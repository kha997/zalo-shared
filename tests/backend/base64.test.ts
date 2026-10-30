import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAttachmentBase64 } from "../../server/base64.js";

test("canonical attachment encoding accepts the advertised 5 MiB maximum without a regex stack overflow", () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
  const decoded = decodeAttachmentBase64(bytes.toString("base64"));
  assert.ok(decoded);
  assert.ok(decoded.equals(bytes));
});
test("attachment decoding rejects malformed, noncanonical, empty and oversized payloads", () => {
  for (const value of [
    "",
    "YQ=",
    "YQ===",
    "Y Q==",
    "YQ==ignored",
    "__--",
    "YR==",
  ])
    assert.equal(decodeAttachmentBase64(value), null);
  assert.equal(
    decodeAttachmentBase64(
      Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
    ),
    null,
  );
  assert.equal(decodeAttachmentBase64("YQ==")?.toString(), "a");
});
