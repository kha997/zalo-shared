import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, type InboundMedia, type Message } from "./api";

const labels: Record<InboundMedia["status"], string> = {
  pending: "Đang chờ tải tệp",
  processing: "Đang tải tệp",
  held: "Tệp đang chờ đối soát",
  ready: "Tệp đã lưu riêng tư",
  unavailable: "Tệp hiện chưa khả dụng",
};
/** A delayed read must not erase a newer ready file already merged by normal polling. */
export function canReplaceMediaSnapshot(
  current: Message,
  fresh: Message,
): boolean {
  if (
    fresh.id !== current.id ||
    fresh.conversationId !== current.conversationId ||
    !Array.isArray(fresh.attachments) ||
    !Array.isArray(fresh.media) ||
    fresh.media.length > 5
  )
    return false;
  const version = (v: unknown): v is string =>
    typeof v === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(v) &&
    BigInt(v) <= 9223372036854775807n;
  return (
    (current.media ?? []).every((item) => {
      const next = fresh.media!.find((n) => n.id === item.id);
      return (
        next &&
        version(item.version) &&
        version(next.version) &&
        BigInt(next.version) >= BigInt(item.version)
      );
    }) &&
    current.attachments.every((item) =>
      fresh.attachments.some((n) => n.id === item.id),
    )
  );
}
/** Read-only refresh never queues a download, retries a send or opens a provider locator. */
export default function InboundMediaStatus({
  message,
  onRefresh,
}: {
  message: Message;
  onRefresh: (message: Message) => void;
}) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const latest = useRef(message);
  latest.current = message;
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [message.id],
  );
  const items = message.media?.slice(0, 5) ?? [];
  if (!items.some((item) => item.status !== "ready")) return null;
  async function refresh() {
    request.current?.abort();
    const controller = new AbortController(),
      token = ++generation.current;
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const fresh = await api<Message>(`/messages/${message.id}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || token !== generation.current) return;
      if (
        fresh.id !== message.id ||
        fresh.conversationId !== message.conversationId ||
        !Array.isArray(fresh.attachments) ||
        !Array.isArray(fresh.media) ||
        fresh.media.length > 5
      )
        throw new Error("Invalid private media response");
      if (canReplaceMediaSnapshot(latest.current, fresh)) onRefresh(fresh);
    } catch (e) {
      if (controller.signal.aborted || token !== generation.current) return;
      setError(
        e instanceof ApiError && [401, 403, 404].includes(e.status)
          ? "Không còn quyền xem tệp này."
          : "Chưa cập nhật được trạng thái tệp. Hãy kiểm tra lại sau.",
      );
    } finally {
      if (!controller.signal.aborted && token === generation.current)
        setLoading(false);
    }
  }
  return (
    <section
      className="inbound-media-status"
      aria-label="Trạng thái tệp đính kèm"
      aria-busy={loading}
    >
      {items
        .filter((item) => item.status !== "ready")
        .map((item) => (
          <p key={item.id}>
            <strong>{item.name}</strong> —{" "}
            {labels[item.status] ?? "Trạng thái tệp chưa xác định"}
          </p>
        ))}
      <button type="button" onClick={() => void refresh()} disabled={loading}>
        {loading ? "Đang kiểm tra tệp…" : "Kiểm tra tệp"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
