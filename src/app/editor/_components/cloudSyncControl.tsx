"use client";

/**
 * Cloud sync's status-bar control (DESIGN.md §7.6): "Sign in" when signed
 * out; a status dot + label ("Synced 2m ago" / "Syncing…" / "Offline" /
 * "This browser is behind") + "Sign out" when signed in, with Reload/
 * Overwrite buttons appearing only in the "behind" state (brief D/E).
 *
 * Split like every other status-bar control (ProjectFileButtons,
 * AssetsDrawerButton): `CloudSyncControlContent` is store-free (props in,
 * `initialDialogOpen` test seam) for renderToStaticMarkup tests;
 * `CloudSyncControl` is the thin `useSyncExternalStore` wrapper over the
 * `cloudSync` singleton — the SAME stable object whether or not
 * `initCloudSync()` has attached the real controller yet (cloudSync.ts's
 * `makeSingleton` forwarding pattern, mirroring assetStore.ts): subscribing
 * here on mount is enough to correctly receive the real controller's state
 * once it attaches, with no reliance on some later unrelated re-render.
 *
 * `SignInDialog` reuses pdfExportModal.tsx's dependency-free a11y recipe
 * verbatim: role="dialog" aria-modal, focus moves in on open (to the
 * username field, TASK 4's first field) and is restored to the opener on
 * close, Tab wraps at the dialog's own ends via dialogFocusTrap.ts's
 * `focusableElementsIn` (the shared fix for the hidden-input trap bug both
 * existing dialogs cite), and Escape/backdrop close it — all suppressed
 * while a sign-in request is in flight, same rule as the PDF modal's
 * `working` guard.
 *
 * TASK 3 (error handling, previously: nothing rendered on failure at all —
 * the owner had to open devtools to learn a sign-in even failed): a
 * `role="alert"` message with copy that differs by failure shape
 * (`signInFailureMessage` in cloudSync.ts owns the exact four strings —
 * wrong credentials / server misconfigured / offline / unexpected — this
 * component only renders whatever it's handed), cleared the instant either
 * field is edited (a stale error sitting under a freshly-retyped password
 * reads as "still wrong" even before the new attempt resolves), and Sign in
 * is disabled — with a pending label — for the whole round trip.
 *
 * INITIAL SYNC GATE (§7.6 dated addendum): once authentication succeeds, a
 * second, non-dismissible dialog owns the whole reconciliation round trip.
 * It blocks the editor while local and cloud copies are compared, says
 * "Synced" only after the visible project is cloud-confirmed, and makes a
 * collision an explicit choice inside the same gate. A failed round trip is
 * equally explicit: local work is safe, but is NOT claimed to be saved in the
 * cloud. Remembered-session restoration uses this same UI and controller path.
 *
 * FIX 4 (§7.6 dated addendum): `status === "conflict"` is the sign-in
 * collision prompt — local carries real work that isn't in the cloud copy
 * `pull()` found. Deliberately reuses the SAME structure the 409 "behind"
 * prompt already has (dot + label + two amber buttons, factored into
 * `ChoiceButtons` below) rather than a second bespoke UI, wired to the same
 * `onReload`/`onOverwrite` callbacks — cloudSync.ts decides which of the two
 * states is showing and what each button does from `status` internally.
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { focusableElementsIn } from "@/app/editor/_components/dialogFocusTrap";
import { cloudSync, type CloudSyncSnapshot, type CloudSyncStatus } from "@/app/editor/_store/cloudSync";

// ---------------------------------------------------------------------------
// Pure display helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Coarse "Xs/m/h/d ago" — the status dot only needs to be roughly right,
 * refreshed periodically by the connected wrapper (below), not to the
 * second. */
