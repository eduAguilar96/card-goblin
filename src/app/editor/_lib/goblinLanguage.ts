/**
 * Monaco language registration for Goblin script (DESIGN.md §4.2).
 *
 * A Monarch tokenizer good enough for vs-dark's built-in token colors:
 * - `#` starts a comment UNLESS followed by exactly 6 hex digits and no
 *   further identifier character — then it is a `#RRGGBB` color literal
 *   (matches the lexer's disambiguation exactly, §3.1).
 * - Strings are single-line with `[ref]` interpolation highlighted inside
 *   (`[[` is the literal-`[` escape, §3.5).
 * - Block openers (`Enum: … Repeat: Front: Back:`) and expression keywords
 *   (`if then else and or not as case column`) are keywords; lowercase
 *   `key:` lines are property keys; other capitalized identifiers (enum
 *   names, templates, `Text`/`Number` column types, `Enum.Case` members)
 *   read as types; `[refs]` read as variables.
 */

import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import type { Bindings } from "@/lib/lang";
import type { SchemaSnapshot } from "@/app/editor/_store/editorStore";
import {
  buildCompletionSnapshot,
  computeCompletions,
  type SuggestionKind,
} from "@/app/editor/_lib/goblinCompletion";

export const GOBLIN_LANGUAGE_ID = "goblin";

const BLOCK_OPENERS = [
  "Enum",
  "Sheet",
  "Template",
  "Card",
  "Rectangle",
  "Text",
  "Icon",
  "Repeat",
  "Front",
  "Back",
];

const EXPR_KEYWORDS = ["if", "then", "else", "and", "or", "not", "as", "case", "column"];

/** Extra fields (keyword lists) are referenced from `cases` via `@name`. */
const monarchLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  blockOpeners: BLOCK_OPENERS,
  exprKeywords: EXPR_KEYWORDS,
  tokenizer: {
    root: [
      // Color literal vs comment — same rule as the lexer (§3.1 ◆22).
      [/#[0-9a-fA-F]{6}(?![0-9a-zA-Z_])/, "number.hex"],
      [/#.*/, "comment"],
      // Unterminated string: consume to end of line WITHOUT entering the
      // string state — strings are single-line (§3.5), and one unclosed
      // quote must not paint every following line as string (⚑11's own
      // error class). Must precede the string-open rule.
      [/"[^"]*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
      // `[ref]` outside strings (◆30: brackets always mean data refs).
      [/\[[A-Za-z][A-Za-z0-9_]*\]/, "variable"],
      [/\d+(\.\d+)?/, "number"],
      // Capitalized word before ':' — block opener (or a stray block-ish word).
      [
        /[A-Z][A-Za-z0-9_]*(?=\s*:)/,
        { cases: { "@blockOpeners": "keyword", "@default": "type.identifier" } },
      ],
      // Lowercase word before ':' — property key (◆30: ordinary identifiers).
      [/[a-z][A-Za-z0-9_]*(?=\s*:)/, "attribute.name"],
      // Capitalized value identifier: enum/template/sheet names, column
      // types, `Enum.Case` parts.
      [/[A-Z][A-Za-z0-9_]*/, "type.identifier"],
      [
        /[a-z][A-Za-z0-9_]*/,
        { cases: { "@exprKeywords": "keyword", "@default": "identifier" } },
      ],
      [/==|!=|<=|>=|[<>+\-*/%().:]/, "operator"],
      [/[ \t]+/, "white"],
    ],
    string: [
      [/\[\[/, "string.escape"],
      [/\[[A-Za-z][A-Za-z0-9_]*\]/, "variable"],
      [/[^"[]+/, "string"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      [/\[/, "string"],
    ],
  },
};

const languageConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "#" },
  brackets: [["(", ")"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
};

/** Idempotent: safe to call from every editor mount. */
export function registerGoblinLanguage(monaco: Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === GOBLIN_LANGUAGE_ID)) {
    return;
  }
  monaco.languages.register({ id: GOBLIN_LANGUAGE_ID, extensions: [".goblin"] });
  monaco.languages.setMonarchTokensProvider(GOBLIN_LANGUAGE_ID, monarchLanguage);
  monaco.languages.setLanguageConfiguration(GOBLIN_LANGUAGE_ID, languageConfiguration);
}

// ---------------------------------------------------------------------------
// Completion provider — a thin adapter over the pure module (DESIGN.md §6.3).
// All context/suggestion logic lives in goblinCompletion.ts, tested without
// Monaco; this layer only converts offsets ↔ positions and item shapes.
// ---------------------------------------------------------------------------

/** What the provider reads from the store on every invocation: the LATEST
 * compile's bindings (mid-edit partials welcome) + the last good schema. */
export interface CompletionSource {
  bindings: Bindings | null;
  schema: SchemaSnapshot | null;
}

function monacoKind(monaco: Monaco, kind: SuggestionKind): languages.CompletionItemKind {
  const k = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "column":
      return k.Field;
    case "variable":
      return k.Variable;
    case "property":
      return k.Property;
    case "element":
      return k.Struct;
    case "keyword":
      return k.Keyword;
    case "enum":
      return k.Enum;
    case "enumCase":
      return k.EnumMember;
    case "color":
      return k.Color;
    case "iconCode":
      return k.Constant;
    case "sheet":
      return k.Class;
    case "template":
      return k.Function;
    case "sizePreset":
      return k.Unit;
    case "value":
      return k.Value;
    case "hint":
      return k.Text;
  }
}

/** One registration per monaco instance — StrictMode double-mounts (and any
 * future second editor) must not duplicate every suggestion. */
const completionsRegistered = new WeakSet<object>();

export function registerGoblinCompletions(
  monaco: Monaco,
  getSource: () => CompletionSource,
): void {
  if (completionsRegistered.has(monaco)) return;
  completionsRegistered.add(monaco);
  monaco.languages.registerCompletionItemProvider(GOBLIN_LANGUAGE_ID, {
    triggerCharacters: ["[", ".", '"', ":"],
    provideCompletionItems(model, position) {
      const { bindings, schema } = getSource();
      const snapshot = buildCompletionSnapshot(bindings, schema);
      const result = computeCompletions(
        model.getValue(),
        model.getOffsetAt(position),
        snapshot,
      );
      const start = model.getPositionAt(result.replaceStart);
      const end = model.getPositionAt(result.replaceEnd);
      const insert = new monaco.Range(
        start.lineNumber,
        start.column,
        position.lineNumber,
        position.column,
      );
      const replace = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      return {
        suggestions: result.suggestions.map((s, i) => ({
          label: s.label,
          insertText: s.insertText,
          detail: s.detail,
          kind: monacoKind(monaco, s.kind),
          // Tier first, then the pure module's deliberate ordering.
          sortText: `${s.group}_${String(i).padStart(4, "0")}`,
          range: { insert, replace },
        })),
      };
    },
  });
}
