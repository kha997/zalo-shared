import { normalizeMediaCandidate } from "./inbound-media.js";
import type { EventEmitter } from "node:events";
import { prepareMedia, type MediaInput } from "./media.js";

interface Listener extends EventEmitter {
  start(options: { retryOnClose: boolean }): unknown;
  stop(): unknown;
}
interface Api {
  listener: Listener;
  sendMessage(text: string, peer: string, type?: number): Promise<unknown>;
  sendAttachment?(
    input: MediaInput,
    peer: string,
    type?: number,
  ): Promise<unknown>;
}
export type TransportFault =
  | "ingress-failed"
  | "ingress-overflow"
  | "invalid-inbound"
  | "connection-lost"
  | "initialization-failed";
interface Options {
  approvedSdk: {
    createApi(options: {
      logging: false;
      selfListen: true;
      checkUpdate: false;
    }): Promise<Api>;
  };
  reconnectDelayMs?: number;
  sendTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  maxPendingInbound?: number;
  requireConnectedEvent?: boolean;
  /** Private candidate capture requires an upstream encrypted receipt consumer. Default false. */
  captureMedia?: boolean;
  onInbound?: (
    message: NonNullable<ReturnType<typeof normalizeInbound>>,
  ) => void | Promise<void>;
  onFault?: (reason: TransportFault) => void | Promise<void>;
}
type Status = "connecting" | "connected" | "disconnected" | "expired";
type Delivery =
  { status: "sent"; providerId: string } | { status: "failed" | "unknown" };
const owners = new WeakMap<Listener, object>();
const errorSinks = new WeakSet<Listener>();
const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
const boundedId = (x: unknown, max = 200): x is string =>
  typeof x === "string" &&
  x.trim().length > 0 &&
  x.length <= max &&
  !x.includes("\0");

export function normalizeInbound(raw: unknown, captureMedia = false) {
  const m = record(raw),
    d = record(m?.data);
  if (
    !m ||
    !d ||
    !boundedId(m.threadId) ||
    (m.type !== 0 && m.type !== 1) ||
    typeof m.isSelf !== "boolean" ||
    !boundedId(d.msgId) ||
    !boundedId(d.uidFrom)
  )
    return null;
  if (
    d.msgType === "webchat" &&
    typeof d.content === "string" &&
    d.content.length > 10000
  )
    return null;
  const base = {
    threadId: m.threadId,
    threadType: m.type as 0 | 1,
    providerId: d.msgId,
    senderId: d.uidFrom,
    isSelf: m.isSelf,
    ...(boundedId(d.cliMsgId) ? { clientId: d.cliMsgId } : {}),
    ...(boundedId(d.ts, 64) ? { providerTimestamp: d.ts } : {}),
  };
  const media = captureMedia === true ? normalizeMediaCandidate(raw) : null;
  return d.msgType === "webchat" && typeof d.content === "string"
    ? { ...base, kind: "text" as const, text: d.content }
    : { ...base, kind: "unsupported" as const, ...(media ? { media } : {}) };
}

