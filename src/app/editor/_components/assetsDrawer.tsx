"use client";

/**
 * Assets drawer (DESIGN.md §7.1b, M3): the local-image-library UI off the
 * status bar. Upload (file picker + drag-drop), a thumbnail grid, per-asset
 * rename (identifier-validated, inline error) and delete (two-step confirm),
 * and copy-reference (`asset:<name>`, ready to paste into `src:`). Dialog
 * chrome mirrors pdfExportModal's a11y (role="dialog", Escape/backdrop/focus
 * trap); the destructive confirm mirrors ResetToDemoButton/ProjectFileButtons
 * (the second, differently colored click is always the destructive one).
 *
 * Split like the other windows: `AssetsDrawer` (default-adjacent, store-
 * connected) subscribes to the `assetStore` singleton via
 * `useSyncExternalStore` and injects its real actions; `AssetsDrawerContent`
 * takes the store surface as props + injected actions, so it renders
 * statically for tests (no interaction driver in this project — `initial*`
 * props show each state, the same pattern as ResetToDemoButton's
 * `initialConfirming` / ProjectFileButtons' `initialPending`).
 *
 * Thumbnails are resolved lazily per asset (`getBytes` → object URL) and
 * revoked both as assets drop out of the list (rename/delete elsewhere) and
 * on unmount (drawer close) — §7.1b: "thumbnail list ... object URLs,
 * revoked on close".
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ASSET_SRC_SCHEME } from "@/lib/lang";
import {
  assetStore,
  isValidAssetName,
  type AssetMeta,
  type StoredAsset,
} from "@/app/editor/_store/assetStore";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * A dropped/picked filename → a starting asset name (§7.1b: upload derives a
 * name rather than prompting first — rename is always available after).
 * Strips the extension, folds every run of non-identifier characters to `_`,
 * prefixes `a` if the result wouldn't start with a letter (ASSET_NAME_PATTERN
 * requires it), falls back to "asset" if nothing survives, then suffixes
 * `_2`, `_3`, … to dodge a collision with `existing`. Pure and exported for
 * tests — always returns a name `isValidAssetName` accepts.
 */
export function deriveAssetName(filename: string, existing: ReadonlySet<string>): string {
  const stem = filename.replace(/\.[^./]+$/, "");
  let base = stem.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+/, "");
  if (base === "") base = "asset";
  if (!/^[a-zA-Z]/.test(base)) base = `a${base}`;
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** `"asset:" + name` — the string a `src:` line pastes in verbatim. Pure and
 * exported so the copy button and its tests share one spelling. */
export function assetReference(name: string): string {
  return `${ASSET_SRC_SCHEME}${name}`;
}

// ---------------------------------------------------------------------------
// Thumbnails (object URLs, lazily resolved, revoked on drop/unmount)
// ---------------------------------------------------------------------------

function blobOf(asset: StoredAsset): Blob {
  return asset.bytes instanceof Blob
    ? asset.bytes
    : // See cardSvg.tsx's identical cast note: valid BlobPart at runtime;
      // lib.dom's type just can't prove it for a plain Uint8Array.
      new Blob([asset.bytes as BlobPart], { type: asset.mime });
}

/** name → object URL (`null` once resolution settled on "no bytes"; absent =
 * still loading). Revokes URLs for names that drop out of `assets` and every
 * URL on unmount — the two revoke rules §7.1b's thumbnail grid asks for. */
