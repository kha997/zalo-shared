import React, { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type OperationsOverview,
  type OperationsPage,
  type ProviderEventSummary,
  type ProviderEventDetail,
  type UnknownJob,
} from "./api";
const MAX_VERSION = "9223372036854775807";
const uuidValid = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const referenceValid = (value: string) =>
  value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9_. /#-]*$/.test(value);
const versionValid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= BigInt(MAX_VERSION);
function overviewValid(value: OperationsOverview) {
  return (
    value &&
    ["mock", "disabled"].includes(value.mode) &&
    ["connected", "disconnected", "expired"].includes(value.status) &&
    typeof value.reconciliationRequired === "boolean" &&
    versionValid(value.gapVersion) &&
    value.owner &&
    ["idle", "reserved", "active", "uncertain"].includes(value.owner.phase) &&
    versionValid(value.owner.epoch) &&
    (value.owner.ownerId === null || uuidValid(value.owner.ownerId)) &&
    (value.owner.phase === "idle") === (value.owner.ownerId === null) &&
    value.counts &&
    [
      value.counts.held,
      value.counts.unresolvedConflicts,
      value.counts.unknownJobs,
    ].every((n) => Number.isSafeInteger(n) && n >= 0)
  );
}
function eventValid(value: ProviderEventSummary) {
  return (
    value &&
    uuidValid(value.id) &&
    uuidValid(value.conversationId) &&
    typeof value.providerId === "string" &&
    value.providerId.length > 0 &&
    value.providerId.length <= 200 &&
    ["text", "unsupported"].includes(value.kind) &&
    (value.text === null || typeof value.text === "string") &&
    ["inbound", "outbound"].includes(value.direction) &&
    ["held", "linked", "conflict"].includes(value.state) &&
    typeof value.conflict === "boolean" &&
    typeof value.variantOverflow === "boolean" &&
    typeof value.variantEvidenceMissing === "boolean" &&
    versionValid(value.resolutionVersion) &&
    (value.resolvedAt === null || typeof value.resolvedAt === "string")
  );
}
function jobValid(value: UnknownJob) {
  return (
    value &&
    uuidValid(value.messageId) &&
    uuidValid(value.conversationId) &&
    typeof value.text === "string" &&
    Array.isArray(value.parts) &&
    value.parts.length >= 1 &&
    value.parts.length <= 6 &&
    value.parts.every(
      (p) =>
        Number.isInteger(p.part) &&
        p.part >= 0 &&
        [
          "pending",
          "processing",
          "sent",
          "skipped",
          "failed",
          "unknown",
        ].includes(p.status) &&
        (p.providerId === null || typeof p.providerId === "string"),
    )
  );
}
function pageValid<T>(value: OperationsPage<T>) {
  return (
    value &&
    Array.isArray(value.items) &&
    value.items.length <= 25 &&
    (value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length <= 2048))
  );
}
/** Admin-only parent mount. Server authorization and CAS remain authoritative. */
export default function ConnectorOperations() {
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [events, setEvents] = useState<OperationsPage<ProviderEventSummary>>({
    items: [],
    nextCursor: null,
  });
  const [jobs, setJobs] = useState<OperationsPage<UnknownJob>>({
    items: [],
    nextCursor: null,
  });
  const [filter, setFilter] = useState<"held" | "conflict">("held");
  const [eventCursor, setEventCursor] = useState<string | null>(null),
    [jobCursor, setJobCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderEventDetail | null>(null);
  const [jobId, setJobId] = useState(""),
    [part, setPart] = useState("");
  const [reference, setReference] = useState(""),
    [attested, setAttested] = useState(false);
  const [gapReference, setGapReference] = useState(""),
    [gapAttested, setGapAttested] = useState(false);
  const [fenceReference, setFenceReference] = useState(""),
    [fenceAttested, setFenceAttested] = useState(false);
  const [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null),
    detailRequest = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const clearProof = () => {
    setReference("");
    setAttested(false);
    setGapReference("");
    setGapAttested(false);
    setFenceReference("");
    setFenceAttested(false);
  };
  const clearPrivate = () => {
    setOverview(null);
    setEvents({ items: [], nextCursor: null });
    setJobs({ items: [], nextCursor: null });
    setDetail(null);
    setJobId("");
    setPart("");
    clearProof();
  };
  const refresh = () => {
    setEventCursor(null);
    setJobCursor(null);
    setRevision((n) => n + 1);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      controller.current?.abort();
      detailRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    detailRequest.current?.abort();
    clearPrivate();
    setLoading(true);
    setError("");
    const suffix = (cursor: string | null) =>
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    void Promise.all([
      api<OperationsOverview>("/provider/operations", { signal: abort.signal }),
      api<OperationsPage<ProviderEventSummary>>(
        `/provider/operations/events?state=${filter}&limit=25${suffix(eventCursor)}`,
        { signal: abort.signal },
      ),
      api<OperationsPage<UnknownJob>>(
        `/provider/operations/unknown?limit=25${suffix(jobCursor)}`,
        { signal: abort.signal },
      ),
    ])
      .then(([summary, eventPage, jobPage]) => {
        if (
          !overviewValid(summary) ||
          !pageValid(eventPage) ||
          !pageValid(jobPage) ||
          !eventPage.items.every(eventValid) ||
          !jobPage.items.every(jobValid)
        )
          throw new Error("invalid-response");
        if (alive.current && current === generation.current) {
          setOverview(summary);
          setEvents(eventPage);
          setJobs(jobPage);
        }
      })
      .catch((e) => {
        if (
          !alive.current ||
          current !== generation.current ||
          abort.signal.aborted
        )
          return;
        clearPrivate();
        setError(
          e instanceof ApiError && e.status === 403
            ? "Bạn không còn quyền đối soát. Dữ liệu quản trị đã được đóng."
            : "Không tải được trạng thái đối soát. Chưa có thay đổi nào được gửi.",
        );
      })
      .finally(() => {
        if (alive.current && current === generation.current) {
          setLoading(false);
          setDetailLoading(false);
        }
      });
    return () => abort.abort();
  }, [filter, eventCursor, jobCursor, revision]);
  useEffect(() => {
    if (detail) heading.current?.focus();
  }, [detail]);
  async function selectEvent(id: string) {
    const current = generation.current,
      abort = new AbortController();
    detailRequest.current?.abort();
    detailRequest.current = abort;
    setDetail(null);
    setReference("");
    setAttested(false);
    setDetailLoading(true);
    setError("");
    try {
      const item = await api<ProviderEventDetail>(
        `/provider/operations/events/${encodeURIComponent(id)}`,
        { signal: abort.signal },
      );
      if (
        !eventValid(item) ||
        item.id !== id ||
        !versionValid(item.resolutionVersion) ||
        !Array.isArray(item.variants) ||
        item.variants.length > 8 ||
        !/^[a-f0-9]{64}$/.test(item.semanticHash) ||
        item.variants.some((v) => !/^[a-f0-9]{64}$/.test(v.semanticHash))
      )
        throw new Error("invalid-response");
      if (
        alive.current &&
        current === generation.current &&
        !abort.signal.aborted
      ) {
        setDetail(item);
      }
    } catch (e) {
      if (
        alive.current &&
        current === generation.current &&
        !abort.signal.aborted
      ) {
        if (e instanceof ApiError && e.status === 403) clearPrivate();
        setError(
          "Không tải được bằng chứng sự kiện. Thao tác xác nhận đang khóa.",
        );
      }
    } finally {
      if (
        alive.current &&
        current === generation.current &&
        !abort.signal.aborted
      )
        setDetailLoading(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    if (busy || loading || !overview) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/provider/operations/${path}`, {
        method: "POST",
        body,
        signal: controller.current?.signal,
      });
      if (alive.current && current === generation.current) {
        setNotice("Đã ghi nhận xác nhận và nhật ký. Đang tải trạng thái mới.");
        refresh();
      }
    } catch (e) {
      if (!alive.current || current !== generation.current) return;
      if (e instanceof ApiError && e.status === 409) {
        setNotice(
          "Trạng thái đã thay đổi. Đã tải lại; hãy kiểm tra lại bằng chứng trước khi xác nhận.",
        );
        refresh();
      } else if (e instanceof ApiError && e.status === 403) {
        clearPrivate();
        setError("Quyền quản trị đã thay đổi. Không thể tiếp tục thao tác.");
      } else
        setError(
          "Chưa xác định kết quả xác nhận. Không gửi lại ngay; tải lại trạng thái và kiểm tra nhật ký trước.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const selectedJob = jobs.items.find((j) => j.messageId === jobId);
  const selectedPart = selectedJob?.parts.find(
    (p) => p.part.toString() === part && p.status === "unknown",
  );
  const eventSafe =
    !!detail &&
    !detail.variantOverflow &&
    !detail.variantEvidenceMissing &&
    detail.resolutionVersion !== MAX_VERSION;
  const confirmSafe =
    eventSafe &&
    detail.state === "held" &&
    detail.direction === "outbound" &&
    !detail.conflict &&
    selectedJob?.conversationId === detail.conversationId &&
    !!selectedPart;
  const resolveSafe =
    eventSafe &&
    detail.conflict &&
    detail.resolvedAt === null &&
    detail.variants.length > 0;
  const gapSafe =
    !!overview &&
    overview.reconciliationRequired &&
    overview.gapVersion !== MAX_VERSION &&
    overview.owner.epoch !== MAX_VERSION &&
    ["idle", "active"].includes(overview.owner.phase) &&
    Object.values(overview.counts).every((n) => n === 0);
  const fenceSafe =
    !!overview &&
    overview.owner.ownerId !== null &&
    overview.owner.phase !== "idle";
  const locked = busy || loading || detailLoading;
  return (
    <section
      className="admin-page connector-operations"
      aria-label="Đối soát Zalo"
      aria-busy={loading || busy}
    >
      <div className="section-intro">
        <h2>Đối soát Zalo</h2>
        <p>
          Đối chiếu bằng ID chính xác. Xác nhận không gửi thêm tin và không tự
          chứng minh lịch sử Zalo đầy đủ.
        </p>
        <button type="button" onClick={refresh} disabled={busy || loading}>
          Tải lại trạng thái
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {loading && <p role="status">Đang tải trạng thái đối soát…</p>}
      {overview && (
        <>
          <div className="operations-cards">
            <div>
              <span>Chế độ</span>
              <strong>
                {overview.mode === "disabled"
                  ? "Nhà cung cấp đang tắt"
                  : "Mô phỏng"}
              </strong>
            </div>
            <div>
              <span>Kết nối</span>
              <strong>
                {overview.status === "connected" &&
                !overview.reconciliationRequired
                  ? "Đã kết nối"
                  : overview.reconciliationRequired
                    ? "Chặn gửi để đối soát"
                    : "Chưa kết nối"}
              </strong>
            </div>
            <div>
              <span>Quyền sở hữu phiên</span>
              <strong>
                {
                  {
                    idle: "Chưa có tiến trình",
                    reserved: "Đang khởi tạo",
                    active: "Đang giữ phiên",
                    uncertain: "Chưa xác định",
                  }[overview.owner.phase]
                }
              </strong>
              <small>Epoch {overview.owner.epoch}</small>
            </div>
            <div>
              <span>Khoảng gián đoạn</span>
              <strong>
                {overview.reconciliationRequired
                  ? "Cần kiểm tra"
                  : "Không có yêu cầu đang mở"}
              </strong>
              <small>Version {overview.gapVersion}</small>
            </div>
          </div>
          <p className="operations-identifiers">
            Owner: <code>{overview.owner.ownerId ?? "Chưa có"}</code> · Mã trạng
            thái: <code>{overview.faultCode ?? "Không có"}</code>
          </p>
          <div className="operations-counts">
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setFilter("held");
                setEventCursor(null);
              }}
            >
              Đang giữ: {overview.counts.held}
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setFilter("conflict");
                setEventCursor(null);
              }}
            >
              Xung đột chưa xử lý: {overview.counts.unresolvedConflicts}
            </button>
            <a href="#ops-unknown">
              Lần gửi chưa rõ: {overview.counts.unknownJobs}
            </a>
          </div>
          <div className="operations-columns">
            <section className="operations-panel">
              <h3>Sự kiện cần kiểm tra</h3>
              <label>
                Loại sự kiện
                <select
                  value={filter}
                  disabled={locked}
                  onChange={(e) => {
                    setFilter(e.target.value as "held" | "conflict");
                    setEventCursor(null);
                  }}
                >
                  <option value="held">Đang giữ</option>
                  <option value="conflict">Xung đột</option>
                </select>
              </label>
              <ul className="operations-list">
                {events.items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => void selectEvent(e.id)}
                    >
                      <strong>{e.providerId}</strong>
                      <small>Hội thoại {e.conversationId}</small>
                      <small>
                        {e.direction} · version {e.resolutionVersion}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {!events.items.length && <p>Không có sự kiện trong trang này.</p>}
              <div className="operations-pagination">
                <button
                  type="button"
                  disabled={locked || !eventCursor}
                  onClick={() => setEventCursor(null)}
                >
                  Trang đầu sự kiện
                </button>
                <button
                  type="button"
                  disabled={locked || !events.nextCursor}
                  onClick={() => setEventCursor(events.nextCursor)}
                >
                  Trang sau sự kiện
                </button>
              </div>
            </section>
            <section className="operations-panel">
              <h3 id="ops-unknown">Lần gửi chưa rõ kết quả</h3>
              <p>Không gửi lại để tránh trùng tin.</p>
              <label>
                Chọn tin nhắn
                <select
                  value={jobId}
                  disabled={locked}
                  onChange={(e) => {
                    setJobId(e.target.value);
                    setPart("");
                    setAttested(false);
                  }}
                >
                  <option value="">Chọn một tin nhắn</option>
                  {jobs.items.map((j) => (
                    <option key={j.messageId} value={j.messageId}>
                      {j.messageId}
                    </option>
                  ))}
                </select>
              </label>
              {selectedJob && (
                <>
                  <p className="break">
                    Hội thoại <code>{selectedJob.conversationId}</code>
                    <br />
                    Tác giả: {selectedJob.actorId ?? "Zalo / thiết bị khác"}
                  </p>
                  <p>{selectedJob.text}</p>
                  <table>
                    <caption>Các phần của tin nhắn</caption>
                    <thead>
                      <tr>
                        <th>Phần</th>
                        <th>Trạng thái</th>
                        <th>Provider ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedJob.parts.map((p) => (
                        <tr key={p.part}>
                          <td>{p.part}</td>
                          <td>{p.status}</td>
                          <td className="break">
                            {p.providerId ?? "Chưa xác nhận"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <label>
                    Phần chưa xác định
                    <select
                      value={part}
                      disabled={locked}
                      onChange={(e) => {
                        setPart(e.target.value);
                        setAttested(false);
                      }}
                    >
                      <option value="">Chọn phần</option>
                      {selectedJob.parts
                        .filter((p) => p.status === "unknown")
                        .map((p) => (
                          <option key={p.part} value={p.part}>
                            {p.part}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              {!jobs.items.length && (
                <p>Không có lần gửi chưa rõ trong trang này.</p>
              )}
              <div className="operations-pagination">
                <button
                  type="button"
                  disabled={locked || !jobCursor}
                  onClick={() => setJobCursor(null)}
                >
                  Trang đầu lần gửi
                </button>
                <button
                  type="button"
                  disabled={locked || !jobs.nextCursor}
                  onClick={() => setJobCursor(jobs.nextCursor)}
                >
                  Trang sau lần gửi
                </button>
              </div>
            </section>
          </div>
          {detailLoading && <p role="status">Đang tải bằng chứng…</p>}
          {detail && (
            <section className="operations-panel operations-detail">
              <h3 ref={heading} tabIndex={-1}>
                Bằng chứng sự kiện đã chọn
              </h3>
              <dl>
                <dt>Sự kiện</dt>
                <dd>
                  <code>{detail.id}</code>
                </dd>
                <dt>Hội thoại</dt>
                <dd>
                  <code>{detail.conversationId}</code>
                </dd>
                <dt>Provider ID</dt>
                <dd>
                  <code>{detail.providerId}</code>
                </dd>
                <dt>Phiên bản đối soát</dt>
                <dd>{detail.resolutionVersion}</dd>
                <dt>Bản gốc</dt>
                <dd>
                  {detail.text ?? "Nội dung chưa hỗ trợ"}
                  <small className="break">Hash: {detail.semanticHash}</small>
                </dd>
              </dl>
              {detail.variants.map((v) => (
                <div className="operations-variant" key={v.semanticHash}>
                  <strong>Biến thể đã giữ</strong>
                  <p>{v.text ?? "Nội dung chưa hỗ trợ"}</p>
                  <small className="break">{v.semanticHash}</small>
                </div>
              ))}
              {(!eventSafe || detail.resolvedAt !== null) && (
                <p className="notice warning">
                  Không thể xác nhận ở trạng thái này: bằng chứng thiếu, vượt
                  giới hạn, version chạm trần hoặc đã được xử lý. Cần điều tra
                  thêm; không có thao tác bỏ qua.
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!attested || !referenceValid(reference) || locked) return;
                  if (filter === "held" && confirmSafe)
                    void mutate("confirm-part", {
                      messageId: selectedJob!.messageId,
                      part: selectedPart!.part,
                      eventId: detail.id,
                      expectedResolutionVersion: detail.resolutionVersion,
                      evidenceRef: reference,
                      confirmProviderIdObserved: true,
                    });
                  else if (filter === "conflict" && resolveSafe)
                    void mutate("resolve-conflict", {
                      eventId: detail.id,
                      expectedResolutionVersion: detail.resolutionVersion,
                      expectedVariantHashes: detail.variants
                        .map((v) => v.semanticHash)
                        .sort(),
                      decision: "retain-canonical",
                      evidenceRef: reference,
                      confirmExternalReview: true,
                    });
                }}
              >
                <label>
                  Tham chiếu bằng chứng
                  <input
                    value={reference}
                    maxLength={256}
                    disabled={locked}
                    onChange={(e) => {
                      setReference(e.target.value);
                      setAttested(false);
                    }}
                    placeholder="VD: ticket-2026-001"
                  />
                </label>
                <small>
                  Chỉ ghi mã tham chiếu nội bộ; không nhập URL, cookie, token
                  hay nội dung khách hàng.
                </small>
                <label className="operations-check">
                  <input
                    type="checkbox"
                    checked={attested}
                    disabled={locked}
                    onChange={(e) => setAttested(e.target.checked)}
                  />
                  {filter === "held"
                    ? "Tôi đã quan sát chính xác provider ID này thuộc phần gửi đã chọn; không suy đoán theo nội dung hoặc thời gian."
                    : "Tôi đã đối chiếu bên ngoài và xác nhận giữ bản gốc cùng toàn bộ biến thể đã lưu."}
                </label>
                <button
                  type="submit"
                  disabled={
                    locked ||
                    !attested ||
                    !referenceValid(reference) ||
                    !(filter === "held" ? confirmSafe : resolveSafe)
                  }
                >
                  {filter === "held"
                    ? "Xác nhận phần gửi bằng ID"
                    : "Ghi nhận giữ bản gốc"}
                </button>
              </form>
            </section>
          )}
          <section className="operations-panel">
            <h3>Xác nhận kiểm tra khoảng gián đoạn</h3>
            <p>
              Chỉ mở yêu cầu đối soát khi không còn sự kiện đang giữ, xung đột
              hoặc lần gửi chưa rõ. Xác nhận này không kết nối lại Zalo và không
              chứng minh dữ liệu bên ngoài đầy đủ.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  gapSafe &&
                  gapAttested &&
                  referenceValid(gapReference) &&
                  !locked
                )
                  void mutate("ack-gap", {
                    expectedGapVersion: overview.gapVersion,
                    expectedOwnerId: overview.owner.ownerId,
                    expectedOwnerEpoch: overview.owner.epoch,
                    evidenceRef: gapReference,
                    confirmHistoryReviewed: true,
                  });
              }}
            >
              <label>
                Tham chiếu kiểm tra lịch sử
                <input
                  value={gapReference}
                  maxLength={256}
                  disabled={locked}
                  onChange={(e) => {
                    setGapReference(e.target.value);
                    setGapAttested(false);
                  }}
                />
              </label>
              <label className="operations-check">
                <input
                  type="checkbox"
                  checked={gapAttested}
                  disabled={locked}
                  onChange={(e) => setGapAttested(e.target.checked)}
                />
                Tôi đã kiểm tra lịch sử bên ngoài và chấp nhận bằng chứng cho
                đúng gap version đang hiển thị.
              </label>
              <button
                type="submit"
                disabled={
                  locked ||
                  !gapSafe ||
                  !gapAttested ||
                  !referenceValid(gapReference)
                }
              >
                Ghi nhận kiểm tra gián đoạn
              </button>
            </form>
          </section>
          <section className="operations-panel">
            <h3>Xác nhận cô lập tiến trình cũ</h3>
            <p>
              Phải dừng tiến trình cũ và xác minh nó không còn khả năng truy cập
              Zalo từ hạ tầng độc lập. Mất khóa cơ sở dữ liệu, hết heartbeat
              hoặc bấm dừng không phải bằng chứng cô lập. Nếu không xác định
              được vị trí tiến trình, không xác nhận.
            </p>
            <p>
              Đúng owner <code>{overview.owner.ownerId ?? "Không có"}</code>,
              epoch <code>{overview.owner.epoch}</code>. Thao tác chỉ ghi nhận
              lời xác nhận của quản trị viên; hệ thống không kiểm chứng firewall
              hay hạ tầng bên ngoài.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  fenceSafe &&
                  fenceAttested &&
                  referenceValid(fenceReference) &&
                  !locked
                )
                  void mutate("ack-fence", {
                    expectedOwnerId: overview.owner.ownerId,
                    expectedEpoch: overview.owner.epoch,
                    evidenceRef: fenceReference,
                    acknowledgeExternalFence: true,
                  });
              }}
            >
              <label>
                Tham chiếu bằng chứng cô lập
                <input
                  value={fenceReference}
                  maxLength={256}
                  disabled={locked}
                  onChange={(e) => {
                    setFenceReference(e.target.value);
                    setFenceAttested(false);
                  }}
                />
              </label>
              <label className="operations-check">
                <input
                  type="checkbox"
                  checked={fenceAttested}
                  disabled={locked}
                  onChange={(e) => setFenceAttested(e.target.checked)}
                />
                Tôi xác nhận đã cô lập đúng tiến trình và khả năng truy cập Zalo
                của owner/epoch này bằng kiểm tra bên ngoài.
              </label>
              <button
                type="submit"
                disabled={
                  locked ||
                  !fenceSafe ||
                  !fenceAttested ||
                  !referenceValid(fenceReference)
                }
              >
                Ghi nhận cô lập bên ngoài
              </button>
            </form>
          </section>
        </>
      )}
    </section>
  );
}
