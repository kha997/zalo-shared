import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from "node:path";
import { createInterface } from "node:readline/promises";

export interface PrivateSessionStore {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
  /** Optional: move an unknown/partial record out of the accepted path. */
  quarantine?(): Promise<void>;
}

export interface PrivateQrView {
  showPng(bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
  confirmIdentity(value: {
    uid: string;
    displayLabel: string | null;
  }): Promise<boolean>;
}

const unavailable = () => new Error("Private pilot files unavailable");
const accountIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_SESSION_BYTES = 1024 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_QR_BYTES = 1024 * 1024;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const DEFAULT_KEY_ID = "v1";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const POSIX = process.platform !== "win32";
const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

function cleanPath(value: unknown) {
  if (typeof value !== "string" || !isAbsolute(value)) throw unavailable();
  const segments = value.split(/[\\/]/);
  if (segments.includes("..")) throw unavailable();
  return normalize(value);
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?")
    .slice(0, 80);
  return cleaned.trim() ? cleaned : null;
}

async function syncDirectory(directory: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is not available on every host filesystem.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function requirePrivateDirectory(directory: string) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unavailable();
  if (POSIX) {
    if ((stat.mode & 0o777) !== 0o700) throw unavailable();
    if (
      typeof process.getuid === "function" &&
      stat.uid !== process.getuid()
    )
      throw unavailable();
    // A symlinked ancestor could redirect every installed file elsewhere.
    if ((await realpath(directory)) !== resolve(directory)) throw unavailable();
  }
}

export async function ensurePrivateDirectory(value: string): Promise<string> {
  const directory = cleanPath(value);
  try {
    await mkdir(directory, { mode: 0o700 });
    await syncDirectory(dirname(directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw unavailable();
  }
  await requirePrivateDirectory(directory);
  return directory;
}

/** Reads an owner-managed 32-byte key without following links or exposing contents. */
export async function readPrivateKeyFile(value: string): Promise<Uint8Array> {
  const path = cleanPath(value);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) throw unavailable();
    if (POSIX) {
      if ((before.mode & 0o077) !== 0) throw unavailable();
      if (
        typeof process.getuid === "function" &&
        before.uid !== process.getuid()
      )
        throw unavailable();
    }
    handle = await open(path, constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 32)
      throw unavailable();
    const key = Buffer.alloc(32);
    const { bytesRead } = await handle.read(key, 0, 32, 0);
    if (bytesRead !== 32) throw unavailable();
    return key;
  } catch {
    throw unavailable();
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Reads an owner-managed private text file such as the pilot manifest. */
export async function readPrivateTextFile(
  value: string,
  maxBytes: number,
): Promise<string> {
  const path = cleanPath(value);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw unavailable();
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) throw unavailable();
    if (before.size <= 0 || before.size > maxBytes) throw unavailable();
    if (POSIX) {
      if ((before.mode & 0o077) !== 0) throw unavailable();
      if (
        typeof process.getuid === "function" &&
        before.uid !== process.getuid()
      )
        throw unavailable();
    }
    handle = await open(path, constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes)
      throw unavailable();
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > maxBytes) throw unavailable();
    return text;
  } catch {
    throw unavailable();
  } finally {
    await handle?.close().catch(() => {});
  }
}

type Envelope = {
  v: 1;
  keyId: string;
  nonce: string;
  tag: string;
  data: string;
};

// The key identifier is bound into both the envelope and the AAD so an
// explicitly selected key cannot decrypt a record written under another id.
function associated(keyId: string): Buffer {
  return Buffer.from(`zalo-pilot-session-v1:${keyId}`);
}

