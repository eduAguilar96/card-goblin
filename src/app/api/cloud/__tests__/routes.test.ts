/**
 * Every /api/cloud/* route (DESIGN.md §7.6, brief F), invoked directly (no
 * server, no network — Next.js route handlers are plain async functions
 * over Request/Response) against `setCloudStorageForTests`'s in-memory
 * fake. Covers: authz (401 unauthenticated on EVERY protected route,
 * explicitly, including presign), payload validation (malformed projects,
 * bad asset name/mime/size), the revision guard (match → write, mismatch →
 * 409, a SIMULATED concurrent write racing the route's own read-then-write),
 * and unconfigured env → a clean 503 everywhere.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginPost } from "@/app/api/cloud/login/route";
import { POST as logoutPost } from "@/app/api/cloud/logout/route";
import { GET as projectGet, PUT as projectPut } from "@/app/api/cloud/project/route";
import { POST as presignPost } from "@/app/api/cloud/assets/presign/route";
import { GET as assetGet, DELETE as assetDelete } from "@/app/api/cloud/assets/[name]/route";
import { GET as diagnoseGet } from "@/app/api/cloud/diagnose/route";
import {
  CloudStorageError,
  createInMemoryCloudStorage,
  resetCloudStorageForTests,
  setCloudStorageForTests,
  type CloudStorage,
} from "@/lib/cloud/r2";
import { PROJECT_KEY } from "@/lib/cloud/keys";
import { createSessionCookieValue, hashPassword, verifyPassword } from "@/lib/cloud/session";
import { DEFAULT_ADMIN_USERNAME, LOGIN_GENERIC_FAILURE_MESSAGE, SESSION_COOKIE_NAME } from "@/lib/cloud/auth";

const TEST_PASSWORD = "correct password for tests";
const BASE = "http://localhost:3000";

// >= 32 bytes (M3: loadSessionEnvFromProcess now rejects anything shorter).
const TEST_SESSION_SECRET = "test-session-secret-that-is-long-enough-32b";

async function configureSession(opts: { username?: string } = {}): Promise<void> {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(TEST_PASSWORD);
  if (opts.username !== undefined) process.env.ADMIN_USERNAME = opts.username;
}

function clearSessionConfig(): void {
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_USERNAME;
}

function sessionCookieHeader(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("configureSession() first");
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue(secret)}`;
}

function req(
  path: string,
  init: { method?: string; body?: unknown; signedIn?: boolean; cookie?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const cookie = init.cookie ?? (init.signedIn ? sessionCookieHeader() : undefined);
  if (cookie !== undefined) headers.cookie = cookie;
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

beforeEach(async () => {
  setCloudStorageForTests(createInMemoryCloudStorage());
  await configureSession();
});

afterEach(() => {
  resetCloudStorageForTests();
  clearSessionConfig();
});

// ---------------------------------------------------------------------------
// Authz: 401 unauthenticated on EVERY protected route (brief F, explicit)
// ---------------------------------------------------------------------------

describe("authz — 401 without a session cookie, on every protected route", () => {
  it("GET /api/cloud/project", async () => {
    const res = await projectGet(req("/api/cloud/project"));
    expect(res.status).toBe(401);
  });

  it("PUT /api/cloud/project", async () => {
    const res = await projectPut(
      req("/api/cloud/project", { method: "PUT", body: { baseRevision: 0, project: { code: "", sheets: {}, assets: [] } } }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/cloud/assets/presign", async () => {
    const res = await presignPost(
      req("/api/cloud/assets/presign", { method: "POST", body: { name: "dragon", mime: "image/png", size: 10 } }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/cloud/assets/[name]", async () => {
    const res = await assetGet(req("/api/cloud/assets/dragon"), { params: Promise.resolve({ name: "dragon" }) });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/cloud/assets/[name]", async () => {
    const res = await assetDelete(req("/api/cloud/assets/dragon", { method: "DELETE" }), {
      params: Promise.resolve({ name: "dragon" }),
    });
    expect(res.status).toBe(401);
  });

  it("a garbage/tampered cookie is also 401, not a 500", async () => {
    const res = await projectGet(req("/api/cloud/project", { cookie: `${SESSION_COOKIE_NAME}=garbage` }));
    expect(res.status).toBe(401);
  });

  it("an EXPIRED session cookie is 401", async () => {
    const longAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const expired = createSessionCookieValue(process.env.SESSION_SECRET!, longAgo);
    const res = await projectGet(req("/api/cloud/project", { cookie: `${SESSION_COOKIE_NAME}=${expired}` }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Unconfigured env → clean 503 everywhere (brief A/F)
// ---------------------------------------------------------------------------

describe("unconfigured — a clean 503, never a crash or a stack trace", () => {
  it("login, with no ADMIN_PASSWORD_HASH/SESSION_SECRET set", async () => {
    clearSessionConfig();
    const res = await loginPost(req("/api/cloud/login", { method: "POST", body: { username: "x", password: "x" } }));
    expect(res.status).toBe(503);
    expect((await json(res) as { error: string }).error).toMatch(/configured/i);
  });

  it("login, with SESSION_SECRET/ADMIN_USERNAME set but ADMIN_PASSWORD_HASH unparseable (TASK 2): a DISTINCT 503, not the generic 'not configured' one", async () => {
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    // The exact dotenv-mangled shape (session.test.ts's fixture) — present,
    // but not a hash `parseStoredHash` can read.
    process.env.ADMIN_PASSWORD_HASH = "scrypt31072DB04C5G5r81KlmRt5brOAueGFOewWVkIc9K";
    const res = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: DEFAULT_ADMIN_USERNAME, password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(503);
    const body = (await json(res)) as { error: string };
    expect(body.error).toMatch(/unreadable/i);
    expect(body.error).not.toMatch(/configured/i); // distinct wording from CLOUD_UNCONFIGURED_MESSAGE
    // Never any part of the actual (mangled) hash text.
    expect(body.error).not.toContain("DB04C_5G5r81KlmRt5brOA");
  });

  it("logout still succeeds even unconfigured (nothing to clean up)", async () => {
    clearSessionConfig();
    const res = await logoutPost();
    expect(res.status).toBe(200);
  });

  it("project GET/PUT: session configured but R2 storage is not", async () => {
    setCloudStorageForTests(null);
    expect((await projectGet(req("/api/cloud/project", { signedIn: true }))).status).toBe(503);
    expect(
      (
        await projectPut(
          req("/api/cloud/project", {
            method: "PUT",
            signedIn: true,
            body: { baseRevision: 0, project: { code: "", sheets: {}, assets: [] } },
          }),
        )
      ).status,
    ).toBe(503);
  });

  it("project GET/PUT: SESSION env not set — 503, not 401 (auth itself is what's unconfigured)", async () => {
    clearSessionConfig();
    // requireSession checks whether auth CAN be evaluated at all before it
    // ever looks for a cookie — with no SESSION_SECRET/ADMIN_PASSWORD_HASH
    // there is no way to verify anything, so this is the SAME "cloud not
    // configured" 503 brief A describes for R2, not a 401 (a 401 would
    // wrongly suggest "sign in again" to an operator who hasn't deployed
    // the env vars yet).
    const res = await projectGet(req("/api/cloud/project"));
    expect(res.status).toBe(503);
  });

  it("presign: R2 not configured", async () => {
    setCloudStorageForTests(null);
    const res = await presignPost(
      req("/api/cloud/assets/presign", {
        method: "POST",
        signedIn: true,
        body: { name: "dragon", mime: "image/png", size: 10 },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("asset GET/DELETE: R2 not configured", async () => {
    setCloudStorageForTests(null);
    expect(
      (await assetGet(req("/api/cloud/assets/dragon", { signedIn: true }), { params: Promise.resolve({ name: "dragon" }) }))
        .status,
    ).toBe(503);
    expect(
      (
        await assetDelete(req("/api/cloud/assets/dragon", { method: "DELETE", signedIn: true }), {
          params: Promise.resolve({ name: "dragon" }),
        })
      ).status,
    ).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe("POST /api/cloud/login", () => {
  it("the correct username + password: 200 + a session cookie", async () => {
    const res = await loginPost(
      req("/api/cloud/login", {
        method: "POST",
        body: { username: DEFAULT_ADMIN_USERNAME, password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("the wrong password (right username): 401, a GENERIC message (doesn't hint at what's wrong)", async () => {
    const res = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: DEFAULT_ADMIN_USERNAME, password: "nope" } }),
    );
    expect(res.status).toBe(401);
    const body = (await json(res)) as { error: string };
    expect(body.error).not.toMatch(/scrypt|hash|salt/i);
    expect(body.error).toBe(LOGIN_GENERIC_FAILURE_MESSAGE);
  });

  it("a malformed body (no username/password fields) fails the SAME way as wrong credentials", async () => {
    const res = await loginPost(req("/api/cloud/login", { method: "POST", body: { nope: "field" } }));
    expect(res.status).toBe(401);
  });

  it("an unparsable JSON body fails the same way too, not a 500", async () => {
    const request = new NextRequest(`${BASE}/api/cloud/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await loginPost(request);
    expect(res.status).toBe(401);
  });

  it(
    "a wrong password waits out the fixed delay before responding (brute-force throttle)",
    async () => {
      // REAL timers deliberately (not vi.useFakeTimers): the route's delay
      // sits AFTER `verifyPassword`, which runs Node's genuinely-native-async
      // `crypto.scrypt` — the same category of timer/native-async mismatch
      // session.test.ts's crypto probe found with WebCrypto's digest()
      // (fake timers can't "advance past" a real worker-thread computation
      // that hasn't started yet). Measuring real elapsed wall-clock time is
      // the honest way to pin this, at the cost of the test itself taking
      // ~500 ms.
      const start = Date.now();
      const res = await loginPost(
        req("/api/cloud/login", { method: "POST", body: { username: DEFAULT_ADMIN_USERNAME, password: "nope" } }),
      );
      const elapsedMs = Date.now() - start;
      expect(res.status).toBe(401);
      // A little under 500 to absorb scheduler jitter/rounding — setTimeout
      // is a "no sooner than" guarantee, so this is comfortably safe.
      expect(elapsedMs).toBeGreaterThanOrEqual(450);
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// TASK 4: username + password — wrong-username, wrong-password, and
// both-wrong must be INDISTINGUISHABLE (status, message, AND timing).
// ---------------------------------------------------------------------------

describe("TASK 4: wrong-username, wrong-password, and both-wrong are indistinguishable", () => {
  const WRONG_CASES: [label: string, username: string, password: string][] = [
    ["wrong username only", "not-the-admin", TEST_PASSWORD],
    ["wrong password only", DEFAULT_ADMIN_USERNAME, "not-the-password"],
    ["both wrong", "not-the-admin", "not-the-password"],
  ];

  it("all three produce the exact SAME status and SAME response body", async () => {
    const outcomes = await Promise.all(
      WRONG_CASES.map(async ([, username, password]) => {
        const res = await loginPost(req("/api/cloud/login", { method: "POST", body: { username, password } }));
        return { status: res.status, body: (await json(res)) as { error: string } };
      }),
    );
    for (const outcome of outcomes) {
      expect(outcome.status).toBe(401);
      expect(outcome.body).toEqual({ error: LOGIN_GENERIC_FAILURE_MESSAGE });
    }
  });

  for (const [label, username, password] of WRONG_CASES) {
    it(
      `${label}: also waits out the FULL fixed delay — no early return skips it`,
      async () => {
        // Same real-timer rationale as the "wrong password" delay test
        // above: verifyPassword's native scrypt derivation can't be
        // fast-forwarded with fake timers.
        const start = Date.now();
        const res = await loginPost(req("/api/cloud/login", { method: "POST", body: { username, password } }));
        const elapsedMs = Date.now() - start;
        expect(res.status).toBe(401);
        expect(elapsedMs).toBeGreaterThanOrEqual(450);
      },
      10_000,
    );
  }
});

// ---------------------------------------------------------------------------
// TASK 4: ADMIN_USERNAME — optional env var, defaults to "admin"
// ---------------------------------------------------------------------------

describe("ADMIN_USERNAME", () => {
  it('defaults to "admin" when unset (already exercised by "the correct username + password" above; pinned here explicitly)', async () => {
    const res = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: "admin", password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(200);
  });

  it("once a custom ADMIN_USERNAME is set, the default \"admin\" no longer works and the custom one does", async () => {
    await configureSession({ username: "eduxx" });
    const withDefault = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: "admin", password: TEST_PASSWORD } }),
    );
    expect(withDefault.status).toBe(401);
    const withCustom = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: "eduxx", password: TEST_PASSWORD } }),
    );
    expect(withCustom.status).toBe(200);
  });

  it("ADMIN_USERNAME is trimmed, same rule as the other env vars", async () => {
    await configureSession({ username: "  eduxx  " });
    const res = await loginPost(
      req("/api/cloud/login", { method: "POST", body: { username: "eduxx", password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// TASK 2a: structured server-side logging, one reason-coded line per attempt
// ---------------------------------------------------------------------------

describe("cloud-login structured logging (TASK 2a): one reason-coded line per attempt, never a secret", () => {
  it('logs "cloud-login: reason=ok" on success', async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await loginPost(
        req("/api/cloud/login", { method: "POST", body: { username: DEFAULT_ADMIN_USERNAME, password: TEST_PASSWORD } }),
      );
      expect(logSpy).toHaveBeenCalledWith("cloud-login: reason=ok");
    } finally {
      logSpy.mockRestore();
    }
  });

  it(
    'logs the right reason code for each failure branch, and NEVER the username/password/hash values',
    async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await loginPost(
          req("/api/cloud/login", {
            method: "POST",
            body: { username: "someone-else", password: TEST_PASSWORD },
          }),
        );
        expect(warnSpy).toHaveBeenLastCalledWith("cloud-login: reason=username-mismatch");

        await loginPost(
          req("/api/cloud/login", {
            method: "POST",
            body: { username: DEFAULT_ADMIN_USERNAME, password: "a wrong password" },
          }),
        );
        expect(warnSpy).toHaveBeenLastCalledWith("cloud-login: reason=password-mismatch");

        clearSessionConfig();
        await loginPost(req("/api/cloud/login", { method: "POST", body: { username: "x", password: "y" } }));
        expect(warnSpy).toHaveBeenLastCalledWith("cloud-login: reason=no-env");

        await configureSession();
        process.env.ADMIN_PASSWORD_HASH = "scrypt31072DB04C5G5r81KlmRt5brOAueGFOewWVkIc9K"; // dotenv-mangled shape
        await loginPost(req("/api/cloud/login", { method: "POST", body: { username: "x", password: "y" } }));
        expect(warnSpy).toHaveBeenLastCalledWith("cloud-login: reason=hash-unparseable");

        // Not once, across every call above, did a log line carry any part
        // of a credential or the hash — only the reason code.
        const allLoggedText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
        expect(allLoggedText).not.toContain(TEST_PASSWORD);
        expect(allLoggedText).not.toContain("someone-else");
        expect(allLoggedText).not.toContain("a wrong password");
        expect(allLoggedText).not.toContain(DEFAULT_ADMIN_USERNAME);
        expect(allLoggedText).not.toContain("DB04C_5G5r81KlmRt5brOA");
        for (const call of warnSpy.mock.calls) {
          expect(call).toHaveLength(1); // exactly one string arg, nothing appended
          expect(call[0]).toMatch(/^cloud-login: reason=(no-env|hash-unparseable|username-mismatch|password-mismatch)$/);
        }
      } finally {
        warnSpy.mockRestore();
      }
    },
    10_000, // two of the calls above pay the real 500 ms credential-failure delay
  );
});

// ---------------------------------------------------------------------------
// TASK 2b: GET /api/cloud/diagnose
// ---------------------------------------------------------------------------

describe("GET /api/cloud/diagnose", () => {
  const R2_VARS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

  afterEach(() => {
    for (const key of R2_VARS) delete process.env[key];
  });

  it("is reachable with NO session cookie at all — deliberately unauthenticated", async () => {
    clearSessionConfig();
    const res = await diagnoseGet();
    expect(res.status).toBe(200);
  });

  it("a fully healthy config: every summary and detail bool true, hash parses as the new dot format", async () => {
    for (const key of R2_VARS) process.env[key] = "some-value";
    process.env.ADMIN_USERNAME = "eduxx";
    const res = await diagnoseGet();
    expect(await json(res)).toEqual({
      configured: { r2: true, session: true, admin: true },
      adminHash: { present: true, parses: true, algorithm: "scrypt", looksDotenvMangled: false, problem: null },
      sessionSecret: { present: true, meetsMinimumLength: true },
      r2: { accountId: true, accessKeyId: true, secretAccessKey: true, bucket: true },
    });
  });

  it("nothing configured at all: every bool false, every detail null", async () => {
    clearSessionConfig();
    const res = await diagnoseGet();
    expect(await json(res)).toEqual({
      configured: { r2: false, session: false, admin: false },
      adminHash: { present: false, parses: false, algorithm: null, looksDotenvMangled: false, problem: null },
      sessionSecret: { present: false, meetsMinimumLength: false },
      r2: { accountId: false, accessKeyId: false, secretAccessKey: false, bucket: false },
    });
  });

  it("a dotenv-mangled hash is named specifically (TASK 2's whole point) rather than just 'doesn't parse'", async () => {
    process.env.ADMIN_PASSWORD_HASH = "scrypt31072DB04C5G5r81KlmRt5brOAueGFOewWVkIc9K";
    const res = await diagnoseGet();
    const body = (await json(res)) as { adminHash: unknown; configured: { admin: boolean } };
    expect(body.adminHash).toEqual({
      present: true,
      parses: false,
      algorithm: null,
      looksDotenvMangled: true,
      problem: "dotenv-mangled",
    });
    expect(body.configured.admin).toBe(false);
  });

  it("a legacy $-separated hash still reports parses:true (TASK 1's no-broken-window guarantee, visible in diagnostics — without disclosing WHICH separator, which would date the operator's last rotation)", async () => {
    process.env.ADMIN_PASSWORD_HASH = (await hashPassword(TEST_PASSWORD)).replaceAll(".", "$");
    const res = await diagnoseGet();
    const body = (await json(res)) as { adminHash: unknown };
    expect(body.adminHash).toEqual({
      present: true,
      parses: true,
      algorithm: "scrypt",
      looksDotenvMangled: false,
      problem: null,
    });
  });

  it("a SESSION_SECRET present but under the minimum length: present true, meetsMinimumLength false, configured.session false", async () => {
    process.env.SESSION_SECRET = "too-short";
    const res = await diagnoseGet();
    const body = (await json(res)) as { sessionSecret: unknown; configured: { session: boolean } };
    expect(body.sessionSecret).toEqual({ present: true, meetsMinimumLength: false });
    expect(body.configured.session).toBe(false);
  });

  it("partial R2 config: each of the four vars reported independently, never collapsed to one bool", async () => {
    process.env.R2_ACCOUNT_ID = "some-account-id";
    process.env.R2_BUCKET = "some-bucket";
    const res = await diagnoseGet();
    const body = (await json(res)) as { r2: unknown; configured: { r2: boolean } };
    expect(body.r2).toEqual({ accountId: true, accessKeyId: false, secretAccessKey: false, bucket: true });
    expect(body.configured.r2).toBe(false);
  });

  it("never leaks a secret VALUE anywhere in the payload — only booleans/enums, exactly as documented", async () => {
    process.env.R2_ACCOUNT_ID = "super-secret-account-id-value";
    process.env.R2_ACCESS_KEY_ID = "super-secret-key-id-value";
    process.env.R2_SECRET_ACCESS_KEY = "super-secret-access-key-value";
    process.env.R2_BUCKET = "super-secret-bucket-value";
    process.env.ADMIN_USERNAME = "super-secret-username-value";
    const res = await diagnoseGet();
    const text = JSON.stringify(await json(res));
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain(TEST_SESSION_SECRET);
    expect(text).not.toContain(TEST_PASSWORD);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe("POST /api/cloud/logout", () => {
  it("always 200 and clears the cookie, even with no cookie sent", async () => {
    const res = await logoutPost();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
  });
});

// ---------------------------------------------------------------------------
// Project GET/PUT — payload validation + the revision guard
// ---------------------------------------------------------------------------

describe("GET /api/cloud/project", () => {
  it("nothing stored yet: 404", async () => {
    const res = await projectGet(req("/api/cloud/project", { signedIn: true }));
    expect(res.status).toBe(404);
  });

  it("something stored: 200 with revision + project", async () => {
    await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "hello", sheets: {}, assets: [] } },
      }),
    );
    const res = await projectGet(req("/api/cloud/project", { signedIn: true }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ revision: 1, project: { code: "hello", sheets: {}, assets: [] } });
  });
});

describe("PUT /api/cloud/project — payload validation (brief C: rejected whole, never partial)", () => {
  const putWith = (body: unknown) =>
    projectPut(req("/api/cloud/project", { method: "PUT", signedIn: true, body }));

  it("missing baseRevision: 400", async () => {
    expect((await putWith({ project: { code: "", sheets: {}, assets: [] } })).status).toBe(400);
  });

  it("negative/non-integer baseRevision: 400", async () => {
    expect((await putWith({ baseRevision: -1, project: { code: "", sheets: {}, assets: [] } })).status).toBe(400);
    expect((await putWith({ baseRevision: 1.5, project: { code: "", sheets: {}, assets: [] } })).status).toBe(400);
  });

  it("code not a string: 400", async () => {
    expect((await putWith({ baseRevision: 0, project: { code: 5, sheets: {}, assets: [] } })).status).toBe(400);
  });

  it("sheets malformed (rows not an array — the SAME rule parseSheetsPayload has always applied): 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: { code: "", sheets: { S: { rows: "not-an-array", editedRows: [] } }, assets: [] },
        })
      ).status,
    ).toBe(400);
  });

  it("a non-string cell value inside sheets: 400 (same strictness as import)", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: { code: "", sheets: { S: { rows: [{ a: 5 }], editedRows: [true] } }, assets: [] },
        })
      ).status,
    ).toBe(400);
  });

  it("asset with an invalid name: 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: { code: "", sheets: {}, assets: [{ name: "bad name!", mime: "image/png", size: 1, hash: "ab" }] },
        })
      ).status,
    ).toBe(400);
  });

  it("asset with a non-image mime: 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: { code: "", sheets: {}, assets: [{ name: "dragon", mime: "text/html", size: 1, hash: "ab" }] },
        })
      ).status,
    ).toBe(400);
  });

  it("asset with the SVG mime used by the local asset library: accepted", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: {
            code: "",
            sheets: {},
            assets: [{ name: "energy_frame", mime: "image/svg+xml", size: 488, hash: "ab" }],
          },
        })
      ).status,
    ).toBe(200);
  });

  it("asset over the size cap: 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: {
            code: "",
            sheets: {},
            assets: [{ name: "dragon", mime: "image/png", size: 3 * 1024 * 1024, hash: "ab" }],
          },
        })
      ).status,
    ).toBe(400);
  });

  it("asset with a non-hex hash: 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: { code: "", sheets: {}, assets: [{ name: "dragon", mime: "image/png", size: 1, hash: "not-hex!" }] },
        })
      ).status,
    ).toBe(400);
  });

  it("a duplicate asset name in the manifest: 400", async () => {
    expect(
      (
        await putWith({
          baseRevision: 0,
          project: {
            code: "",
            sheets: {},
            assets: [
              { name: "dragon", mime: "image/png", size: 1, hash: "ab" },
              { name: "dragon", mime: "image/png", size: 2, hash: "cd" },
            ],
          },
        })
      ).status,
    ).toBe(400);
  });

  it("unparsable JSON body: 400, not a 500", async () => {
    const request = new NextRequest(`${BASE}/api/cloud/project`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: sessionCookieHeader() },
      body: "{not json",
    });
    expect((await projectPut(request)).status).toBe(400);
  });

  it("a fully valid payload is accepted (contrast case — the rules above aren't rejecting everything)", async () => {
    const res = await putWith({
      baseRevision: 0,
      project: {
        code: "Sheet: S\n  column a: Text\n",
        sheets: { S: { rows: [{ a: "1" }], editedRows: [true] } },
        assets: [{ name: "dragon", mime: "image/png", size: 100, hash: "abcd1234" }],
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/cloud/project — the revision guard", () => {
  it("baseRevision matches (0, nothing stored yet): writes, returns revision 1", async () => {
    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "v1", sheets: {}, assets: [] } },
      }),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ revision: 1 });
  });

  it("an R2 rejection returns only its safe operation/status/code diagnostic", async () => {
    const real = createInMemoryCloudStorage();
    const failing: CloudStorage = {
      ...real,
      async putObject() {
        throw new CloudStorageError("contains projects/default/project.json and private provider detail", {
          operation: "PUT",
          status: 411,
          code: "MissingContentLength",
        });
      },
    };
    setCloudStorageForTests(failing);
    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "v1", sheets: {}, assets: [] } },
      }),
    );
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ error: "Cloud storage error (R2 PUT 411 MissingContentLength)." });
  });

  it("baseRevision matches the CURRENT (non-zero) revision: writes again, increments", async () => {
    await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "v1", sheets: {}, assets: [] } },
      }),
    );
    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 1, project: { code: "v2", sheets: {}, assets: [] } },
      }),
    );
    expect(await json(res)).toEqual({ revision: 2 });
  });

  it("baseRevision stale: 409 + the CURRENT revision, and the write is REJECTED (not applied)", async () => {
    await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "v1", sheets: {}, assets: [] } },
      }),
    );
    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "SHOULD NOT LAND", sheets: {}, assets: [] } },
      }),
    );
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "revision-conflict", revision: 1 });
    const stored = await projectGet(req("/api/cloud/project", { signedIn: true }));
    expect((await json(stored) as { project: { code: string } }).project.code).toBe("v1"); // untouched
  });

  it("PUTting against a project that was never created (baseRevision > 0, nothing stored): 409 with revision 0", async () => {
    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 5, project: { code: "x", sheets: {}, assets: [] } },
      }),
    );
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "revision-conflict", revision: 0 });
  });

  it("SIMULATED CONCURRENT WRITE: a write lands between this request's read and its own write — the conditional PUT (not just the revision pre-check) is what stops it", async () => {
    // Wrap the fake storage so the FIRST putObject call (the route's own)
    // is preceded by a "sneaky" concurrent write to the SAME key — modeling
    // another request's PUT landing in the gap between this request's
    // getObject (read) and putObject (write). Both attempts race for the
    // same "the object must not yet exist" (ifMatch="") precondition.
    const real = createInMemoryCloudStorage();
    let sneakSent = false;
    const racy: CloudStorage = {
      ...real,
      async putObject(key, bytes, mime, ifMatch) {
        if (!sneakSent && key === PROJECT_KEY) {
          sneakSent = true;
          await real.putObject(
            PROJECT_KEY,
            new TextEncoder().encode(JSON.stringify({ revision: 1, code: "WON THE RACE", sheets: {}, assets: [] })),
            "application/json",
            "",
          );
        }
        return real.putObject(key, bytes, mime, ifMatch);
      },
    };
    setCloudStorageForTests(racy);

    const res = await projectPut(
      req("/api/cloud/project", {
        method: "PUT",
        signedIn: true,
        body: { baseRevision: 0, project: { code: "LOST THE RACE", sheets: {}, assets: [] } },
      }),
    );
    // This request read revision 0 (nothing stored) and passed the semantic
    // check — but by the time its OWN conditional write executed, the sneak
    // write had already created the object. The conditional PUT (not the
    // pre-check) is what catches this: it must 409, reporting the WINNER's
    // revision, never silently overwrite it.
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "revision-conflict", revision: 1 });
    const stored = await real.getObject(PROJECT_KEY);
    const parsed = JSON.parse(new TextDecoder().decode(stored!.bytes)) as { code: string };
    expect(parsed.code).toBe("WON THE RACE"); // the loser never landed
  });
});

// ---------------------------------------------------------------------------
// Presign PUT — never trust the client (brief C)
// ---------------------------------------------------------------------------

describe("POST /api/cloud/assets/presign", () => {
  const presign = (body: unknown) =>
    presignPost(req("/api/cloud/assets/presign", { method: "POST", signedIn: true, body }));

  it("a valid request: 200 with a URL", async () => {
    const res = await presign({ name: "dragon", mime: "image/png", size: 1024 });
    expect(res.status).toBe(200);
    expect(typeof (await json(res) as { url: string }).url).toBe("string");
  });

  it("an SVG request: 200 with a URL (existing local SVG projects can sync)", async () => {
    const res = await presign({ name: "energy_frame", mime: "image/svg+xml", size: 488 });
    expect(res.status).toBe(200);
    expect(typeof (await json(res) as { url: string }).url).toBe("string");
  });

  it("an invalid asset name: 400", async () => {
    expect((await presign({ name: "not valid!", mime: "image/png", size: 10 })).status).toBe(400);
    expect((await presign({ name: "1starts-with-digit", mime: "image/png", size: 10 })).status).toBe(400);
  });

  it("a non-image mime: 400", async () => {
    expect((await presign({ name: "dragon", mime: "application/pdf", size: 10 })).status).toBe(400);
    expect((await presign({ name: "dragon", mime: "text/html", size: 10 })).status).toBe(400);
  });

  it("size zero, negative, non-numeric, or over the 2 MB cap: 400", async () => {
    expect((await presign({ name: "dragon", mime: "image/png", size: 0 })).status).toBe(400);
    expect((await presign({ name: "dragon", mime: "image/png", size: -5 })).status).toBe(400);
    expect((await presign({ name: "dragon", mime: "image/png", size: "big" })).status).toBe(400);
    expect((await presign({ name: "dragon", mime: "image/png", size: 3 * 1024 * 1024 })).status).toBe(400);
  });

  it("missing fields entirely: 400, not a 500", async () => {
    expect((await presign({})).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Asset [name] GET/DELETE
// ---------------------------------------------------------------------------

describe("GET /api/cloud/assets/[name]", () => {
  it("valid name: 200 with a URL", async () => {
    const res = await assetGet(req("/api/cloud/assets/dragon", { signedIn: true }), {
      params: Promise.resolve({ name: "dragon" }),
    });
    expect(res.status).toBe(200);
    expect(typeof (await json(res) as { url: string }).url).toBe("string");
  });

  it("invalid name: 400", async () => {
    const res = await assetGet(req("/api/cloud/assets/bad name", { signedIn: true }), {
      params: Promise.resolve({ name: "bad name" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/cloud/assets/[name]", () => {
  it("valid name: 200, idempotent even if nothing was ever uploaded", async () => {
    const res = await assetDelete(req("/api/cloud/assets/dragon", { method: "DELETE", signedIn: true }), {
      params: Promise.resolve({ name: "dragon" }),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });

  it("invalid name: 400", async () => {
    const res = await assetDelete(req("/api/cloud/assets/bad name", { method: "DELETE", signedIn: true }), {
      params: Promise.resolve({ name: "bad name" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("the wrong-username path still pays for scrypt (review: an early skip is a timing oracle)", () => {
  // Mutating the route to `usernameOk ? await verifyPassword(...) : false`
  // passed the whole suite while creating a 227ms, 30/30-separable username
  // oracle: the existing delay assertions can't see it because the fixed
  // 500ms delay is longer than scrypt's ~200ms. This pin self-calibrates —
  // it measures scrypt on THIS machine, then requires the wrong-username
  // login to have spent a meaningful share of it.
  it("a wrong username costs the delay PLUS real password work", async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    process.env.ADMIN_PASSWORD_HASH = hash;

    const t0 = performance.now();
    await verifyPassword(TEST_PASSWORD, hash);
    const scryptMs = performance.now() - t0;

    const t1 = performance.now();
    await loginPost(
      req("/api/cloud/login", {
        method: "POST",
        body: { username: "definitely-not-the-admin", password: TEST_PASSWORD },
      }),
    );
    const loginMs = performance.now() - t1;

    // Half of one scrypt above the fixed delay: generous enough for a noisy
    // CI box, far below the ~500ms a scrypt-skipping route would return in.
    // FAILURE_DELAY_MS is private to the route; 500 is its documented value.
    expect(loginMs).toBeGreaterThan(500 + scryptMs * 0.5);
  }, 20_000);
});

describe("logout clears a __Host- cookie (which browsers reject without Path=/)", () => {
  it("sets Path=/ — a narrower path would silently fail to clear the session", async () => {
    const res = await logoutPost();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(SESSION_COOKIE_NAME);
  });
});
