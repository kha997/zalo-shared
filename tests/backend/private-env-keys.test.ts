import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("private env key inspection prints names but never values", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-env-keys-"));
  try {
    const file = join(dir, "app.env");
    writeFileSync(
      file,
      [
        "DATABASE_URL=postgresql://user:fake-password@host/db",
        "API_TOKEN=fake-token",
        "EMPTY=",
        "export EXTRA=fake-extra",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );
    const output = execFileSync("bash", ["ops/private-env-keys.sh", file], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    for (const key of ["API_TOKEN", "DATABASE_URL", "EMPTY", "EXTRA"])
      assert.match(output, new RegExp(`^${key}$`, "m"));
    assert.doesNotMatch(output, /fake-password|fake-token|fake-extra/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
