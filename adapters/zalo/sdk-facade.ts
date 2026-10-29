import { EventEmitter } from "node:events";
import { prepareMedia, type MediaInput } from "./media.js";
interface SafeOptions {
  logging: false;
  selfListen: true;
  checkUpdate: false;
}
interface Options {
  sessionStore: {
    read(): Promise<unknown>;
    write(value: unknown): Promise<void>;
  };
  allowNetworkLogin?: boolean;
  loginTimeoutMs?: number;
  /** Injection is for offline tests; never pass an untrusted loader. */
  loader?: () => unknown | Promise<unknown>;
}
type RecordValue = Record<string, any>;
const unavailable = () => new Error("SDK facade unavailable");
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unavailable();
  return value as RecordValue;
}
function boundedClone(value: unknown): any {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > 65536) throw unavailable();
  return JSON.parse(json);
}
function cookies(value: unknown): any[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256)
    throw unavailable();
  for (const entry of value) {
    const c = record(entry);
    if (
      typeof c.key !== "string" ||
      !c.key ||
      typeof c.value !== "string" ||
      !c.value ||
      typeof c.domain !== "string" ||
      !c.domain ||
      typeof c.path !== "string" ||
      !c.path
    )
      throw unavailable();
  }
  return value;
}
function credentials(value: unknown) {
  const v = record(boundedClone(value));
  if (
    typeof v.imei !== "string" ||
    !v.imei.trim() ||
    typeof v.userAgent !== "string" ||
    !v.userAgent.trim()
  )
    throw unavailable();
  return { imei: v.imei, userAgent: v.userAgent, cookie: cookies(v.cookie) };
}
function stop(raw: any) {
  try {
    raw?.listener?.on("error", () => {});
    Promise.resolve(raw?.listener?.stop()).catch(() => {});
  } catch {
    /* Never expose SDK exceptions. */
  }
}
/** Offline candidate only. No SDK load or vault access occurs without explicit authorization. */
export function createSdkFacade(options: Options) {
  const timeout = options.loginTimeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000)
    throw unavailable();
  let closed = false,
    busy = false,
    generation = 0;
  // Caller timeout never releases the underlying write exclusion.
  let writeTail: Promise<void> = Promise.resolve();
  let cancel: (() => void) | undefined;
  let active:
    | {
        raw: RecordValue;
        identity: { imei: string; userAgent: string };
        proxy: EventEmitter;
        detach(): void;
      }
    | undefined;
  const release = () => {
    const old = active;
    active = undefined;
    if (old) {
      try {
        old.detach();
      } catch {}
      stop(old.raw);
    }
  };
  async function persist(current: NonNullable<typeof active>, token: number) {
    if (closed || token !== generation) throw unavailable();
    const jar = record(current.raw.getCookie());
    if (typeof jar.serializeSync !== "function") throw unavailable();
    const snapshot = record(boundedClone(jar.serializeSync()));
    const session = credentials({
      ...current.identity,
      cookie: cookies(snapshot.cookies),
    });
    if (closed || token !== generation) throw unavailable();
    const writing = writeTail.then(async () => {
      // Queued generations may expire before the preceding write settles.
      if (closed || token !== generation) throw unavailable();
      await options.sessionStore.write(session);
      if (closed || token !== generation) throw unavailable();
    });
    writeTail = writing.catch(() => {});
    await writing;
  }
  async function createApi(_safeOptions?: SafeOptions) {
    if (options.allowNetworkLogin !== true || closed || busy)
      throw unavailable();
    busy = true;
    const token = ++generation;
    release();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => reject(unavailable());
      timer = setTimeout(() => {
        generation++;
        cancel?.();
      }, timeout);
    });
    const valid = () => !closed && generation === token;
    const work = (async () => {
      const input = credentials(await options.sessionStore.read());
      if (!valid()) throw unavailable();
      const identity = { imei: input.imei, userAgent: input.userAgent };
      const module = record(
        await (options.loader ?? (() => import("zca-js")))(),
      );
      if (!valid()) throw unavailable();
      if (typeof module.Zalo !== "function") throw unavailable();
      const instance = new module.Zalo({
        logging: false,
        selfListen: true,
        checkUpdate: false,
      });
      const raw = await instance.login(boundedClone(input));
      if (!valid()) {
        stop(raw);
        throw unavailable();
      }
      try {
        record(raw);
        const listener = record(raw.listener);
        for (const name of ["on", "off", "start", "stop"])
          if (typeof listener[name] !== "function") throw unavailable();
        if (
          typeof raw.sendMessage !== "function" ||
          typeof raw.getCookie !== "function"
        )
          throw unavailable();
        const proxy = new EventEmitter();
        proxy.on("error", () => {});
        const bindings = [
          "connected",
          "closed",
          "disconnected",
          "message",
          "error",
        ].map((event) => {
          const handler = (...args: unknown[]) => {
            if (valid() && active?.raw === raw)
              proxy.emit(
                event,
                ...(event === "error"
                  ? [unavailable()]
                  : event === "message"
                    ? [args[0]]
                    : event !== "connected" &&
                        typeof args[0] === "number" &&
                        Number.isSafeInteger(args[0])
                      ? [args[0]]
                      : []),
              );
          };
          listener.on(event, handler);
          return { event, handler };
        });
        const current = {
          raw,
          identity,
          proxy,
          detach: () => {
            for (const b of bindings) listener.off(b.event, b.handler);
          },
        };
        active = current;
        await persist(current, token);
        const ensure = () => {
          if (!valid() || active !== current) throw unavailable();
        };
        Object.assign(proxy, {
          start: (_opts: unknown) => {
            try {
              ensure();
              Promise.resolve(listener.start({ retryOnClose: false })).catch(
                () => {
                  if (valid()) proxy.emit("error", unavailable());
                },
              );
            } catch {
              throw unavailable();
            }
          },
          stop: () => {
            try {
              ensure();
              Promise.resolve(listener.stop()).catch(() => {
                if (valid()) proxy.emit("error", unavailable());
              });
            } catch {
              throw unavailable();
            }
          },
        });
        return {
          listener: proxy as EventEmitter & {
            start(options: { retryOnClose: boolean }): void;
            stop(): void;
          },
          sendAttachment: async (input: MediaInput, peer: string, type = 0) => {
            try {
              ensure();
              if (
                typeof peer !== "string" ||
                !peer.trim() ||
                peer.length > 200 ||
                peer.includes("\0") ||
                (type !== 0 && type !== 1)
              )
                throw unavailable();
              const source = prepareMedia(input);
              const result = record(
                await raw.sendMessage(
                  { msg: "", attachments: [source] },
                  peer,
                  type,
                ),
              );
              ensure();
              if (
                result.message !== null ||
                !Array.isArray(result.attachment) ||
                result.attachment.length !== 1
              )
                throw unavailable();
              const entry = record(result.attachment[0]);
              const id = entry.msgId;
              if (!(
                (typeof id === "string" &&
                  id.trim().length > 0 &&
                  id.length <= 200 &&
                  !id.includes("\0")) ||
                (typeof id === "number" && Number.isSafeInteger(id) && id >= 0)
              ))
                throw unavailable();
              return {
                message: null,
                attachment: [{ msgId: id as string | number }],
              };
            } catch {
              throw unavailable();
            }
          },
          sendMessage: async (text: string, peer: string, type = 0) => {
            try {
              ensure();
              if (
                typeof text !== "string" ||
                !text.trim() ||
                text.length > 10000 ||
                typeof peer !== "string" ||
                !peer.trim() ||
                peer.length > 200 ||
                (type !== 0 && type !== 1)
              )
                throw unavailable();
              const result = record(await raw.sendMessage(text, peer, type));
              ensure();
              const id = (value: unknown) =>
                (typeof value === "string" && value.length > 0) ||
                (typeof value === "number" && Number.isSafeInteger(value));
              const message =
                result.message == null ? null : record(result.message);
              if (message && !id(message.msgId)) throw unavailable();
              const attachment = Array.isArray(result.attachment)
                ? result.attachment.map((item: unknown) => {
                    const entry = record(item);
                    if (!id(entry.msgId)) throw unavailable();
                    return { msgId: entry.msgId };
                  })
                : [];
              return {
                message: message ? { msgId: message.msgId } : null,
                attachment,
              };
            } catch {
              throw unavailable();
            }
          },
        };
      } catch {
        if (active?.raw === raw) release();
        else stop(raw);
        throw unavailable();
      }
    })();
    try {
      return await Promise.race([work, interrupted]);
    } catch {
      if (generation === token) generation++;
      release();
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      cancel = undefined;
      busy = false;
    }
  }
  return {
    createApi,
    persistSession: async () => {
      if (closed || busy || !active) throw unavailable();
      busy = true;
      try {
        await persist(active, generation);
      } catch {
        generation++;
        release();
        throw unavailable();
      } finally {
        busy = false;
      }
    },
    close: () => {
      closed = true;
      generation++;
      cancel?.();
      release();
    },
  };
}
