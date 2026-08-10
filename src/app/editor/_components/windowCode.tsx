"use client";

import { useEffect, useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { Diagnostic } from "@/lib/lang";
import {
  GOBLIN_LANGUAGE_ID,
  registerGoblinCompletions,
  registerGoblinLanguage,
} from "@/app/editor/_lib/goblinLanguage";
import { editorStore, useEditorStore } from "@/app/editor/_store/editorStore";

/** Stable empty fallback — selectors must not mint a new array per render. */
const NO_DIAGNOSTICS: Diagnostic[] = [];

function toMarker(monaco: Monaco, d: Diagnostic): editor.IMarkerData {
  return {
    severity:
      d.severity === "error"
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
    code: d.code,
    message: d.message,
    // Diagnostic ranges are 0-based/end-exclusive; Monaco is 1-based.
    startLineNumber: d.range.startLine + 1,
    startColumn: d.range.startCol + 1,
    endLineNumber: d.range.endLine + 1,
    endColumn: d.range.endCol + 1,
  };
}

/** Push markers into Monaco. Returns false when Monaco isn't mounted yet —
 * the caller must not record the diagnostics as applied. */
function applyMarkers(
  monaco: Monaco | null,
  editorInstance: editor.IStandaloneCodeEditor | null,
  diagnostics: readonly Diagnostic[],
): boolean {
  const model = editorInstance?.getModel();
  if (!monaco || !model) return false;
  monaco.editor.setModelMarkers(
    model,
    GOBLIN_LANGUAGE_ID,
    diagnostics.map((d) => toMarker(monaco, d)),
  );
  return true;
}

/** Structural equality over exactly the fields toMarker reads (each compile
 * mints fresh objects, so identity says nothing). Two empty lists — the
 * steady state of clean code — compare equal trivially. */
function diagnosticsEqual(a: readonly Diagnostic[], b: readonly Diagnostic[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((d, i) => {
    const e = b[i];
    return (
      d.code === e.code &&
      d.severity === e.severity &&
      d.message === e.message &&
      d.range.startLine === e.range.startLine &&
      d.range.startCol === e.range.startCol &&
      d.range.endLine === e.range.endLine &&
      d.range.endCol === e.range.endCol
    );
  });
}

export default function WindowCode() {
  const code = useEditorStore((s) => s.code);
  const setCode = useEditorStore((s) => s.setCode);
  // ALL severities of the LATEST compile, good or bad (§4.2): the code
  // window shows live errors even while preview/grid hold the last good
  // result. The store owns the compile and its 300 ms cadence.
  const diagnostics = useEditorStore((s) => s.compile?.diagnostics ?? NO_DIAGNOSTICS);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const appliedRef = useRef<readonly Diagnostic[] | null>(null);

  useEffect(() => {
    // Fast path: every debounced compile mints a fresh diagnostics array,
    // but the contents rarely change — skip the setModelMarkers call (and
    // its per-300ms churn) when they haven't.
    if (appliedRef.current !== null && diagnosticsEqual(appliedRef.current, diagnostics)) {
      return;
    }
    if (applyMarkers(monacoRef.current, editorRef.current, diagnostics)) {
      appliedRef.current = diagnostics;
    }
  }, [diagnostics]);

  return (
    <div className="h-full w-full bg-gray-900 text-white">
      <Editor
        height="100%"
        defaultLanguage={GOBLIN_LANGUAGE_ID}
        theme="vs-dark"
        value={code}
        beforeMount={registerGoblinLanguage}
        onMount={(editorInstance, monaco) => {
          editorRef.current = editorInstance;
          monacoRef.current = monaco;
          // Completions read the store LAZILY per invocation, so they track
          // every compile without re-registration (§6.3: latest bindings,
          // last good schema as the fallback name source).
          registerGoblinCompletions(monaco, () => {
            const s = editorStore.getState();
            return { bindings: s.compile?.bindings ?? null, schema: s.lastGoodSchema };
          });
          // Monaco mounts async — pull the freshest compile rather than the
          // diagnostics captured when this closure rendered.
          const current = editorStore.getState().compile?.diagnostics ?? NO_DIAGNOSTICS;
          if (applyMarkers(monaco, editorInstance, current)) {
            appliedRef.current = current;
          }
        }}
        onChange={(value) => setCode(value ?? "")}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false, // Prevents unnecessary scrolling
          // Icon-code completion works INSIDE `code:` strings (§6.3); Monaco
          // disables string quick-suggestions by default.
          quickSuggestions: { other: true, comments: false, strings: true },
        }}
      />
    </div>
  );
}
