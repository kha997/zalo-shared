import type pg from "pg";
import { ACCOUNT } from "../../server/db.js";
import {
  ProviderNotDispatchedError,
  type Provider,
} from "../../server/worker.js";
export interface TextTransport {
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
): Provider {
  let prepared:
    { id: string; text: string; peer: string; type: 0 | 1 } | undefined;
  return {
    async connected(db) {
      const state = (
        await (db ?? pool).query(
          "SELECT status,reconciliation_required FROM provider_state WHERE account_id=$1",
          [ACCOUNT],
        )
      ).rows[0];
      return (
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
          "SELECT part FROM delivery_parts WHERE message_id=$1 ORDER BY part",
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
        m.attachments !== 0 ||
        parts.length !== 1 ||
        parts[0].part !== 0 ||
        typeof m.text !== "string" ||
        !m.text.trim() ||
        m.text.length > 10000
      )
        throw new Error("Unsupported SDK message");
      prepared = {
        id,
        text: m.text,
        peer: m.provider_thread_id,
        type: m.provider_thread_type,
      };
    },
    async sendPart(id, part, db) {
      if (!prepared || prepared.id !== id || part !== 0)
        throw new Error("Message not prepared");
      if (!(await this.connected(db))) throw new ProviderNotDispatchedError();
      const result = await transport.sendText(
        prepared.peer,
        prepared.text,
        prepared.type,
      );
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
