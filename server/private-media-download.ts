import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { prepareMedia, type MediaInput } from "./media.js";
export interface MediaNetworkPolicy {
  approvedHosts: ReadonlySet<string>;
  maxBytes: number;
  /** Only shorter deadlines are permitted, primarily for deterministic tests. */
  timeouts?: { dnsMs?: number; headersMs?: number; totalMs?: number };
}
export interface MediaAddress {
  address: string;
  family: 4 | 6;
}
export interface DownloadResponse {
  status: number;
  rawHeaders: string[];
  remoteAddress: string;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
export interface DownloadDependencies {
  resolve(hostname: string, signal: AbortSignal): Promise<MediaAddress[]>;
  request(input: {
    url: URL;
    hostname: string;
    address: string;
    family: 4 | 6;
    signal: AbortSignal;
    maxHeaderBytes: number;
  }): Promise<DownloadResponse>;
}
export class MediaDownloadError extends Error {
  constructor(
    readonly code:
      "policy" | "address" | "timeout" | "response" | "content" | "network",
  ) {
    super(`Private media download ${code}`);
    this.name = "MediaDownloadError";
  }
}
const fail = (code: MediaDownloadError["code"]): never => {
  throw new MediaDownloadError(code);
};
/** Conservative public unicast only; special-purpose and transition ranges are denied. */
export function isPublicMediaAddress(value: string): boolean {
  try {
    if (typeof value !== "string" || value.includes("%") || !isIP(value))
      return false;
    const address = ipaddr.parse(value);
    if (address.range() !== "unicast") return false;
    return (
      address.kind() === "ipv4" || address.match(ipaddr.parseCIDR("2000::/3"))
    );
  } catch {
    return false;
  }
}
const canonicalHost = (host: unknown): host is string =>
  typeof host === "string" &&
  host.length <= 253 &&
  host === host.toLowerCase() &&
  host.includes(".") &&
  !isIP(host) &&
  host
    .split(".")
    .every((x) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x));
