/**
 * Cloud sync's status-bar control (DESIGN.md §7.6) — static markup only,
 * same posture as pdfExportModal.test.tsx: the dialog's a11y ATTRIBUTES are
 * pinned here (role, aria-modal, labelled title, focusable, error/working
 * states); actual focus/Escape/Tab behavior has no driver in this project
 * and is on the manual browser checklist (module comment in
 * cloudSyncControl.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CloudSyncControl, {
  CloudSyncControlContent,
  SignInDialog,
  cloudStatusLabel,
  formatRelativeTime,
  type CloudSyncControlContentProps,
} from "@/app/editor/_components/cloudSyncControl";
import {
  cloudSync,
  resetCloudSyncForTests,
  signInFailureMessage,
  type CloudSyncSnapshot,
} from "@/app/editor/_store/cloudSync";

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

const SIGNED_OUT: CloudSyncSnapshot = {
  status: "signed-out",
  lastSyncedAt: null,
  pullProgress: null,
  errorMessage: null,
  behindRevision: null,
  conflictProject: null,
  notice: null,
};

function snapshot(patch: Partial<CloudSyncSnapshot>): CloudSyncSnapshot {
  return { ...SIGNED_OUT, ...patch };
}

function render(props: Partial<CloudSyncControlContentProps> = {}): string {
  return renderToStaticMarkup(
    <CloudSyncControlContent
      snapshot={props.snapshot ?? SIGNED_OUT}
      now={props.now ?? 1_000_000}
      onSignIn={props.onSignIn ?? (async () => ({ ok: true }))}
      onSignOut={props.onSignOut ?? (() => {})}
      onReload={props.onReload ?? (() => {})}
      onOverwrite={props.onOverwrite ?? (() => {})}
      initialDialogOpen={props.initialDialogOpen}
    />,
  );
}

// ---------------------------------------------------------------------------
// Pure display helpers
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  it("reads as 'just now' for anything under 5 s", () => {
    expect(formatRelativeTime(1000, 1000)).toBe("just now");
    expect(formatRelativeTime(1000, 4999)).toBe("just now");
  });

  it("seconds, then minutes, then hours, then days", () => {
    expect(formatRelativeTime(0, 30_000)).toBe("30s ago");
    expect(formatRelativeTime(0, 90_000)).toBe("2m ago");
    expect(formatRelativeTime(0, 2 * 60 * 60 * 1000)).toBe("2h ago");
    expect(formatRelativeTime(0, 3 * 24 * 60 * 60 * 1000)).toBe("3d ago");
  });

  it("never goes negative for a clock that ticks backward", () => {
    expect(formatRelativeTime(5000, 1000)).toBe("just now");
  });
});

describe("cloudStatusLabel", () => {
  it("covers every status with the brief's four signed-in words plus the transitional ones", () => {
    expect(cloudStatusLabel(snapshot({ status: "signed-out" }), 0)).toBe("Signed out");
    expect(cloudStatusLabel(snapshot({ status: "signing-in" }), 0)).toBe("Signing in…");
    expect(cloudStatusLabel(snapshot({ status: "pulling" }), 0)).toBe("Syncing…");
    expect(cloudStatusLabel(snapshot({ status: "pushing" }), 0)).toBe("Syncing…");
    expect(cloudStatusLabel(snapshot({ status: "idle", lastSyncedAt: null }), 0)).toBe("Synced");
    expect(cloudStatusLabel(snapshot({ status: "idle", lastSyncedAt: 0 }), 30_000)).toBe("Synced 30s ago");
    expect(cloudStatusLabel(snapshot({ status: "offline" }), 0)).toBe("Offline");
    expect(cloudStatusLabel(snapshot({ status: "behind" }), 0)).toBe("This browser is behind");
    expect(cloudStatusLabel(snapshot({ status: "conflict" }), 0)).toBe(
      "Your editor has work that isn't in the cloud",
    );
  });

  it("reports coarse pull progress while pulling assets (brief D: '3 of 8 images')", () => {
    const label = cloudStatusLabel(
      snapshot({ status: "pulling", pullProgress: { done: 3, total: 8 } }),
      0,
    );
    expect(label).toBe("Syncing images (3 of 8)…");
  });

  // ---------------------------------------------------------------------
  // FIX 3: a fresh sign-in notice replaces the ordinary idle label.
  // ---------------------------------------------------------------------

  it("a notice REPLACES the ordinary idle label", () => {
    const label = cloudStatusLabel(
      snapshot({ status: "idle", lastSyncedAt: 1000, notice: "Loaded your cloud project" }),
      1000,
    );
    expect(label).toBe("Loaded your cloud project");
  });

  it("a notice is ignored outside status idle (defensive — cloudSync.ts never sets one there)", () => {
    const label = cloudStatusLabel(snapshot({ status: "offline", notice: "Loaded your cloud project" }), 0);
    expect(label).toBe("Offline");
  });

  it("no notice: the ordinary idle label is unaffected", () => {
    expect(cloudStatusLabel(snapshot({ status: "idle", lastSyncedAt: null, notice: null }), 0)).toBe("Synced");
  });
});

// ---------------------------------------------------------------------------
// Signed-out: "Sign in" button + dialog
// ---------------------------------------------------------------------------

describe("CloudSyncControlContent — signed out", () => {
  it("rests as a single quiet 'Sign in' button, no dialog", () => {
    const markup = render();
    expect(stripTags(markup)).toBe("Sign in");
    expect(markup).not.toContain("role=\"dialog\"");
  });

  it("initialDialogOpen (test seam) renders the sign-in dialog statically", () => {
    const markup = render({ initialDialogOpen: true });
    expect(markup).toContain('role="dialog"');
    expect(stripTags(markup)).toContain("Sign in to cloud sync");
  });
});

// ---------------------------------------------------------------------------
// Signed-in: dot + label + Sign out, Reload/Overwrite only when behind
// ---------------------------------------------------------------------------

describe("CloudSyncControlContent — signed in", () => {
  it("idle: shows the last-synced label and Sign out, no Reload/Overwrite", () => {
    const markup = render({ snapshot: snapshot({ status: "idle", lastSyncedAt: 970_000 }), now: 1_000_000 });
    const text = stripTags(markup);
    expect(text).toContain("Synced 30s ago");
    expect(text).toContain("Sign out");
    expect(text).not.toContain("Reload");
    expect(text).not.toContain("Overwrite");
    expect(text).not.toContain("Sign in");
  });

  it("offline: quiet 'Offline' label, error message surfaced via title", () => {
    const markup = render({
      snapshot: snapshot({ status: "offline", errorMessage: "Can't reach the network." }),
    });
    expect(stripTags(markup)).toContain("Offline");
    expect(markup).toContain('title="Can&#x27;t reach the network."');
  });

  it("behind: names the state and offers Reload AND Overwrite", () => {
    const markup = render({ snapshot: snapshot({ status: "behind", behindRevision: 7 }) });
    const text = stripTags(markup);
    expect(text).toContain("This browser is behind");
    expect(text).toContain("Reload");
    expect(text).toContain("Overwrite");
    expect(text).toContain("Sign out"); // still available even mid-conflict
  });

  // ---------------------------------------------------------------------
  // FIX 4: the sign-in collision prompt — same structure as "behind"
  // (dot + label + two buttons + Sign out), different copy.
  // ---------------------------------------------------------------------

  it("conflict: names the state and offers 'Keep cloud copy' / 'Keep this device's work', not Reload/Overwrite", () => {
    const markup = render({
      snapshot: snapshot({
        status: "conflict",
        conflictProject: { revision: 3, project: { code: "", sheets: {}, assets: [] } },
      }),
    });
    const text = stripTags(markup);
    // react-dom/server HTML-escapes apostrophes in text content (SignInDialog's
    // tests below hit the same thing) — compare against the escaped form.
    expect(text).toContain("Your editor has work that isn&#x27;t in the cloud");
    expect(text).toContain("Keep cloud copy");
    expect(text).toContain("Keep this device&#x27;s work");
    expect(text).toContain("Sign out");
    expect(text).not.toContain("Reload");
    expect(text).not.toContain("Overwrite");
  });

  it("idle with a fresh notice shows it instead of 'Synced…' (FIX 3, visible without devtools)", () => {
    const markup = render({
      snapshot: snapshot({
        status: "idle",
        lastSyncedAt: 970_000,
        notice: "No cloud project yet — uploading this one",
      }),
      now: 1_000_000,
    });
    const text = stripTags(markup);
    expect(text).toContain("No cloud project yet — uploading this one");
    expect(text).not.toContain("Synced");
  });

  it("pulling with progress: the coarse N-of-M wording appears in the bar", () => {
    const markup = render({
      snapshot: snapshot({ status: "pulling", pullProgress: { done: 2, total: 5 } }),
    });
    expect(stripTags(markup)).toContain("Syncing images (2 of 5)…");
  });
});

// ---------------------------------------------------------------------------
// SignInDialog
// ---------------------------------------------------------------------------

describe("SignInDialog", () => {
  const renderDialog = (props: Partial<Parameters<typeof SignInDialog>[0]> = {}): string =>
    renderToStaticMarkup(
      <SignInDialog
        onClose={props.onClose ?? (() => {})}
        onSubmit={props.onSubmit ?? (async () => ({ ok: true }))}
        initialUsername={props.initialUsername}
        initialPassword={props.initialPassword}
        initialError={props.initialError}
        initialWorking={props.initialWorking}
      />,
    );

  it("is an accessible dialog: role, aria-modal, labelled title, focusable", () => {
    const markup = renderDialog();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="cloud-signin-title"');
    expect(markup).toContain('id="cloud-signin-title"');
    expect(markup).toContain('tabindex="-1"');
  });

  // ---------------------------------------------------------------------
  // TASK 4: username field, above password, both required
  // ---------------------------------------------------------------------

  it("has a username field ABOVE the password field, both labelled", () => {
    const markup = renderDialog();
    const text = stripTags(markup);
    expect(text).toContain("Username");
    expect(text).toContain("Password");
    expect(text.indexOf("Username")).toBeLessThan(text.indexOf("Password"));
    expect(markup).toMatch(/autocomplete="username"/i);
  });

  it("resting state: Sign in is disabled until BOTH username and password are filled", () => {
    const neither = renderDialog({ initialUsername: "", initialPassword: "" });
    expect(/<button type="submit"[^>]*>Sign in<\/button>/.exec(neither)?.[0]).toContain('disabled=""');

    const usernameOnly = renderDialog({ initialUsername: "eduxx", initialPassword: "" });
    expect(/<button type="submit"[^>]*>Sign in<\/button>/.exec(usernameOnly)?.[0]).toContain('disabled=""');

    const passwordOnly = renderDialog({ initialUsername: "", initialPassword: "hunter2" });
    expect(/<button type="submit"[^>]*>Sign in<\/button>/.exec(passwordOnly)?.[0]).toContain('disabled=""');

    const both = renderDialog({ initialUsername: "eduxx", initialPassword: "hunter2" });
    expect(/<button type="submit"[^>]*>Sign in<\/button>/.exec(both)?.[0]).not.toContain('disabled=""');
  });

  // ---------------------------------------------------------------------
  // TASK 3: role=alert error markup — one state per failure shape
  // ---------------------------------------------------------------------

  it("initialError (test seam) shows a role=alert message, tied to BOTH fields via aria-describedby", () => {
    const markup = renderDialog({ initialError: "Incorrect username or password." });
    expect(markup).toContain('role="alert"');
    expect(stripTags(markup)).toContain("Incorrect username or password.");
    // Neither field is singled out as "the" wrong one (TASK 4: the response
    // never says which of username/password was wrong, so the markup must
    // not imply one either) — both carry aria-invalid + the same describedby.
    expect(markup.match(/aria-invalid="true"/g)?.length).toBe(2);
    expect(markup.match(/aria-describedby="cloud-signin-error"/g)?.length).toBe(2);
    expect(markup).toContain('id="cloud-signin-error"');
  });

  it("no error: aria-invalid is explicitly false on both fields, no describedby, no alert", () => {
    const markup = renderDialog();
    expect(markup.match(/aria-invalid="false"/g)?.length).toBe(2);
    expect(markup).not.toContain("aria-describedby");
    expect(markup).not.toContain('role="alert"');
  });

  it("each signInFailureMessage case renders as its own distinct role=alert text, including 404 (HIGH, security review)", () => {
    const cases: [label: string, status: number | "network"][] = [
      ["wrong credentials (401)", 401],
      ["server not configured / hash unreadable (503)", 503],
      ["offline / network failure", "network"],
      ["unexpected server error (5xx)", 500],
      // THE bug this fix closes: a live deployment 404ing these routes must
      // never render as "Incorrect username or password" — see
      // signInFailureMessage's module comment for the full incident.
      ["unrecognized status (404) — must NOT read as wrong credentials", 404],
    ];
    const seen = new Set<string>();
    for (const [label, status] of cases) {
      const message = signInFailureMessage(status);
      const markup = renderDialog({ initialError: message });
      // react-dom/server HTML-escapes apostrophes in text content — compare
      // against the RAW markup with the same escaping applied, not the JS
      // string verbatim (mirrors this file's existing "Can&#x27;t reach the
      // network." precedent for the offline status-bar title, below).
      expect(markup, label).toContain(message.replace(/'/g, "&#x27;"));
      expect(markup, label).toContain('role="alert"');
      if (status === 404) expect(stripTags(markup), label).not.toContain("Incorrect username or password");
      seen.add(message);
    }
    // All five are worded distinctly from one another (module comment on
    // signInFailureMessage) — no two cases silently collapsed to the same copy.
    expect(seen.size).toBe(5);
  });

  it("the 503 copy specifically names /api/cloud/diagnose and the deployment guide (TASK 2/3)", () => {
    const markup = renderDialog({ initialError: signInFailureMessage(503) });
    const text = stripTags(markup);
    expect(text).toContain("/api/cloud/diagnose");
    expect(text).toContain("docs/deployment.md");
  });

  it("initialWorking (test seam): both buttons disabled, a role=status 'Signing in…' notice, both inputs disabled", () => {
    const markup = renderDialog({ initialWorking: true, initialUsername: "eduxx", initialPassword: "hunter2" });
    expect(markup).toContain('role="status"');
    expect(stripTags(markup)).toContain("Signing in…");
    const cancelButton = /<button type="button"[^>]*>Cancel<\/button>/.exec(markup)?.[0];
    expect(cancelButton).toContain('disabled=""');
    const submitButton = /<button type="submit"[^>]*>Signing in…<\/button>/.exec(markup)?.[0];
    expect(submitButton).toContain('disabled=""');
    const inputTags = markup.match(/<input[^>]*>/g) ?? [];
    expect(inputTags).toHaveLength(2);
    for (const tag of inputTags) expect(tag).toContain('disabled=""');
  });

  it("the password field is type=password with autocomplete for a credential manager", () => {
    const markup = renderDialog();
    expect(markup).toContain('type="password"');
    // Attribute-name casing is renderer-dependent (react-dom/server has
    // historically varied here) and irrelevant to a browser's HTML parser,
    // which matches attribute names case-insensitively — so this checks the
    // MEANINGFUL thing (the value is set) without pinning a casing quirk.
    expect(markup).toMatch(/autocomplete="current-password"/i);
  });
});

// ---------------------------------------------------------------------------
// CloudSyncControl — the actual store-connected component (not just its
// store-free Content), pinning that the whole wiring renders without
// crashing and reads the `cloudSync` singleton correctly at every stage.
// ---------------------------------------------------------------------------

describe("CloudSyncControl (connected)", () => {
  afterEach(() => resetCloudSyncForTests());

  it("before any sign-in, renders exactly the signed-out button (getServerSnapshot path)", () => {
    // No `initCloudSync()` call here (needs `window`, unavailable in this
    // test env) — this IS the real "prerender / before mount" case:
    // useSyncExternalStore's getServerSnapshot must read the SAME safe
    // default the client would, which is what makes this render clean
    // during Next's static prerender of /editor (CLAUDE.md's build note).
    const markup = renderToStaticMarkup(<CloudSyncControl />);
    expect(stripTags(markup)).toBe("Sign in");
  });

  it("reflects the singleton's CURRENT snapshot at render time (not a stale default)", async () => {
    // Drive the real singleton into a signed-in-ish state the way
    // resetCloudSyncForTests + signIn can from a headless test (inert
    // transport — signIn still fails, but passes through "signing-in" en
    // route, proving the connected component reads live state, not a
    // hardcoded constant).
    resetCloudSyncForTests();
    const pending = cloudSync.signIn("anything", "anything");
    // Mid-flight snapshot: status is "signing-in" the instant signIn() is
    // called, synchronously, before any await yields.
    expect(cloudSync.getSnapshot().status).toBe("signing-in");
    const markup = renderToStaticMarkup(<CloudSyncControl />);
    expect(stripTags(markup)).toContain("Signing in…");
    await pending;
  });
});
