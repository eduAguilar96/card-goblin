/**
 * `verifyPassword`'s scrypt-throws fallback (M1, independent security
 * review): a SEPARATE file from session.test.ts on purpose — `vi.mock`
 * applies module-wide for every test in a file, and the rest of this
 * module's tests need REAL scrypt to hash/verify real passwords. This file
 * exists only to force the one failure `parseStoredHash`'s own checks can't
 * anticipate (some Node/environment-specific scrypt failure unrelated to
 * N/r/p shape) and confirm `verifyPassword` still resolves `false` rather
 * than rejecting — a throw here would 500 the login route AND skip its
 * fixed failure delay, a misconfiguration oracle (session.ts's doc comment
 * on `verifyPassword`).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    scrypt: (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(new Error("forced scrypt failure (test double)"));
    },
  };
});

describe("verifyPassword when scrypt itself throws", () => {
  it("resolves false rather than rejecting, for an otherwise well-formed hash", async () => {
    const { verifyPassword } = await import("../session");
    // Shape-valid (passes parseStoredHash's own checks) — the mock above is
    // what forces the actual derivation to fail, not a malformed hash.
    const wellFormedHash = "scrypt$16384$8$1$c2FsdA$aGFzaA";
    await expect(verifyPassword("any password", wellFormedHash)).resolves.toBe(false);
  });
});