const sameAddress = (a: string, b: string) => {
  try {
    return (
      ipaddr.parse(a).toNormalizedString() ===
      ipaddr.parse(b).toNormalizedString()
    );
  } catch {
    return false;
  }
};
const destroy = (r: DownloadResponse | undefined) => {
  try {
    r?.destroy();
  } catch {}
};
function deadline<T>(
  work: Promise<T>,
  ms: number,
  controller: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      reject(new MediaDownloadError("timeout"));
      return;
    }
    const abort = () => reject(new MediaDownloadError("timeout"));
    controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), ms);
    work
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abort);
      })
      .catch(() => {});
  });
}
/** No application host is approved by default. Calling this function is never URL fetch permission. */
export async function downloadMedia(
  raw: string,
  category: "photo" | "file",
  policy: MediaNetworkPolicy,
  deps: DownloadDependencies = productionDownloadDependencies,
): Promise<{ mime: MediaInput["mime"]; data: Buffer }> {
  const controller = new AbortController();
  let response: DownloadResponse | undefined;
  let total: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      !policy ||
      !(policy.approvedHosts instanceof Set) ||
      policy.approvedHosts.size < 1 ||
      policy.approvedHosts.size > 32 ||
      !Number.isInteger(policy.maxBytes) ||
      policy.maxBytes < 1 ||
      policy.maxBytes > 5 * 1024 * 1024 ||
      ![...policy.approvedHosts].every(canonicalHost) ||
      !["photo", "file"].includes(category)
    )
      fail("policy");
    if (
      typeof raw !== "string" ||
      Buffer.byteLength(raw) > 4096 ||
      !/^[\x21-\x7e]+$/.test(raw) ||
      /[\\#]/.test(raw)
    )
      fail("policy");
    const authority = /^https:\/\/([^/?.]+(?:\.[^/?]+)*)(?:[/?]|$)/.exec(
      raw,
    )?.[1];
    // Compare raw authority too: WHATWG parsing otherwise normalizes away ambiguity.
    const url = new URL(raw);
    if (
      !authority ||
      authority.includes("@") ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      !canonicalHost(url.hostname) ||
      !policy.approvedHosts.has(url.hostname) ||
      !(authority === url.hostname || authority === url.hostname + ":443")
    )
      fail("policy");
    const times = {
      dnsMs: policy.timeouts?.dnsMs ?? 2000,
      headersMs: policy.timeouts?.headersMs ?? 5000,
      totalMs: policy.timeouts?.totalMs ?? 15000,
    };
    for (const [key, max] of [
      ["dnsMs", 2000],
      ["headersMs", 5000],
      ["totalMs", 15000],
    ] as const)
      if (!Number.isInteger(times[key]) || times[key] < 1 || times[key] > max)
        fail("policy");
    total = setTimeout(() => controller.abort(), times.totalMs);
    const answers = await deadline(
      Promise.resolve().then(() =>
        deps.resolve(url.hostname, controller.signal),
      ),
      times.dnsMs,
      controller,
    );
    if (
      !Array.isArray(answers) ||
      answers.length < 1 ||
      answers.length > 32 ||
      answers.some(
        (a) =>
          !a ||
          !isPublicMediaAddress(a.address) ||
          isIP(a.address) !== a.family,
      )
    )
      fail("address");
    const selected = { ...answers[0] };
    const pending = Promise.resolve().then(() =>
      deps.request({
        url: new URL(url.href),
        hostname: url.hostname,
        address: selected.address,
        family: selected.family,
        signal: controller.signal,
        maxHeaderBytes: 16384,
      }),
    );
    // An injected adapter may ignore abort; dispose a response delivered after expiry.
    void pending.then(
      (r) => {
        if (controller.signal.aborted) destroy(r);
      },
      () => {},
    );
    response = await deadline(pending, times.headersMs, controller);
    if (
      !response ||
      !sameAddress(response.remoteAddress, selected.address) ||
      !isPublicMediaAddress(response.remoteAddress)
    )
      fail("address");
    if (
      response.status !== 200 ||
      !Array.isArray(response.rawHeaders) ||
      response.rawHeaders.length % 2 !== 0
    )
      fail("response");
    const headers = new Map<string, string>();
    let headerBytes = 0;
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      const key = response.rawHeaders[i],
        value = response.rawHeaders[i + 1];
      if (typeof key !== "string" || typeof value !== "string")
        fail("response");
      headerBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 4;
      const lower = key.toLowerCase();
      if (headers.has(lower) || /[\r\n]/.test(key + value)) fail("response");
      headers.set(lower, value);
    }
    if (headerBytes > 16384) fail("response");
    const encoding = headers.get("content-encoding");
    if (encoding && encoding.trim().toLowerCase() !== "identity")
      fail("response");
    const mime = headers.get("content-type")?.trim().toLowerCase();
    if (
      ![
        "image/png",
        "image/jpeg",
        ...(category === "file" ? ["application/pdf", "text/plain"] : []),
      ].includes(mime ?? "")
    )
      fail("content");
    const length = headers.get("content-length");
    let declared: number | undefined;
    if (length !== undefined) {
      if (!/^(0|[1-9][0-9]{0,9})$/.test(length)) fail("response");
      declared = Number(length);
      if (declared < 1 || declared > policy.maxBytes) fail("content");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const read = (async () => {
      for await (const chunk of response!.body) {
        if (controller.signal.aborted) fail("timeout");
        if (!(chunk instanceof Uint8Array)) fail("response");
        bytes += chunk.byteLength;
        if (bytes > policy.maxBytes) fail("content");
        chunks.push(Buffer.from(chunk));
      }
    })();
    await deadline(read, times.totalMs, controller);
    if (!bytes || (declared !== undefined && declared !== bytes))
      fail("content");
    let source;
    try {
      source = prepareMedia({
        name: "attachment",
        mime: mime as MediaInput["mime"],
        data: Buffer.concat(chunks, bytes),
      });
    } catch {
      fail("content");
    }
    return { mime: mime as MediaInput["mime"], data: source!.data };
  } catch (error) {
    if (error instanceof MediaDownloadError) throw error;
    if (controller.signal.aborted) throw new MediaDownloadError("timeout");
    throw new MediaDownloadError("network");
  } finally {
    if (total) clearTimeout(total);
    controller.abort();
    destroy(response);
  }
}
/** Built-in HTTPS only: no redirects, proxy, session headers, cookies or ambient DNS. */
export function createProductionDownloadDependencies(
  adapters: { lookup?: typeof dns.lookup; request?: typeof https.request } = {},
): DownloadDependencies {
  const lookup = adapters.lookup ?? dns.lookup;
  const issueRequest = adapters.request ?? https.request;
  return {
    async resolve(hostname, signal) {
      const result = await lookup(hostname, { all: true, verbatim: true });
      if (signal.aborted) fail("timeout");
      return result as MediaAddress[];
    },
    request(input) {
      return new Promise((resolve, reject) => {
        if (input.signal.aborted) {
          reject(new MediaDownloadError("timeout"));
          return;
        }
        if (
          input.url.protocol !== "https:" ||
          input.url.hostname !== input.hostname ||
          input.url.username ||
          input.url.password ||
          input.url.hash ||
          (input.url.port && input.url.port !== "443") ||
          !canonicalHost(input.hostname) ||
          !isPublicMediaAddress(input.address) ||
          isIP(input.address) !== input.family ||
          !Number.isInteger(input.maxHeaderBytes) ||
          input.maxHeaderBytes < 1 ||
          input.maxHeaderBytes > 16384
        ) {
          reject(new MediaDownloadError("policy"));
          return;
        }
        let answered = false;
        let settled = false;
        const decline = (code: MediaDownloadError["code"]) => {
          if (settled) return;
          settled = true;
          reject(new MediaDownloadError(code));
        };
        const request = issueRequest(input.url, {
          method: "GET",
          agent: false,
          servername: input.hostname,
          rejectUnauthorized: true,
          maxHeaderSize: input.maxHeaderBytes,
          headers: {
            Host: input.hostname,
            "Accept-Encoding": "identity",
            Accept: "image/png,image/jpeg,application/pdf,text/plain",
          },
          lookup: ((_hostname: unknown, options: any, callback: any) => {
            if (input.signal.aborted) {
              callback(new MediaDownloadError("timeout"));
              return;
            }
            if (options?.all)
              callback(null, [
                { address: input.address, family: input.family },
              ]);
            else callback(null, input.address, input.family);
          }) as any,
        });
        const abort = () => {
          decline("timeout");
          try {
            request.destroy(new MediaDownloadError("timeout"));
          } catch {}
        };
        input.signal.addEventListener("abort", abort, { once: true });
        request.on("error", () => decline("network"));
        request.on("socket", (socket) =>
          socket.once("secureConnect", () => {
            if (!sameAddress(socket.remoteAddress ?? "", input.address))
              request.destroy(new MediaDownloadError("address"));
          }),
        );
        request.once("response", (res) => {
          // A rejected/unread response can still receive an error when abort or
          // socket cleanup runs. Keep an observer even before iteration starts.
          res.on("error", () => {});
          answered = true;
          if (settled || input.signal.aborted) {
            res.destroy();
            return;
          }
          if (!sameAddress(res.socket.remoteAddress ?? "", input.address)) {
            decline("address");
            res.destroy();
            return;
          }
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            rawHeaders: res.rawHeaders,
            remoteAddress: res.socket.remoteAddress ?? "",
            body: res,
            destroy() {
              res.destroy();
              request.destroy();
            },
          });
        });
        request.once("close", () => {
          input.signal.removeEventListener("abort", abort);
          if (!answered) decline("network");
        });
        if (input.signal.aborted) abort();
        else {
          try {
            request.end();
          } catch {
            decline("network");
            try {
              request.destroy();
            } catch {}
          }
        }
      });
    },
  };
}
export const productionDownloadDependencies =
  createProductionDownloadDependencies();
