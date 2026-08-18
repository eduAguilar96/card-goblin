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
 * verbatim: role="dialog" aria-modal, focus moves in on open and is
 * restored to the opener on close, Tab wraps at the dialog's own ends via
 * dialogFocusTrap.ts's `focusableElementsIn` (the shared fix for the
 * hidden-input trap bug both existing dialogs cite), and Escape/backdrop
 * close it — all suppressed while a sign-in request is in flight, same rule
 * as the PDF modal's `working` guard.
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
 * implementation detail). */
export function cloudStatusLabel(snapshot: CloudSyncSnapshot, nowMs: number): string {
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
  onSubmit(password: string): Promise<SignInResult>;
  /** Test seams (no interaction driver in this project — same pattern as
   * PdfExportModal's initialMarginText/initialFailure). */
  initialPassword?: string;
  initialError?: string | null;
  initialWorking?: boolean;
}

export function SignInDialog({
  onClose,
  onSubmit,
  initialPassword = "",
  initialError = null,
  initialWorking = false,
}: SignInDialogProps): ReactElement {
  const [password, setPassword] = useState(initialPassword);
  const [error, setError] = useState<string | null>(initialError);
  const [working, setWorking] = useState(initialWorking);
  const dialogRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus the password field on open; restore the opener's focus on close
  // (every close path — Escape, backdrop, Cancel, a successful submit —
  // unmounts this component the same way, so one cleanup covers all of
  // them). Effects never run in renderToStaticMarkup; covered by the manual
  // browser checklist, same as pdfExportModal.tsx.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (passwordRef.current ?? dialogRef.current)?.focus();
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

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working || password.length === 0) return;
    setWorking(true);
    setError(null);
    const result = await onSubmit(password);
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
            Password
            <input
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={working}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "cloud-signin-error" : undefined}
              onChange={(event) => setPassword(event.currentTarget.value)}
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
              disabled={working || password.length === 0}
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

export interface CloudSyncControlContentProps {
  snapshot: CloudSyncSnapshot;
  /** Injected so the relative-time label is deterministic in tests and so
   * the connected wrapper controls its own refresh cadence. */
  now: number;
  onSignIn(password: string): Promise<SignInResult>;
  onSignOut(): void;
  onReload(): void;
  onOverwrite(): void;
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
  initialDialogOpen = false,
}: CloudSyncControlContentProps): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(initialDialogOpen);

  if (snapshot.status === "signed-out") {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          title="Sign in to sync this project across devices"
          className={QUIET_BUTTON}
        >
          Sign in
        </button>
        {dialogOpen && (
          <SignInDialog
            onClose={() => setDialogOpen(false)}
            onSubmit={onSignIn}
          />
        )}
      </>
    );
  }

  const labelColor =
    snapshot.status === "behind"
      ? "text-amber-400"
      : snapshot.status === "offline"
        ? "text-gray-500"
        : "text-gray-400";

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusDot status={snapshot.status} />
      <span className={labelColor} title={snapshot.errorMessage ?? undefined}>
        {cloudStatusLabel(snapshot, now)}
      </span>
      {snapshot.status === "behind" && (
        <>
          <button
            type="button"
            onClick={onReload}
            title="Discard this browser's unsynced changes and load the server's copy"
            className="rounded border border-amber-800 px-1.5 text-amber-300 hover:border-amber-500 hover:text-amber-200"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            title="Keep this browser's copy and overwrite the server with it"
            className="rounded border border-amber-800 px-1.5 text-amber-300 hover:border-amber-500 hover:text-amber-200"
          >
            Overwrite
          </button>
        </>
      )}
      <button type="button" onClick={onSignOut} className={QUIET_BUTTON}>
        Sign out
      </button>
    </span>
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
      onSignIn={(password) => cloudSync.signIn(password)}
      onSignOut={() => cloudSync.signOut()}
      onReload={() => void cloudSync.reload()}
      onOverwrite={() => void cloudSync.overwrite()}
    />
  );
}
