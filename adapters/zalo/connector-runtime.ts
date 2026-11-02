import type pg from "pg";
import type { LocatorCipher } from "../../server/locator-cipher.js";
import {
  acquireConnectorOwnership,
  type OwnershipHandle,
} from "../../server/connector-ownership.js";
import { ACCOUNT, audit } from "../../server/db.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { runWorkerOnce, type Provider } from "../../server/worker.js";
import { runMediaScheduler } from "../../server/media-scheduler.js";
import type {
  downloadMedia,
  MediaNetworkPolicy,
} from "../../server/private-media-download.js";
import { createSdkProvider } from "./provider.js";
import { createZaloTransport } from "./transport.js";
import { recordProviderFault } from "../../server/provider-faults.js";
type TransportOptions = Parameters<typeof createZaloTransport>[0];
type Facade = TransportOptions["approvedSdk"] & {
  close(): unknown;
  persistSession?(): Promise<void>;
};
type Transport = ReturnType<typeof createZaloTransport>;
interface Options {
  pool: pg.Pool;
  ownerLabel: string;
  /** Explicit private encryption capability, not provider/download activation. */
  mediaCipher?: LocatorCipher;
  maxPendingMedia?: number;
  /** Opt-in bounded media scheduling; absent means no download work is run. */
  media?: {
    policy: MediaNetworkPolicy;
    download?: typeof downloadMedia;
    maxDownloadedBytes?: number;
    retention?: { retentionMs?: number; maxJobs?: number };
  };
  createFacade(): Facade | Promise<Facade>;
  createTransport?: (
    options: TransportOptions,
  ) => Transport | Promise<Transport>;
  createProvider?: (
    pool: pg.Pool,
    transport: Transport,
    owner: OwnershipHandle,
  ) => Provider;
  /** Pilot-only: persist inbound only for the bound account and these exact direct peers. */
  inbound?: { accountId: string; allowedPeerIds: readonly string[] };
  /** Pilot-only: mark provider_state connected under the active owner fence. */
  publishConnected?: boolean;
  /** Pilot-only: synchronous admission predicate checked before inbound, dispatch and publication. */
  guard?: () => boolean;
  /** Pilot-only: restrict outbound claims to these exact direct peers. */
  dispatchPeers?: readonly string[];
  /** Pilot-only: synchronous operator hook when the transport reports a gap. */
  onTransportFault?: () => void;
  acquireOwnership?: typeof acquireConnectorOwnership;
  transportOptions?: Pick<
    TransportOptions,
    | "reconnectDelayMs"
    | "maxReconnectAttempts"
    | "sendTimeoutMs"
    | "handshakeTimeoutMs"
    | "maxPendingInbound"
  >;
}
const unavailable = () => new Error("Connector runtime unavailable");
const peerId = /^[A-Za-z0-9_-]{1,200}$/;
function readInboundPolicy(value: Options["inbound"]) {
  if (value === undefined) return undefined;
  const peers = value?.allowedPeerIds;
  if (
    !value ||
    typeof value.accountId !== "string" ||
    !peerId.test(value.accountId) ||
    !Array.isArray(peers) ||
    peers.length < 1 ||
    peers.length > 4 ||
    !peers.every((peer) => typeof peer === "string" && peerId.test(peer)) ||
    new Set(peers).size !== peers.length ||
    peers.includes(value.accountId)
  )
    throw unavailable();
  return Object.freeze({
    ownAccountId: value.accountId,
    peers: new Set(peers),
  });
}
function readDispatchPeers(value: Options["dispatchPeers"]) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 4 ||
    !value.every((peer) => typeof peer === "string" && peerId.test(peer)) ||
    new Set(value).size !== value.length
  )
    throw unavailable();
  return Object.freeze([...value]);
}
/** Inbound content from any other direct peer, group or mismatched sender is dropped unpersisted. */
export function admitPilotInbound(
  peers: ReadonlySet<string>,
  ownAccountId: string,
  event: {
    threadType: 0 | 1;
    threadId: string;
    senderId: string;
    isSelf: boolean;
  },
) {
  return (
    event.threadType === 0 &&
    peers.has(event.threadId) &&
    (event.isSelf === true
      ? event.senderId === ownAccountId
      : event.senderId === event.threadId)
  );
}
/** Injected, single-lifetime connector. No SDK import, login default, executable or live switch. */
export function createOwnedConnector(options: Options) {
  const inboundPeers = readInboundPolicy(options.inbound);
  const dispatchPeers = readDispatchPeers(options.dispatchPeers);
  if (
    dispatchPeers &&
    inboundPeers &&
    dispatchPeers.some((peer) => !inboundPeers.peers.has(peer))
  )
    throw unavailable();
  if (
    options.publishConnected !== undefined &&
    typeof options.publishConnected !== "boolean"
  )
    throw unavailable();
  if (options.guard !== undefined && typeof options.guard !== "function")
    throw unavailable();
  if (
    options.onTransportFault !== undefined &&
    typeof options.onTransportFault !== "function"
  )
    throw unavailable();
  let rejectedInbound = 0;
  let status: "stopped" | "starting" | "active" | "blocked" = "stopped";
  let gap = false;
  let terminal = false,
    pending: Promise<void> | undefined,
    cancel: (() => void) | undefined;
  let owner: OwnershipHandle | undefined,
    facade: Facade | undefined,
    transport: Transport | undefined,
    provider: Provider | undefined,
    governedOwner: OwnershipHandle | undefined;
  const faultWrites = new Set<Promise<void>>();
  let disposedFacade: Facade | undefined,
    disposedTransport: Transport | undefined;
  const cleanup = () => {
    if (transport && transport !== disposedTransport) {
      disposedTransport = transport;
      try {
        Promise.resolve(transport.stop()).catch(() => {});
      } catch {}
    }
    if (facade && facade !== disposedFacade) {
      disposedFacade = facade;
      try {
        Promise.resolve(facade.close()).catch(() => {});
      } catch {}
    }
  };
  const block = () => {
    if (status !== "stopped") status = "blocked";
  };
  const revoked = () => {
    terminal = true;
    block();
    cancel?.();
    cleanup();
  };
  const assertCurrent = async () => {
    if (terminal || !owner?.admitted) throw unavailable();
    try {
      await owner.assertCurrent();
    } catch {
      revoked();
      throw unavailable();
    }
    if (terminal || !owner.admitted) throw unavailable();
  };
  const closeOwner = async () => {
    try {
      await owner?.close();
    } catch {}
  };
  const guardPasses = () => {
    if (!options.guard) return true;
    try {
      return options.guard() === true;
    } catch {
      return false;
    }
  };
  const admissible = () =>
    !terminal && !gap && owner?.admitted === true && guardPasses();
  const waitForConnected = async () => {
    if (!transport) throw unavailable();
    const deadline =
      Date.now() +
      Math.max(
        1000,
        (options.transportOptions?.handshakeTimeoutMs ?? 15000) + 1000,
      );
    while (transport.status !== "connected") {
      if (!admissible() || transport.status !== "connecting")
        throw unavailable();
      if (Date.now() >= deadline) throw unavailable();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!admissible()) throw unavailable();
  };
  /** Publish app-observable provider state only under the active owner row lock. */
  const publishConnected = async () => {
    if (options.publishConnected !== true) return;
    if (!transport || transport.status !== "connected" || !admissible())
      throw unavailable();
    const db = await options.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL statement_timeout='2000ms'");
      const current = await db.query(
        "SELECT account_id FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase='active' FOR SHARE",
        [ACCOUNT, owner!.token.ownerId, owner!.token.epoch],
      );
      if (
        !current.rowCount ||
        transport.status !== "connected" ||
        !admissible()
      )
        throw unavailable();
      const published = await db.query(
        "UPDATE provider_state SET status='connected',last_event_at=now() WHERE account_id=$1 AND reconciliation_required=false",
        [ACCOUNT],
      );
      if (published.rowCount !== 1) throw unavailable();
      await audit(db, null, "provider.state", ACCOUNT, {
        status: "connected",
        ownerLabel: options.ownerLabel,
      });
      // Re-check the live transport immediately before commit: the guard is
      // in-process, so a disconnect during the round-trip must roll back.
      if (transport.status !== "connected" || !admissible())
        throw unavailable();
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK").catch(() => {});
      throw unavailable();
    } finally {
      db.release();
    }
  };
  const discardApi = (api: Awaited<ReturnType<Facade["createApi"]>>) => {
    // Rejected APIs never reach the transport's sink installation. Late SDK
    // errors must still be consumed after a pending factory resolves.
    try {
      api.listener.on("error", () => {});
    } catch {}
    try {
      Promise.resolve(api.listener.stop()).catch(() => {});
    } catch {}
  };
  const start = (): Promise<void> => {
    if (pending) return pending;
    if (status === "active" && !terminal) return Promise.resolve();
    if (terminal) return Promise.reject(unavailable());
    status = "starting";
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(unavailable());
    });
    const work = (async () => {
      try {
        owner = await (options.acquireOwnership ?? acquireConnectorOwnership)(
          options.pool,
          { ownerLabel: options.ownerLabel, onRevoked: revoked },
        );
        await assertCurrent();
        facade = await options.createFacade();
        if (terminal) {
          cleanup();
          throw unavailable();
        }
        await assertCurrent();
        const approvedSdk: Facade["createApi"] = async (safe) => {
          await assertCurrent();
          const api = await facade!.createApi(safe);
          if (terminal || !owner!.admitted) {
            discardApi(api);
            throw unavailable();
          }
          // Query again after login: loss during initialization must never expose an API.
          try {
            await assertCurrent();
          } catch {
            discardApi(api);
            throw unavailable();
          }
          return api;
        };
        transport = await (options.createTransport ?? createZaloTransport)({
          ...options.transportOptions,
          approvedSdk: { createApi: approvedSdk },
          captureMedia: !!options.mediaCipher,
          onInbound: async (event) => {
            if (!guardPasses()) {
              rejectedInbound++;
              return;
            }
            await assertCurrent();
            // The fence await can cross the grant expiry; re-check before persistence.
            if (!guardPasses()) {
              rejectedInbound++;
              return;
            }
            if (
              inboundPeers &&
              !admitPilotInbound(
                inboundPeers.peers,
                inboundPeers.ownAccountId,
                event,
              )
            ) {
              rejectedInbound++;
              return;
            }
            await ingestProviderEvent(options.pool, event, {
              owner: owner!.token,
              mediaCipher: options.mediaCipher,
              maxPendingMedia: options.maxPendingMedia,
            });
          },
          onFault: (reason) => {
            // Block dispatch synchronously; durable fault persistence may await a pool.
            gap = true;
            try {
              options.onTransportFault?.();
            } catch {}
            const write = (async () => {
              const db = await options.pool.connect();
              try {
                await db.query("BEGIN");
                await db.query("SET LOCAL statement_timeout='2000ms'");
                // Hold the owner row until the gap write commits. A plain MVCC
                // EXISTS could admit an old callback then overwrite a new owner.
                const current = await db.query(
                  "SELECT account_id FROM connector_ownership WHERE account_id=$1 AND owner_id=$2 AND epoch=$3 AND phase IN ('reserved','active') FOR SHARE",
                  [ACCOUNT, owner!.token.ownerId, owner!.token.epoch],
                );
                if (current.rowCount) {
                  await recordProviderFault(db, reason);
                  await db.query(
                    "INSERT INTO audit(account_id,action,target_id,metadata) VALUES($1,'connector.gap',$2,$3)",
                    [
                      ACCOUNT,
                      owner!.token.ownerId,
                      { epoch: owner!.token.epoch, reason },
                    ],
                  );
                }
                await db.query("COMMIT");
              } catch {
                await db.query("ROLLBACK").catch(() => {});
                throw unavailable();
              } finally {
                db.release();
              }
            })();
            faultWrites.add(write);
            void write.catch(() => {}).finally(() => faultWrites.delete(write));
            return write;
          },
        });
        if (terminal) {
          cleanup();
          throw unavailable();
        }
        await assertCurrent();
        const dispatchOwner: OwnershipHandle = {
          token: owner.token,
          get admitted() {
            return owner!.admitted && !gap && !terminal;
          },
          async assertCurrent() {
            await assertCurrent();
            if (gap) throw unavailable();
          },
          markActive: () => owner!.markActive(),
          invalidate: (reason) => owner!.invalidate(reason),
          close: () => owner!.close(),
        };
        governedOwner = dispatchOwner;
        provider = (options.createProvider ?? createSdkProvider)(
          options.pool,
          transport,
          dispatchOwner,
        );
        await transport.start();
        await assertCurrent();
        await owner.markActive();
        await assertCurrent();
        if (options.publishConnected === true) {
          await waitForConnected();
          await publishConnected();
          await assertCurrent();
        }
        status = "active";
      } catch {
        terminal = true;
        block();
        cleanup();
        governedOwner = undefined;
        try {
          await owner?.invalidate("initialization-failed");
        } catch {}
        throw unavailable();
      }
    })();
    // Always observe late initialization, including a factory resolving after stop.
    pending = Promise.race([work, cancelled]).finally(() => {
      pending = undefined;
      cancel = undefined;
    });
    return pending;
  };
  return {
    start,
    async stop() {
      terminal = true;
      status = "stopped";
      cancel?.();
      cleanup();
      governedOwner = undefined;
      // A fault raised just before teardown must still be durable before the
      // owner row is closed. Bound the wait so a dead pool cannot hang stop().
      if (faultWrites.size)
        await Promise.race([
          Promise.allSettled([...faultWrites]),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
      await closeOwner();
    },
    async runOnce() {
      if (!guardPasses()) return { processed: false };
      await assertCurrent();
      if (status !== "active" || !provider) throw unavailable();
      return runWorkerOnce(
        options.pool,
        provider,
        dispatchPeers ? { peers: dispatchPeers } : undefined,
      );
    },
    /** One bounded media step under the same dispatch fence; never sends mail. */
    async runMediaOnce() {
      if (!guardPasses()) return { processed: false };
      await assertCurrent();
      if (
        status !== "active" ||
        !governedOwner ||
        !options.mediaCipher ||
        !options.media?.policy
      )
        throw unavailable();
      return runMediaScheduler({
        pool: options.pool,
        worker: {
          owner: governedOwner,
          cipher: options.mediaCipher,
          policy: options.media.policy,
          ...(options.media.download
            ? { download: options.media.download }
            : {}),
          ...(options.media.maxDownloadedBytes !== undefined
            ? { maxDownloadedBytes: options.media.maxDownloadedBytes }
            : {}),
        },
        ...(options.media.retention
          ? { retention: options.media.retention }
          : {}),
        maintenanceEvery: 1,
        maxIterations: 1,
        idleDelayMs: 0,
        sleep: async () => {},
      });
    },
    async persistSession() {
      await assertCurrent();
      if (status !== "active" || !facade?.persistSession) throw unavailable();
      try {
        await facade.persistSession();
        await assertCurrent();
      } catch {
        revoked();
        try {
          await owner?.invalidate("initialization-failed");
        } catch {}
        throw unavailable();
      }
    },
    get status() {
      return status;
    },
    get rejectedInbound() {
      return rejectedInbound;
    },
  };
}
export type OwnedConnector = ReturnType<typeof createOwnedConnector>;
