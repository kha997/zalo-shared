import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("100-message history survives newest polling and an arrival during older-page loading", async ({
  page,
  request,
  baseURL,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL,
    password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Administrator test credentials required");
  const auth = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(auth.ok()).toBeTruthy();
  const headers = {
    Origin: baseURL!,
    "X-CSRF-Token": (await auth.json()).csrfToken,
  };
  const contactId = "history-" + randomUUID(),
    contactName = contactId;
  const inbound = async (index: number) => {
    const response = await request.post("/api/provider/mock/inbound", {
      headers,
      data: {
        contactId,
        contactName,
        providerId: `${contactId}-${index}`,
        text: `History row ${index}`,
      },
    });
    expect(response.ok()).toBeTruthy();
  };
  for (let index = 0; index < 100; index++) await inbound(index);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^Đăng nhập/ }).click();
  await page.getByRole("button", { name: contactName, exact: true }).click();
  await expect(page.locator("article.message")).toHaveCount(50);
  let release!: () => void;
  let captured!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/conversations/*/messages?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("before"))
      return route.continue();
    const response = await route.fetch();
    captured();
    await hold;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Tải tin nhắn cũ", exact: true })
    .click();
  await started;
  await inbound(100);
  release();
  await expect(page.locator("article.message")).toHaveCount(101);
  await expect(page.locator("article.message").first()).toContainText(
    "History row 0",
  );
  await expect(page.locator("article.message").last()).toContainText(
    "History row 100",
  );
  await expect(
    page.getByRole("button", { name: "Tải tin nhắn cũ", exact: true }),
  ).toHaveCount(0);
  await page.waitForResponse(
    (response) =>
      response.url().includes("/messages?") &&
      !response.url().includes("before=") &&
      response.ok(),
  );
  await expect(page.locator("article.message")).toHaveCount(101);
});

test("delayed old mutation 401 does not log out a reauthenticated browser", async ({
  page,
  request,
  baseURL,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL,
    password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Administrator test credentials required");
  const auth = await request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(auth.ok()).toBeTruthy();
  const identity = await auth.json();
  const contactName = "stale-session-" + randomUUID();
  const fixture = await request.post("/api/provider/mock/inbound", {
    headers: { Origin: baseURL!, "X-CSRF-Token": identity.csrfToken },
    data: {
      contactId: contactName,
      contactName,
      providerId: contactName,
      text: "Session regression",
    },
  });
  expect(fixture.ok()).toBeTruthy();
  const login = async () => {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: /^Đăng nhập/ }).click();
    await expect(
      page.getByRole("heading", { name: "Hộp thư chung", exact: true }),
    ).toBeVisible();
  };
  await page.goto("/");
  await login();
  await page.getByRole("button", { name: contactName, exact: true }).click();
  let release!: () => void;
  let captured!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/conversations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    captured();
    await hold;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Old session expired" } }),
    });
  });
  await page
    .getByLabel("Người phụ trách", { exact: true })
    .selectOption(identity.user.id);
  await started;
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await login();
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.status() === 401,
  );
  release();
  await response;
  await page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/me") && response.ok(),
  );
  await expect(
    page.getByRole("heading", { name: "Hộp thư chung", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."),
  ).toHaveCount(0);
});


test('inbound arrival precedes a locally appended later outgoing send after polling', async ({ page, request, baseURL }) => {
  const email = process.env.TEST_ADMIN_EMAIL, password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Administrator test credentials required');
  const auth = await request.post('/api/auth/login', { data: { email, password } });
  expect(auth.ok()).toBeTruthy();
  const identity = await auth.json();
  const headers = { Origin: baseURL!, 'X-CSRF-Token': identity.csrfToken };
  const contactName = 'order-' + randomUUID();
  const inbound = async (index: number) => {
    const response = await request.post('/api/provider/mock/inbound', { headers, data: {
      contactId: contactName, contactName, providerId: `${contactName}-${index}`, text: `Order row ${index}`,
    } });
    expect(response.ok()).toBeTruthy();
  };
  await inbound(1);
  await inbound(2);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^Đăng nhập/ }).click();
  await page.getByRole('button', { name: contactName, exact: true }).click();
  await expect(page.locator('article.message')).toHaveCount(2);
  const assigned = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/conversations/') && response.ok());
  await page.getByLabel('Người phụ trách', { exact: true }).selectOption(identity.user.id);
  await assigned;
  let release!: () => void;
  let captured!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { captured = resolve; });
  let held = false;
  await page.route('**/api/conversations/*/messages?*', async (route) => {
    if (held) return route.continue();
    held = true;
    captured();
    await hold;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await started;
  await inbound(3);
  await page.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Order row 4');
  await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  await expect(page.locator('article.message').last()).toContainText('Order row 4');
  release();
  await expect(page.locator('article.message')).toHaveCount(4);
  await expect(page.locator('article.message .bubble p')).toHaveText(['Order row 1', 'Order row 2', 'Order row 3', 'Order row 4']);
});