function seal(key: Buffer, value: unknown, keyId: string): string {
  const json = JSON.stringify(value);
  if (typeof json !== "string" || Buffer.byteLength(json) > MAX_SESSION_BYTES)
    throw unavailable();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associated(keyId));
  const ciphertext = Buffer.concat([
    cipher.update(json, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    keyId,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

function unseal(key: Buffer, encoded: string, keyId: string): unknown {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(encoded);
  } catch {
    throw unavailable();
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.v !== 1 ||
    envelope.keyId !== keyId ||
    typeof envelope.nonce !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  )
    throw unavailable();
  const nonce = Buffer.from(envelope.nonce, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw unavailable();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(associated(keyId));
  decipher.setAuthTag(tag);
  try {
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw unavailable();
  }
}

/** Encrypted session record with one atomic install and conservative quarantine. */
export class PrivateSessionFile implements PrivateSessionStore {
  private readonly path: string;
  private readonly directory: string;
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(options: {
    path: string;
    key: Uint8Array;
    /** Non-secret key selector bound into the envelope and AAD. */
    keyId?: string;
  }) {
    this.path = cleanPath(options?.path);
    this.directory = dirname(this.path);
    if (!(options?.key instanceof Uint8Array) || options.key.byteLength !== 32)
      throw unavailable();
    const keyId = options.keyId ?? DEFAULT_KEY_ID;
    if (typeof keyId !== "string" || !KEY_ID.test(keyId)) throw unavailable();
    this.key = Buffer.from(options.key);
    this.keyId = keyId;
  }

  async read(): Promise<unknown> {
    await requirePrivateDirectory(this.directory);
    const before = await lstat(this.path);
    if (before.isSymbolicLink() || !before.isFile()) throw unavailable();
    if (POSIX && (before.mode & 0o077) !== 0) throw unavailable();
    let handle: FileHandle | undefined;
    try {
      handle = await open(this.path, constants.O_RDONLY | noFollow);
      const stat = await handle.stat();
      if (stat.isSymbolicLink() || !stat.isFile()) throw unavailable();
      if (stat.size <= 0 || stat.size > MAX_ENVELOPE_BYTES) throw unavailable();
      const encoded = await handle.readFile("utf8");
      return unseal(this.key, encoded, this.keyId);
    } catch {
      throw unavailable();
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async write(value: unknown): Promise<void> {
    await requirePrivateDirectory(this.directory);
    const prefix = `${basename(this.path)}.`;
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (name.startsWith(prefix) && name.endsWith(".tmp"))
        await unlink(join(this.directory, name)).catch(() => {});
    }
    const encoded = seal(this.key, value, this.keyId);
    const temp = `${this.path}.${randomBytes(16).toString("hex")}.tmp`;
    let installed = false;
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      await handle.writeFile(encoded);
      await handle.sync();
      if (POSIX) await handle.chmod(0o600);
      await handle.close();
      handle = undefined;
      await rename(temp, this.path);
      installed = true;
      await syncDirectory(this.directory);
      const roundTrip = await this.read();
      if (JSON.stringify(roundTrip) !== JSON.stringify(value))
        throw unavailable();
    } catch {
      if (handle) await handle.close().catch(() => {});
      await unlink(temp).catch(() => {});
      if (installed) await this.quarantine().catch(() => {});
      throw unavailable();
    }
  }

  async quarantine(): Promise<void> {
    const target = `${this.path}.quarantine-${randomBytes(8).toString("hex")}`;
    try {
      const stat = await lstat(this.path);
      if (stat.isDirectory()) throw unavailable();
      await rename(this.path, target);
      await syncDirectory(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw unavailable();
    }
  }
}

const QR_FILE = "qr.png";

function isPng(bytes: Uint8Array) {
  return (
    bytes instanceof Uint8Array &&
    bytes.byteLength >= 33 &&
    bytes.byteLength <= MAX_QR_BYTES &&
    Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE) &&
    Buffer.from(bytes.subarray(12, 16)).toString("ascii") === "IHDR" &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      16,
      false,
    ) > 0 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      20,
      false,
    ) > 0
  );
}

async function defaultConfirm(value: {
  uid: string;
  displayLabel: string | null;
}): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw unavailable();
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  try {
    const answer = await terminal.question(
      [
        "Confirm this dedicated pilot account?",
        `UID: ${value.uid}`,
        `Display name: ${value.displayLabel ?? "(none)"}`,
        'Type "confirm" to bind; anything else cancels: ',
      ].join("\n"),
    );
    return answer.trim() === "confirm";
  } finally {
    terminal.close();
  }
}

/** Owned 0700 directory and 0600 file, never a web view and never a console QR. */
export class PrivateQrFileView implements PrivateQrView {
  private readonly directory: string;
  private readonly confirm: (value: {
    uid: string;
    displayLabel: string | null;
  }) => Promise<boolean>;

  constructor(options: {
    directory: string;
    confirm?: (value: {
      uid: string;
      displayLabel: string | null;
    }) => Promise<boolean>;
  }) {
    this.directory = cleanPath(options?.directory);
    this.confirm = options.confirm ?? defaultConfirm;
  }

  private async file() {
    await ensurePrivateDirectory(this.directory);
    const target = join(this.directory, QR_FILE);
    const root = resolve(this.directory);
    if (resolve(target) !== `${root}${sep}${QR_FILE}`) throw unavailable();
    return target;
  }

  async showPng(bytes: Uint8Array): Promise<void> {
    if (!isPng(bytes)) throw unavailable();
    const target = await this.file();
    const existing = await lstat(target).catch(() => undefined);
    if (existing && (existing.isSymbolicLink() || !existing.isFile()))
      throw unavailable();
    const temp = join(
      this.directory,
      `.qr.${randomBytes(16).toString("hex")}.tmp`,
    );
    let handle: FileHandle | undefined;
    let installed = false;
    try {
      handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      const stat = await handle.stat();
      if (!stat.isFile()) throw unavailable();
      await handle.writeFile(bytes);
      await handle.sync();
      if (POSIX) await handle.chmod(0o600);
      await handle.close();
      handle = undefined;
      await rename(temp, target);
      installed = true;
      await syncDirectory(this.directory);
    } catch {
      await handle?.close().catch(() => {});
      if (!installed) await unlink(temp).catch(() => {});
      throw unavailable();
    }
  }

  async clear(): Promise<void> {
    const target = await this.file();
    try {
      const stat = await lstat(target);
      if (stat.isDirectory()) throw unavailable();
      await unlink(target);
      await syncDirectory(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unavailable();
    }
  }

  async confirmIdentity(value: {
    uid: string;
    displayLabel: string | null;
  }): Promise<boolean> {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.uid !== "string" ||
      !accountIdPattern.test(value.uid)
    )
      throw unavailable();
    const displayLabel = label(value.displayLabel);
    return (await this.confirm({ uid: value.uid, displayLabel })) === true;
  }
}
