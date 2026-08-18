/**
 * auth.ts's own exports, directly (DESIGN.md §7.6) — previously exercised
 * only indirectly through routes.test.ts's route-level assertions. Covers
 * `loadSessionEnvFromProcess`'s new minimum-secret-length gate (M3,
 * independent security review), the `__Host-` cookie name (L7), and
 * `extractPassword`'s body-shape parsing.
 */
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  extractPassword,
  loadSessionEnvFromProcess,
} from "../auth";

const LONG_SECRET = "a".repeat(32); // exactly the floor
const HASH = "scrypt$16384$8$1$c2FsdA$aGFzaA"; // shape-valid; value irrelevant here

describe("loadSessionEnvFromProcess", () => {
  it("both present and long enough: a SessionEnv", () => {
    expect(loadSessionEnvFromProcess({ SESSION_SECRET: LONG_SECRET, ADMIN_PASSWORD_HASH: HASH })).toEqual({
      sessionSecret: LONG_SECRET,
      adminPasswordHash: HASH,
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
});

describe("SESSION_COOKIE_NAME (L7: the __Host- prefix)", () => {
  it("carries the __Host- prefix", () => {
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });
});

describe("extractPassword", () => {
  it("returns the password from a well-formed body", () => {
    expect(extractPassword({ password: "hunter2" })).toBe("hunter2");
  });

  it("returns '' for anything that isn't {password: string}", () => {
    expect(extractPassword(null)).toBe("");
    expect(extractPassword(undefined)).toBe("");
    expect(extractPassword("a string")).toBe("");
    expect(extractPassword(42)).toBe("");
    expect(extractPassword([])).toBe("");
    expect(extractPassword({})).toBe("");
    expect(extractPassword({ password: 12345 })).toBe("");
    expect(extractPassword({ passwrod: "typo" })).toBe("");
  });

  it("an empty-string password is returned as-is (not coerced to the '' sentinel path differently)", () => {
    expect(extractPassword({ password: "" })).toBe("");
  });
});
