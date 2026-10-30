import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("SDK artifact is exact, integrity-pinned and development-only", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const sdk = lock.packages["node_modules/zca-js"];
  assert.equal(manifest.devDependencies["zca-js"], "2.2.0");
  assert.equal(manifest.dependencies["zca-js"], undefined);
  assert.equal(sdk.version, "2.2.0");
  assert.equal(sdk.dev, true);
  assert.equal(sdk.integrity, "sha512-pBU0T0/uadH3Neq7yMssUmE769VVuqKhL8YD1HqQQG8e6lkwueAopNu0vhJdqiJRHZdPIEomT2FxRzauOx4pgA==");
});
