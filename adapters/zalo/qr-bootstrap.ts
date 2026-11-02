import type { OwnershipHandle } from "../../server/connector-ownership.js";
import type {
  PrivateQrView,
  PrivateSessionStore,
} from "../../server/private-pilot-files.js";
import type { PilotGrant } from "../../server/pilot-policy.js";

export type TrustedSdkLoader = () => unknown | Promise<unknown>;

const BOOTSTRAP_DEADLINE_MS = 120_000;
const MAX_QR_BYTES = 1024 * 1024;
const MAX_SESSION_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_MS = 30_000;
const VIEW_SETTLE_MS = 5_000;
const accountIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const unavailable = () => new Error("SDK facade unavailable");
export const QUARANTINE_UNCONFIRMED = "quarantine-unconfirmed";
export class PilotSessionQuarantineError extends Error {
  readonly code = QUARANTINE_UNCONFIRMED;
  constructor() {
    super(QUARANTINE_UNCONFIRMED);
    this.name = "PilotSessionQuarantineError";
  }
}

type RecordValue = Record<string, any>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unavailable();
  return value as RecordValue;
}

function boundedClone(value: unknown): any {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > MAX_SESSION_BYTES) throw unavailable();
  return JSON.parse(json);
}

function safeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?")
    .slice(0, 80);
  return cleaned.trim() ? cleaned : null;
}

function validIdentity(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validCookies(value: unknown): any[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256)
    throw unavailable();
  for (const entry of value) {
    const cookie = record(entry);
    if (
      !validIdentity(cookie.key, 256) ||
      !validIdentity(cookie.value, 4096) ||
      !validIdentity(cookie.domain, 256) ||
      !validIdentity(cookie.path, 256)
    )
      throw unavailable();
  }
  return boundedClone(value);
}

function decodePng(value: unknown): Uint8Array {
  if (typeof value !== "string") throw unavailable();
  let encoded = value;
  if (encoded.startsWith("data:")) {
    if (!encoded.startsWith("data:image/png;base64,")) throw unavailable();
    encoded = encoded.slice("data:image/png;base64,".length);
  }
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    encoded.length > Math.ceil((MAX_QR_BYTES * 4) / 3) + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw unavailable();
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length < 33 ||
    bytes.length > MAX_QR_BYTES ||
    bytes.toString("base64") !== encoded ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw unavailable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0 || width > 4096 || height > 4096)
    throw unavailable();
  return new Uint8Array(bytes);
}

function disposeApi(value: unknown, disposed: WeakSet<object>) {
  if (!value || typeof value !== "object" || disposed.has(value as object)) return;
  disposed.add(value as object);
  const api = value as any;
  try {
    api?.listener?.on?.("error", () => {});
  } catch {}
  try {
    void Promise.resolve(api?.listener?.stop?.()).catch(() => {});
  } catch {}
}

/**
 * Owner-controlled QR enrollment. It never starts a listener, never sends,
 * never persists a QR image in evidence, and never returns raw SDK material.
 */
