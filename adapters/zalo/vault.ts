import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";

/** External 32-byte key is never persisted; caller owns key distribution and rotation. */
export class CredentialVault {
  private readonly key: Buffer;
  constructor(
    private readonly path: string,
    key: Uint8Array,
  ) {
    if (key.byteLength !== 32) throw new Error("Vault requires a 32-byte key");
    this.key = Buffer.from(key);
  }
  async write(value: unknown): Promise<void> {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from("zalo-vault-v1"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const encoded = JSON.stringify({
      v: 1,
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: ciphertext.toString("base64"),
    });
    const temp = `${this.path}.${randomBytes(16).toString("hex")}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(encoded);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.path);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async read(): Promise<unknown> {
    const envelope = JSON.parse(await readFile(this.path, "utf8"));
    if (
      envelope.v !== 1 ||
      typeof envelope.nonce !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.data !== "string"
    )
      throw new Error("Invalid vault format");
    const nonce = Buffer.from(envelope.nonce, "base64"),
      tag = Buffer.from(envelope.tag, "base64");
    if (nonce.length !== 12 || tag.length !== 16)
      throw new Error("Invalid vault format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAAD(Buffer.from("zalo-vault-v1"));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
}
