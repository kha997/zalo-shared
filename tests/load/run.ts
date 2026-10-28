import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw new Error("Load test permits loopback HTTP only");
const adminEmail = process.env.TEST_ADMIN_EMAIL,
  adminPassword = process.env.TEST_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword)
  throw new Error("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required");
type Session = { cookie: string; csrf: string };
async function call(
  path: string,
  session?: Session,
  data?: unknown,
  key?: string,
) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(30000),
    method: data === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${path.split("?")[0]}`);
  return {
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function login(email: string, password: string): Promise<Session> {
  const result = await call("/api/auth/login", undefined, { email, password });
  if (!result.cookie) throw new Error("Session cookie absent");
  return { cookie: result.cookie, csrf: result.body.csrfToken };
}
const admin = await login(adminEmail, adminPassword);
await call("/api/provider/mock/state", admin, { status: "connected" });
const rounds = Number(process.env.LOAD_ROUNDS ?? 3);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100)
  throw new Error("LOAD_ROUNDS must be 1..100");
const userCounts = (process.env.LOAD_USERS ?? "4,10,25,50")
  .split(",")
  .map(Number);
if (
  !userCounts.length ||
  userCounts.some((n) => ![4, 10, 25, 50, 100, 200, 500].includes(n)) ||
  new Set(userCounts).size !== userCounts.length
)
  throw new Error(
    "LOAD_USERS must be unique comma-separated counts from 4,10,25,50,100,200,500",
  );
const capacityProbe = process.env.LOAD_PROFILE === "capacity";
const output: unknown[] = [];
for (const count of userCounts) {
  const run = randomUUID();
  const users = [];
  for (let i = 0; i < count; i++) {
    const credentials = {
      email: `load-${run}-${i}@example.test`,
      password: `Load-${randomUUID()}!`,
    };
    const user = (
      await call("/api/users", admin, {
        ...credentials,
        name: `Load user ${i + 1}`,
        role: "agent",
      })
    ).body;
    const contactId = `load-${run}-${i}`;
    await call("/api/provider/mock/inbound", admin, {
      contactId,
      contactName: `Load contact ${i + 1} ${run}`,
      providerId: contactId,
      text: "Synthetic load fixture",
    });
    const conversations = (
      await call(`/api/conversations?search=${encodeURIComponent(run)}`, admin)
    ).body.items;
    const conversation = conversations.find(
      (c: { contactId: string }) => c.contactId === contactId,
    );
    if (!conversation) throw new Error("Fixture conversation missing");
    const response = await fetch(
      `${base}/api/conversations/${conversation.id}`,
      {
        method: "PATCH",
        headers: {
          Origin: base,
          Cookie: admin.cookie,
          "X-CSRF-Token": admin.csrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: conversation.version,
          assigneeId: user.id,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Fixture assignment HTTP ${response.status}`);
    users.push({ ...credentials, conversationId: conversation.id });
  }
  const latency: number[] = [],
    errors: string[] = [],
    ids = new Set<string>();
  let requests = 0,
    retriesVerified = 0;
  const started = performance.now();
  await Promise.all(
    users.map(async (user) => {
      const measured = async <T>(fn: () => Promise<T>): Promise<T> => {
        const start = performance.now();
        try {
          return await fn();
        } finally {
          requests++;
          latency.push(performance.now() - start);
        }
      };
      try {
        const session = await measured(() => login(user.email, user.password));
        for (let r = 0; r < rounds; r++) {
          await measured(() =>
            call("/api/conversations?assignedTo=me", session),
          );
          const key = randomUUID(),
            body = { text: `Synthetic load ${run} ${r}` };
          const first = await measured(() =>
            call(
              `/api/conversations/${user.conversationId}/messages`,
              session,
              body,
              key,
            ),
          );
          const retry = await measured(() =>
            call(
              `/api/conversations/${user.conversationId}/messages`,
              session,
              body,
              key,
            ),
          );
          if (first.body.id !== retry.body.id || ids.has(first.body.id))
            throw new Error("Idempotency/unique message verification failed");
          ids.add(first.body.id);
          retriesVerified++;
          const timeline = (
            await measured(() =>
              call(
                `/api/conversations/${user.conversationId}/messages`,
                session,
              ),
            )
          ).body.items;
          if (
            timeline.filter((m: { id: string }) => m.id === first.body.id)
              .length !== 1
          )
            throw new Error("Duplicate/missing persisted message");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Unknown failure");
      }
    }),
  );
  const durationMs = performance.now() - started;
  latency.sort((a, b) => a - b);
  const percentile = (p: number) =>
    latency[Math.max(0, Math.ceil(latency.length * p) - 1)] ?? null;
  const result = {
    namedConcurrentUsers: count,
    rounds,
    requests,
    durationMs,
    requestsPerSecond: requests / (durationMs / 1000),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    engineeringTarget: {
      p95Ms: 2000,
      errorCount: 0,
      scope: "short local API workload; not a production SLA",
    },
    engineeringTargetMet:
      errors.length === 0 && (percentile(0.95) ?? Infinity) <= 2000,
    errors,
    uniqueMessages: ids.size,
    idempotentRetriesVerified: retriesVerified,
  };
  output.push(result);
  console.log(JSON.stringify(result));
}
const mockDispatchDrain: {
  status: string;
  waitMs: number;
  pending?: number;
  unknown?: number;
  failed?: number;
} = { status: "UNPROVEN", waitMs: 0 };
if (process.env.METRICS_TOKEN) {
  const drainStart = performance.now();
  while (performance.now() - drainStart < 60000) {
    const response = await fetch(base + "/metrics", {
      headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Protected queue metrics unavailable");
    const text = await response.text();
    const counts: Record<string, number> = {};
    for (const match of text.matchAll(
      /^zs_outbox_jobs\{status="([a-z]+)"\} ([0-9]+)/gm,
    ))
      counts[match[1]] = Number(match[2]);
    mockDispatchDrain.pending =
      (counts.pending ?? 0) + (counts.processing ?? 0);
    mockDispatchDrain.unknown = counts.unknown ?? 0;
    mockDispatchDrain.failed = counts.failed ?? 0;
    if (mockDispatchDrain.unknown || mockDispatchDrain.failed) {
      mockDispatchDrain.status = "FAIL";
      break;
    }
    if (!mockDispatchDrain.pending) {
      mockDispatchDrain.status = "PASS";
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (mockDispatchDrain.status === "UNPROVEN")
    mockDispatchDrain.status = "FAIL_TIMEOUT";
  mockDispatchDrain.waitMs = performance.now() - drainStart;
}
console.log(JSON.stringify({ mockDispatchDrain }));
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  capacityProbe
    ? "docs/evidence/qa-load-capacity.json"
    : process.env.LOAD_PROFILE === "sustained"
      ? "docs/evidence/qa-load-sustained.json"
      : "docs/evidence/qa-load.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      environment: {
        base,
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        logicalCpus: os.cpus().length,
        availableParallelism: os.availableParallelism(),
        totalMemoryBytes: os.totalmem(),
        operatorReportedLoginRateLimit:
          process.env.LOGIN_RATE_LIMIT ??
          "not supplied to runner; check server configuration",
        appMode: "local simulator; configuration supplied by operator",
      },
      measurements: output,
      mockDispatchDrain,
      latencyTargetPolicy: capacityProbe
        ? "Upper-range capacity observation; latency exceedance reported, not a claim this range meets target. Functional integrity/drain failures still fail."
        : "Enforced: p95<=2000ms, zero errors.",
      limitations:
        "HTTP API concurrency; no browser rendering, physical workstations, real Zalo transport, soak, horizontal scaling or production capacity established. Setup excluded; request latencies include login hashing. All users start together; each runs serial requests.",
    },
    null,
    2,
  ),
);
if (
  mockDispatchDrain.status.startsWith("FAIL") ||
  output.some(
    (r: any) =>
      (!capacityProbe && !r.engineeringTargetMet) ||
      r.errors.length ||
      r.uniqueMessages !== r.namedConcurrentUsers * rounds,
  )
)
  process.exitCode = 1;
