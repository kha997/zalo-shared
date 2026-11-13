import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocatorCipher,
  locatorAad,
} from "../../server/locator-cipher.js";
const account = "00000000-0000-4000-8000-000000000001",
  event = "00000000-0000-4000-8000-000000000002";
const aad = () => locatorAad(account, event, 0);
const url = "https://media.example.test/asset?signature=secret-synthetic";
const old = Buffer.alloc(32, 1),
  next = Buffer.alloc(32, 2),
  fingerprintKey = Buffer.alloc(32, 3);
const make = (
  activeKeyId = "old",
  keys = new Map([
    ["old", old],
    ["next", next],
  ]),
) => createLocatorCipher({ activeKeyId, keys, fingerprintKey });
const safeFailure = (fn: () => unknown) =>
  assert.throws(
    fn,
    (e) =>
      e instanceof Error &&
      e.message === "Locator cipher unavailable" &&
      e.cause === undefined,
  );

test("locator encryption uses random authenticated envelopes and stable private fingerprints", () => {
  const cipher = make(),
    first = cipher.seal(url, aad()),
    second = cipher.seal(url, aad());
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(cipher.open(first, aad()), url);
  assert.equal(cipher.open(second, aad()), url);
  assert.ok(!JSON.stringify(first).includes("secret-synthetic"));
  assert.equal(cipher.fingerprint(url), make("next").fingerprint(url));
  assert.match(cipher.fingerprint(url), /^[a-f0-9]{64}$/);
  assert.notEqual(cipher.fingerprint(url), cipher.fingerprint(url + "-other"));
  assert.ok(Object.isFrozen(first));
});
test("AAD, tag, ciphertext, key identity and canonical envelope tampering fail with safe errors", () => {
  const cipher = make(),
    value = cipher.seal(url, aad());
  safeFailure(() => cipher.open(value, locatorAad(account, event, 1)));
  safeFailure(() => cipher.open(value, locatorAad(event, account, 0)));
  for (const mutated of [
    { ...value, keyId: "missing" },
    { ...value, keyId: "next" },
    { ...value, nonce: Buffer.alloc(12).toString("base64") },
    { ...value, tag: Buffer.alloc(16).toString("base64") },
    { ...value, ciphertext: Buffer.alloc(50).toString("base64") },
    { ...value, ciphertext: value.ciphertext + "\n" },
    { ...value, nonce: "" },
    { ...value, ciphertext: "A".repeat(6000) },
    { ...value, href: url },
    null,
  ])
    safeFailure(() => cipher.open(mutated as any, aad()));
});
test("key rotation reads old envelopes while copied key material resists caller mutation", () => {
  const oldKey = Buffer.from(old),
    fpKey = Buffer.from(fingerprintKey),
    keys = new Map([["old", oldKey]]);
  const cipher = createLocatorCipher({
    activeKeyId: "old",
    keys,
    fingerprintKey: fpKey,
  });
  const envelope = cipher.seal(url, aad()),
    hash = cipher.fingerprint(url);
  keys.clear();
  oldKey.fill(9);
  fpKey.fill(8);
  assert.equal(cipher.open(envelope, aad()), url);
  assert.equal(cipher.fingerprint(url), hash);
  const rotated = make("next");
  assert.equal(rotated.open(envelope, aad()), url);
  assert.equal(rotated.seal(url, aad()).keyId, "next");
  safeFailure(() =>
    make("next", new Map([["next", next]])).open(envelope, aad()),
  );
});
test("invalid keys, context and locator inputs fail closed without exposing their values", () => {
  for (const options of [
    null,
    {},
    { activeKeyId: "old", keys: new Map([["old", old]]), fingerprintKey: old },
    { activeKeyId: "missing", keys: new Map([["old", old]]), fingerprintKey },
    {
      activeKeyId: "old",
      keys: new Map([["old", Buffer.alloc(31)]]),
      fingerprintKey,
    },
  ])
    safeFailure(() => createLocatorCipher(options as any));
  for (const args of [
    [account, event, 5],
    [account, event, -1],
    ["bad", event, 0],
  ])
    safeFailure(() => locatorAad(...(args as [string, string, number])));
  const cipher = make();
  for (const value of [
    "not-url",
    "http://media.example.test/a",
    "https://u:p@media.example.test/a",
    "https://media.example.test/a#x",
    "https://@media.example.test/a",
    "https://media.example.test/a#",
    "https://media.example.test/a\\b",
    "https://media.example.test/a\ud800",
    "https://media.example.test/" + "a".repeat(4096),
  ]) {
    safeFailure(() => cipher.seal(value, aad()));
    safeFailure(() => cipher.fingerprint(value));
  }
  safeFailure(() => cipher.seal(url, "unbound-context"));
});
