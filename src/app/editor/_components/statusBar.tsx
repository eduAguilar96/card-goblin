"use client";

/**
 * The editor-wide status bar (DESIGN.md §5 task 7, grid review MINOR-2): ONE
 * compact line across the editor bottom, in dark chrome, unifying what used
 * to be the preview's private status line:
 *
 *   N cards · M problems · K flagged cells · X pristine rows excluded
 *   [ + the stale indicator while the latest compile is broken ]
 *
 * Sourcing rules (why each number reads what it reads):
 * - cards — from `lastGoodModel`: the count of cards the preview is showing
 *   (keep-last-good, §4.2).
 * - problems — errors + warnings of the CURRENT compile's diagnostics: what
 *   Monaco squiggles right now, good compile or not.
 * - flagged cells — distinct cells carrying D001–D003 in the CURRENT
 *   compile's dataDiagnostics: exactly the cells the grid paints red
 *   (windowSpreadsheet reads the same source; buildFlagIndex dedupes
 *   multiple diagnostics on one cell).
 * - pristine rows excluded — the CURRENT compile's ◆29 exclusions, matching
 *   the rows the grid dims.
 * - stale — `isStale` (§4.2): the compile is broken, so preview and grid
 *   tabs are holding the last good state while the counts above track the
 *   live (broken) compile.
 *
 * The right side is the project-lifecycle surface: the §6.2 autosave notes (a
 * quiet "autosave off" when storage is unusable this session) and reset, plus
 * the §7.1 project-file pair (Export / Import, projectFile.tsx) and the §7.6
 * cloud sync control (cloudSyncControl.tsx — "Sign in", or a status dot +
 * Sign out once signed in). Destructive actions (reset, import) sit behind
 * inline two-step confirms (no browser confirm() — they must live in the
 * same dark chrome and be statically renderable for tests).
 *
 * Split (same pattern as the other windows): `StatusBar` is the thin store
 * subscription; `StatusBarContent` (exported for tests) takes the store
 * surface as props for renderToStaticMarkup-driven tests.
 */

import { useState, type ReactElement } from "react";
import { buildFlagIndex } from "@/app/editor/_components/gridModel";
import { AssetsDrawerButton } from "@/app/editor/_components/assetsDrawer";
import {
  exportEditorProject,
  importEditorProject,
  ProjectFileButtons,
} from "@/app/editor/_components/projectFile";
import CloudSyncControl from "@/app/editor/_components/cloudSyncControl";
import { resetEditorToDemo } from "@/app/editor/_store/persistence";
import type { StoredAsset } from "@/app/editor/_store/assetStore";
import {
  useEditorStore,
  type CompileState,
  type EditorSeed,
  type LastGoodModel,
} from "@/app/editor/_store/editorStore";

export default function StatusBar(): ReactElement {
  const compile = useEditorStore((s) => s.compile);
  const lastGood = useEditorStore((s) => s.lastGoodModel);
  const isStale = useEditorStore((s) => s.isStale);
  const autosaveDisabled = useEditorStore((s) => s.autosaveDisabled);
  return (
    <StatusBarContent
      compile={compile}
      lastGood={lastGood}
      isStale={isStale}
      autosaveDisabled={autosaveDisabled}
      onReset={resetEditorToDemo}
      onExportProject={exportEditorProject}
      onImportProject={importEditorProject}
    />
  );
}

export interface StatusBarContentProps {
  compile: CompileState | null;
  lastGood: LastGoodModel | null;
  isStale: boolean;
  autosaveDisabled: boolean;
  onReset(): void;
  onExportProject(): void | Promise<void>;
  onImportProject(seed: EditorSeed, assets: readonly StoredAsset[]): void;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function StatusBarContent({
  compile,
  lastGood,
  isStale,
  autosaveDisabled,
  onReset,
  onExportProject,
  onImportProject,
}: StatusBarContentProps): ReactElement {
  const cards = (lastGood?.model.decks ?? []).reduce((n, deck) => n + deck.cards.length, 0);
  const diagnostics = compile?.diagnostics ?? [];
  const problems = diagnostics.length;
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const flaggedCells = buildFlagIndex(compile?.dataDiagnostics ?? []).size;
  const excluded = Object.values(compile?.excludedPristineRows ?? {}).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    // adversarial review item 2: this bar used to be ONE `overflow-hidden
    // whitespace-nowrap` line, so at ~1000px with the stale + autosave-off
    // indicators on, the right-hand action group (Assets / Export / Import /
    // Reset — or an ARMED confirm's answer buttons) got clipped out of view
    // along with the counters. Restructured so the two halves degrade
    // differently: the counters (below) are low-stakes and allowed to
    // truncate/clip; the action group (ml-auto span) never does — it wraps
    // onto additional lines instead, and nothing in it forces nowrap, so
    // even a long confirm sentence can break onto a second line rather than
    // vanish. `flex-wrap` here is defense in depth for the same reason.
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <span>{plural(cards, "card")}</span>
        <Dot />
        <span
          className={
            problems === 0 ? undefined : hasErrors ? "text-red-400" : "text-amber-400"
          }
        >
          {plural(problems, "problem")}
        </span>
        <Dot />
        <span className={flaggedCells > 0 ? "text-red-400" : undefined}>
          {plural(flaggedCells, "flagged cell")}
        </span>
        <Dot />
        <span>{plural(excluded, "pristine row")} excluded</span>
      </div>
      <span className="ml-auto flex flex-wrap items-center gap-3">
        {isStale && (
          <span className="text-amber-400">
            stale — preview &amp; tabs show last good state
          </span>
        )}
        {autosaveDisabled && (
          <span
            className="text-gray-500"
            title="This browser refused storage (private mode or quota) — changes won't survive a reload."
          >
            autosave off
          </span>
        )}
        <AssetsDrawerButton />
        <ProjectFileButtons onExport={onExportProject} onImport={onImportProject} />
        <CloudSyncControl />
        <ResetToDemoButton onReset={onReset} />
      </span>
    </div>
  );
}

/**
 * "Reset to demo" with its inline confirm (§6.2): the first click only arms
 * the question — the destructive click is always a second, differently
 * colored one. `initialConfirming` is a test seam (no interaction driver in
 * this project), letting both states render statically.
 */
export function ResetToDemoButton({
  onReset,
  initialConfirming = false,
}: {
  onReset(): void;
  initialConfirming?: boolean;
}): ReactElement {
  const [confirming, setConfirming] = useState(initialConfirming);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200"
      >
        Reset to demo
      </button>
    );
  }
  return (
    // flex-wrap (item 2): the answer buttons of an armed confirm must never
    // clip — if the sentence doesn't fit beside Reset/Keep, it wraps rather
    // than pushing them out of the visible bar.
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-amber-400">
        Replace your project (and your uploaded assets) with the demo?
      </span>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          onReset();
        }}
        className="rounded border border-red-900 px-1.5 text-red-400 hover:border-red-500 hover:text-red-300"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-gray-700 px-1.5 text-gray-400 hover:border-gray-500 hover:text-gray-200"
      >
        Keep
      </button>
    </span>
  );
}

function Dot(): ReactElement {
  return (
    <span aria-hidden className="text-gray-600">
      ·
    </span>
  );
}
