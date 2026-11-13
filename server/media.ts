export type MediaInput = {
  name: string;
  mime: "image/png" | "image/jpeg" | "application/pdf" | "text/plain";
  data: Buffer;
};
export type MediaSource = {
  data: Buffer;
  filename: string;
  metadata: { totalSize: number; width?: number; height?: number };
};
const invalid = () => new Error("Invalid media");
function dimensions(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 40_000_000
  )
    throw invalid();
  return { width, height };
}
function imageSize(data: Buffer, mime: string) {
  if (mime === "image/png") {
    if (
      data.length < 33 ||
      !data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      data.readUInt32BE(8) !== 13 ||
      !data.subarray(12, 16).equals(Buffer.from("IHDR"))
    )
      throw invalid();
    return dimensions(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (data.length < 4 || data[0] !== 255 || data[1] !== 216) throw invalid();
  let offset = 2;
  while (offset < data.length) {
    if (data[offset++] !== 255) throw invalid();
    while (offset < data.length && data[offset] === 255) offset++;
    if (offset >= data.length) throw invalid();
    const marker = data[offset++];
    if (marker === 0 || marker === 216 || marker === 217 || marker === 218)
      throw invalid();
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > data.length) throw invalid();
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw invalid();
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      if (
        length < 11 ||
        data[offset + 7] < 1 ||
        length !== 8 + 3 * data[offset + 7]
      )
        throw invalid();
      return dimensions(
        data.readUInt16BE(offset + 5),
        data.readUInt16BE(offset + 3),
      );
    }
    offset += length;
  }
  throw invalid();
}
/** Header/UTF-8 validation only; does not decode images or establish document safety. */
export function prepareMedia(input: MediaInput): MediaSource {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 1024 ||
      /[\x00-\x1f\x7f]/.test(input.name) ||
      !Buffer.isBuffer(input.data) ||
      input.data.length < 1 ||
      input.data.length > 5 * 1024 * 1024
    )
      throw invalid();
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "application/pdf": "pdf",
      "text/plain": "txt",
    };
    const extension = Object.hasOwn(extensions, input.mime)
      ? extensions[input.mime]
      : undefined;
    if (!extension) throw invalid();
    const data = Buffer.from(input.data);
    const size = input.mime.startsWith("image/")
      ? imageSize(data, input.mime)
      : {};
    if (
      input.mime === "application/pdf" &&
      !data.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw invalid();
    if (input.mime === "text/plain") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (text.includes("\0")) throw invalid();
    }
    const basename = input.name.split(/[\\/]/).pop()!;
    const stem =
      basename
        .replace(/\.[^.]*$/, "")
        .replace(/[^\p{L}\p{N}_ .-]/gu, "_")
        .replace(/^\.+|\.+$/g, "")
        .trim()
        .slice(0, 120) || "attachment";
    return {
      data,
      filename: `${stem}.${extension}`,
      metadata: { totalSize: data.length, ...size },
    };
  } catch {
    throw invalid();
  }
}
