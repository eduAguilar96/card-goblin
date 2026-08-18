#!/usr/bin/env node
// Hashes the cloud-sync admin password for ADMIN_PASSWORD_HASH (DESIGN.md
// §7.6, M3). Prompts on STDIN, masked — never argv, which would leave the
// plaintext password sitting in shell history (~/.bash_history, ~/.zsh_history)
// and in `ps` output for the life of the process. Run it, paste the printed
// hash into your env (Vercel project settings, .env.local, …), never the
// password itself.
//
// FORMAT: `scrypt$N$r$p$salt$hash`, salt/hash base64url. This is a
// DELIBERATE, hand-kept-in-sync DUPLICATE of the encode half of
// src/lib/cloud/session.ts's hashPassword — Node scripts in this repo are
// plain .mjs (see generate-dicier-codes.mjs, generate-font-metrics.mjs) and
// can't import the app's TypeScript source directly, so the ~15 lines of
// scrypt-and-encode logic live twice. If you ever retune the cost
// parameters below, retune session.ts's SCRYPT_N/R/P/KEYLEN/SCRYPT_MAXMEM
// too (the format is self-describing — N/r/p travel WITH the hash — so a
// mismatch wouldn't break verification of hashes already minted, but new
// ones should still match what the app documents as its default).
//
// MINIMUM LENGTH: this script refuses a password under 16 characters
// (independent security review, H1) — the single admin password IS the
// whole perimeter (§7.6: one login, no accounts, no per-user lockout), so
// there is no other floor on it anywhere in the system.

import { randomBytes, scrypt } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const MIN_PASSWORD_LENGTH = 16;

// OWASP's 2026 recommendation — mirrors session.ts's SCRYPT_N/R/P/KEYLEN/
// SCRYPT_MAXMEM exactly (M2, review: raised from the original N=2^14, which
// sat below every current OWASP-listed configuration).
const N = 131072;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 256 * 1024 * 1024; // 128*N*r*p is 128 MiB; Node's default ceiling is 32 MiB

async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

/** Strip a trailing CRLF/LF (independent security review, M7): defense in
 * depth alongside the per-character raw-mode reading below — a password
 * PASTED with a trailing newline (common when copying from a generator or
 * a text file) would otherwise hash to `password\n`, which a single-line
 * password `<input>` in the sign-in dialog can never reproduce (it can't
 * contain a newline at all) — a silent, confusing lockout with the
 * objectively correct password. */
function stripTrailingNewline(text) {
  return text.replace(/\r?\n$/, "");
}

// Restores the terminal out of raw mode no matter how the process exits
// (independent security review, M7/L11) — normal completion already does
// this via promptHiddenTTY's own cleanup(), but a killed/crashed process
// (Ctrl+C at an inopportune moment, an uncaught exception before cleanup
// runs) could otherwise leave the user's shell silently not echoing
// keystrokes. 'exit' handlers may only do synchronous work, which
// setRawMode(false) is. Registered once, unconditionally; a no-op when
// stdin was never put into raw mode (not a TTY, or already restored).
process.on("exit", () => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
});

/**
 * Read one line from stdin WITHOUT echoing it to the terminal — the
 * standard Node raw-mode recipe (readline itself has no built-in masking).
 * TTY only; the non-TTY (piped input) path is handled separately in
 * `main()` with a single shared `readline.Interface` — creating and
 * `close()`ing a fresh one per question on `process.stdin` is flaky
 * (`close()` can leave the stream in a state the next `createInterface`
 * doesn't reliably resume), so one instance answers every question.
 *
 * Iterates PER CHARACTER within each 'data' event, not the whole chunk
 * (independent security review, M7): typed input usually arrives one
 * keystroke per event, but a PASTED password delivers every character in a
 * single event — switching on the whole chunk would let an embedded \n/\r
 * slip through as literal password content instead of being recognized as
 * "submit" (see `stripTrailingNewline`'s doc comment for the lockout that
 * caused). Iterating catches the terminator wherever it falls in the chunk.
 */
function promptHiddenTTY(question) {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let input = "";
    let settled = false;

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const submit = () => {
      settled = true;
      cleanup();
      stdout.write("\n");
      resolve(input);
    };
    const cancel = () => {
      settled = true;
      cleanup();
      stdout.write("\n");
      reject(new Error("Cancelled."));
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (settled) return; // a terminator earlier in THIS chunk already resolved/rejected
        switch (char) {
          case "\n":
          case "\r":
          case "": // Ctrl+D
            submit();
            break;
          case "": // Ctrl+C
            cancel();
            break;
          case "": // backspace (DEL)
          case "\b":
            input = input.slice(0, -1);
            break;
          default:
            input += char;
            break;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  console.log("CardGoblin cloud sync — admin password hasher (DESIGN.md §7.6)\n");

  // TTY: masked raw-mode input, one call per question. Non-TTY (piped
  // input): `rl.question()` called TWICE against the SAME interface is a
  // known Node footgun with piped input specifically — both lines arrive in
  // one 'data' event, and the second `question()` call is wired up only
  // AFTER readline has already processed that event, so its callback never
  // fires and the process hangs. Consuming the interface as an async
  // iterator instead (`for await`'s protocol) correctly queues lines that
  // arrive before anything was "waiting" for them. readline's own line
  // splitting already strips the line's terminating newline, but
  // `stripTrailingNewline` still runs on both paths below for one uniform
  // guarantee regardless of which path answered.
  let ask;
  let closeAsk = () => {};
  if (process.stdin.isTTY) {
    ask = promptHiddenTTY;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const lines = rl[Symbol.asyncIterator]();
    ask = async (question) => {
      process.stdout.write(question);
      const { value, done } = await lines.next();
      return done ? "" : value;
    };
    closeAsk = () => rl.close();
  }

  const password = stripTrailingNewline(await ask("Password: "));
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `\nRefused — this is the ONE password protecting the whole deployment (no per-account ` +
        `lockout, no rate limiting beyond a fixed per-attempt delay), so it needs to be long. ` +
        `Pick at least ${MIN_PASSWORD_LENGTH} characters, ideally generated randomly.`,
    );
    closeAsk();
    process.exitCode = 1;
    return;
  }
  const confirm = stripTrailingNewline(await ask("Confirm password: "));
  closeAsk();
  if (confirm !== password) {
    console.error("\nPasswords didn't match — nothing hashed. Try again.");
    process.exitCode = 1;
    return;
  }

  const hash = await hashPassword(password);
  console.log("\nADMIN_PASSWORD_HASH:\n");
  console.log(hash);
  console.log(
    "\nPaste the line above (the WHOLE scrypt$... string) as your ADMIN_PASSWORD_HASH " +
      "env var. The password itself was never written to disk or shell history — this " +
      "hash is the only thing you need to keep.",
  );
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
