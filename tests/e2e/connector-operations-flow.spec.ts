import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/app.js";
import { configFromEnv } from "../../server/config.js";
import { createPool, migrate, seed } from "../../server/db.js";
import { ingestProviderEvent } from "../../server/provider-store.js";
import { recordProviderFault } from "../../server/provider-faults.js";

async function isolatedBrowserDatabase() {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error("Disposable TEST_DATABASE_URL required");
  const url = new URL(source);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/zalo_test"
  )
    throw new Error("Browser recovery requires disposable zalo_test database");
  const name = `browser_${randomUUID().replaceAll("-", "")}`;
  if (!/^browser_[a-f0-9]{32}$/.test(name))
    throw new Error("Invalid disposable database name");
  const owner = createPool(source, { max: 1 });
  let created = false;
  let pool: ReturnType<typeof createPool> | undefined;
  const close = async () => {
    try {
      await pool?.end();
      if (created) {
        await owner.query(`DROP DATABASE "${name}"`);
        created = false;
      }
    } finally {
      await owner.end();
    }
  };
  try {
    // New random identifier only; no existing database is modified or replaced.
    await owner.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    url.pathname = `/${name}`;
    pool = createPool(url.toString());
    await migrate(pool);
    return { pool, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Own database/server: no queue data or database-wide locks touch the load app.
// Actual browser + HTTP + PostgreSQL, but synthetic provider receipts, no SDK/phone.
test("four staff browsers and administrator reconcile exact IDs through private HTTP without another send", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const database = await isolatedBrowserDatabase();
  const { pool } = database;
  const contexts: BrowserContext[] = [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const email = `${randomUUID()}@example.test`,
      password = randomUUID();
    await seed(pool, { adminEmail: email, adminPassword: password });
    const config = configFromEnv({
      PROVIDER_MODE: "disabled",
      LOGIN_RATE_LIMIT: "100",
    });
    app = await buildApp({ pool, config });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    // Only this isolated test config changes; every request still needs exact Origin.
    config.publicOrigin = base;
    async function login(email: string, password: string) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(base);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await page.getByRole("button", { name: /^Đăng nhập/ }).click();
      await expect(
        page.getByRole("textbox", { name: /Tìm/ }).first(),
      ).toBeVisible();
      const meResponse = await context.request.get(`${base}/api/auth/me`);
      expect(meResponse.status()).toBe(200);
      const me = await meResponse.json();
      return {
        context,
        page,
        me,
        headers: { Origin: base, "X-CSRF-Token": me.csrfToken },
      };
    }
    const admin = await login(email, password);
    const staff: Awaited<ReturnType<typeof login>>[] = [];
    for (let i = 0; i < 4; i++) {
      const credential = {
        email: `${randomUUID()}@example.test`,
        password: randomUUID(),
      };
      const created = await admin.context.request.post(`${base}/api/users`, {
        headers: admin.headers,
        data: { ...credential, name: `Browser staff ${i}`, role: "agent" },
      });
      expect(created.status()).toBe(200);
      staff.push(await login(credential.email, credential.password));
    }
    expect(new Set(staff.map((s) => s.me.user.id)).size).toBe(4);
    for (const member of staff) {
      await expect(
        member.page.getByRole("button", { name: /Đối soát Zalo/ }),
      ).toHaveCount(0);
      expect(
        (
          await member.context.request.get(`${base}/api/provider/operations`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await member.context.request.post(
            `${base}/api/provider/operations/ack-gap`,
            {
              headers: member.headers,
              data: {},
            },
          )
        ).status(),
      ).toBe(403);
    }
    const event = {
      threadType: 0 as const,
      threadId: "browser-operator-peer",
      senderId: "synthetic-peer",
      providerId: "browser-inbound",
      isSelf: false,
      kind: "text" as const,
      text: "Synthetic inbound",
    };
    const initial = await ingestProviderEvent(pool, event);
    const cid = (
      await pool.query("SELECT conversation_id FROM messages WHERE id=$1", [
        initial.messageId,
      ])
    ).rows[0].conversation_id;
    // Native receipt before an unknown attempt: its author must remain explicitly unknown.
    await ingestProviderEvent(pool, {
      ...event,
      isSelf: true,
      senderId: "synthetic-self",
      providerId: "browser-native",
      text: "Synthetic other-device message",
    });
    const actorId = staff[0].me.user.id;
    const mid = (
      await pool.query(
        "INSERT INTO messages(conversation_id,direction,text,status,actor_id) VALUES($1,'outbound','Synthetic uncertain staff intent','unknown',$2) RETURNING id",
        [cid, actorId],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO outbox(message_id,status) VALUES($1,'unknown')",
      [mid],
    );
    await pool.query(
      "INSERT INTO delivery_parts(message_id,part,status) VALUES($1,0,'unknown')",
      [mid],
    );
    const held = await ingestProviderEvent(pool, {
      ...event,
      isSelf: true,
      senderId: "synthetic-self",
      providerId: "browser-exact-id",
      text: "Synthetic uncertain staff intent",
    });
    expect(held.held).toBe(true);
    await ingestProviderEvent(pool, {
      ...event,
      providerId: "browser-conflict",
      text: "Canonical synthetic body",
    });
    await ingestProviderEvent(pool, {
      ...event,
      providerId: "browser-conflict",
      text: "Different synthetic body",
    });
    const countBefore = (
      await pool.query(
        "SELECT count(*)::int n FROM messages WHERE direction='outbound'",
      )
    ).rows[0].n;
    await admin.page.getByRole("button", { name: /Đối soát Zalo/ }).click();
    const panel = admin.page.getByRole("region", { name: "Đối soát Zalo" });
    await panel.getByRole("button", { name: /browser-exact-id/ }).click();
    await panel.getByLabel("Chọn tin nhắn").selectOption(mid);
    await panel.getByLabel("Phần chưa xác định").selectOption("0");
    const confirm = panel.getByRole("button", {
      name: "Xác nhận phần gửi bằng ID",
    });
    await expect(confirm).toBeDisabled();
    await panel
      .getByLabel("Tham chiếu bằng chứng", { exact: true })
      .fill("synthetic-browser-ticket");
    await panel.getByLabel(/Tôi đã quan sát chính xác provider ID/).check();
    await confirm.click();
    await expect(panel.getByText(/Đã ghi nhận xác nhận/)).toBeVisible();
    await expect
      .poll(
        async () =>
          (await pool.query("SELECT status FROM messages WHERE id=$1", [mid]))
            .rows[0].status,
      )
      .toBe("sent");
    expect(
      (
        await pool.query(
          "SELECT actor_id,provider_id FROM messages WHERE id=$1",
          [mid],
        )
      ).rows[0],
    ).toEqual({ actor_id: actorId, provider_id: "browser-exact-id" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM messages WHERE direction='outbound'",
        )
      ).rows[0].n,
    ).toBe(countBefore);
    expect(
      (await pool.query("SELECT count(*)::int n FROM outbox")).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT actor_id FROM audit WHERE action='connector.part_confirmed' AND target_id=$1",
          [mid],
        )
      ).rows[0].actor_id,
    ).toBe(admin.me.user.id);
    // Resolve retained conflict through the real form, preserving canonical content.
    await panel.getByRole("button", { name: /Xung đột chưa xử lý:/ }).click();
    await panel.getByRole("button", { name: /browser-conflict/ }).click();
    await expect(
      panel.getByText("Canonical synthetic body", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("Different synthetic body", { exact: true }),
    ).toBeVisible();
    await panel
      .getByLabel("Tham chiếu bằng chứng", { exact: true })
      .fill("synthetic-conflict-review");
    await panel.getByLabel(/Tôi đã đối chiếu bên ngoài/).check();
    await panel.getByRole("button", { name: "Ghi nhận giữ bản gốc" }).click();
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT resolved_at IS NOT NULL done FROM provider_events WHERE provider_id='browser-conflict'",
            )
          ).rows[0].done,
      )
      .toBe(true);
    // A stale history review cannot clear a newer durable fault.
    const before = await (
      await admin.context.request.get(`${base}/api/provider/operations`)
    ).json();
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await recordProviderFault(db, "connection-lost");
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    const stale = await admin.context.request.post(
      `${base}/api/provider/operations/ack-gap`,
      {
        headers: admin.headers,
        data: {
          expectedGapVersion: before.gapVersion,
          expectedOwnerId: before.owner.ownerId,
          expectedOwnerEpoch: before.owner.epoch,
          evidenceRef: "synthetic-stale-review",
          confirmHistoryReviewed: true,
        },
      },
    );
    expect(stale.status()).toBe(409);
    expect(
      (await pool.query("SELECT reconciliation_required FROM provider_state"))
        .rows[0].reconciliation_required,
    ).toBe(true);
    // The ordinary inbox must not attribute native/shared-device sends to staff.
    await staff[0].page
      .getByRole("button", { name: /Zalo browser-operator-peer/ })
      .click();
    const native = staff[0].page
      .locator("article.message")
      .filter({ hasText: "Synthetic other-device message" });
    await expect(
      native.getByText("Zalo / thiết bị khác", { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await app?.close();
    await database.close();
  }
});
