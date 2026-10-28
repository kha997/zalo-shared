import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("four independent browser sessions claim and send; agents excluded from administration; text is safe", async ({
  browser,
  request,
  baseURL,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required");
  const login = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  const admin = await login.json();
  const headers = { "X-CSRF-Token": admin.csrfToken, Origin: baseURL! };
  const run = randomUUID().slice(0, 8);
  const fixtures: { email: string; password: string; contactName: string }[] =
    [];
  for (let i = 0; i < 4; i++) {
    const credential = {
      email: `qa-${run}-${i}@example.test`,
      password: `QA-${randomUUID()}!`,
    };
    const userResponse = await request.post("/api/users", {
      headers,
      data: { ...credential, name: `QA agent ${i}`, role: "agent" },
    });
    expect(userResponse.ok()).toBeTruthy();
    const contactName = `QA contact ${run} ${i}`;
    const inbound = await request.post("/api/provider/mock/inbound", {
      headers,
      data: {
        contactId: `qa-${run}-${i}`,
        contactName,
        providerId: `qa-in-${run}-${i}`,
        text: `Synthetic inbound ${i}`,
      },
    });
    expect(inbound.ok()).toBeTruthy();
    fixtures.push({ ...credential, contactName });
  }
  const contexts = await Promise.all(fixtures.map(() => browser.newContext()));
  try {
    await Promise.all(
      contexts.map(async (context, i) => {
        const page = await context.newPage();
        await page.goto(baseURL!);
        await page.getByLabel("Email", { exact: true }).fill(fixtures[i].email);
        await page
          .getByLabel("Mật khẩu", { exact: true })
          .fill(fixtures[i].password);
        await page.getByRole("button", { name: /^Đăng nhập/ }).click();
        await page
          .getByRole("button", { name: new RegExp(fixtures[i].contactName) })
          .click();
        await page
          .getByRole("button", { name: "Nhận hội thoại", exact: true })
          .click();
        const text = `QA outbound ${run} ${i} <img src=x onerror="window.__qaXss=1">`;
        await page
          .getByRole("textbox", { name: "Tin nhắn", exact: true })
          .fill(text);
        await page
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .click();
        await expect(
          page.locator("article.message").getByText(text, { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => (window as unknown as { __qaXss?: number }).__qaXss,
          ),
        ).toBeUndefined();
        expect(await page.locator('img[src="x"]').count()).toBe(0);
        await expect(page.getByRole("button", { name: /Nhân sự/ })).toHaveCount(
          0,
        );
        await expect(page.getByRole("button", { name: /Nhật ký/ })).toHaveCount(
          0,
        );
        const denied = await context.request.get(`${baseURL}/api/audit`);
        expect(denied.status()).toBe(403);
        const me = await (
          await context.request.get(`${baseURL}/api/auth/me`)
        ).json();
        const mutation = await context.request.post(`${baseURL}/api/users`, {
          headers: { Origin: baseURL!, "X-CSRF-Token": me.csrfToken },
          data: {
            name: "Denied",
            email: `denied-${run}-${i}@example.test`,
            password: `Denied-${randomUUID()}`,
            role: "admin",
          },
        });
        expect(mutation.status()).toBe(403);
        await page.screenshot({
          path: `docs/evidence/qa-browser-context-${i + 1}.png`,
          fullPage: true,
        });
      }),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("unauthenticated API requests are rejected", async ({
  playwright,
  baseURL,
}) => {
  const isolated = await playwright.request.newContext({ baseURL });
  try {
    expect((await isolated.get("/api/conversations")).status()).toBe(401);
  } finally {
    await isolated.dispose();
  }
});
