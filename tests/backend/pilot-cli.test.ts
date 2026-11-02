import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePilotArgs,
  parsePilotManifest,
  runPilotCli,
} from "../../tools/pilot-connector.js";

const now = new Date("2026-11-02T00:30:00.000Z");
const account = "zalo-uid-sentinel-1";
const peer = "peer-sentinel-1";
const build = {
  sourceCommit: "a".repeat(40),
  lockSha256: "b".repeat(64),
  sdkIntegrity: "sha512-" + "c".repeat(64),
};

function manifestFor(
  purpose: "enroll-session" | "observe" | "send-test",
  overrides: Record<string, unknown> = {},
  consentOverrides: Record<string, unknown> = {},
) {
  const bound = purpose === "enroll-session" ? null : account;
  const peers = purpose === "enroll-session" ? [] : [peer];
  return {
    version: 1,
    build: { ...build },
    consent: {
      consentRef: "owner-consent-synthetic",
      notAfter: "2026-11-03T00:00:00.000Z",
      expectedAccountId: bound,
      allowedPurposes: [purpose],
      allowedPeerIds: peers,
      maxPartsPerDay: 5,
      minIntervalMs: 2000,
      ...consentOverrides,
    },
    grant: {
      version: 1,
      grantId: "grant-synthetic-1",
      purpose,
      ...build,
      issuedAt: "2026-11-02T00:00:00.000Z",
      expiresAt:
        purpose === "enroll-session"
          ? "2026-11-02T01:00:00.000Z"
          : "2026-11-02T08:00:00.000Z",
      ownerConsentRef: "owner-consent-synthetic",
      dedicatedAccountAttested: true,
      unofficialClientRiskAccepted: true,
      expectedAccountId: bound,
      allowedPeerIds: peers,
      maxPartsPerDay: 1,
      minIntervalMs: 2000,
      ...overrides,
    },
  };
}

const manifestText = (purpose: "enroll-session" | "observe" | "send-test") =>
  JSON.stringify(manifestFor(purpose));

test("argument parsing defaults to dry-run and rejects non-manifest options", () => {
  const absolute = "/private/pilot/manifest.json";
  assert.deepEqual(parsePilotArgs([], { PILOT_MANIFEST: absolute }), {
    ok: true,
    command: "dry-run",
    manifestPath: absolute,
    acknowledge: false,
  });
  assert.deepEqual(
    parsePilotArgs(["--manifest", absolute, "--acknowledge-pilot-risk"], {}),
    {
      ok: true,
      command: "dry-run",
      manifestPath: absolute,
      acknowledge: true,
    },
  );
  assert.equal(parsePilotArgs(["bootstrap"], {}).ok, false);
  assert.equal(parsePilotArgs(["unknown", "--manifest", absolute]).ok, false);
  assert.equal(parsePilotArgs(["dry-run", "--cookie", "x"]).ok, false);
  assert.equal(parsePilotArgs(["dry-run", "--token", "x"]).ok, false);
  assert.equal(parsePilotArgs(["dry-run", "--key", "x"]).ok, false);
  assert.equal(parsePilotArgs(["dry-run", "--url", "x"]).ok, false);
  assert.equal(parsePilotArgs(["dry-run", "--manifest", "relative.json"]).ok, false);
  assert.equal(
    parsePilotArgs(["dry-run", "--manifest", absolute, "--manifest", absolute])
      .ok,
    false,
  );
});

