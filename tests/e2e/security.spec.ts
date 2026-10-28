import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("HTTP adversarial acceptance: CSRF, disabled sessions, claim race, send deduplication, attachments", async ({
  playwright,
  baseURL,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL,
    password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Administrator test credentials required");
  const admin = await playwright.request.newContext({ baseURL });
  const agents: { client: APIRequestContext; id: string; csrf: string }[] = [];
  const run = randomUUID();
  try {
    const auth = await admin.post("/api/auth/login", {
      data: { email, password },
    });
    expect(auth.status()).toBe(200);
    const { csrfToken } = await auth.json();
    const headers = { Origin: baseURL!, "X-CSRF-Token": csrfToken };
    for (let i = 0; i < 2; i++) {
      const credential = {
        email: `security-${run}-${i}@example.test`,
        password: `Security-${randomUUID()}!`,
      };
      const created = await admin.post("/api/users", {
        headers,
        data: { ...credential, name: `Security agent ${i}`, role: "agent" },
      });
      expect(created.status()).toBe(200);
      const user = await created.json();
      const client = await playwright.request.newContext({ baseURL });
      const session = await client.post("/api/auth/login", {
        data: credential,
      });
      expect(session.status()).toBe(200);
      agents.push({
        client,
        id: user.id,
        csrf: (await session.json()).csrfToken,
      });
    }
    const target = `/api/users/${agents[0].id}`;
    expect(
      (
        await admin.patch(target, {
          headers: { Origin: baseURL! },
          data: { name: "Forbidden missing token" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.patch(target, {
          headers: { ...headers, Origin: "https://foreign.example.test" },
          data: { name: "Forbidden origin" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.post("/api/attachments", {
          headers,
          data: {
            name: "unsafe.html",
            mime: "text/html",
            dataBase64: Buffer.from("<script>alert(1)</script>").toString(
              "base64",
            ),
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await admin.post("/api/attachments", {
          headers,
          data: {
            name: "fake.png",
            mime: "image/png",
            dataBase64: Buffer.from("not a png").toString("base64"),
          },
        })
      ).status(),
    ).toBe(400);
    const inbound = {
      contactId: `security-${run}`,
      contactName: `Security ${run}`,
      providerId: `security-${run}`,
      text: "Synthetic race fixture",
    };
    expect(
      (
        await admin.post("/api/provider/mock/inbound", {
          headers,
          data: inbound,
        })
      ).ok(),
    ).toBeTruthy();
    const list = await (
      await admin.get(`/api/conversations?search=${run}`)
    ).json();
    const conversation = list.items.find(
      (c: { contactId: string }) => c.contactId === inbound.contactId,
    );
    expect(conversation).toBeTruthy();
    const claims = await Promise.all(
      agents.map((a) =>
        a.client.patch(`/api/conversations/${conversation.id}`, {
          headers: { Origin: baseURL!, "X-CSRF-Token": a.csrf },
          data: { expectedVersion: conversation.version, assigneeId: a.id },
        }),
      ),
    );
    expect(claims.map((r) => r.status()).sort()).toEqual([200, 409]);
    const winner = agents[claims.findIndex((r) => r.status() === 200)];
    const loser = agents[claims.findIndex((r) => r.status() !== 200)];
    const path = `/api/conversations/${conversation.id}/messages`;
    const key = randomUUID(),
      body = { text: `Synthetic concurrent send ${run}` };
    const sendHeaders = {
      Origin: baseURL!,
      "X-CSRF-Token": winner.csrf,
      "Idempotency-Key": key,
    };
    const sends = await Promise.all([
      winner.client.post(path, { headers: sendHeaders, data: body }),
      winner.client.post(path, { headers: sendHeaders, data: body }),
    ]);
    for (const response of sends) expect(response.ok()).toBeTruthy();
    const messages = await Promise.all(sends.map((r) => r.json()));
    expect(messages[0].id).toBe(messages[1].id);
    const timeline = (await (await winner.client.get(path)).json()).items;
    expect(
      timeline.filter((m: { id: string }) => m.id === messages[0].id),
    ).toHaveLength(1);
    expect(
      (
        await winner.client.post(path, {
          headers: sendHeaders,
          data: { text: "Different payload" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await loser.client.post(path, {
          headers: {
            Origin: baseURL!,
            "X-CSRF-Token": loser.csrf,
            "Idempotency-Key": randomUUID(),
          },
          data: body,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.patch(`/api/users/${loser.id}`, {
          headers,
          data: { active: false },
        })
      ).ok(),
    ).toBeTruthy();
    expect((await loser.client.get("/api/auth/me")).status()).toBe(401);
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      for (const route of [
        "/api/users",
        "/api/conversations",
        path,
        "/api/provider",
        "/api/audit",
      ])
        expect((await anonymous.get(route)).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await Promise.all(agents.map((a) => a.client.dispose()));
    await admin.dispose();
  }
});

test.skip("last active admin protection and mock-disabled behavior require an isolated server configuration", async () => {
  // Covered in database integration tests: never risk disabling the operator account here.
});
