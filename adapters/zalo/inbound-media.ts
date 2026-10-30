export type InboundMediaCandidate = Readonly<{
  index: number;
  name: string;
  url: string;
  category: "photo" | "file";
}>;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** Source-shaped candidate only. This neither admits a download host nor proves a live SDK schema. */
export function normalizeMediaCandidate(
  raw: unknown,
): ReadonlyArray<InboundMediaCandidate> | null {
  try {
    const data = object(object(raw)?.data),
      content = object(data?.content);
    if (
      !data ||
      !content ||
      !["chat.photo", "share.file"].includes(data.msgType as string) ||
      Object.keys(content).length !== 2 ||
      !Object.hasOwn(content, "href") ||
      !Object.hasOwn(content, "title")
    )
      return null;
    const url = content.href,
      title = content.title;
    if (
      typeof url !== "string" ||
      !url ||
      Buffer.byteLength(url, "utf8") > 4096 ||
      /[\s\x00-\x1f\x7f]/u.test(url) ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 200 ||
      Buffer.from(title, "utf8").toString("utf8") !== title ||
      /[\x00-\x1f\x7f]/.test(title)
    )
      return null;
    const authority = /^https:\/\/([^/?#]*)/i.exec(url)?.[1];
    if (
      !authority ||
      authority.includes("@") ||
      url.includes("#") ||
      url.includes("\\") ||
      Buffer.from(url, "utf8").toString("utf8") !== url
    )
      return null;
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.port
    )
      return null;
    const name = title.split(/[\\/]/).pop()!.trim();
    if (!name || name === "." || name === "..") return null;
    const result = Object.freeze({
      index: 0,
      name,
      url,
      category:
        data.msgType === "chat.photo" ? ("photo" as const) : ("file" as const),
    });
    return Object.freeze([result]);
  } catch {
    return null;
  }
}