test("dry-run validates the private manifest and performs no runner, vault or SDK work", async () => {
  let reads = 0;
  let runner = 0;
  const result = await runPilotCli({
    argv: ["dry-run", "--manifest", "/private/pilot/manifest.json"],
    dependencies: {
      readFile: async () => {
        reads++;
        return manifestText("enroll-session");
      },
      now: () => now,
      runCommand: async () => {
        runner++;
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, undefined);
  const output = JSON.parse(result.stdout!);
  assert.deepEqual(output, {
    command: "dry-run",
    ok: true,
    gate: "admitted",
    purpose: "enroll-session",
    expiresAt: "2026-11-02T01:00:00.000Z",
  });
  assert.equal(reads, 1);
  assert.equal(runner, 0);
  assert.equal(result.stdout!.includes(account), false);
  assert.equal(result.stdout!.includes(peer), false);
  assert.equal(result.stdout!.includes("grant-synthetic"), false);
  assert.equal(result.stdout!.includes("owner-consent"), false);
});

test("dry-run denies expired, malformed, extra-field and mismatched manifests", async () => {
  const cases = [
    JSON.stringify(manifestFor("enroll-session", { expiresAt: "2026-11-02T00:00:00.000Z" })),
    JSON.stringify(manifestFor("enroll-session", { sourceCommit: "d".repeat(40) })),
    JSON.stringify({ ...manifestFor("enroll-session"), unexpected: true }),
    JSON.stringify({
      ...manifestFor("enroll-session"),
      build: { ...build, unexpected: true },
    }),
    "not-json",
  ];
  for (const text of cases) {
    const result = await runPilotCli({
      argv: ["dry-run", "--manifest", "/private/pilot/manifest.json"],
      dependencies: {
        readFile: async () => text,
        now: () => now,
      },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.stdout!), {
      command: "dry-run",
      ok: false,
      gate: "denied",
    });
  }
});

test("preflight admits an exact G5 scope without reading secrets or requiring acknowledgement", async () => {
  let reads = 0;
  let runner = 0;
  const result = await runPilotCli({
    argv: ["preflight", "--manifest", "/private/pilot/manifest.json"],
    dependencies: {
      readFile: async () => {
        reads++;
        return JSON.stringify(
          manifestFor("observe", {
            expiresAt: "2026-11-02T02:00:00.000Z",
          }),
        );
      },
      now: () => now,
      runCommand: async () => {
        runner++;
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout!), {
    command: "preflight",
    ok: true,
    gate: "admitted",
    purpose: "observe",
    accountBound: true,
    peerCount: 1,
    maxPartsPerDay: 1,
    minIntervalMs: 2000,
    lifetimeMs: 2 * 60 * 60 * 1000,
    expiresAt: "2026-11-02T02:00:00.000Z",
  });
  assert.equal(reads, 1);
  assert.equal(runner, 0);
  assert.equal(result.stdout!.includes(account), false);
  assert.equal(result.stdout!.includes(peer), false);
  assert.equal(result.stdout!.includes("grant-synthetic"), false);
  assert.equal(result.stdout!.includes("owner-consent"), false);

  const enroll = await runPilotCli({
    argv: ["preflight", "--manifest", "/private/pilot/manifest.json"],
    dependencies: {
      readFile: async () => manifestText("enroll-session"),
      now: () => now,
    },
  });
  assert.equal(enroll.exitCode, 0);
  assert.equal(JSON.parse(enroll.stdout!).peerCount, 0);
  assert.equal(JSON.parse(enroll.stdout!).accountBound, false);
});

test("preflight denies a scope outside the approved G5 bounds", async () => {
  const cases = [
    JSON.stringify(
      manifestFor(
        "observe",
        {
          allowedPeerIds: [peer, "peer-sentinel-2"],
          expiresAt: "2026-11-02T02:00:00.000Z",
        },
        { allowedPeerIds: [peer, "peer-sentinel-2"] },
      ),
    ),
    JSON.stringify(
      manifestFor(
        "observe",
        {
          maxPartsPerDay: 11,
          expiresAt: "2026-11-02T02:00:00.000Z",
        },
        { maxPartsPerDay: 11 },
      ),
    ),
    JSON.stringify(
      manifestFor("observe", {
        expiresAt: "2026-11-02T03:00:00.000Z",
      }),
    ),
    JSON.stringify(
      manifestFor("observe", {
        minIntervalMs: 1999,
        expiresAt: "2026-11-02T02:00:00.000Z",
      }),
    ),
    JSON.stringify(
      manifestFor("enroll-session", { expectedAccountId: account }, {
        expectedAccountId: account,
      }),
    ),
    JSON.stringify(
      manifestFor("enroll-session", { allowedPeerIds: [peer] }, {
        allowedPeerIds: [peer],
      }),
    ),
  ];
  for (const text of cases) {
    const result = await runPilotCli({
      argv: ["preflight", "--manifest", "/private/pilot/manifest.json"],
      dependencies: {
        readFile: async () => text,
        now: () => now,
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout!).gate, "denied");
    assert.equal(result.stdout!.includes(account), false);
    assert.equal(result.stdout!.includes(peer), false);
  }
});

test("live commands require the explicit operator flag before any manifest read", async () => {
  let reads = 0;
  for (const command of ["bootstrap", "run-observe", "run-send-test"]) {
    const result = await runPilotCli({
      argv: [command, "--manifest", "/private/pilot/manifest.json"],
      dependencies: {
        readFile: async () => {
          reads++;
          return manifestText("enroll-session");
        },
        now: () => now,
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout!).gate, "denied");
  }
  assert.equal(reads, 0);
});

test("live commands require the matching grant purpose and an available runner", async () => {
  for (const [command, manifestPurpose] of [
    ["bootstrap", "observe"],
    ["run-observe", "enroll-session"],
    ["run-send-test", "observe"],
  ] as const) {
    let runner = 0;
    const result = await runPilotCli({
      argv: [
        command,
        "--manifest",
        "/private/pilot/manifest.json",
        "--acknowledge-pilot-risk",
      ],
      dependencies: {
        readFile: async () => manifestText(manifestPurpose),
        now: () => now,
        runCommand: async () => {
          runner++;
        },
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout!).gate, "denied");
    assert.equal(runner, 0);
  }

  const noRunner = await runPilotCli({
    argv: [
      "bootstrap",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () => manifestText("enroll-session"),
      now: () => now,
    },
  });
  assert.equal(noRunner.exitCode, 1);
  assert.equal(JSON.parse(noRunner.stdout!).gate, "unavailable");
});

test("matching live commands invoke the reviewed runner and return only safe outcomes", async () => {
  for (const command of ["bootstrap", "run-observe", "run-send-test"] as const) {
    const purpose =
      command === "bootstrap"
        ? "enroll-session"
        : command === "run-observe"
          ? "observe"
          : "send-test";
    const seen: unknown[] = [];
    const env = { PILOT_MANIFEST: "/private/pilot/manifest.json" };
    const result = await runPilotCli({
      argv: [command, "--acknowledge-pilot-risk"],
      env,
      dependencies: {
        readFile: async () => manifestText(purpose),
        now: () => now,
        runCommand: async (input) => {
          seen.push(input);
        },
      },
    });
    assert.equal(result.exitCode, 0);
    const output = JSON.parse(result.stdout!);
    assert.equal(output.command, command);
    assert.equal(output.ok, true);
    assert.equal(output.gate, "completed");
    assert.equal(output.purpose, purpose);
    assert.equal(result.stdout!.includes(account), false);
    assert.equal(result.stdout!.includes(peer), false);
    assert.equal(seen.length, 1);
    const input = seen[0] as any;
    assert.equal(input.command, command);
    assert.equal(input.manifest.grant.purpose, purpose);
    assert.equal(input.env, env);
  }
});

test("safety halts exit non-zero and expose only bounded counters", async () => {
  for (const halt of [
    "connection-lost",
    "runtime-error",
    "already-reserved",
    "reservation-denied",
    "dispatch-uncertain",
  ]) {
    const result = await runPilotCli({
      argv: [
        "run-send-test",
        "--manifest",
        "/private/pilot/manifest.json",
        "--acknowledge-pilot-risk",
      ],
      dependencies: {
        readFile: async () => manifestText("send-test"),
        now: () => now,
        runCommand: async () => ({ halt, ticks: 4, rejectedInbound: 2 }),
      },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.stdout!), {
      command: "run-send-test",
      ok: false,
      gate: halt,
      purpose: "send-test",
      expiresAt: "2026-11-02T08:00:00.000Z",
      ticks: 4,
      rejectedInbound: 2,
    });
    assert.equal(result.stdout!.includes(account), false);
    assert.equal(result.stdout!.includes(peer), false);
  }

  const benign = await runPilotCli({
    argv: [
      "run-observe",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () => manifestText("observe"),
      now: () => now,
      runCommand: async () => ({ halt: "grant-expired", ticks: 3 }),
    },
  });
  assert.equal(benign.exitCode, 0);
  assert.deepEqual(JSON.parse(benign.stdout!), {
    command: "run-observe",
    ok: true,
    gate: "grant-expired",
    purpose: "observe",
    expiresAt: "2026-11-02T08:00:00.000Z",
    ticks: 3,
  });

  const invalidCounters = await runPilotCli({
    argv: [
      "run-send-test",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () => manifestText("send-test"),
      now: () => now,
      runCommand: async () => ({
        halt: "runtime-error",
        ticks: -1,
        rejectedInbound: "many" as never,
      }),
    },
  });
  assert.equal(invalidCounters.exitCode, 1);
  const output = JSON.parse(invalidCounters.stdout!);
  assert.equal(output.gate, "runtime-error");
  assert.equal("ticks" in output, false);
  assert.equal("rejectedInbound" in output, false);
});

test("an unknown runner halt never reaches operator-visible output", async () => {
  for (const halt of [
    "future-unknown-halt",
    `leak-${account}`,
    "cookies=abc",
  ]) {
    const result = await runPilotCli({
      argv: [
        "run-send-test",
        "--manifest",
        "/private/pilot/manifest.json",
        "--acknowledge-pilot-risk",
      ],
      dependencies: {
        readFile: async () => manifestText("send-test"),
        now: () => now,
        runCommand: async () => ({ halt, ticks: 1 }),
      },
    });
    assert.equal(result.exitCode, 1);
    const output = JSON.parse(result.stdout!);
    assert.equal(output.gate, "runtime-error");
    assert.equal(result.stdout!.includes(halt), false);
    assert.equal(result.stdout!.includes(account), false);
    assert.equal(result.stdout!.includes("cookies"), false);
  }
});

test("a non-string runner halt is a safety failure, not a success", async () => {
  for (const halt of [
    42,
    null,
    { reason: "grant-expired" },
    new String("grant-expired"),
  ]) {
    const result = await runPilotCli({
      argv: [
        "run-observe",
        "--manifest",
        "/private/pilot/manifest.json",
        "--acknowledge-pilot-risk",
      ],
      dependencies: {
        readFile: async () => manifestText("observe"),
        now: () => now,
        runCommand: async () =>
          ({ halt, ticks: 1 }) as unknown as never,
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout!).gate, "runtime-error");
    assert.equal(result.stdout!.includes("grant-expired"), false);
  }
});

test("runner failures, missing manifests and policy-invalid live manifests fail closed", async () => {
  const runnerFailure = await runPilotCli({
    argv: [
      "bootstrap",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () => manifestText("enroll-session"),
      now: () => now,
      runCommand: async () => {
        throw new Error("sensitive internal detail");
      },
    },
  });
  assert.equal(runnerFailure.exitCode, 1);
  assert.equal(JSON.parse(runnerFailure.stdout!).gate, "unavailable");
  assert.equal(runnerFailure.stdout!.includes("sensitive"), false);
  assert.equal(runnerFailure.stderr, undefined);

  const quarantine = await runPilotCli({
    argv: [
      "bootstrap",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () => manifestText("enroll-session"),
      now: () => now,
      runCommand: async () => {
        throw Object.assign(new Error("quarantine"), {
          code: "quarantine-unconfirmed",
        });
      },
    },
  });
  assert.equal(quarantine.exitCode, 1);
  assert.equal(
    JSON.parse(quarantine.stdout!).gate,
    "quarantine-unconfirmed",
  );
  assert.equal(quarantine.stdout!.includes("sensitive"), false);

  const missing = await runPilotCli({
    argv: ["dry-run", "--manifest", "/private/pilot/manifest.json"],
    dependencies: {
      readFile: async () => {
        throw new Error("missing");
      },
      now: () => now,
    },
  });
  assert.equal(missing.exitCode, 1);

  const observeWithoutAccount = await runPilotCli({
    argv: [
      "run-observe",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () =>
        JSON.stringify(
          manifestFor("observe", { expectedAccountId: null }, { expectedAccountId: null }),
        ),
      now: () => now,
      runCommand: async () => {},
    },
  });
  assert.equal(observeWithoutAccount.exitCode, 1);
  assert.equal(JSON.parse(observeWithoutAccount.stdout!).gate, "denied");

  const selfPeer = await runPilotCli({
    argv: [
      "run-observe",
      "--manifest",
      "/private/pilot/manifest.json",
      "--acknowledge-pilot-risk",
    ],
    dependencies: {
      readFile: async () =>
        JSON.stringify(
          manifestFor(
            "observe",
            { allowedPeerIds: [account] },
            { allowedPeerIds: [account] },
          ),
        ),
      now: () => now,
      runCommand: async () => {},
    },
  });
  assert.equal(selfPeer.exitCode, 1);
  assert.equal(JSON.parse(selfPeer.stdout!).gate, "denied");
});

test("manifest parsing rejects extra keys and returns a frozen grant", () => {
  const parsed = parsePilotManifest(manifestText("enroll-session"), now);
  assert.equal(parsed.grant.purpose, "enroll-session");
  assert.ok(Object.isFrozen(parsed.grant));
  assert.ok(Object.isFrozen(parsed.build));
  assert.throws(() =>
    parsePilotManifest(
      JSON.stringify({ ...manifestFor("enroll-session"), consentRef: "other" }),
      now,
    ),
  );
});
