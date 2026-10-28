import React, { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  setCsrf,
  initials,
  time,
  statusLabel,
  fileBase64,
  type User,
  type Conversation,
  type Message,
  type Attachment,
  type Provider,
  type Audit,
} from "./api";
type ConversationPage = { items: Conversation[]; nextCursor: string | null };
type Send = {
  conversationId: string;
  key: string;
  text: string;
  attachmentIds: string[];
  state: "sending" | "ambiguous" | "rejected";
  error?: string;
};
const roles = {
  admin: "Quản trị viên",
  supervisor: "Giám sát",
  agent: "Nhân viên",
};
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState("inbox");
  const [users, setUsers] = useState<User[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [provider, setProvider] = useState<Provider | null>(null),
    [audit, setAudit] = useState<Audit[]>([]);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("open"),
    [assigned, setAssigned] = useState(""),
    [draft, setDraft] = useState(""),
    [files, setFiles] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(false),
    [send, setSend] = useState<Send | null>(null),
    [busy, setBusy] = useState(false),
    [network, setNetwork] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [hasSnapshots, setHasSnapshots] = useState(false);
  const [listRefresh, setListRefresh] = useState(0);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Conversation | null>(null);
  const listController = useRef<AbortController | null>(null);
  const loadMoreRef = useRef<(() => Promise<void>) | null>(null);
  const timelineEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    timelineEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, selected]);
  const current = conversations.find((c) => c.id === selected) ||
    (selectedSnapshot?.id === selected ? selectedSnapshot : undefined);
  const sendRef = useRef(send);
  sendRef.current = send;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const sessionRef = useRef<string | null>(null);
  const draftsRef = useRef<
    Record<string, { text: string; files: Attachment[] }>
  >({});
  const restorePending = (id: string) => {
    try {
      const raw = sessionStorage.getItem("zs-pending:" + id);
      if (raw) {
        const pending = JSON.parse(raw) as Send;
        if (
          typeof pending.key === "string" &&
          typeof pending.text === "string" &&
          typeof pending.conversationId === "string" &&
          Array.isArray(pending.attachmentIds)
        ) {
          setSend({
            ...pending,
            state: "ambiguous",
            error: "Trang đã tải lại khi yêu cầu chưa được xác nhận.",
          });
          setDraft(pending.text);
          setSelected(pending.conversationId);
          setFilter("");
          setAssigned("");
        }
      }
    } catch {}
  };
  useEffect(() => {
    if (!user) return;
    try {
      if (send)
        sessionStorage.setItem("zs-pending:" + user.id, JSON.stringify(send));
      else sessionStorage.removeItem("zs-pending:" + user.id);
    } catch {}
  }, [user, send]);
  const reset = () => {
    sessionRef.current = null;
    draftsRef.current = {};
    setUser(null);
    setPage("inbox");
    setBusy(false);
    setUploading(false);
    setCsrf("");
    setMessages([]);
    setConversations([]);
    setSelectedSnapshot(null);
    listController.current?.abort();
    setSelected(null);
    setDraft("");
    setFiles([]);
    setSend(null);
    setProvider(null);
    setUsers([]);
    setAudit([]);
  };
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: User; csrfToken: string }>("/auth/me", {
      signal: controller.signal,
    })
      .then((v) => {
        setCsrf(v.csrfToken);
        sessionRef.current = v.user.id;
        restorePending(v.user.id);
        setUser(v.user);
      })
      .catch(() => {})
      .finally(() => setBoot(false));
    const expire = () => {
      reset();
      setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    };
    window.addEventListener("session-expired", expire);
    return () => {
      controller.abort();
      window.removeEventListener("session-expired", expire);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    listController.current = controller;
    let running = false;
    let cursor: string | null = null;
    let expanded = false;
    setConversations([]);
    setNextCursor(null);
    setHasSnapshots(false);
    setListError("");
    const fetchPage = async (more = false) => {
      if (running || (more && !cursor)) return;
      running = true;
      setLoadingList(true);
      try {
        const query = new URLSearchParams({
          limit: "50", search,
          ...(filter ? { status: filter } : {}),
          ...(assigned ? { assignedTo: assigned } : {}),
          ...(more && cursor ? { before: cursor } : {}),
        });
        const result = await api<ConversationPage>("/conversations?" + query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (more) expanded = true;
        if (more || !expanded) {
          cursor = result.nextCursor;
          setNextCursor(cursor);
        }
        setHasSnapshots(expanded);
        setConversations((previous) => {
          const byId = new Map(result.items.map((item) => [item.id, item]));
          const retained = more || expanded
            ? previous.filter((item) => !byId.has(item.id))
            : [];
          return more ? [...retained, ...result.items] : [...result.items, ...retained];
        });
        setSelectedSnapshot((previous) =>
          result.items.find((item) => item.id === selectedRef.current) || previous);
        setListError("");
      } catch (e) {
        if (!controller.signal.aborted) setListError((e as Error).message);
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoadingList(false);
      }
    };
    loadMoreRef.current = () => fetchPage(true);
    void fetchPage();
    const timer = setInterval(() => void fetchPage(), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
      loadMoreRef.current = null;
    };
  }, [user?.id, search, filter, assigned, listRefresh]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    let running = false;
    const controller = new AbortController();
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const [us, ps, identity] = await Promise.all([
          api<{ items: User[] }>("/users", { signal: controller.signal }),
          api<Provider>("/provider", { signal: controller.signal }),
          api<{ user: User; csrfToken: string }>("/auth/me", {
            signal: controller.signal,
          }),
        ]);
        if (!alive) return;
        setCsrf(identity.csrfToken);
        if (
          identity.user.role !== user.role ||
          identity.user.name !== user.name
        )
          setUser(identity.user);
        setUsers(us.items);
        setProvider(ps);
        setNetwork(false);
        if (selected) {
          const result = await api<{ items: Message[] }>(
            `/conversations/${selected}/messages`,
            { signal: controller.signal },
          );
          if (alive) {
            setMessages(result.items);
            const pending = sendRef.current;
            if (pending && pending.conversationId === selected) {
              /* POST retry is the only reliable lookup by idempotency key. */
            }
          }
        }
        if (page === "audit" && user.role !== "agent") {
          const rows = await api<{ items: Audit[] }>("/audit?limit=100", {
            signal: controller.signal,
          });
          if (alive) setAudit(rows.items);
        }
      } catch (e) {
        if (alive && !(e instanceof DOMException && e.name === "AbortError"))
          setNetwork(true);
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [user, selected, search, filter, assigned, page]);
  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await api<{ user: User; csrfToken: string }>("/auth/login", {
        method: "POST",
        body: { email: data.get("email"), password: data.get("password") },
      });
      setCsrf(r.csrfToken);
      sessionRef.current = r.user.id;
      restorePending(r.user.id);
      setUser(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (body: object) => {
    if (!current) return;
    const actor = sessionRef.current;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Conversation>(`/conversations/${current.id}`, {
        method: "PATCH",
        body: { expectedVersion: current.version, ...body },
      });
      if (sessionRef.current === actor) {
        setSelectedSnapshot(updated);
        setConversations((cs) =>
          cs.map((c) => (c.id === updated.id ? updated : c)),
        );
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "Hội thoại vừa thay đổi. Dữ liệu sẽ được cập nhật; vui lòng thử lại."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const choose = (c: Conversation) => {
    if (selected !== c.id) {
      setMessages([]);
      if (!send) {
        if (selected) draftsRef.current[selected] = { text: draft, files };
        const saved = draftsRef.current[c.id];
        setDraft(saved?.text || "");
        setFiles(saved?.files || []);
      }
    }
    setSelectedSnapshot(c);
    setSelected(c.id);
    void api(`/conversations/${c.id}/read`, { method: "POST", body: {} }).catch(
      () => {},
    );
  };
  const performSend = async (logical: Send) => {
    const actor = sessionRef.current;
    setSend({ ...logical, state: "sending" });
    setError("");
    try {
      const result = await api<Message>(
        `/conversations/${logical.conversationId}/messages`,
        {
          method: "POST",
          key: logical.key,
          body: { text: logical.text, attachmentIds: logical.attachmentIds },
        },
      );
      if (sessionRef.current !== actor) return;
      if (selectedRef.current === logical.conversationId)
        setMessages((ms) =>
          ms.some((m) => m.id === result.id) ? ms : [...ms, result],
        );
      delete draftsRef.current[logical.conversationId];
      setSend(null);
      setDraft("");
      setFiles([]);
    } catch (e) {
      if (sessionRef.current !== actor) return;
      const definite =
        e instanceof ApiError && e.status >= 400 && e.status < 500;
      setSend({
        ...logical,
        state: definite ? "rejected" : "ambiguous",
        error: (e as Error).message,
      });
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || send || (!draft.trim() && !files.length)) return;
    void performSend({
      conversationId: current.id,
      key: crypto.randomUUID(),
      text: draft,
      attachmentIds: files.map((f) => f.id),
      state: "sending",
    });
  };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const actor = sessionRef.current;
    const target = selected;
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length + files.length > 5) {
      setError("Tối đa 5 tệp cho mỗi tin nhắn.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const next: Attachment[] = [];
      for (const f of picked) {
        if (
          f.size > 5 * 1024 * 1024 ||
          ![
            "image/png",
            "image/jpeg",
            "application/pdf",
            "text/plain",
          ].includes(f.type)
        )
          throw new Error(
            "Chỉ nhận PNG, JPEG, PDF hoặc TXT, tối đa 5 MiB mỗi tệp.",
          );
        next.push(
          await api<Attachment>("/attachments", {
            method: "POST",
            body: {
              name: f.name,
              mime: f.type,
              dataBase64: await fileBase64(f),
            },
          }),
        );
      }
      if (sessionRef.current === actor) {
        if (selectedRef.current === target) setFiles((fs) => [...fs, ...next]);
        else if (target) {
          const saved = draftsRef.current[target] || { text: "", files: [] };
          draftsRef.current[target] = {
            ...saved,
            files: [...saved.files, ...next],
          };
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  if (boot)
    return (
      <main className="loading" aria-live="polite">
        Đang mở không gian làm việc…
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <span className="brand-icon">z</span> Zalo Shared
          </div>
          <div>
            <span className="eyebrow">KẾT NỐI CÙNG NHAU</span>
            <h1>
              Mỗi cuộc trò chuyện.
              <br />
              Một đội ngũ tận tâm.
            </h1>
            <p>
              Không gian chung để lắng nghe, phối hợp và chăm sóc khách hàng.
            </p>
          </div>
          <small>HỘP THƯ ĐỘI NGŨ · KHÔNG GIAN RIÊNG TƯ</small>
        </section>
        <section className="login-card">
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập không gian</h2>
          <p className="muted">Sử dụng tài khoản được quản trị viên cấp.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="ban@congty.vn"
              />
            </label>
            <label>
              Mật khẩu
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={1}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Đang đăng nhập…" : "Đăng nhập"} <span>→</span>
            </button>
          </form>
          <p className="login-note">
            Tài khoản cá nhân · Phân quyền rõ ràng · Lịch sử minh bạch
          </p>
        </section>
      </main>
    );
  const canSend =
    !!current && (user.role !== "agent" || current.assigneeId === user.id);
  return (
    <div className="workspace">
      <aside className="rail">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">z</span>
          <span>
            Zalo <strong>Shared</strong>
          </span>
        </a>
        <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav aria-label="Điều hướng chính">
          <button
            className={page === "inbox" ? "nav active" : "nav"}
            onClick={() => setPage("inbox")}
          >
            <span>▣</span> Hộp thư{" "}
            <span className="nav-count">{conversations.length}</span>
          </button>
          {user.role === "admin" && (
            <button
              className={page === "staff" ? "nav active" : "nav"}
              onClick={() => setPage("staff")}
            >
              <span>♙</span> Nhân sự
            </button>
          )}
          {user.role !== "agent" && (
            <button
              className={page === "audit" ? "nav active" : "nav"}
              onClick={() => setPage("audit")}
            >
              <span>◷</span> Nhật ký
            </button>
          )}
        </nav>
        <div className="rail-bottom">
          <div className="provider">
            <span
              className={
                "dot " + (provider?.status === "connected" ? "green" : "red")
              }
            />
            <div>
              <strong>
                {provider?.status === "connected"
                  ? "Kết nối hoạt động"
                  : "Kết nối gián đoạn"}
              </strong>
              <small>
                {provider?.mode === "mock"
                  ? "Sandbox · Nhà cung cấp mô phỏng"
                  : "Chưa bật nhà cung cấp"}
              </small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{roles[user.role]}</small>
            </div>
            <button
              aria-label="Đăng xuất"
              title="Đăng xuất"
              onClick={async () => {
                try {
                  await api("/auth/logout", { method: "POST", body: {} });
                  reset();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              ↪
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">KHÔNG GIAN CHĂM SÓC KHÁCH HÀNG</span>
            <h1>
              {page === "inbox"
                ? "Hộp thư chung"
                : page === "staff"
                  ? "Đội ngũ của bạn"
                  : "Nhật ký hoạt động"}
            </h1>
          </div>
          <span className="private-badge">
            {provider?.mode === "mock" ? "◈ Sandbox" : "◈ Nội bộ"}
          </span>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button aria-label="Đóng thông báo" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {network && (
          <div className="notice warning" role="status">
            Mất kết nối với máy chủ. Đang thử kết nối lại; trạng thái hiển thị
            có thể chưa cập nhật.
          </div>
        )}
        {provider && provider.status !== "connected" && (
          <div className="notice warning">
            Nhà cung cấp{" "}
            {provider.status === "expired" ? "hết phiên" : "mất kết nối"}. Tin
            nhắn có thể tiếp tục chờ xử lý.
          </div>
        )}
        {page === "inbox" ? (
          <div className={"inbox " + (selected ? "has-selection" : "")}>
            <section
              className="conversation-list"
              aria-label="Danh sách hội thoại"
            >
              <div className="list-heading">
                <h2>
                  Hội thoại <span>{conversations.length}</span>
                </h2>
                <span className="live-label">
                  <span className="dot green" /> Cập nhật 2 giây
                </span>
              </div>
              <label className="search">
                <span>⌕</span>
                <input
                  aria-label="Tìm hội thoại"
                  placeholder="Tìm tên hoặc nội dung…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="filters">
                <select
                  aria-label="Trạng thái hội thoại"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="open">Đang mở</option>
                  <option value="resolved">Đã giải quyết</option>
                  <option value="">Tất cả trạng thái</option>
                </select>
                <select
                  aria-label="Phân công"
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Mọi nhân viên</option>
                  <option value="me">Của tôi</option>
                  <option value="unassigned">Chưa phân công</option>
                </select>
              </div>
              <div className="conversation-scroll">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    className={
                      "conversation " + (selected === c.id ? "selected" : "")
                    }
                    onClick={() => choose(c)}
                    aria-label={c.contactName}
                    aria-pressed={selected === c.id}
                  >
                    <span className="avatar contact">
                      {initials(c.contactName)}
                    </span>
                    <div className="conversation-copy">
                      <div>
                        <strong>{c.contactName}</strong>
                        <time>{time(c.updatedAt)}</time>
                      </div>
                      <p>{c.lastMessage || "Chưa có tin nhắn"}</p>
                      <div className="conversation-meta">
                        <span>
                          {c.assigneeId
                            ? users.find((u) => u.id === c.assigneeId)?.name ||
                              "Đã phân công"
                            : "Chưa phân công"}
                        </span>
                        {c.unreadCount > 0 && <b>{c.unreadCount}</b>}
                      </div>
                    </div>
                  </button>
                ))}
                {listError && <div className="empty-small" role="alert">Không tải được danh sách: {listError}</div>}
                {loadingList && <div className="list-progress" role="status">Đang tải hội thoại…</div>}
                {nextCursor && <button className="load-more" disabled={loadingList} onClick={() => void loadMoreRef.current?.()}>Tải thêm hội thoại</button>}
                {!conversations.length && !loadingList && !listError && (
                  <div className="empty-small">
                    Chưa có hội thoại phù hợp.
                    <br />
                    <small>Hội thoại mới sẽ xuất hiện tại đây.</small>
                  </div>
                )}
              </div>
              <footer className="list-footer">
                {hasSnapshots ? <><span>Các trang đã tải được giữ lại; chỉ trang đầu tự cập nhật.</span><button disabled={loadingList} onClick={() => setListRefresh((value) => value + 1)}>Làm mới danh sách</button></> : "Một đội ngũ. Trọn vẹn mỗi kết nối."}
              </footer>
            </section>
            {current ? (
              <section
                className="thread"
                aria-label={"Hội thoại với " + current.contactName}
              >
                <header className="thread-header">
                  <button
                    className="back"
                    onClick={() => setSelected(null)}
                    aria-label="Quay lại danh sách"
                  >
                    ←
                  </button>
                  <span className="avatar contact">
                    {initials(current.contactName)}
                  </span>
                  <div>
                    <h2>{current.contactName}</h2>
                    <small>
                      <span className="dot green" />{" "}
                      {current.status === "open" ? "Đang mở" : "Đã giải quyết"}{" "}
                      · {current.contactId}
                    </small>
                  </div>
                  <button
                    className="status-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        status: current.status === "open" ? "resolved" : "open",
                      })
                    }
                  >
                    {current.status === "open" ? "✓ Giải quyết" : "Mở lại"}
                  </button>
                </header>
                <div className="assignment-bar">
                  <span>♙ Phụ trách</span>
                  {user.role === "agent" ? (
                    <>
                      <strong>
                        {users.find((u) => u.id === current.assigneeId)?.name ||
                          "Chưa phân công"}
                      </strong>
                      {!current.assigneeId && (
                        <button
                          disabled={busy}
                          onClick={() => void mutate({ assigneeId: user.id })}
                        >
                          Nhận hội thoại
                        </button>
                      )}
                    </>
                  ) : (
                    <select
                      aria-label="Người phụ trách"
                      disabled={busy}
                      value={current.assigneeId || ""}
                      onChange={(e) =>
                        void mutate({ assigneeId: e.target.value || null })
                      }
                    >
                      <option value="">Chưa phân công</option>
                      {users
                        .filter((u) => u.active)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div
                  className="timeline"
                  aria-label="Tin nhắn"
                  aria-live="polite"
                >
                  <div className="timeline-intro">
                    <span>Cuộc trò chuyện với {current.contactName}</span>
                    <small>Lịch sử được chia sẻ trong đội ngũ</small>
                  </div>
                  {messages.map((m) => (
                    <article className={"message " + m.direction} key={m.id}>
                      <span className="avatar tiny">
                        {initials(
                          m.direction === "inbound"
                            ? current.contactName
                            : users.find((u) => u.id === m.actorId)?.name ||
                                "Đội ngũ",
                        )}
                      </span>
                      <div>
                        <div className="message-author">
                          {m.direction === "inbound"
                            ? current.contactName
                            : users.find((u) => u.id === m.actorId)?.name ||
                              "Đội ngũ"}
                        </div>
                        <div className="bubble">
                          {m.text && <p>{m.text}</p>}
                          {m.attachments.map((a) => (
                            <a
                              className="attachment"
                              key={a.id}
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              ↗ {a.name}{" "}
                              <small>{Math.ceil(a.size / 1024)} KB</small>
                            </a>
                          ))}
                        </div>
                        <div className={"message-meta " + m.status}>
                          <time>{time(m.createdAt)}</time>
                          <span>{statusLabel[m.status]}</span>
                        </div>
                        {m.status === "unknown" && (
                          <p className="delivery-note">
                            Kết quả chưa xác định. Không gửi lại để tránh trùng
                            tin.
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                  {!messages.length && (
                    <div className="empty-small">
                      Chưa có tin nhắn trong hội thoại.
                    </div>
                  )}
                  <div ref={timelineEnd} />
                </div>
                <form className="composer" onSubmit={submit}>
                  {!canSend && (
                    <div className="compose-hint">
                      {current.assigneeId
                        ? "Hội thoại được giao cho nhân viên khác."
                        : "Nhận hội thoại để bắt đầu trả lời."}
                    </div>
                  )}
                  {send && (
                    <div className="notice warning" role="status">
                      <div>
                        <strong>
                          {send.state === "sending"
                            ? "Đang xác nhận tin nhắn…"
                            : send.state === "ambiguous"
                              ? "Chưa xác định kết quả gửi"
                              : "Yêu cầu gửi bị từ chối"}
                        </strong>
                        <p>
                          {send.error || "Vui lòng chờ xác nhận từ máy chủ."}
                        </p>
                        {send.state === "ambiguous" && (
                          <small>
                            Nội dung được giữ nguyên. Kiểm tra bằng cùng mã yêu
                            cầu để tránh gửi trùng.
                          </small>
                        )}
                      </div>
                      {send.state !== "sending" && (
                        <button
                          type="button"
                          onClick={() => void performSend(send)}
                        >
                          Kiểm tra / thử lại
                        </button>
                      )}
                      {send.state === "rejected" && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(send.conversationId);
                            setSend(null);
                          }}
                        >
                          Sửa nội dung
                        </button>
                      )}
                    </div>
                  )}
                  <textarea
                    aria-label="Tin nhắn"
                    placeholder={
                      canSend
                        ? "Viết lời nhắn đến khách hàng…"
                        : "Nhận hội thoại trước khi trả lời"
                    }
                    value={draft}
                    disabled={!canSend || !!send}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                  />
                  {files.length > 0 && (
                    <div className="file-chips">
                      {files.map((f) => (
                        <span key={f.id}>
                          {f.name}
                          <button
                            type="button"
                            disabled={!!send}
                            aria-label={"Xóa " + f.name}
                            onClick={() =>
                              setFiles((fs) => fs.filter((x) => x.id !== f.id))
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="composer-footer">
                    <label
                      className={
                        "file-button " + (!canSend || send ? "disabled" : "")
                      }
                      title="PNG, JPEG, PDF, TXT · 5 MiB · tối đa 5 tệp"
                    >
                      <input
                        type="file"
                        aria-label="Đính kèm"
                        multiple
                        accept="image/png,image/jpeg,application/pdf,text/plain"
                        onChange={upload}
                        disabled={!canSend || !!send || uploading}
                      />
                      <span>＋</span>
                      {uploading ? "Đang tải…" : "Đính kèm"}
                    </label>
                    <small>PNG, JPG, PDF, TXT · tối đa 5 MiB/tệp</small>
                    <button
                      className="primary"
                      aria-label="Gửi tin nhắn"
                      disabled={
                        !canSend ||
                        !!send ||
                        uploading ||
                        (!draft.trim() && !files.length)
                      }
                    >
                      Gửi tin nhắn <span>↗</span>
                    </button>
                  </div>
                </form>
              </section>
            ) : (
              <section className="thread empty-thread">
                <div className="empty-icon">✉</div>
                <span className="eyebrow">SẴN SÀNG LẮNG NGHE</span>
                <h2>Chọn một cuộc trò chuyện</h2>
                <p>
                  Cùng đội ngũ mang đến trải nghiệm
                  <br />
                  chăm sóc liền mạch cho mỗi khách hàng.
                </p>
              </section>
            )}
            {current && (
              <aside className="contact-panel">
                <span className="eyebrow">THÔNG TIN KHÁCH HÀNG</span>
                <div className="contact-card">
                  <span className="avatar large">
                    {initials(current.contactName)}
                  </span>
                  <h2>{current.contactName}</h2>
                  <span className="tag">Khách hàng</span>
                </div>
                <dl>
                  <dt>Mã liên hệ</dt>
                  <dd>{current.contactId}</dd>
                  <dt>Người phụ trách</dt>
                  <dd>
                    {users.find((u) => u.id === current.assigneeId)?.name ||
                      "Chưa phân công"}
                  </dd>
                  <dt>Trạng thái</dt>
                  <dd>
                    {current.status === "open" ? "Đang mở" : "Đã giải quyết"}
                  </dd>
                </dl>
                <div className="team-note">
                  <span>✧</span>
                  <strong>Chăm sóc cùng nhau</strong>
                  <p>
                    Kiểm tra người phụ trách trước khi trả lời để mỗi khách hàng
                    luôn được hỗ trợ nhất quán.
                  </p>
                </div>
              </aside>
            )}
          </div>
        ) : page === "staff" ? (
          <Staff
            users={users}
            onError={setError}
            onUpdate={(u) =>
              setUsers((us) =>
                us.some((x) => x.id === u.id)
                  ? us.map((x) => (x.id === u.id ? u : x))
                  : [...us, u],
              )
            }
          />
        ) : (
          <section className="admin-page">
            <div className="section-intro">
              <h2>Lịch sử minh bạch</h2>
              <p>Hoạt động gần nhất trong không gian làm việc.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Thành viên</th>
                    <th>Hoạt động</th>
                    <th>Đối tượng</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{new Date(a.createdAt).toLocaleString("vi-VN")}</td>
                      <td>{a.actorName || "Hệ thống"}</td>
                      <td>
                        <code>{a.action}</code>
                      </td>
                      <td className="break">{a.targetId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!audit.length && (
                <p className="empty-small">Chưa có hoạt động được ghi nhận.</p>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
function Staff({
  users,
  onError,
  onUpdate,
}: {
  users: User[];
  onError: (v: string) => void;
  onUpdate: (u: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const change = async (id: string, body: object) => {
    setBusy(true);
    try {
      onUpdate(await api<User>("/users/" + id, { method: "PATCH", body }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-page">
      <div className="section-intro">
        <h2>Cộng tác tốt hơn, cùng nhau</h2>
        <p>
          Quản lý tài khoản và quyền truy cập của đội ngũ. Không giới hạn số
          nhân viên.
        </p>
      </div>
      <form
        className="staff-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          setBusy(true);
          try {
            onUpdate(
              await api<User>("/users", {
                method: "POST",
                body: {
                  name: data.get("name"),
                  email: data.get("email"),
                  password: data.get("password"),
                  role: data.get("role"),
                },
              }),
            );
            form.reset();
          } catch (err) {
            onError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Thêm thành viên</h3>
        <label>
          Họ tên
          <input name="name" required />
        </label>
        <label>
          Email nhân viên
          <input name="email" type="email" autoComplete="off" required />
        </label>
        <label>
          Mật khẩu ban đầu
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <label>
          Vai trò
          <select name="role">
            <option value="agent">Nhân viên</option>
            <option value="supervisor">Giám sát</option>
            <option value="admin">Quản trị viên</option>
          </select>
        </label>
        <button className="primary" disabled={busy}>
          Thêm nhân viên
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                </td>
                <td>
                  <select
                    aria-label={"Vai trò của " + u.name}
                    value={u.role}
                    disabled={busy}
                    onChange={(e) =>
                      void change(u.id, { role: e.target.value })
                    }
                  >
                    {Object.entries(roles).map(([key, value]) => (
                      <option key={key} value={key}>
                        {value}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={"tag " + (!u.active ? "inactive" : "")}>
                    {u.active ? "Hoạt động" : "Đã vô hiệu hóa"}
                  </span>
                </td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => void change(u.id, { active: !u.active })}
                  >
                    {u.active ? "Vô hiệu hóa" : "Kích hoạt"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
