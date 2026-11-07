import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerStaticAssets } from "../../server/static.js";

test("serves only enumerated public build files, never arbitrary paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "zs-static-"));
  const app = Fastify();
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>inbox</main>");
    await writeFile(join(root, "assets", "safe.js"), "export const safe=true");
    await writeFile(join(root, "private.env"), "SECRET=must-not-serve");
    await registerStaticAssets(app, root);
    assert.equal((await app.inject("/")).statusCode, 200);
    const js = await app.inject("/assets/safe.js");
    assert.equal(js.statusCode, 200);
    assert.match(String(js.headers["content-type"]), /javascript/);
    for (const path of [
      "/private.env",
      "/api/missing",
      "/assets/../private.env",
      "/assets/%2e%2e/private.env",
      "/unknown",
    ]) {
      const r = await app.inject(path);
      assert.equal(r.statusCode, 404);
      assert.ok(!r.body.includes("must-not-serve"));
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
