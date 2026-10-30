import { test, expect, type Page } from "@playwright/test";
const id = (end: string) => `00000000-0000-4000-8000-${end.padStart(12, "0")}`;
async function mockShell(page: Page, role: () => string = () => "admin") {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: id("10"),
      name: "Synthetic operator",
      email: "operator@example.test",
      role: role(),
      active: true,
    };
    const value =
      path === "/api/auth/me"
        ? { user, csrfToken: "synthetic-ui-csrf" }
        : path === "/api/users"
          ? { items: [user] }
          : path === "/api/provider"
            ? { mode: "disabled", status: "disconnected", lastEventAt: null }
            : { items: [], nextCursor: null };
    await route.fulfill({ json: value });
  });
}
// Browser presentation/CAS interaction contract only. Responses below are synthetic;
// real HTTP authorization, SQL reconciliation and phone operation are separate gates.
test("operator UI requires exact evidence and refreshes a stale confirmation without resending", async ({
  page,
}) => {
  const event = {
    id: id("2"),
    conversationId: id("3"),
    providerId: "observed-exact-id",
    direction: "outbound",
    kind: "text",
    text: '<img src=x onerror="window.__opsXss=1">',
    state: "held",
    resolutionVersion: "0",
    conflict: false,
    resolvedAt: null,
    variantOverflow: false,
    variantEvidenceMissing: false,
    receivedAt: new Date().toISOString(),
    semanticHash: "a".repeat(64),
    variants: [],
  };
  let posts = 0,
    gapVersion = "4",
    overviewReads = 0;
  await mockShell(page);
  await page.route("**/api/provider/operations**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      posts++;
      expect(url.pathname).toBe("/api/provider/operations/confirm-part");
      expect(route.request().postDataJSON()).toEqual({
        messageId: id("4"),
        part: 0,
        eventId: event.id,
        expectedResolutionVersion: "0",
        evidenceRef: "ticket-001",
        confirmProviderIdObserved: true,
      });
      gapVersion = "5";
      await route.fulfill({
        status: 409,
        json: { error: { message: "Stale state" } },
      });
      return;
    }
    if (url.pathname === "/api/provider/operations") {
      overviewReads++;
      await route.fulfill({
        json: {
          mode: "disabled",
          status: "disconnected",
          reconciliationRequired: true,
          gapVersion,
          faultCode: "connection-lost",
          owner: { ownerId: null, epoch: "0", phase: "idle" },
          counts: { held: 1, unresolvedConflicts: 0, unknownJobs: 1 },
        },
      });
    } else if (url.pathname.endsWith("/unknown"))
      await route.fulfill({
        json: {
          items: [
            {
              messageId: id("4"),
              conversationId: event.conversationId,
              text: "synthetic staff intent",
              actorId: id("5"),
              createdAt: event.receivedAt,
              parts: [
                {
                  part: 0,
                  status: "unknown",
                  providerId: null,
                  attachmentId: null,
                },
              ],
            },
          ],
          nextCursor: null,
        },
      });
    else if (url.pathname.endsWith(event.id))
      await route.fulfill({ json: event });
    else await route.fulfill({ json: { items: [event], nextCursor: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Đối soát Zalo/ }).click();
  const panel = page.getByRole("region", { name: "Đối soát Zalo" });
  await expect(
    panel.getByText("Nhà cung cấp đang tắt", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /observed-exact-id/ }).click();
  await expect(
    panel.getByRole("heading", { name: "Bằng chứng sự kiện đã chọn" }),
  ).toBeFocused();
  await expect(panel.locator('img[src="x"]')).toHaveCount(0);
  await panel.getByLabel("Chọn tin nhắn").selectOption(id("4"));
  await panel.getByLabel("Phần chưa xác định").selectOption("0");
  const confirm = panel.getByRole("button", {
    name: "Xác nhận phần gửi bằng ID",
  });
  await expect(confirm).toBeDisabled();
  await panel
    .getByLabel("Tham chiếu bằng chứng", { exact: true })
    .fill("ticket-001");
  await expect(confirm).toBeDisabled();
  await panel.getByLabel(/Tôi đã quan sát chính xác provider ID/).check();
  await confirm.click();
  await expect(panel.getByText(/Trạng thái đã thay đổi/)).toBeVisible();
  await expect(panel.getByText("Version 5", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Bằng chứng sự kiện đã chọn" }),
  ).toHaveCount(0);
  expect(posts).toBe(1);
  expect(overviewReads).toBeGreaterThanOrEqual(2);
});

test("operator UI closes privileged content after the shell observes role revocation", async ({
  page,
}) => {
  let role = "admin";
  await mockShell(page, () => role);
  await page.route("**/api/provider/operations**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json:
        path === "/api/provider/operations"
          ? {
              mode: "disabled",
              status: "disconnected",
              reconciliationRequired: true,
              gapVersion: "2",
              faultCode: "connection-lost",
              owner: { ownerId: null, epoch: "0", phase: "idle" },
              counts: { held: 0, unresolvedConflicts: 0, unknownJobs: 0 },
            }
          : { items: [], nextCursor: null },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Đối soát Zalo/ }).click();
  await expect(
    page.getByRole("region", { name: "Đối soát Zalo" }),
  ).toBeVisible();
  role = "supervisor";
  await expect(page.getByRole("button", { name: /Đối soát Zalo/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("region", { name: "Đối soát Zalo" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Chỉ quản trị viên được xem đối soát Zalo."),
  ).toBeVisible();
});
