import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadMedia,
  isPublicMediaAddress,
  type DownloadDependencies,
} from "../../server/private-media-download.js";
const policy = {
  approvedHosts: new Set(["media.example.test"]),
  maxBytes: 1024,
};
const good = "https://media.example.test/private?token=synthetic-secret";
function fake(overrides: Partial<DownloadDependencies> = {}) {
  let requests = 0,
    destroyed = 0;
  const deps: DownloadDependencies = {
    async resolve() {
      return [{ address: "8.8.8.8", family: 4 }];
    },
    async request(input) {
      requests++;
      assert.equal(input.address, "8.8.8.8");
      assert.equal(input.hostname, "media.example.test");
      return {
        status: 200,
        rawHeaders: ["content-type", "text/plain"],
        remoteAddress: "8.8.8.8",
        body: (async function* () {
          yield Buffer.from("synthetic");
        })(),
        destroy() {
          destroyed++;
        },
      };
    },
    ...overrides,
  };
  return {
    deps,
    get requests() {
      return requests;
    },
    get destroyed() {
      return destroyed;
    },
  };
}
test("private media exact-host policy rejects URL ambiguity before DNS or request", async () => {
  const f = fake({
    async resolve() {
      throw Error("must not resolve");
    },
  });
  for (const url of [
    good.replace("https:", "http:"),
    "https://user@media.example.test/a",
    "https://@media.example.test/a",
    good + "#",
    "https://media.example.test./a",
    "https://media.example.test:444/a",
    "https://media.example.test.evil/a",
    "https://media.example.test\\@evil/a",
    "https://MEDIA.example.test/a",
    "https://média.example.test/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://media.example.test/a\n",
  ])
    await assert.rejects(
      downloadMedia(url, "file", policy, f.deps),
      (e) => e instanceof Error && !e.message.includes("synthetic-secret"),
    );
  await assert.rejects(
    downloadMedia(
      good,
      "file",
      { ...policy, approvedHosts: new Set() },
      f.deps,
    ),
  );
  assert.equal(f.requests, 0);
});
test("public address classifier rejects special IPv4 and IPv6 including mapped and transition ranges", () => {
  for (const address of [
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "192.0.0.9",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "100::1",
    "fc00::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:808:808::1",
    "3fff::1",
    "5f00::1",
    "4000::1",
  ])
    assert.equal(isPublicMediaAddress(address), false, address);
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicMediaAddress(address), true, address);
});
test("download pins one validated DNS answer and rejects mixed public/private answers", async () => {
  const f = fake();
  const result = await downloadMedia(good, "file", policy, f.deps);
  assert.equal(result.data.toString(), "synthetic");
  assert.equal(result.mime, "text/plain");
  assert.equal(f.requests, 1);
  assert.equal(f.destroyed, 1);
  const mixed = fake({
    async resolve() {
      return [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ];
    },
  });
  await assert.rejects(downloadMedia(good, "file", policy, mixed.deps));
  assert.equal(mixed.requests, 0);
  const rebound = fake({
    async request() {
      return {
        status: 200,
        rawHeaders: ["content-type", "text/plain"],
        remoteAddress: "127.0.0.1",
        body: (async function* () {
          yield Buffer.from("secret");
        })(),
        destroy() {},
      };
    },
  });
  await assert.rejects(downloadMedia(good, "file", policy, rebound.deps));
});
test("download rejects redirects, encoding, duplicated headers, wrong media, size and partial-body errors", async () => {
  for (const patch of [
    { status: 302 },
    { rawHeaders: ["content-type", "text/plain", "content-encoding", "gzip"] },
    {
      rawHeaders: ["content-type", "text/plain", "content-type", "text/plain"],
    },
    { rawHeaders: ["content-type", "text/html"] },
    { rawHeaders: ["content-type", "text/plain", "content-length", "1025"] },
    { rawHeaders: ["content-type", "text/plain", "content-length", "20"] },
    {
      body: (async function* () {
        yield Buffer.alloc(1025);
      })(),
    },
    {
      body: (async function* () {
        yield Buffer.from("partial");
        throw Error("secret-token");
      })(),
    },
    {
      rawHeaders: ["content-type", "image/png"],
      body: (async function* () {
        yield Buffer.from("invalid");
      })(),
    },
  ]) {
    let destroyed = 0;
    const f = fake({
      async request() {
        return {
          status: 200,
          rawHeaders: ["content-type", "text/plain"],
          remoteAddress: "8.8.8.8",
          body: (async function* () {
            yield Buffer.from("synthetic");
          })(),
          ...patch,
          destroy() {
            destroyed++;
          },
        };
      },
    });
    await assert.rejects(
      downloadMedia(good, "file", policy, f.deps),
      (e) => e instanceof Error && !e.message.includes("secret"),
    );
    assert.equal(destroyed, 1);
  }
  const f = fake();
  await assert.rejects(downloadMedia(good, "photo", policy, f.deps));
});
test("DNS, header and body deadlines abort while late DNS and request failures stay observed", async () => {
  const timeouts = { dnsMs: 5, headersMs: 5, totalMs: 15 };
  let signal: AbortSignal | undefined;
  const dns = fake({
    resolve: async (_h, s) => {
      signal = s;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    downloadMedia(good, "file", { ...policy, timeouts }, dns.deps),
  );
  assert.equal(signal!.aborted, true);
  assert.equal(dns.requests, 0);
  const headers = fake({
    request: async (input) => {
      signal = input.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    downloadMedia(good, "file", { ...policy, timeouts }, headers.deps),
  );
  assert.equal(signal!.aborted, true);
  const body = fake({
    async request(input) {
      signal = input.signal;
      return {
        status: 200,
        rawHeaders: ["content-type", "text/plain"],
        remoteAddress: "8.8.8.8",
        body: {
          [Symbol.asyncIterator]() {
            return { next: async () => new Promise<any>(() => {}) };
          },
        },
        destroy() {},
      };
    },
  });
  await assert.rejects(
    downloadMedia(good, "file", { ...policy, timeouts }, body.deps),
  );
  assert.equal(signal!.aborted, true);
  const throws = fake({
    request() {
      throw Error("https://secret-url");
    },
  });
  await assert.rejects(
    downloadMedia(good, "file", policy, throws.deps),
    (e) => e instanceof Error && !e.message.includes("https:"),
  );
});

test("production HTTPS adapter fixes lookup, SNI, certificate verification and credential-free headers", async () => {
  const { createProductionDownloadDependencies } =
    await import("../../server/private-media-download.js");
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  let captured: any;
  let requests = 0;
  let resolutions = 0;
  const deps = createProductionDownloadDependencies({
    lookup: async () => {
      resolutions++;
      return [
        { address: resolutions === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 },
      ] as any;
    },
    request: ((_url: any, options: any) => {
      requests++;
      captured = options;
      options.lookup(
        "media.example.test",
        { all: true },
        (error: unknown, addresses: unknown) => {
          assert.equal(error, null);
          assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
        },
      );
      const req = new EventEmitter() as any;
      req.destroy = () => {
        req.emit("close");
        return req;
      };
      req.end = () => {
        const socket = new EventEmitter() as any;
        socket.remoteAddress = "8.8.8.8";
        req.emit("socket", socket);
        socket.emit("secureConnect");
        const response = Readable.from([Buffer.from("adapter bytes")]) as any;
        response.socket = socket;
        response.statusCode = 200;
        response.rawHeaders = ["content-type", "text/plain"];
        req.emit("response", response);
      };
      return req;
    }) as any,
  });
  const result = await downloadMedia(good, "file", policy, deps);
  assert.equal(result.data.toString(), "adapter bytes");
  assert.equal(requests, 1);
  assert.equal(resolutions, 1);
  assert.equal(captured.agent, false);
  assert.equal(captured.rejectUnauthorized, true);
  assert.equal(captured.servername, "media.example.test");
  assert.equal(captured.maxHeaderSize, 16384);
  assert.deepEqual(captured.headers, {
    Host: "media.example.test",
    "Accept-Encoding": "identity",
    Accept: "image/png,image/jpeg,application/pdf,text/plain",
  });
  const controller = new AbortController();
  const pin = createProductionDownloadDependencies({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }] as any,
    request: ((_url: any, options: any) => {
      let selected: any;
      options.lookup("ignored", { all: true }, (e: any, r: any) => {
        assert.equal(e, null);
        selected = r;
      });
      assert.deepEqual(selected, [{ address: "8.8.8.8", family: 4 }]);
      throw Error("adapter-secret");
    }) as any,
  });
  await assert.rejects(
    pin.request({
      url: new URL(good),
      hostname: "media.example.test",
      address: "8.8.8.8",
      family: 4,
      signal: controller.signal,
      maxHeaderBytes: 16384,
    }),
  );
});

test("late DNS cannot start a request and late headers are destroyed after deadline", async () => {
  const timeouts = { dnsMs: 5, headersMs: 5, totalMs: 15 };
  let finishDns!: (a: { address: string; family: 4 }[]) => void;
  const dns = fake({
    resolve: () =>
      new Promise((r) => {
        finishDns = r;
      }),
  });
  await assert.rejects(
    downloadMedia(good, "file", { ...policy, timeouts }, dns.deps),
  );
  finishDns([{ address: "8.8.8.8", family: 4 }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(dns.requests, 0);
  let finishHeaders!: (response: any) => void;
  let destroyed = 0;
  const headers = fake({
    request: () =>
      new Promise((r) => {
        finishHeaders = r;
      }),
  });
  await assert.rejects(
    downloadMedia(good, "file", { ...policy, timeouts }, headers.deps),
  );
  finishHeaders({
    status: 200,
    rawHeaders: ["content-type", "text/plain"],
    remoteAddress: "8.8.8.8",
    body: (async function* () {
      yield Buffer.from("late");
    })(),
    destroy() {
      destroyed++;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(destroyed, 1);
});

test("production adapter refuses pre-aborted requests and destroys late responses after rejection", async () => {
  const { createProductionDownloadDependencies } =
    await import("../../server/private-media-download.js");
  const { EventEmitter } = await import("node:events");
  const controller = new AbortController();
  let calls = 0;
  let request: any;
  const deps = createProductionDownloadDependencies({
    request: (() => {
      calls++;
      request = new EventEmitter() as any;
      request.destroy = () => {
        request.emit("close");
        return request;
      };
      request.end = () => request.emit("error", Error("private-url-token"));
      return request;
    }) as any,
  });
  const input = {
    url: new URL(good),
    hostname: "media.example.test",
    address: "8.8.8.8",
    family: 4 as const,
    signal: controller.signal,
    maxHeaderBytes: 16384,
  };
  controller.abort();
  await assert.rejects(deps.request(input));
  assert.equal(calls, 0);
  await assert.rejects(
    deps.request({ ...input, signal: new AbortController().signal }),
  );
  let destroyed = 0;
  request.emit(
    "response",
    Object.assign(new EventEmitter(), {
      socket: { remoteAddress: "8.8.8.8" },
      destroy() {
        destroyed++;
      },
      rawHeaders: [],
      statusCode: 200,
    }),
  );
  assert.equal(destroyed, 1);
});

test("download admits the four bounded content types and rejects overlong headers", async () => {
  const png = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  const jpeg = Buffer.from([
    255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0,
  ]);
  for (const [mime, data, category] of [
    ["image/png", png, "photo"],
    ["image/jpeg", jpeg, "photo"],
    ["application/pdf", Buffer.from("%PDF-1.7 synthetic"), "file"],
    ["text/plain", Buffer.from("Kiểm thử"), "file"],
  ] as const) {
    const f = fake({
      async request() {
        return {
          status: 200,
          rawHeaders: [
            "content-type",
            mime,
            "content-length",
            String(data.length),
          ],
          remoteAddress: "8.8.8.8",
          body: (async function* () {
            yield data;
          })(),
          destroy() {},
        };
      },
    });
    const r = await downloadMedia(good, category, policy, f.deps);
    assert.equal(r.mime, mime);
    assert.deepEqual(r.data, data);
  }
  const overlong = fake({
    async request() {
      return {
        status: 200,
        rawHeaders: [
          "content-type",
          "text/plain",
          "x-padding",
          "x".repeat(16384),
        ],
        remoteAddress: "8.8.8.8",
        body: (async function* () {
          throw Error("body must not be read");
          yield Buffer.from("unused");
        })(),
        destroy() {},
      };
    },
  });
  await assert.rejects(downloadMedia(good, "file", policy, overlong.deps));
});

test("production response cleanup consumes errors before reading or rejecting headers", async () => {
  const { createProductionDownloadDependencies } =
    await import("../../server/private-media-download.js");
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  let response: any;
  const deps = createProductionDownloadDependencies({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }] as any,
    request: (() => {
      const req = new EventEmitter() as any;
      req.destroy = (error?: Error) => {
        response?.destroy(error);
        req.emit("close");
        return req;
      };
      req.end = () => {
        response = Readable.from([Buffer.from("unread redirect body")]) as any;
        response.socket = { remoteAddress: "8.8.8.8" };
        response.statusCode = 302;
        response.rawHeaders = ["content-type", "text/plain"];
        req.emit("response", response);
      };
      return req;
    }) as any,
  });
  await assert.rejects(downloadMedia(good, "file", policy, deps));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(response.listenerCount("error") > 0);
  assert.doesNotThrow(() =>
    response.emit("error", Error("late-private-locator")),
  );
});