function useThumbnails(
  assets: readonly AssetMeta[],
  getBytes: (name: string) => Promise<StoredAsset | null>,
): ReadonlyMap<string, string | null> {
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  // m6 (adversarial): `getBytes` arrives as a fresh inline arrow from
  // `AssetsDrawer` on every one of ITS re-renders (which cascade from any
  // ancestor re-render, e.g. the status bar recompiling on an unrelated
  // keystroke — not just real asset changes). Depending on it directly
  // would re-run the effect below every such render, redoing already-
  // settled thumbnail work and risking a create/revoke race. Read it
  // through a ref instead — always current, never a dependency.
  const getBytesRef = useRef(getBytes);
  getBytesRef.current = getBytes;

  useEffect(() => {
    const names = new Set(assets.map((a) => a.name));
    setUrls((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [name, url] of prev) {
        if (!names.has(name)) {
          if (url) URL.revokeObjectURL(url);
          next.delete(name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    let cancelled = false;
    for (const meta of assets) {
      if (urlsRef.current.has(meta.name)) continue;
      void getBytesRef.current(meta.name).then((asset) => {
        if (cancelled) return;
        const url = asset ? URL.createObjectURL(blobOf(asset)) : null;
        setUrls((prev) => new Map(prev).set(meta.name, url));
      });
    }
    return () => {
      cancelled = true;
    };
    // getBytes intentionally excluded (see getBytesRef above) — only a real
    // change in WHICH assets exist should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  // Revoke everything on unmount (drawer close, §7.1b).
  useEffect(
    () => () => {
      for (const url of urlsRef.current.values()) {
        if (url) URL.revokeObjectURL(url);
      }
    },
    [],
  );

  return urls;
}

// ---------------------------------------------------------------------------
// Content (store-free)
// ---------------------------------------------------------------------------

export interface AssetsDrawerActions {
  upload(name: string, mime: string, bytes: Blob | Uint8Array): Promise<AssetMeta>;
  rename(oldName: string, newName: string): Promise<void>;
  remove(name: string): Promise<void>;
  getBytes(name: string): Promise<StoredAsset | null>;
}

export interface AssetsDrawerContentProps extends AssetsDrawerActions {
  /** Sorted by name (assetStore's contract). */
  assets: AssetMeta[];
  disabled: boolean;
  onClose(): void;
  /** Test seams (no interaction driver in this project) — render each state
   * statically instead of simulating the click that reaches it. */
  initialError?: string | null;
  initialConfirmDeleteName?: string | null;
  initialRenamingName?: string | null;
  initialRenameError?: string | null;
}

const QUIET_BUTTON =
  "rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200";
const FIELD_CLASS =
  "rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-xs text-gray-200";

export function AssetsDrawerContent({
  assets,
  disabled,
  onClose,
  upload,
  rename,
  remove,
  getBytes,
  initialError = null,
  initialConfirmDeleteName = null,
  initialRenamingName = null,
  initialRenameError = null,
}: AssetsDrawerContentProps): ReactElement {
  const [error, setError] = useState<string | null>(initialError);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(
    initialConfirmDeleteName,
  );
  const [renamingName, setRenamingName] = useState<string | null>(initialRenamingName);
  const [renameDraft, setRenameDraft] = useState<string>(initialRenamingName ?? "");
  const [renameError, setRenameError] = useState<string | null>(initialRenameError);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const thumbnails = useThumbnails(assets, getBytes);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleFiles = async (files: Iterable<File>): Promise<void> => {
    const existingNames = new Set(assets.map((a) => a.name));
    let lastError: string | null = null;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        lastError = `“${file.name}” isn't an image file.`;
        continue;
      }
      const name = deriveAssetName(file.name, existingNames);
      existingNames.add(name);
      try {
        await upload(name, file.type, file);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Upload failed.";
      }
    }
    setError(lastError);
  };

  const startRename = (name: string): void => {
    setRenamingName(name);
    setRenameDraft(name);
    setRenameError(null);
  };

  const commitRename = async (oldName: string): Promise<void> => {
    if (!isValidAssetName(renameDraft)) {
      setRenameError(
        "Use letters, numbers, and underscores, starting with a letter.",
      );
      return;
    }
    try {
      await rename(oldName, renameDraft);
      setRenamingName(null);
      setRenameError(null);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed.");
    }
  };

  const commitDelete = async (name: string): Promise<void> => {
    setConfirmDeleteName(null);
    try {
      await remove(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const copyReference = (name: string): void => {
    const text = assetReference(name);
    const clipboard: { writeText?(text: string): Promise<void> } | undefined =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(text).then(() => {
      setCopiedName(name);
      setTimeout(() => setCopiedName((cur) => (cur === name ? null : cur)), 1500);
    });
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.hasAttribute("disabled"));
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

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assets-drawer-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex max-h-[80vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border p-4 text-sm text-gray-200 shadow-xl outline-none ${
          dragOver ? "border-blue-500 bg-gray-800/95" : "border-gray-700 bg-gray-800"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="assets-drawer-title" className="text-base font-semibold text-white">
            Assets
          </h2>
          <button type="button" onClick={onClose} className={QUIET_BUTTON}>
            Close
          </button>
        </div>

        {disabled && (
          <p
            role="status"
            className="mb-3 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-500"
          >
            Local image storage isn&apos;t available in this browser (private mode or
            a storage quota) — uploads are off for this session.
          </p>
        )}

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload image…
          </button>
          <span className="text-xs text-gray-500">
            or drag and drop onto this window — up to 2 MB each
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.currentTarget.files;
              event.currentTarget.value = "";
              if (files && files.length > 0) void handleFiles(files);
            }}
          />
        </div>

        {error !== null && (
          <p
            role="alert"
            className="mb-3 rounded border border-red-900 bg-red-950 px-2 py-1 text-xs text-red-300"
          >
            {error}
          </p>
        )}

        {assets.length === 0 ? (
          <p className="rounded border border-gray-700 bg-gray-900 px-2 py-4 text-center text-xs text-gray-500">
            No assets yet — upload an image to reference it as{" "}
            <code>{assetReference("name")}</code> in <code>src:</code>.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {assets.map((meta) => {
              const thumb = thumbnails.get(meta.name);
              return (
                <li
                  key={meta.name}
                  className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-900 p-2"
                >
                  <div className="flex h-16 items-center justify-center overflow-hidden rounded bg-gray-800">
                    {thumb ? (
                      // Object URL thumbnail — not a static asset next/image
                      // can optimize (and its dimensions aren't known ahead
                      // of the blob load), so a plain <img> is correct here.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt={meta.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-gray-600">
                        {thumb === null ? "no preview" : "loading…"}
                      </span>
                    )}
                  </div>

                  {renamingName === meta.name ? (
                    <div className="flex flex-col gap-1">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.currentTarget.value)}
                        className={FIELD_CLASS}
                      />
                      {renameError !== null && (
                        <span role="alert" className="text-[10px] text-red-400">
                          {renameError}
                        </span>
                      )}
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void commitRename(meta.name)}
                          className={QUIET_BUTTON}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingName(null);
                            setRenameError(null);
                          }}
                          className={QUIET_BUTTON}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="Rename"
                      onClick={() => startRename(meta.name)}
                      className="truncate text-left text-xs text-gray-200 hover:underline"
                    >
                      {meta.name}
                    </button>
                  )}

                  {confirmDeleteName === meta.name ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-amber-400">
                        Delete “{meta.name}”?
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void commitDelete(meta.name)}
                          className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-400 hover:border-red-500 hover:text-red-300"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteName(null)}
                          className={QUIET_BUTTON}
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => copyReference(meta.name)}
                        title={`Copy ${assetReference(meta.name)}`}
                        className={QUIET_BUTTON}
                      >
                        {copiedName === meta.name ? "Copied" : "Copy ref"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteName(meta.name)}
                        className={QUIET_BUTTON}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store-connected wrapper + status-bar button
// ---------------------------------------------------------------------------

/** Store-connected drawer: subscribes to the `assetStore` singleton and
 * injects its real actions into `AssetsDrawerContent`. */
export function AssetsDrawer({ onClose }: { onClose(): void }): ReactElement {
  const snapshot = useSyncExternalStore(
    (onChange) => assetStore.subscribe(() => onChange()),
    () => assetStore.getSnapshot(),
    () => assetStore.getSnapshot(),
  );
  return (
    <AssetsDrawerContent
      assets={snapshot.assets}
      disabled={snapshot.disabled}
      onClose={onClose}
      upload={(name, mime, bytes) => assetStore.upload(name, mime, bytes)}
      rename={(oldName, newName) => assetStore.rename(oldName, newName)}
      remove={(name) => assetStore.remove(name)}
      getBytes={(name) => assetStore.getBytes(name)}
    />
  );
}

/** The status bar's "Assets" button with a count badge, and the drawer it
 * opens. Store-free aside from its own open/closed state (mirrors
 * ExportPdfButtonContent) — the count comes from the same `useSyncExternalStore`
 * snapshot the drawer itself reads. */
export function AssetsDrawerButton(): ReactElement {
  const [open, setOpen] = useState(false);
  const count = useSyncExternalStore(
    (onChange) => assetStore.subscribe(() => onChange()),
    () => assetStore.getSnapshot().assets.length,
    () => 0,
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Local image assets — upload art to reference with asset:<name>"
        className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200"
      >
        Assets{count > 0 ? ` (${count})` : ""}
      </button>
      {open && <AssetsDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