/** Injected transport only: no SDK import or default account authentication. */
export function createZaloTransport(options: Options) {
  const delay = options.reconnectDelayMs ?? 1000,
    sendTimeout = options.sendTimeoutMs ?? 15000;
  const handshakeTimeout = options.handshakeTimeoutMs ?? 15000,
    maxInbound = options.maxPendingInbound ?? 100;
  for (const n of [delay, sendTimeout, handshakeTimeout])
    if (!Number.isInteger(n) || n < 1 || n > 60000)
      throw new Error("Invalid transport bounds");
  if (!Number.isInteger(maxInbound) || maxInbound < 1 || maxInbound > 1000)
    throw new Error("Invalid ingress bounds");
  const owner = {},
    used = new WeakSet<Listener>();
  let status: Status = "disconnected",
    api: Api | undefined;
  let generation = 0,
    stopped = false,
    attempts = 0,
    pending: Promise<void> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined,
    handshake: ReturnType<typeof setTimeout> | undefined;
  let cancelCreation: (() => void) | undefined,
    detach = () => {};
  let ingressFault: TransportFault | undefined,
    processing = false,
    blocked = false;
  const queue: NonNullable<ReturnType<typeof normalizeInbound>>[] = [];
  let idleWaiters: (() => void)[] = [];
  const notify = (reason: TransportFault) => {
    const unavailable = () => {
      // A failed gap/fault observer must not let automatic reconnect hide the gap.
      ingressFault ??= "ingress-failed";
      stop();
    };
    try {
      Promise.resolve(options.onFault?.(reason)).catch(unavailable);
    } catch {
      unavailable();
    }
  };
  const clearHandshake = () => {
    if (handshake) clearTimeout(handshake);
    handshake = undefined;
  };
  const sink = (listener: Listener) => {
    if (!errorSinks.has(listener)) {
      listener.on("error", () => {});
      errorSinks.add(listener);
    }
  };
  const dispose = (current: Api) => {
    // A stale factory may alias a listener already adopted by the new generation.
    if (api?.listener === current.listener) return;
    if (owners.has(current.listener) && owners.get(current.listener) !== owner)
      return;
    try {
      sink(current.listener);
      Promise.resolve(current.listener.stop()).catch(() => {});
    } catch {}
  };
  const release = () => {
    clearHandshake();
    detach();
    detach = () => {};
    const old = api;
    api = undefined;
    if (old && owners.get(old.listener) === owner) {
      owners.delete(old.listener);
      dispose(old);
    }
  };
  const stop = () => {
    stopped = true;
    generation++;
    if (retry) clearTimeout(retry);
    retry = undefined;
    cancelCreation?.();
    // Cancelled work still disposes its late result, but must not swallow a new start.
    pending = undefined;
    release();
    if (status !== "expired") status = "disconnected";
  };
  const expire = () => {
    stop();
    status = "expired";
  };
  const failIngress = (reason: TransportFault) => {
    if (ingressFault) return;
    ingressFault = reason;
    stop();
    notify(reason);
  };
  const settleIdle = () => {
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  };
  async function consume() {
    if (processing || blocked) return;
    processing = true;
    try {
      while (queue.length) {
        const event = queue.shift()!;
        try {
          if (!options.onInbound) throw new Error("No durable consumer");
          await options.onInbound(event);
        } catch {
          // Bounded work remains in memory; no automatic retry or no-loss claim.
          queue.unshift(event);
          blocked = true;
          failIngress("ingress-failed");
          break;
        }
      }
    } finally {
      processing = false;
      settleIdle();
    }
  }
  const drain = async () => {
    if (processing)
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    if (ingressFault) throw new Error("Inbound unavailable: " + ingressFault);
  };

  function attach(current: Api) {
    const l = current.listener;
    if (owners.has(l) || used.has(l))
      throw new Error("Listener already owned or used");
    const token = ++generation;
    used.add(l);
    owners.set(l, owner);
    api = current;
    sink(l);
    const valid = () => !stopped && token === generation;
    const interrupted = (code?: number) => {
      if (!valid()) return;
      if (code === 3000 || code === 3003) {
        expire();
        notify("connection-lost");
        return;
      }
      generation++;
      release();
      status = "disconnected";
      notify("connection-lost");
      if (stopped || ingressFault || attempts >= 3) return;
      attempts++;
      retry = setTimeout(() => {
        retry = undefined;
        if (stopped || status === "expired" || ingressFault) return;
        const reconnect = createOne();
        pending = reconnect;
        void reconnect
          .catch(() => {})
          .finally(() => {
            if (pending === reconnect) pending = undefined;
          });
      }, delay);
    };
    const connected = () => {
      if (valid()) {
        clearHandshake();
        status = "connected";
      }
    };
    const inbound = (raw: unknown) => {
      if (!valid()) return;
      const message = normalizeInbound(raw, options.captureMedia === true);
      if (!message) {
        failIngress("invalid-inbound");
        return;
      }
      if (queue.length + (processing ? 1 : 0) >= maxInbound) {
        failIngress("ingress-overflow");
        return;
      }
      queue.push(message);
      void consume();
    };
    const error = () => interrupted();
    l.on("connected", connected);
    l.on("message", inbound);
    l.on("closed", interrupted);
    l.on("disconnected", interrupted);
    l.on("error", error);
    detach = () => {
      l.off("connected", connected);
      l.off("message", inbound);
      l.off("closed", interrupted);
      l.off("disconnected", interrupted);
      l.off("error", error);
    };
    status = "connecting";
    handshake = setTimeout(() => interrupted(), handshakeTimeout);
    try {
      Promise.resolve(l.start({ retryOnClose: false })).catch(() =>
        interrupted(),
      );
      if (
        options.requireConnectedEvent === false &&
        valid() &&
        status === "connecting"
      )
        connected();
    } catch {
      interrupted();
    }
  }

  async function createOne(): Promise<void> {
    const token = ++generation;
    status = "connecting";
    const valid = () => !stopped && token === generation;
    let cancel!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
      cancelCreation = cancel;
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Transport initialization timeout")),
        handshakeTimeout,
      );
    });
    const work = (async () => {
      const created = await options.approvedSdk.createApi({
        logging: false,
        selfListen: true,
        checkUpdate: false,
      });
      if (!valid()) {
        dispose(created);
        return;
      }
      attach(created);
    })();
    try {
      await Promise.race([work, cancelled, timeout]);
    } catch (error) {
      if (valid()) {
        generation++;
        release();
        status = "disconnected";
        notify("initialization-failed");
      }
      if (
        error instanceof Error &&
        error.message === "Listener already owned or used"
      )
        throw error;
      throw new Error("Transport initialization unavailable");
    } finally {
      if (timer) clearTimeout(timer);
      if (cancelCreation === cancel) cancelCreation = undefined;
    }
  }
  const start = (): Promise<void> => {
    if (ingressFault)
      return Promise.reject(new Error("Inbound reconciliation required"));
    if (
      status === "expired" ||
      status === "connected" ||
      status === "connecting" ||
      retry
    )
      return pending ?? Promise.resolve();
    if (pending) return pending;
    stopped = false;
    const opening = createOne().finally(() => {
      if (pending === opening) pending = undefined;
    });
    pending = opening;
    return opening;
  };
  const dispatch = async (
    sendingApi: Api,
    invoke: () => Promise<unknown>,
    acceptedId: (result: unknown) => unknown,
  ): Promise<Delivery> => {
    const token = generation;
    const notDispatched = Symbol("transport-not-dispatched");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve()
          .then(() => {
            if (
              status !== "connected" ||
              token !== generation ||
              api !== sendingApi
            )
              return notDispatched;
            return invoke();
          })
          .then((result): Delivery => {
            if (result === notDispatched) return { status: "failed" };
            const id = acceptedId(result);
            const providerId = boundedId(id)
              ? id
              : typeof id === "number" && Number.isSafeInteger(id) && id >= 0
                ? String(id)
                : null;
            return providerId !== null
              ? { status: "sent", providerId }
              : { status: "unknown" };
          })
          .catch((): Delivery => ({ status: "unknown" })),
        new Promise<Delivery>((resolve) => {
          timer = setTimeout(() => resolve({ status: "unknown" }), sendTimeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const sendText = async (
    peer: string,
    text: string,
    type = 0,
  ): Promise<Delivery> => {
    if (
      status !== "connected" ||
      !api ||
      !boundedId(peer) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 10000 ||
      (type !== 0 && type !== 1)
    )
      return { status: "failed" };
    const sendingApi = api;
    return dispatch(
      sendingApi,
      () => sendingApi.sendMessage(text, peer, type),
      (result) => record(record(result)?.message)?.msgId,
    );
  };
  const sendAttachment = async (
    input: MediaInput,
    peer: string,
    type = 0,
  ): Promise<Delivery> => {
    if (
      status !== "connected" ||
      !api ||
      !api.sendAttachment ||
      !boundedId(peer) ||
      (type !== 0 && type !== 1)
    )
      return { status: "failed" };
    let media: MediaInput;
    try {
      const source = prepareMedia(input);
      media = { name: source.filename, mime: input.mime, data: source.data };
    } catch {
      return { status: "failed" };
    }
    const sendingApi = api;
    return dispatch(
      sendingApi,
      () => sendingApi.sendAttachment!(media, peer, type),
      (result) => {
        const r = record(result);
        return r?.message === null &&
          Array.isArray(r.attachment) &&
          r.attachment.length === 1
          ? record(r.attachment[0])?.msgId
          : undefined;
      },
    );
  };
  return {
    start,
    stop,
    drain,
    sessionInvalid: expire,
    sendText,
    sendAttachment,
    get status() {
      return status;
    },
  };
}
