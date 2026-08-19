/**
 * auth.ts's own exports, directly (DESIGN.md §7.6) — previously exercised
 * only indirectly through routes.test.ts's route-level assertions. Covers
 * `loadSessionEnvFromProcess`'s new minimum-secret-length gate (M3,
 * independent security review) and `ADMIN_USERNAME` handling (TASK 4), the
 * `__Host-` cookie name (L7), and `extractCredentials`'s body-shape parsing
 * (TASK 4: now `{username, password}`, not just `{password}`).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_USERNAME,
  MIN_SESSION_SECRET_BYTES,
  SESSION_COOKIE_NAME,
  extractCredentials,
  loadSessionEnvFromProcess,
  sessionSecretByteLength,
} from "../auth";

const LONG_SECRET = "a".repeat(32); // exactly the floor
const HASH = "scrypt.16384.8.1.c2FsdA.aGFzaA"; // shape-valid; value irrelevant here

describe("loadSessionEnvFromProcess", () => {
  it("both present and long enough, no ADMIN_USERNAME set: a SessionEnv defaulting the username", () => {
    expect(loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET, ADMIN_PASSWORD_HASH: HASH })).toEqual({
      sessionSecret: LONG_SECRET,
      adminPasswordHash: HASH,
      adminUsername: DEFAULT_ADMIN_USERNAME,
    });
  });

  it("no env at all: null", () => {
    expect(loadSessionEnvFromProcess({})).toBeNull();
  });

  it("SESSION_SECRET missing: null", () => {
    expect(loadSessionEnvFromProcess({ ADMIN_PASSWORD_HASH: HASH })).toBeNull();
  });

  it("ADMIN_PASSWORD_HASH missing: null", () => {
    expect(loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET })).toBeNull();
  });

  it("SESSION_SECRET blank/whitespace-only: null", () => {
    expect(loadSessionEnvFromProcess({ SESSION_SECRET: "   ", ADMIN_PASSWORD_HASH: HASH })).toBeNull();
  });

  describe("M3: SESSION_SECRET shorter than 32 bytes fails closed (not configured)", () => {
    it("a 1-character secret: null — the exact hole the review found", () => {
      expect(loadSessionEnvFromProcess({ SESSION_SECRET: "x", ADMIN_PASSWORD_HASH: HASH })).toBeNull();
    });

    it("31 bytes (one short of the floor): null", () => {
      const secret = "a".repeat(31);
      expect(loadSessionEnvFromProcess({ SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: HASH })).toBeNull();
    });

    it("exactly 32 bytes: accepted", () => {
      expect(LONG_SECRET.length).toBe(32);
      expect(loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET, ADMIN_PASSWORD_HASH: HASH })).not.toBeNull();
    });

    it("measures UTF-8 BYTES, not JS string .length — a 32-char secret full of multi-byte characters is still accepted (it has MORE than 32 bytes)", () => {
      const secret = "é".repeat(32); // 1 UTF-16 code unit each, 2 UTF-8 bytes each = 64 bytes
      expect(secret.length).toBe(32);
      expect(loadSessionEnvFromProcess({ SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: HASH })).not.toBeNull();
    });

    it("a short secret padded with trimmed whitespace still fails (trim happens before the length check)", () => {
      const secret = `  ${"a".repeat(10)}  `; // 10 real chars, padded
      expect(loadSessionEnvFromProcess({ SESSION_SECRET: secret, ADMIN_PASSWORD_HASH: HASH })).toBeNull();
    });
  });

  describe("TASK 4: ADMIN_USERNAME — optional, defaults to \"admin\", never gates configured-ness", () => {
    it("unset: adminUsername is DEFAULT_ADMIN_USERNAME, and this alone doesn't 503", () => {
      const env = loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET, ADMIN_PASSWORD_HASH: HASH });
      expect(env?.adminUsername).toBe(DEFAULT_ADMIN_USERNAME);
      expect(DEFAULT_ADMIN_USERNAME).toBe("admin");
    });

    it("blank/whitespace-only: treated the same as unset (falls back to the default)", () => {
      const env = loadSessionEnvFromProcess({
        SESSION_SECRET: LONG_SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        ADMIN_USERNAME: "   ",
      });
      expect(env?.adminUsername).toBe(DEFAULT_ADMIN_USERNAME);
    });

    it("a custom value is used verbatim, trimmed", () => {
      const env = loadSessionEnvFromProcess({
        SESSION_SECRET: LONG_SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        ADMIN_USERNAME: "  eduxx  ",
      });
      expect(env?.adminUsername).toBe("eduxx");
    });

    it("is never itself a reason SESSION_SECRET/ADMIN_PASSWORD_HASH-configured returns null", () => {
      // Already implied by the "unset" case above (env is non-null there),
      // but pinned explicitly: an operator who set every OTHER var correctly
      // and simply never touched ADMIN_USERNAME must still get a working
      // (default-username) deployment, not a 503.
      expect(
        loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET, ADMIN_PASSWORD_HASH: HASH, ADMIN_USERNAME: "" }),
      ).not.toBeNull();
    });
  });
});

describe("SESSION_COOKIE_NAME (L7: the __Host- prefix)", () => {
  it("carries the __Host- prefix", () => {
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });
});

describe("sessionSecretByteLength / MIN_SESSION_SECRET_BYTES (exported for GET /api/cloud/diagnose)", () => {
  it("MIN_SESSION_SECRET_BYTES is 32 — the SAME floor loadSessionEnvFromProcess enforces above", () => {
    expect(MIN_SESSION_SECRET_BYTES).toBe(32);
  });

  it("measures UTF-8 bytes, not JS .length (matches the M3 describe block above)", () => {
    expect(sessionSecretByteLength("a".repeat(32))).toBe(32);
    expect(sessionSecretByteLength("é".repeat(32))).toBe(64);
  });
});

describe("extractCredentials (TASK 4: {username, password}, not just {password})", () => {
  it("returns both fields from a well-formed body", () => {
    expect(extractCredentials({ username: "eduxx", password: "hunter2" })).toEqual({
      username: "eduxx",
      password: "hunter2",
    });
  });

  it("each field independently falls back to '' when absent or non-string", () => {
    expect(extractCredentials(null)).toEqual({ username: "", password: "" });
    expect(extractCredentials(undefined)).toEqual({ username: "", password: "" });
    expect(extractCredentials("a string")).toEqual({ username: "", password: "" });
    expect(extractCredentials(42)).toEqual({ username: "", password: "" });
    expect(extractCredentials([])).toEqual({ username: "", password: "" });
    expect(extractCredentials({})).toEqual({ username: "", password: "" });
    expect(extractCredentials({ username: 5, password: 5 })).toEqual({ username: "", password: "" });
    expect(extractCredentials({ usrname: "typo", passwrod: "typo" })).toEqual({ username: "", password: "" });
  });

  it("only one field present: the other still falls back to '' (not a whole-body reject)", () => {
    expect(extractCredentials({ username: "eduxx" })).toEqual({ username: "eduxx", password: "" });
    expect(extractCredentials({ password: "hunter2" })).toEqual({ username: "", password: "hunter2" });
  });

  it("an empty-string value is returned as-is (not coerced to the '' sentinel path differently)", () => {
    expect(extractCredentials({ username: "", password: "" })).toEqual({ username: "", password: "" });
  });

  it("neither field is trimmed — exact, case-sensitive matching", () => {
    expect(extractCredentials({ username: " eduxx ", password: " hunter2 " })).toEqual({
      username: " eduxx ",
      password: " hunter2 ",
    });
  });
});
