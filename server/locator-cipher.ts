import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
export type LocatorEnvelope = Readonly<{
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;
export interface LocatorCipher {
  seal(url: string, aad: string): LocatorEnvelope;
  open(value: LocatorEnvelope, aad: string): string;
  fingerprint(url: string): string;
}
interface Options {
  activeKeyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
  fingerprintKey: Uint8Array;
}
const unavailable = () => new Error("Locator cipher unavailable");
const uuidPattern =
  "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuid = new RegExp(`^${uuidPattern}$`, "i"),
  context = new RegExp(`^zalo-media:v1:${uuidPattern}:${uuidPattern}:[0-4]$`);
const keyId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
/** Canonical account/event/item binding. Never use caller text, a URL or a mutable row serialization as AAD. */
export function locatorAad(
  accountId: string,
  eventId: string,
  index: number,
): string {
  if (
    typeof accountId !== "string" ||
    typeof eventId !== "string" ||
    !uuid.test(accountId) ||
    !uuid.test(eventId) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 4
  )
    throw unavailable();
  return `zalo-media:v1:${accountId.toLowerCase()}:${eventId.toLowerCase()}:${index}`;
}
function validateUrl(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    /[\s\x00-\x1f\x7f]/u.test(value)
  )
    throw unavailable();
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    value.includes("#") ||
    value.includes("\\") ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  )
    throw unavailable();
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.port
  )
    throw unavailable();
}
function aadBytes(aad: string, id: string): Buffer {
  if (typeof aad !== "string" || !context.test(aad)) throw unavailable();
  return Buffer.from(JSON.stringify(["zalo-media-locator-v1", id, aad]));
}
function decode(value: unknown, min: number, max: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw unavailable();
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length < min ||
    bytes.length > max ||
    bytes.toString("base64") !== value
  )
    throw unavailable();
  return bytes;
}
/** Injected locator keys only; no vault/file/env access and no downloader or live-provider activation. */
export function createLocatorCipher(options: Options): LocatorCipher {
  let active: string, keys: Map<string, Buffer>, fp: Buffer;
  try {
    if (
      !options ||
      !keyId(options.activeKeyId) ||
      !(options.keys instanceof Map) ||
      options.keys.size < 1 ||
      options.keys.size > 8 ||
      !(options.fingerprintKey instanceof Uint8Array) ||
      options.fingerprintKey.byteLength !== 32
    )
      throw unavailable();
    active = options.activeKeyId;
    keys = new Map();
    fp = Buffer.from(options.fingerprintKey);
    for (const [id, value] of options.keys) {
      if (
        !keyId(id) ||
        !(value instanceof Uint8Array) ||
        value.byteLength !== 32
      )
        throw unavailable();
      const bytes = Buffer.from(value);
      if (bytes.equals(fp)) throw unavailable();
      keys.set(id, bytes);
    }
    if (!keys.has(active)) throw unavailable();
  } catch {
    throw unavailable();
  }
  return Object.freeze({
    seal(url: string, aad: string): LocatorEnvelope {
      try {
        validateUrl(url);
        const associated = aadBytes(aad, active),
          nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", keys.get(active)!, nonce);
        cipher.setAAD(associated);
        const ciphertext = Buffer.concat([
          cipher.update(url, "utf8"),
          cipher.final(),
        ]);
        return Object.freeze({
          keyId: active,
          nonce: nonce.toString("base64"),
          ciphertext: ciphertext.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        });
      } catch {
        throw unavailable();
      }
    },
    open(value: LocatorEnvelope, aad: string): string {
      try {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join(",") !==
            "ciphertext,keyId,nonce,tag" ||
          !keyId(value.keyId)
        )
          throw unavailable();
        const key = keys.get(value.keyId);
        if (!key) throw unavailable();
        const associated = aadBytes(aad, value.keyId),
          nonce = decode(value.nonce, 12, 12),
          tag = decode(value.tag, 16, 16),
          ciphertext = decode(value.ciphertext, 1, 4096);
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(associated);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        const url = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        validateUrl(url);
        return url;
      } catch {
        throw unavailable();
      }
    },
    fingerprint(url: string): string {
      try {
        validateUrl(url);
        return createHmac("sha256", fp)
          .update("zalo-media-locator-fingerprint-v1\0")
          .update(url, "utf8")
          .digest("hex");
      } catch {
        throw unavailable();
      }
    },
  });
}
