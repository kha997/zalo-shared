// Exercises the reviewed PrivateQrFileView against synthetic fixtures inside
// the connector image as UID 65532. Writes only under FIXTURE_DIR (a tmpfs) and
// FIXTURE_FOREIGN_DIR (an owner-mismatched bind mount). Reports modes/owners,
// never image bytes.
import { lstat, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PrivateQrFileView,
  ensurePrivateDirectory,
} from "/app/dist/connector/server/private-pilot-files.js";

const root = process.env.FIXTURE_ROOT;
const foreign = process.env.FIXTURE_FOREIGN_DIR;
if (!root || !foreign) throw new Error("FIXTURE_ROOT and FIXTURE_FOREIGN_DIR are required");
const base = join(root, "view");

// 33-byte synthetic PNG: signature, IHDR length/type, width 1, height 1.
const png = Buffer.alloc(33);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
png.writeUInt32BE(13, 8);
png.write("IHDR", 12, "ascii");
png.writeUInt32BE(1, 16);
png.writeUInt32BE(1, 20);

const mode = (stat) => (stat.mode & 0o777).toString(8);
const outcome = async (fn) => {
  try {
    await fn();
    return "ADMITTED";
  } catch {
    return "REFUSED";
  }
};
const report = { uid: process.getuid(), results: {} };

await rm(root, { recursive: true, force: true });
await mkdir(root, { mode: 0o700, recursive: true });
await ensurePrivateDirectory(base);
const view = new PrivateQrFileView({ directory: base });
await view.showPng(png);
const file = await lstat(join(base, "qr.png"));
const dir = await lstat(base);
report.results.written = {
  mode: mode(file),
  uid: file.uid,
  isFile: file.isFile(),
  isSymlink: file.isSymbolicLink(),
};
report.results.directory = { mode: mode(dir), uid: dir.uid };
report.results.entries = (await readdir(base)).sort();
await view.clear();
report.results.cleared = (await readdir(base)).length === 0;
await view.clear();
report.results.clearWhenAbsent = "OK";

const loose = `${base}-loose`;
await mkdir(loose, { mode: 0o755, recursive: true });
report.results.looseDirectory = await outcome(
  () => new PrivateQrFileView({ directory: loose }).showPng(png),
);

const linked = `${base}-linked`;
await mkdir(linked, { mode: 0o700, recursive: true });
const decoy = join(linked, "decoy.png");
await writeFile(decoy, png, { mode: 0o600 });
await symlink(decoy, join(linked, "qr.png"));
report.results.symlinkTarget = await outcome(
  () => new PrivateQrFileView({ directory: linked }).showPng(png),
);
report.results.decoyUnchanged = (await lstat(decoy)).size === png.length;

const bad = `${base}-bad`;
await mkdir(bad, { mode: 0o700, recursive: true });
report.results.nonPng = await outcome(
  () => new PrivateQrFileView({ directory: bad }).showPng(Buffer.from("not a png at all")),
);

report.results.foreignOwner = await outcome(
  () => new PrivateQrFileView({ directory: foreign }).showPng(png),
);

for (const path of [base, loose, linked, bad]) {
  await rm(path, { recursive: true, force: true });
}
report.results.cleanup = (await readdir(root)).sort();
process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
