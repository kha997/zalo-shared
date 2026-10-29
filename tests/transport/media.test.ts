import test from "node:test";
import assert from "node:assert/strict";
import { prepareMedia } from "../../adapters/zalo/media.js";
function png(w = 2, h = 3) {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w = 2, h = 3) {
  return Buffer.from([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    1,
    1,
    17,
    0,
    255,
    218,
    0,
    2,
  ]);
}
test("media derives canonical extension/dimensions and clones private bytes", () => {
  const data = png();
  const result = prepareMedia({
    name: "../../unsafe.exe",
    mime: "image/png",
    data,
  });
  assert.equal(result.filename, "unsafe.png");
  assert.deepEqual(result.metadata, { totalSize: 33, width: 2, height: 3 });
  data.fill(0);
  assert.equal(result.data[0], 137);
  assert.deepEqual(
    prepareMedia({ name: "photo.bin", mime: "image/jpeg", data: jpeg() })
      .metadata,
    { totalSize: 19, width: 2, height: 3 },
  );
  assert.equal(
    prepareMedia({
      name: "a.pdf",
      mime: "text/plain",
      data: Buffer.from("hello"),
    }).filename,
    "a.txt",
  );
  assert.equal(
    prepareMedia({
      name: "a.txt",
      mime: "application/pdf",
      data: Buffer.from("%PDF-1.7"),
    }).filename,
    "a.pdf",
  );
});
test("media rejects arbitrary sources, size and mismatched or malformed content", () => {
  for (const input of [
    null,
    "/private/file",
    {},
    { name: "a", mime: "text/plain", data: "https://example.test" },
    { name: "a", mime: "text/plain", data: Buffer.alloc(0) },
    { name: "a", mime: "text/plain", data: Buffer.alloc(5 * 1024 * 1024 + 1) },
    { name: "a", mime: "video/mp4", data: Buffer.from("x") },
    { name: "a\0", mime: "text/plain", data: Buffer.from("x") },
    { name: "a", mime: "text/plain", data: Buffer.from([255]) },
    { name: "a", mime: "text/plain", data: Buffer.from("a\0b") },
    { name: "a", mime: "application/pdf", data: Buffer.from("text") },
    ...[
      png(0),
      png(16385),
      png(10000, 10000),
      png().subarray(0, 32),
      Buffer.from("notpng"),
    ].map((data) => ({ name: "a", mime: "image/png", data })),
    ...[
      Buffer.from([255, 216, 255]),
      Buffer.from([255, 216, 255, 224, 255, 255]),
      jpeg(0),
      jpeg(16385),
    ].map((data) => ({ name: "a", mime: "image/jpeg", data })),
  ])
    assert.throws(() => prepareMedia(input as any), /Invalid media/);
});
