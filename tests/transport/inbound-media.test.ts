import test from "node:test";
import assert from "node:assert/strict";
import { UserMessage, GroupMessage } from "zca-js";
import { normalizeMediaCandidate } from "../../adapters/zalo/inbound-media.js";

const content = {
  href: "https://media.example.test/file?signature=synthetic-only",
  title: "../photo.png",
};
const frame = (msgType = "chat.photo", value: unknown = content) => ({
  data: { msgType, content: value },
});
test("source-shaped direct and group constructors preserve a single private media candidate", () => {
  for (const Constructor of [UserMessage, GroupMessage]) {
    const raw = new Constructor("self", {
      uidFrom: "peer",
      idTo: "group",
      msgType: "chat.photo",
      content: { ...content },
    } as any);
    const result = normalizeMediaCandidate(raw);
    assert.deepEqual(result, [
      { index: 0, name: "photo.png", url: content.href, category: "photo" },
    ]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result![0]));
  }
  assert.equal(
    normalizeMediaCandidate(frame("share.file"))![0].category,
    "file",
  );
});
test("candidate parser rejects unsupported schemas, albums, invalid names and non-HTTPS locator syntax", () => {
  for (const raw of [
    null,
    {},
    [],
    frame("webchat"),
    frame("chat.photo", "not an attachment"),
    frame("chat.photo", [content]),
    frame("chat.photo", { thumb: content.href, title: "photo" }),
    frame("chat.photo", { ...content, childnumber: 2 }),
    frame("chat.photo", { ...content, params: { href: content.href } }),
    ...["", "x".repeat(201), "a\0b", "a\nb", "a\ud800", ".", "../.."].map(
      (title) => frame("chat.photo", { ...content, title }),
    ),
    ...[
      "http://media.example.test/a",
      "file:///private",
      "https://u:p@media.example.test/a",
      "https://media.example.test:444/a",
      "https://media.example.test/a#fragment",
      "https://media.example.test/a\n",
      "https://media.example.test/" + "a".repeat(4096),
      "not-url",
      "https://@media.example.test/a",
      "https://media.example.test/a#",
      "https://media.example.test/a\\b",
      "https://media.example.test/a\ud800",
    ].map((href) => frame("chat.photo", { ...content, href })),
  ])
    assert.equal(normalizeMediaCandidate(raw), null);
  const input = frame();
  const result = normalizeMediaCandidate(input)!;
  input.data.content = {
    href: "https://different.example.test/x",
    title: "other",
  };
  assert.equal(result[0].url, content.href);
  assert.equal(
    normalizeMediaCandidate({
      get data() {
        throw Error(content.href);
      },
    }),
    null,
  );
});
