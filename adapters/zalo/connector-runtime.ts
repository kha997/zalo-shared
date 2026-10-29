import type pg from "pg";
import {
  acquireConnectorOwnership,
  type OwnershipHandle,
} from "../../server/connector-ownership.js";
import { ACCOUNT } from "../../server/db.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { runWorkerOnce, type Provider } from "../../server/worker.js";
import { createSdkProvider } from "./provider.js";
import { createZaloTransport } from "./transport.js";
type TransportOptions = Parameters<typeof createZaloTransport>[0];
type Facade = TransportOptions["approvedSdk"] & {
  close(): unknown;
  persistSession?(): Promise<void>;
};
type Transport = ReturnType<typeof createZaloTransport>;
interface Options {
  pool: pg.Pool;
  ownerLabel: string;
  createFacade(): Facade | Promise<Facade>;
  createTransport?: (
    options: TransportOptions,
  ) => Transport | Promise<Transport>;
  createProvider?: (
    pool: pg.Pool,
    transport: Transport,
    owner: OwnershipHandle,
  ) => Provider;
  acquireOwnership?: typeof acquireConnectorOwnership;
  transportOptions?: Pick<
    TransportOptions,
    | "reconnectDelayMs"
    | "sendTimeoutMs"
    | "handshakeTimeoutMs"
    | "maxPendingInbound"
  >;
}
const unavailable = () => new Error("Connector runtime unavailable");
/** Injected, single-lifetime connector. No SDK import, login default, executable or live switch. */
export function createOwnedConnector(options: Options) {
  let status: "stopped" | "starting" | "active" | "blocked" = "stopped";
  let gap = false;
  let terminal = false,
    pending: Promise<void> | undefined,
    cancel: (() => void) | undefined;
  let owner: OwnershipHandle | undefined,
    facade: Facade | undefined,
    transport: Transport | undefined,
    provider: Provider | undefined;
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
          onInbound: async (event) => {
            await assertCurrent();
            await ingestProviderEvent(options.pool, event, {
              owner: owner!.token,
            });
          },
          onFault: async (reason) => {
            // Block dispatch synchronously; durable fault persistence may await a pool.
            gap = true;
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
                await db.query(
                  "UPDATE provider_state SET status='disconnected',reconciliation_required=true,fault_code=$2 WHERE account_id=$1",
                  [ACCOUNT, reason],
                );
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
        provider = (options.createProvider ?? createSdkProvider)(
          options.pool,
          transport,
          dispatchOwner,
        );
        await transport.start();
        await assertCurrent();
        await owner.markActive();
        await assertCurrent();
        status = "active";
      } catch {
        terminal = true;
        block();
        cleanup();
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
      await closeOwner();
    },
    async runOnce() {
      await assertCurrent();
      if (status !== "active" || !provider) throw unavailable();
      return runWorkerOnce(options.pool, provider);
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
  };
}
