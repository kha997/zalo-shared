import type { FastifyInstance } from "fastify";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const types: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Register a startup snapshot of public build assets; request paths never select filesystem paths. */
export async function registerStaticAssets(
  app: FastifyInstance,
  root: string,
): Promise<void> {
  let index: Buffer;
  try {
    index = await readFile(join(root, "index.html"));
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  app.get("/", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-cache")
      .type("text/html; charset=utf-8")
      .send(index),
  );
  async function assets(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: any) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!/^[A-Za-z0-9_.-]+$/.test(entry.name)) continue;
      const pathname = prefix + "/" + entry.name;
      if (entry.isDirectory()) {
        await assets(join(directory, entry.name), pathname);
        continue;
      }
      const mime = types[extname(entry.name)];
      if (!entry.isFile() || !mime) continue; // no symlinks, dotfiles, config or arbitrary HTML
      const bytes = await readFile(join(directory, entry.name));
      app.get(pathname, async (_req, reply) =>
        reply
          .header("Cache-Control", "public, max-age=31536000, immutable")
          .type(mime)
          .send(bytes),
      );
    }
  }
  await assets(join(root, "assets"), "/assets");
}
