import type { EventEmitter } from "node:events";

interface Listener extends EventEmitter {
  start(options: { retryOnClose: boolean }): unknown;
  stop(): unknown;
}
interface Api {
  listener: Listener;
  sendMessage(text: string, peer: string, type?: number): Promise<unknown>;
}
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
  requireConnectedEvent?: boolean;
  onInbound?: (
    message: NonNullable<ReturnType<typeof normalizeInbound>>,
  ) => void;
}
type Status = "connecting" | "connected" | "disconnected" | "expired";
type Delivery =
  { status: "sent"; providerId: string } | { status: "failed" | "unknown" };
const owners = new WeakMap<Listener, object>();
const errorSinks = new WeakSet<Listener>();
const consumeLateError = () => {};
const record = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" ? (x as Record<string, unknown>) : null;
export function normalizeInbound(raw: unknown) {
  const m = record(raw),
    d = record(m?.data);
  if (
    !m ||
    !d ||
    typeof m.threadId !== "string" ||
    !m.threadId ||
    (m.type !== 0 && m.type !== 1) ||
    typeof m.isSelf !== "boolean" ||
    typeof d.msgId !== "string" ||
    !d.msgId ||
    typeof d.uidFrom !== "string"
  )
    return null;
  const base = {
    threadId: m.threadId,
    threadType: m.type,
    providerId: d.msgId,
    senderId: d.uidFrom,
    isSelf: m.isSelf,
  };
  return d.msgType === "webchat" && typeof d.content === "string"
    ? { ...base, kind: "text" as const, text: d.content }
    : { ...base, kind: "unsupported" as const };
}
/** Candidate only: callers explicitly supply an approved SDK facade; no SDK is imported. */
export function createZaloTransport(options: Options) {
  const owner = {};
  let status: Status = "disconnected",
    api: Api | undefined,
    generation = 0,
    stopped = false,
    attempts = 0;
  let pending: Promise<void> | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  let detach = () => {};
  const cancel = () => {
    if (retry) clearTimeout(retry);
    retry = undefined;
  };
  const closeListener = () => {
    detach();
    if (api && owners.get(api.listener) === owner) {
      try {
        api.listener.stop();
      } catch {}
      owners.delete(api.listener);
    }
    api = undefined;
  };
  const stop = () => {
    stopped = true;
    generation++;
    cancel();
    closeListener();
    if (status !== "expired") status = "disconnected";
  };
  const expire = () => {
    stop();
    status = "expired";
  };
  function attach(current: Api) {
    const l = current.listener;
    if (owners.has(l) && owners.get(l) !== owner)
      throw new Error("Listener already owned");
    const token = ++generation;
    owners.set(l, owner);
    api = current;
    // A closure-free sink survives release so delayed SDK error events cannot crash Node.
    if (!errorSinks.has(l)) {
      l.on("error", consumeLateError);
      errorSinks.add(l);
    }
    const valid = () => !stopped && generation === token;
    const interrupted = (code?: number) => {
      if (!valid()) return;
      if (code === 3000 || code === 3003) {
        expire();
        return;
      }
      generation++;
      detach();
      status = "disconnected";
      // SDK stop closes the socket; callbacks from this generation are already fenced.
      try {
        l.stop();
      } catch {}
      if (attempts >= 3) return;
      attempts++;
      retry = setTimeout(() => {
        retry = undefined;
        if (stopped || status === "expired") return;
        try {
          attach(current);
        } catch {
          status = "disconnected";
          closeListener();
        }
      }, options.reconnectDelayMs ?? 1000);
    };
    const connected = () => {
      if (valid()) status = "connected";
    };
    const inbound = (raw: unknown) => {
      if (!valid()) return;
      const message = normalizeInbound(raw);
      if (message) {
        try {
          options.onInbound?.(message);
        } catch {}
      }
    };
    // Consume SDK errors while this listener generation is owned.
    const error = () => interrupted();
    l.on("connected", connected);
    l.on("message", inbound);
    l.on("closed", interrupted);
    l.on("error", error);
    detach = () => {
      l.off("connected", connected);
      l.off("message", inbound);
      l.off("closed", interrupted);
      l.off("error", error);
    };
    status = "connecting";
    try {
      l.start({ retryOnClose: false });
      if (options.requireConnectedEvent === false && status === "connecting")
        status = "connected";
    } catch {
      interrupted();
    }
  }
  const start = (): Promise<void> => {
    if (
      status === "expired" ||
      status === "connected" ||
      status === "connecting" ||
      retry
    )
      return pending ?? Promise.resolve();
    if (pending) return pending;
    stopped = false;
    const token = ++generation;
    status = "connecting";
    pending = (async () => {
      try {
        const created = await options.approvedSdk.createApi({
          logging: false,
          selfListen: true,
          checkUpdate: false,
        });
        if (stopped || token !== generation) return;
        attach(created);
      } catch (e) {
        if (token === generation) status = "disconnected";
        throw e;
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const sendText = async (
    peer: string,
    text: string,
    type = 0,
  ): Promise<Delivery> => {
    if (
      status !== "connected" ||
      !api ||
      !peer ||
      !text ||
      (type !== 0 && type !== 1)
    )
      return { status: "failed" };
    const sendingApi = api,
      sendGeneration = generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve()
          .then(() => {
            if (status !== "connected" || generation !== sendGeneration)
              return { cancelled: true };
            return sendingApi.sendMessage(text, peer, type);
          })
          .then(
            (result): Delivery => {
              if (record(result)?.cancelled) return { status: "failed" };
              const id = record(record(result)?.message)?.msgId;
              // zca-js 2.2.0 SendMessageResult declares msgId:number. Reject
              // unsafe numbers: converting after precision loss cannot recover the ID.
              const providerId =
                typeof id === "string" && id.length > 0
                  ? id
                  : typeof id === "number" && Number.isSafeInteger(id)
                    ? String(id)
                    : null;
              return providerId !== null
                ? { status: "sent", providerId }
                : { status: "unknown" };
            },
            (): Delivery => ({ status: "unknown" }),
          ),
        new Promise<Delivery>((resolve) => {
          timer = setTimeout(
            () => resolve({ status: "unknown" }),
            options.sendTimeoutMs ?? 15000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return {
    start,
    stop,
    sessionInvalid: expire,
    sendText,
    get status() {
      return status;
    },
  };
}