export function formatRelativeTime(thenMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** The visible label for every signed-in status (brief E: "last-synced/
 * 'syncing'/'offline'/'behind'" — `signing-in`/`pulling`/`pushing` all read
 * as "Syncing…" to the user; which network call is in flight is an
 * implementation detail).
 *
 * FIX 3: `notice` PREEMPTS the ordinary idle label — cloudSync.ts only ever
 * sets it in the same patch that sets `status: "idle"` (or gates on status
 * already being idle), so this check doesn't need its own expiry timer: the
 * very next pull/push clears `notice` before it could set a stale one. */
export function cloudStatusLabel(snapshot: CloudSyncSnapshot, nowMs: number): string {
  if (snapshot.status === "idle" && snapshot.notice !== null) return snapshot.notice;
  switch (snapshot.status) {
    case "signed-out":
      return "Signed out";
    case "signing-in":
      return "Signing in…";
    case "pulling":
      return snapshot.pullProgress
        ? `Syncing images (${snapshot.pullProgress.done} of ${snapshot.pullProgress.total})…`
        : "Syncing…";
    case "pushing":
      return "Syncing…";
    case "idle":
      return snapshot.lastSyncedAt === null
        ? "Synced"
        : `Synced ${formatRelativeTime(snapshot.lastSyncedAt, nowMs)}`;
    case "offline":
      return "Offline";
    case "behind":
      return "This browser is behind";
    case "conflict":
      return "Your editor has work that isn't in the cloud";
  }
}

const DOT_COLOR: Record<CloudSyncStatus, string> = {
  "signed-out": "bg-gray-600",
  "signing-in": "bg-amber-400",
  pulling: "bg-amber-400",
  pushing: "bg-amber-400",
  idle: "bg-emerald-500",
  offline: "bg-gray-500",
  behind: "bg-red-500",
  conflict: "bg-red-500",
};

function StatusDot({ status }: { status: CloudSyncStatus }): ReactElement {
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DOT_COLOR[status]}`} />;
}

const QUIET_BUTTON =
  "rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200";

// ---------------------------------------------------------------------------
// Sign-in dialog
// ---------------------------------------------------------------------------

export type SignInResult = { ok: true } | { ok: false; message: string };

export interface SignInDialogProps {
  onClose(): void;
  onSubmit(username: string, password: string): Promise<SignInResult>;
  /** Test seams (no interaction driver in this project — same pattern as
   * PdfExportModal's initialMarginText/initialFailure). */
  initialUsername?: string;
  initialPassword?: string;
  initialError?: string | null;
  initialWorking?: boolean;
}

export function SignInDialog({
  onClose,
  onSubmit,
  initialUsername = "",
  initialPassword = "",
  initialError = null,
  initialWorking = false,
}: SignInDialogProps): ReactElement {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState(initialPassword);
  const [error, setError] = useState<string | null>(initialError);
  const [working, setWorking] = useState(initialWorking);
  const dialogRef = useRef<HTMLDivElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Focus the username field (the first field, TASK 4) on open; restore the
  // opener's focus on close (every close path — Escape, backdrop, Cancel, a
  // successful submit — unmounts this component the same way, so one
  // cleanup covers all of them). Effects never run in renderToStaticMarkup;
  // covered by the manual browser checklist, same as pdfExportModal.tsx.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (usernameRef.current ?? dialogRef.current)?.focus();
    return () => opener?.focus();
  }, []);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!working) onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = focusableElementsIn(dialogRef.current);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Shared by both fields (TASK 3: "clear the message when the user edits a
  // field") — a stale error sitting under a freshly-retyped credential reads
  // as "still wrong" even before the new attempt has resolved. Guarded on
  // `error !== null` only to avoid a pointless setState on every keystroke
  // once it's already clear.
  const clearErrorOnEdit = (): void => {
    if (error !== null) setError(null);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working || username.length === 0 || password.length === 0) return;
    setWorking(true);
    setError(null);
    const result = await onSubmit(username, password);
    if (result.ok) {
      onClose();
      return;
    }
    setWorking(false);
    setError(result.message);
  };

  return (
    <div
      // whitespace-normal: prophylactic, same reason as the other dialogs —
      // an overlay mounted under a whitespace-nowrap ancestor (the status
      // bar) inherits it through the DOM.
      className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-black/60 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-signin-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-200 shadow-xl outline-none"
      >
        <h2 id="cloud-signin-title" className="mb-3 text-base font-semibold text-white">
          Sign in to cloud sync
        </h2>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            Username
            <input
              ref={usernameRef}
              type="text"
              autoComplete="username"
              value={username}
              disabled={working}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "cloud-signin-error" : undefined}
              onChange={(event) => {
                setUsername(event.currentTarget.value);
                clearErrorOnEdit();
              }}
              className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={working}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "cloud-signin-error" : undefined}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                clearErrorOnEdit();
              }}
              className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-200"
            />
          </label>
          {error !== null && (
            <p id="cloud-signin-error" role="alert" className="text-red-400">
              {error}
            </p>
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            {working && (
              <span className="mr-auto text-xs text-gray-400" role="status">
                Signing in…
              </span>
            )}
            <button
              type="button"
              disabled={working}
              onClick={onClose}
              className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={working || username.length === 0 || password.length === 0}
              className="rounded border border-gray-500 bg-gray-600 px-3 py-1 font-semibold text-white hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status-bar control
// ---------------------------------------------------------------------------

const CHOICE_BUTTON =
  "rounded border border-amber-800 px-1.5 text-amber-300 hover:border-amber-500 hover:text-amber-200";

/**
 * The two-button "resolve this" affordance — factored out because the 409
 * "behind" prompt and the sign-in "conflict" prompt (FIX 4) are the exact
 * same SHAPE (a "take theirs" choice and a "keep mine, overwrite" choice),
 * differing only in copy. Both wire to the same `onReload`/`onOverwrite`
 * callbacks; cloudSync.ts decides what each one actually does from
 * `status` internally (its `reload`/`overwrite` doc comments).
 */
function ChoiceButtons({
  onLeft,
  onRight,
  leftLabel,
  rightLabel,
  leftTitle,
  rightTitle,
}: {
  onLeft(): void;
  onRight(): void;
  leftLabel: string;
  rightLabel: string;
  leftTitle: string;
  rightTitle: string;
}): ReactElement {
  return (
    <>
      <button type="button" onClick={onLeft} title={leftTitle} className={CHOICE_BUTTON}>
        {leftLabel}
      </button>
      <button type="button" onClick={onRight} title={rightTitle} className={CHOICE_BUTTON}>
        {rightLabel}
      </button>
    </>
  );
}

export interface SyncGateModalProps {
  snapshot: CloudSyncSnapshot;
  onDismiss(): void;
  onReload(): void;
  onOverwrite(): void;
}

/**
 * The initial synchronization checkpoint. It deliberately has no Escape or
 * backdrop close path: the editor stays unavailable until reconciliation has
 * either succeeded, failed explicitly, or the user has resolved two divergent
 * projects. This is stronger than the compact status-bar indicator because it
 * answers the safety-critical question "which project am I looking at?" before
 * editing can resume.
 */
export function SyncGateModal({
  snapshot,
  onDismiss,
  onReload,
  onOverwrite,
}: SyncGateModalProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener !== null && opener !== document.body && opener.isConnected) {
        opener.focus();
        return;
      }
      document.querySelector<HTMLElement>("[data-cloud-sync-focus-return]")?.focus();
    };
  }, []);

  useEffect(() => {
    (firstButtonRef.current ?? dialogRef.current)?.focus();
  }, [snapshot.syncGate, snapshot.status]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = focusableElementsIn(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Keep the original choice available if "Use this device" failed before
  // its project PUT (for example, while uploading an image). The controller
  // intentionally retains conflictProject in that case even though the
  // compact status becomes Offline; treating status alone as the choice
  // identity would turn a retryable conflict into a dismissible failure.
  const isBehind = snapshot.behindRevision !== null || snapshot.status === "behind";
  const isConflict =
    !isBehind && (snapshot.conflictProject !== null || snapshot.status === "conflict");
  const title =
    snapshot.syncGate === "syncing"
      ? "Syncing"
      : snapshot.syncGate === "synced"
        ? "Synced"
        : "Could not sync";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center whitespace-normal bg-black/70 p-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-gate-title"
        aria-describedby="cloud-sync-gate-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-800 p-5 text-sm text-gray-200 shadow-xl outline-none"
      >
        <h2 id="cloud-sync-gate-title" className="text-lg font-semibold text-white">
          {title}
        </h2>

        {snapshot.syncGate === "syncing" && (
          <div
            id="cloud-sync-gate-description"
            className="mt-3"
            role="status"
            aria-live="polite"
          >
            <p>Checking this device against the saved cloud project. Keep this window open.</p>
            {snapshot.pullProgress !== null && (
              <p className="mt-2 text-gray-400">
                Syncing images ({snapshot.pullProgress.done} of {snapshot.pullProgress.total})…
              </p>
            )}
          </div>
        )}

        {snapshot.syncGate === "synced" && (
          <>
            <p id="cloud-sync-gate-description" className="mt-3">
              The project now shown in the editor matches the saved cloud project. You can safely
              continue editing.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={onDismiss}
                className="rounded border border-emerald-600 bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-600"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {snapshot.syncGate === "failed" && isConflict && (
          <>
            <p id="cloud-sync-gate-description" className="mt-3">
              This device and the cloud contain different projects. CardGoblin has not completed a
              project choice. Choose which one should become the saved cloud project.
            </p>
            {snapshot.errorMessage !== null && (
              <p className="mt-2 text-red-400" role="alert">
                {snapshot.errorMessage}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={onReload}
                className="rounded border border-gray-500 bg-gray-700 px-3 py-2 font-semibold text-white hover:bg-gray-600"
              >
                Use cloud project
              </button>
              <button
                type="button"
                onClick={onOverwrite}
                className="rounded border border-amber-600 bg-amber-700 px-3 py-2 font-semibold text-white hover:bg-amber-600"
              >
                Use this device&apos;s project
              </button>
            </div>
          </>
        )}

        {snapshot.syncGate === "failed" && isBehind && (
          <>
            <p id="cloud-sync-gate-description" className="mt-3">
              The cloud project changed on another device before this one could finish syncing.
              CardGoblin has not completed a project choice. Choose which project to keep.
            </p>
            {snapshot.errorMessage !== null && (
              <p className="mt-2 text-red-400" role="alert">
                {snapshot.errorMessage}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={onReload}
                className="rounded border border-gray-500 bg-gray-700 px-3 py-2 font-semibold text-white hover:bg-gray-600"
              >
                Load cloud project
              </button>
              <button
                type="button"
                onClick={onOverwrite}
                className="rounded border border-amber-600 bg-amber-700 px-3 py-2 font-semibold text-white hover:bg-amber-600"
              >
                Save this device&apos;s project
              </button>
            </div>
          </>
        )}

        {snapshot.syncGate === "failed" && !isConflict && !isBehind && (
          <>
            <div id="cloud-sync-gate-description" className="mt-3">
              <p>
                Your work is still safe on this device, but it has not been confirmed as saved in
                the cloud.
              </p>
              {snapshot.errorMessage !== null && (
                <p className="mt-2 text-red-400" role="alert">
                  {snapshot.errorMessage}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={onDismiss}
                className="rounded border border-gray-500 bg-gray-700 px-4 py-2 font-semibold text-white hover:bg-gray-600"
              >
                Continue locally
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export interface CloudSyncControlContentProps {
  snapshot: CloudSyncSnapshot;
  /** Injected so the relative-time label is deterministic in tests and so
   * the connected wrapper controls its own refresh cadence. */
  now: number;
  onSignIn(username: string, password: string): Promise<SignInResult>;
  onSignOut(): void;
  onReload(): void;
  onOverwrite(): void;
  onDismissSyncGate(): void;
  /** Test seam: render the sign-in dialog open, statically. */
  initialDialogOpen?: boolean;
}

/** Store-free — the connected `CloudSyncControl` injects the singleton's
 * actions, tests inject spies (same split as ProjectFileButtons). */
export function CloudSyncControlContent({
  snapshot,
  now,
  onSignIn,
  onSignOut,
  onReload,
  onOverwrite,
  onDismissSyncGate,
  initialDialogOpen = false,
}: CloudSyncControlContentProps): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(initialDialogOpen);

  // Authentication errors stay in the credential dialog. Once credentials
  // are accepted, the controller opens the dedicated sync checkpoint and the
  // credential form gets out of its way.
  useEffect(() => {
    if (snapshot.syncGate !== null && dialogOpen) setDialogOpen(false);
  }, [dialogOpen, snapshot.syncGate]);

  const syncGate = snapshot.syncGate !== null ? (
    <SyncGateModal
      snapshot={snapshot}
      onDismiss={onDismissSyncGate}
      onReload={onReload}
      onOverwrite={onOverwrite}
    />
  ) : null;

  if (snapshot.status === "signed-out") {
    return (
      <>
        <button
          type="button"
          data-cloud-sync-focus-return
          onClick={() => setDialogOpen(true)}
          title="Sign in to sync this project across devices"
          className={QUIET_BUTTON}
        >
          Sign in
        </button>
        {dialogOpen && snapshot.syncGate === null && (
          <SignInDialog
            onClose={() => setDialogOpen(false)}
            onSubmit={onSignIn}
          />
        )}
        {syncGate}
      </>
    );
  }

  const labelColor =
    snapshot.status === "behind" || snapshot.status === "conflict"
      ? "text-amber-400"
      : snapshot.status === "offline"
        ? "text-gray-500"
        : "text-gray-400";

  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusDot status={snapshot.status} />
        <span className={labelColor} title={snapshot.errorMessage ?? undefined}>
          {cloudStatusLabel(snapshot, now)}
        </span>
        {snapshot.status === "behind" && (
          <ChoiceButtons
            onLeft={onReload}
            onRight={onOverwrite}
            leftLabel="Reload"
            rightLabel="Overwrite"
            leftTitle="Discard this browser's unsynced changes and load the server's copy"
            rightTitle="Keep this browser's copy and overwrite the server with it"
          />
        )}
        {snapshot.status === "conflict" && (
          <ChoiceButtons
            onLeft={onReload}
            onRight={onOverwrite}
            leftLabel="Keep cloud copy"
            rightLabel="Keep this device's work"
            leftTitle="Discard this device's local work and load the cloud project"
            rightTitle="Keep this device's work and upload it, replacing the cloud project"
          />
        )}
        <button
          type="button"
          data-cloud-sync-focus-return
          onClick={onSignOut}
          className={QUIET_BUTTON}
        >
          Sign out
        </button>
      </span>
      {syncGate}
    </>
  );
}

/**
 * Store-connected wrapper — subscribes to the `cloudSync` singleton exactly
 * the way `AssetsDrawerButton` subscribes to `assetStore`: ONE stable
 * object, safe to read/subscribe before `initCloudSync()` has attached the
 * real controller (cloudSync.ts's module comment on `makeSingleton`
 * explains why this — not a `| null` read at render time — is what makes
 * the real controller's state reach this component reliably once it
 * attaches, with no gap where a signed-in user would see a stale "Sign in").
 */
export default function CloudSyncControl(): ReactElement {
  const snapshot = useSyncExternalStore(
    (onChange) => cloudSync.subscribe(onChange),
    () => cloudSync.getSnapshot(),
    () => cloudSync.getSnapshot(),
  );

  // Ticks the relative-time label ("2m ago" → "3m ago") without the
  // snapshot itself changing — a plain re-render timer, not store state.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <CloudSyncControlContent
      snapshot={snapshot}
      now={now}
      onSignIn={(username, password) => cloudSync.signIn(username, password)}
      onSignOut={() => cloudSync.signOut()}
      onReload={() => void cloudSync.reload()}
      onOverwrite={() => void cloudSync.overwrite()}
      onDismissSyncGate={() => cloudSync.dismissSyncGate()}
    />
  );
}
