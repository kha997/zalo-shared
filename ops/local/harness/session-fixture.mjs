// Exercises the encrypted private session store with an in-memory synthetic
// key. Never reads or writes the real pilot key or session file.
import { randomBytes } from "node:crypto";
import { lstat, readdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  PrivateSessionFile,
  ensurePrivateDirectory,
} from "/app/dist/connector/server/private-pilot-files.js";

const root = process.env.FIXTURE_ROOT;
if (!root) throw new Error("FIXTURE_ROOT is required");
const dir = join(root, "state");
const path = join(dir, "session.enc");

const mode = (stat) => (stat.mode & 0o777).toString(8);
const refused = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

await rm(root, { recursive: true, force: true });
await ensurePrivateDirectory(root);
await ensurePrivateDirectory(dir);

const key = randomBytes(32);
const otherKey = randomBytes(32);
const store = new PrivateSessionFile({ path, key });
const value = {
  version: 1,
  accountId: "synthetic-account-a",
  session: { marker: "synthetic-session-value" },
};
const report = {};
await store.write(value);
const back = await store.read();
report.roundTrip = JSON.stringify(back) === JSON.stringify(value);
const file = await lstat(path);
report.file = { mode: mode(file), uid: file.uid, isFile: file.isFile() };
report.entries = (await readdir(dir)).sort();

report.wrongKeyRefused = await refused(() =>
  new PrivateSessionFile({ path, key: otherKey }).read(),
);
report.wrongKeyIdRefused = await refused(() =>
  new PrivateSessionFile({ path, key, keyId: "v2" }).read(),
);

const ciphertext = await readFile(path);
await writeFile(path, ciphertext.subarray(0, ciphertext.length - 4), { mode: 0o600 });
await chmod(path, 0o600);
report.truncatedRefused = await refused(() => store.read());

await store.quarantine();
report.quarantined = (await readdir(dir)).filter((name) => name.includes("quarantine")).length === 1;
report.readAfterQuarantineRefused = await refused(() => store.read());
await rm(root, { recursive: true, force: true });
report.cleaned = true;
process.stdout.write(`${JSON.stringify(report)}\n`);
