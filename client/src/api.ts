export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "agent";
  active: boolean;
};
export type Conversation = {
  id: string;
  contactName: string;
  contactId: string;
  status: "open" | "resolved";
  assigneeId: string | null;
  version: number;
  unreadCount: number;
  lastMessage: string;
  updatedAt: string;
};
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
};
export type Message = {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  text: string;
  actorId: string | null;
  status: "received" | "pending" | "processing" | "sent" | "failed" | "unknown";
  createdAt: string;
  attachments: Attachment[];
};
export type Provider = {
  mode: "mock" | "disabled";
  status: "connected" | "disconnected" | "expired";
  lastEventAt: string | null;
};
export type Audit = {
  id: string;
  actorName: string;
  action: string;
  targetId: string;
  createdAt: string;
  metadata: unknown;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const method = options.method || "GET";
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30000);
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout.signal])
        : timeout.signal,
      headers: {
        ...(method !== "GET"
          ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
          : {}),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && path !== "/auth/login")
    window.dispatchEvent(new Event("session-expired"));
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error?.message || "Không thể hoàn tất yêu cầu",
    );
  return value as T;
}
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
export const statusLabel: Record<string, string> = {
  received: "Đã nhận",
  pending: "Đang chờ",
  processing: "Đang gửi",
  sent: "Đã gửi",
  failed: "Gửi thất bại",
  unknown: "Chưa rõ kết quả",
};
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