export async function bootstrapPilotSession(options: {
  grant: PilotGrant;
  owner: OwnershipHandle;
  view: PrivateQrView;
  sessionStore: PrivateSessionStore;
  loader: TrustedSdkLoader;
  signal: AbortSignal;
  now?: Date;
  deadlineMs?: number;
}): Promise<{ boundAccountId: string }> {
  try {
    const grant = options?.grant;
    const owner = options?.owner;
    const view = options?.view;
    const sessionStore = options?.sessionStore;
    const loader = options?.loader;
    const signal = options?.signal;
    const now = options?.now ?? new Date();
    if (
      !grant ||
      typeof grant !== "object" ||
      grant.purpose !== "enroll-session" ||
      (grant.expectedAccountId !== null &&
        (typeof grant.expectedAccountId !== "string" ||
          !accountIdPattern.test(grant.expectedAccountId))) ||
      !owner ||
      typeof owner.assertCurrent !== "function" ||
      owner.admitted !== true ||
      !view ||
      typeof view.showPng !== "function" ||
      typeof view.clear !== "function" ||
      typeof view.confirmIdentity !== "function" ||
      !sessionStore ||
      typeof sessionStore.write !== "function" ||
      typeof loader !== "function" ||
      !signal ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function"
    )
      throw unavailable();
    const issuedAt = Date.parse(grant.issuedAt);
    const expiresAt = Date.parse(grant.expiresAt);
    if (
      grant.dedicatedAccountAttested !== true ||
      grant.unofficialClientRiskAccepted !== true ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= issuedAt ||
      issuedAt > now.getTime() + MAX_CLOCK_SKEW_MS ||
      expiresAt <= now.getTime() ||
      (options.deadlineMs !== undefined &&
        (!Number.isInteger(options.deadlineMs) ||
          options.deadlineMs < 1 ||
          options.deadlineMs > BOOTSTRAP_DEADLINE_MS))
    )
      throw unavailable();
    const fresh = () => {
      const current = options?.now ?? new Date();
      const nowMs = current instanceof Date ? current.getTime() : NaN;
      return (
        Number.isFinite(nowMs) &&
        nowMs < expiresAt &&
        nowMs + MAX_CLOCK_SKEW_MS >= issuedAt
      );
    };
    if (signal.aborted) {
      await Promise.resolve(view.clear()).catch(() => {});
      throw unavailable();
    }

    const expected = grant.expectedAccountId;
    let finished = false,
      aborted = false,
      viewFailure = false,
      qrSeen = false,
      writeAttempted = false,
      cleared = false;
    let abortAction: (() => void) | undefined;
    let imei: string | undefined;
    let userAgent: string | undefined;
    let displayLabel: string | null = null;
    let resolvedApi: unknown;
    const disposed = new WeakSet<object>();
    let rejectAbort: (error: Error) => void = () => {};
    const abortedPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    void abortedPromise.catch(() => {});
    const race = <T>(value: Promise<T> | T): Promise<T> =>
      Promise.race([Promise.resolve(value), abortedPromise]);

    let deadline: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const onSignal = () => abort("signal");
    const abort = (_reason: string) => {
      if (finished || aborted) return;
      aborted = true;
      try {
        abortAction?.();
      } catch {}
      rejectAbort(unavailable());
      if (resolvedApi) disposeApi(resolvedApi, disposed);
    };

    signal.addEventListener("abort", onSignal, { once: true });
    deadline = setTimeout(
      () => abort("deadline"),
      Math.min(options?.deadlineMs ?? BOOTSTRAP_DEADLINE_MS, BOOTSTRAP_DEADLINE_MS),
    );
    deadline.unref?.();
    poll = setInterval(() => {
      Promise.resolve()
        .then(() => owner.assertCurrent())
        .catch(() => abort("owner-lost"));
    }, 1000);
    poll.unref?.();

    let viewTail: Promise<unknown> = Promise.resolve();
    const settleViewTail = () =>
      Promise.race([
        viewTail.catch(() => {}),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, VIEW_SETTLE_MS);
          timer.unref?.();
        }),
      ]);
    const quarantine = async () => {
      try {
        await sessionStore.quarantine?.();
      } catch {
        throw new PilotSessionQuarantineError();
      }
    };
    const captureAbort = (actions: RecordValue) => {
      if (typeof actions.abort === "function")
        abortAction = () => {
          try {
            actions.abort();
          } catch {}
        };
    };
    const onEvent = (event: unknown) => {
      try {
        if (finished || aborted) return;
        const value = record(event);
        if (value.type === 0) {
          const data = record(value.data);
          captureAbort(record(value.actions));
          const png = decodePng(data.image);
          qrSeen = true;
          viewTail = viewTail
            .then(() => (finished || aborted ? undefined : view.showPng(png)))
            .catch(() => {
              viewFailure = true;
              abort("view-failed");
            });
          return;
        }
        if (value.type === 1) {
          captureAbort(record(value.actions));
          abort("qr-expired");
          return;
        }
        if (value.type === 2) {
          captureAbort(record(value.actions));
          const data = record(value.data);
          displayLabel = safeLabel(data.display_name);
          return;
        }
        if (value.type === 3) {
          captureAbort(record(value.actions));
          abort("qr-declined");
          return;
        }
        if (value.type === 4) {
          const data = record(value.data);
          if (
            !validIdentity(data.imei, 512) ||
            !validIdentity(data.userAgent, 1024)
          )
            throw unavailable();
          // Cookie material from this event is deliberately ignored. Only the
          // latest jar on the final API resolution is a credential checkpoint.
          imei = data.imei;
          userAgent = data.userAgent;
          return;
        }
        abort("callback-invalid");
      } catch {
        abort("callback-invalid");
      }
    };

    try {
      await race(owner.assertCurrent());
      const module = record(await race(loader()));
      if (aborted) throw unavailable();
      if (typeof module.Zalo !== "function") throw unavailable();
      const instance = new module.Zalo({
        logging: false,
        selfListen: true,
        checkUpdate: false,
      });
      if (aborted || !instance || typeof instance.loginQR !== "function")
        throw unavailable();
      const login = Promise.resolve().then(() =>
        instance.loginQR({}, (event: unknown) => onEvent(event)),
      );
      login.then(
        (api) => {
          resolvedApi = api;
          if (aborted || finished) disposeApi(api, disposed);
        },
        () => {},
      );
      const api = await race(login);
      resolvedApi = api;
      if (aborted || finished) {
        disposeApi(api, disposed);
        throw unavailable();
      }

      await race(owner.assertCurrent());
      const raw = record(api);
      if (typeof raw.getOwnId !== "function") throw unavailable();
      const uid = raw.getOwnId();
      if (typeof uid !== "string" || !accountIdPattern.test(uid))
        throw unavailable();
      if (expected !== null && uid !== expected) throw unavailable();
      if (!qrSeen || viewFailure || aborted) throw unavailable();
      if (
        !imei ||
        !userAgent ||
        !validIdentity(imei, 512) ||
        !validIdentity(userAgent, 1024)
      )
        throw unavailable();
      const confirmed = await race(
        view.confirmIdentity({ uid, displayLabel: safeLabel(displayLabel) }),
      );
      if (confirmed !== true || aborted) throw unavailable();

      await race(owner.assertCurrent());
      if (typeof raw.getCookie !== "function") throw unavailable();
      const jar = record(raw.getCookie());
      if (typeof jar.serializeSync !== "function") throw unavailable();
      const snapshot = boundedClone(jar.serializeSync());
      if (!snapshot || typeof snapshot !== "object" || aborted)
        throw unavailable();
      const cookie = validCookies(record(snapshot).cookies);

      const value = {
        version: 1 as const,
        accountId: uid,
        session: { imei, userAgent, cookie },
      };
      await race(owner.assertCurrent());
      if (!fresh() || aborted) throw unavailable();
      writeAttempted = true;
      const writing = Promise.resolve().then(() => sessionStore.write(value));
      try {
        await Promise.race([writing, abortedPromise]);
      } catch {
        writing
          .then(() => sessionStore.quarantine?.())
          .catch(() => {});
        throw unavailable();
      }
      await race(owner.assertCurrent());
      await race(settleViewTail());
      if (aborted) throw unavailable();
      await race(view.clear());
      cleared = true;
      return { boundAccountId: uid };
    } catch {
      if (writeAttempted) await quarantine();
      throw unavailable();
    } finally {
      finished = true;
      signal.removeEventListener("abort", onSignal);
      if (deadline) clearTimeout(deadline);
      if (poll) clearInterval(poll);
      if (!cleared) {
        await settleViewTail();
        await Promise.resolve(view.clear()).catch(() => {});
      }
      if (resolvedApi) disposeApi(resolvedApi, disposed);
    }
  } catch (error) {
    if (error instanceof PilotSessionQuarantineError) throw error;
    throw unavailable();
  }
}
