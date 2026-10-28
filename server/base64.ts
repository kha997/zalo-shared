/** Decode bounded attachment bytes. Null means malformed or out of bounds. */
export function decodeAttachmentBase64(
  value: string,
  maxBytes = 5 * 1024 * 1024,
): Buffer | null {
  if (
    !value.length ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maxBytes / 3) * 4
  )
    return null;
  const bytes = Buffer.from(value, "base64");
  // Node's decoder is intentionally permissive; re-encoding enforces canonical alphabet and padding.
  return bytes.length > 0 &&
    bytes.length <= maxBytes &&
    bytes.toString("base64") === value
    ? bytes
    : null;
}
