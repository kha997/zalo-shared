import type { OwnershipHandle } from "../../server/connector-ownership.js";
import type {
  BootstrapStage,
  PilotReason,
} from "../../server/pilot-reasons.js";
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

export {
  BOOTSTRAP_REASONS,
  BOOTSTRAP_STAGES,
  type BootstrapStage,
  type PilotReason,
} from "../../server/pilot-reasons.js";

export class PilotBootstrapError extends Error {
  readonly code: PilotReason;
  constructor(code: PilotReason) {
    super("SDK facade unavailable");
    this.name = "PilotBootstrapError";
    this.code = code;
  }
}

const fail = (code: PilotReason) => new PilotBootstrapError(code);
const ABORT_REASONS: Record<string, PilotReason> = {
  signal: "aborted",
  deadline: "deadline",
  "qr-expired": "qr-expired",
  "qr-declined": "qr-declined",
  "callback-invalid": "callback-invalid",
  "owner-lost": "owner-lost",
  "view-failed": "view-failed",
};
/**
 * Fixed messages raised by the pinned SDK's loginQR. They are matched exactly
 * (or as a stable prefix) so the stage can be named without echoing provider
 * text, which may carry response bodies.
 */
const LOGIN_FAILURES: ReadonlyArray<readonly [string, PilotReason]> = [
  ["Cannot get API login version", "login-version-failed"],
  ["Unable to generate QRCode", "login-qr-generate-failed"],
  ["Cannot get session, login failed", "login-session-unconfirmed"],
  ["Can't get account info", "login-userinfo-failed"],
  ["Can't login", "login-userinfo-failed"],
];
function loginFailureCode(error: unknown): PilotReason {
  if (!(error instanceof Error)) return "login-failed";
  for (const [message, code] of LOGIN_FAILURES) {
    if (error.message === message || error.message.startsWith(message + "\n"))
      return code;
  }
  return "login-failed";
}

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
  /** Optional sink for the closed stage vocabulary; must never throw outward. */
  onStage?: (stage: BootstrapStage) => void;
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
      typeof signal.addEventListener !== "function" ||
      (options.onStage !== undefined && typeof options.onStage !== "function")
    )
      throw fail("input-invalid");
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
      throw fail("grant-invalid");
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
      throw fail("aborted");
    }

    const stage = (name: BootstrapStage) => {
      try {
        options.onStage?.(name);
      } catch {}
    };
    const expected = grant.expectedAccountId;
    let finished = false,
      aborted = false,
      viewFailure = false,
      qrSeen = false,
      writeAttempted = false,
      cleared = false;
    let abortCode: PilotReason = "internal";
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
    const abort = (reason: string) => {
      if (finished || aborted) return;
      aborted = true;
      abortCode = ABORT_REASONS[reason] ?? "internal";
      try {
        abortAction?.();
      } catch {}
      rejectAbort(fail(abortCode));
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
            .then(async () => {
              if (finished || aborted) return;
              await view.showPng(png);
              if (finished || aborted) return;
              stage("qr-shown");
            })
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
          stage("scanned");
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

    const requireOwner = async () => {
      try {
        await race(owner.assertCurrent());
      } catch (error) {
        if (error instanceof PilotBootstrapError) throw error;
        throw fail("owner-lost");
      }
    };

    try {
      await requireOwner();
      stage("owner-checked");
      let module: RecordValue;
      try {
        module = record(await race(loader()));
      } catch (error) {
        if (error instanceof PilotBootstrapError) throw error;
        throw fail("sdk-load-failed");
      }
      if (aborted) throw fail(abortCode);
      if (typeof module.Zalo !== "function") throw fail("sdk-invalid");
      let instance: any;
      try {
        instance = new (module.Zalo as new (options: unknown) => any)({
          logging: false,
          selfListen: true,
          checkUpdate: false,
        });
      } catch {
        throw fail("sdk-invalid");
      }
      if (aborted || !instance || typeof instance.loginQR !== "function")
        throw fail(aborted ? abortCode : "sdk-invalid");
      stage("sdk-loaded");
      stage("login-requested");
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
      let api: unknown;
      try {
        api = await race(login);
      } catch (error) {
        // This is the provider-facing failure: loginQR never resolved, so no
        // API exists to dispose and no listener was ever started.
        if (error instanceof PilotBootstrapError) throw error;
        throw fail(loginFailureCode(error));
      }
      resolvedApi = api;
      if (aborted || finished) {
        disposeApi(api, disposed);
        throw fail(aborted ? abortCode : "internal");
      }
      stage("login-resolved");

      await requireOwner();
      let raw: RecordValue;
      try {
        raw = record(api);
      } catch {
        throw fail("sdk-invalid");
      }
      let uid: unknown;
      try {
        if (typeof raw.getOwnId !== "function") throw 0;
        uid = raw.getOwnId();
      } catch {
        throw fail("uid-invalid");
      }
      if (typeof uid !== "string" || !accountIdPattern.test(uid))
        throw fail("uid-invalid");
      if (expected !== null && uid !== expected) throw fail("uid-mismatch");
      stage("uid-verified");
      if (!qrSeen) throw fail("qr-missing");
      if (viewFailure) throw fail("view-failed");
      if (aborted) throw fail(abortCode);
      if (
        !imei ||
        !userAgent ||
        !validIdentity(imei, 512) ||
        !validIdentity(userAgent, 1024)
      )
        throw fail("login-info-invalid");
      let confirmed: unknown;
      try {
        confirmed = await race(
          view.confirmIdentity({ uid, displayLabel: safeLabel(displayLabel) }),
        );
      } catch (error) {
        if (error instanceof PilotBootstrapError) throw error;
        throw fail("identity-declined");
      }
      if (confirmed !== true || aborted)
        throw fail(aborted ? abortCode : "identity-declined");
      stage("identity-confirmed");

      await requireOwner();
      let cookie: any[];
      try {
        if (typeof raw.getCookie !== "function") throw 0;
        const jar = record(raw.getCookie());
        if (typeof jar.serializeSync !== "function") throw 0;
        const snapshot = boundedClone(jar.serializeSync());
        if (!snapshot || typeof snapshot !== "object") throw 0;
        cookie = validCookies(record(snapshot).cookies);
      } catch {
        throw fail("cookie-invalid");
      }
      stage("cookie-captured");

      const value = {
        version: 1 as const,
        accountId: uid,
        session: { imei, userAgent, cookie },
      };
      await requireOwner();
      if (!fresh()) throw fail("grant-expired");
      if (aborted) throw fail(abortCode);
      writeAttempted = true;
      const writing = Promise.resolve().then(() => sessionStore.write(value));
      try {
        await Promise.race([writing, abortedPromise]);
      } catch (error) {
        writing
          .then(() => sessionStore.quarantine?.())
          .catch(() => {});
        throw error instanceof PilotBootstrapError
          ? error
          : fail("session-write-failed");
      }
      stage("session-written");
      await requireOwner();
      await race(settleViewTail());
      if (aborted) throw fail(abortCode);
      try {
        await race(view.clear());
      } catch (error) {
        if (error instanceof PilotBootstrapError) throw error;
        throw fail("view-failed");
      }
      cleared = true;
      stage("qr-cleared");
      return { boundAccountId: uid };
    } catch (error) {
      if (writeAttempted) await quarantine();
      throw error instanceof PilotBootstrapError ? error : fail("internal");
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
    if (error instanceof PilotBootstrapError) throw error;
    throw fail("internal");
  }
}
