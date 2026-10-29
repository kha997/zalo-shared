import type pg from "pg";
import { prepareMedia, type MediaInput } from "./media.js";
import { ACCOUNT } from "../../server/db.js";
import {
  ProviderNotDispatchedError,
  type Provider,
} from "../../server/worker.js";
type Delivery =
  { status: "sent"; providerId: string } | { status: "failed" | "unknown" };
export interface TextTransport {
  sendAttachment?(
    input: MediaInput,
    peer: string,
    type?: number,
  ): Promise<Delivery>;
  readonly status: string;
  sendText(
    peer: string,
    text: string,
    type?: number,
  ): Promise<
    { status: "sent"; providerId: string } | { status: "failed" | "unknown" }
  >;
}
/** Explicit injected development bridge; never exposes or authenticates SDK sessions. */
export function createSdkProvider(
  pool: pg.Pool,
  transport: TextTransport,
  ownership?: { readonly admitted: boolean; assertCurrent(): Promise<void> },
): Provider {
  let prepared:
    | {
        id: string;
        text: string;
        peer: string;
        type: 0 | 1;
        media: Map<number, MediaInput>;
      }
    | undefined;
  return {
    async connected(db) {
      if (ownership) {
        if (!ownership.admitted) return false;
        try {
          await ownership.assertCurrent();
        } catch {
          return false;
        }
        if (!ownership.admitted) return false;
      }
      const state = (
        await (db ?? pool).query(
          "SELECT status,reconciliation_required FROM provider_state WHERE account_id=$1",
          [ACCOUNT],
        )
      ).rows[0];
      return (
        (!ownership || ownership.admitted) &&
        transport.status === "connected" &&
        state?.status === "connected" &&
        state.reconciliation_required === false
      );
    },
    async prepareMessage(id, db) {
      prepared = undefined;
      const m = (
        await db.query(
          "SELECT m.text,c.provider_thread_id,c.provider_thread_type,(SELECT count(*)::int FROM attachments a WHERE a.message_id=m.id) attachments FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.direction='outbound' AND c.account_id=$2",
          [id, ACCOUNT],
        )
      ).rows[0];
      const parts = (
        await db.query(
          "SELECT part,attachment_id FROM delivery_parts WHERE message_id=$1 ORDER BY part",
          [id],
        )
      ).rows;
      if (
        !m ||
        typeof m.provider_thread_id !== "string" ||
        !m.provider_thread_id.trim() ||
        m.provider_thread_id.length > 200 ||
        m.provider_thread_id.includes("\0") ||
        ![0, 1].includes(m.provider_thread_type) ||
        !Number.isInteger(m.attachments) ||
        m.attachments < 0 ||
        m.attachments > 5 ||
        parts.length !== 1 + m.attachments ||
        parts.some((p, index) => p.part !== index) ||
        parts[0].attachment_id != null ||
        typeof m.text !== "string" ||
        (!m.text.trim() && m.attachments === 0) ||
        m.text.length > 10000
      )
        throw new Error("Unsupported SDK message");
      const media = new Map<number, MediaInput>();
      if (m.attachments > 0) {
        if (!transport.sendAttachment) throw new Error("Unsupported SDK media");
        const rows = (
          await db.query(
            "SELECT id,message_id,account_id,name,mime,octet_length(data)::int size FROM attachments WHERE message_id=$1 ORDER BY id LIMIT 6 FOR SHARE",
            [id],
          )
        ).rows;
        const bindings = parts.slice(1).map((p) => p.attachment_id);
        if (
          rows.length !== m.attachments ||
          new Set(bindings).size !== bindings.length ||
          bindings.some((binding) => typeof binding !== "string" || !binding) ||
          rows.some(
            (a) =>
              a.message_id !== id ||
              a.account_id !== ACCOUNT ||
              !bindings.includes(a.id) ||
              !Number.isInteger(a.size) ||
              a.size < 1 ||
              a.size > 5 * 1024 * 1024,
          ) ||
          rows.reduce((sum, a) => sum + a.size, 0) > 25 * 1024 * 1024
        )
          throw new Error("Invalid media binding");
        const buffers = (
          await db.query(
            "SELECT id,data FROM attachments WHERE message_id=$1 AND account_id=$2 AND id=ANY($3::uuid[]) AND octet_length(data) BETWEEN 1 AND 5242880",
            [id, ACCOUNT, bindings],
          )
        ).rows;
        if (buffers.length !== rows.length)
          throw new Error("Missing media bytes");
        for (const part of parts.slice(1)) {
          const meta = rows.find((a) => a.id === part.attachment_id);
          const bytes = buffers.find((a) => a.id === part.attachment_id)?.data;
          if (!meta || !Buffer.isBuffer(bytes) || bytes.length !== meta.size)
            throw new Error("Invalid media bytes");
          const source = prepareMedia({
            name: meta.name,
            mime: meta.mime,
            data: bytes,
          });
          media.set(part.part, {
            name: source.filename,
            mime: meta.mime,
            data: source.data,
          });
        }
      }
      prepared = {
        id,
        text: m.text,
        peer: m.provider_thread_id,
        type: m.provider_thread_type,
        media,
      };
    },
    async sendPart(id, part, db) {
      if (
        !prepared ||
        prepared.id !== id ||
        !Number.isInteger(part) ||
        part < 0 ||
        (part > 0 && !prepared.media.has(part))
      )
        throw new Error("Message not prepared");
      if (!(await this.connected(db))) throw new ProviderNotDispatchedError();
      if (part === 0 && !prepared.text.trim() && prepared.media.size > 0)
        return null;
      if (ownership) {
        try {
          await ownership.assertCurrent();
        } catch {
          throw new ProviderNotDispatchedError();
        }
        if (!ownership.admitted) throw new ProviderNotDispatchedError();
      }
      const input = prepared.media.get(part);
      const result =
        part === 0
          ? await transport.sendText(
              prepared.peer,
              prepared.text,
              prepared.type,
            )
          : await transport.sendAttachment!(
              { ...input!, data: Buffer.from(input!.data) },
              prepared.peer,
              prepared.type,
            );
      // Revocation cannot cancel an SDK call already entered. A late confirmation
      // cannot establish durable acceptance after ownership/session loss.
      if (ownership) {
        try {
          await ownership.assertCurrent();
        } catch {
          throw new Error("Provider execution uncertain");
        }
        if (!ownership.admitted)
          throw new Error("Provider execution uncertain");
      }
      if (result.status === "failed") throw new ProviderNotDispatchedError();
      if (result.status !== "sent")
        throw new Error("Provider execution uncertain");
      return result.providerId;
    },
    releaseMessage(id) {
      if (prepared?.id === id) prepared = undefined;
    },
  };
}
