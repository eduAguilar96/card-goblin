/**
 * Monaco language registration for Goblin script (DESIGN.md §4.2).
 *
 * A Monarch tokenizer good enough for vs-dark's built-in token colors:
 * - `#` starts a comment UNLESS followed by exactly 6 hex digits and no
 *   further identifier character — then it is a `#RRGGBB` color literal
 *   (matches the lexer's disambiguation exactly, §3.1).
 * - Strings are single-line with `[ref]` and Number-only `[ref:0N]`
 *   interpolation highlighted inside
 *   (`[[` is the literal-`[` escape, §3.5; `\n` and `\\` are the M3 §3.1
 *   escapes — anything else after `\` paints invalid, matching E001).
 * - Block openers (`Enum: … Repeat: Front: Back:`), contextual node openers
 *   (`If:`/`Else:`), contextual `let name:`/`param name:`, and expression keywords
 *   (`if then else and or not as case column`) are keywords; lowercase
 *   `key:` lines are property keys; other capitalized identifiers (enum
 *   names, templates, `Text`/`Number` column types, `Enum.Case` members)
 *   read as types; `[refs]` read as variables.
 */

import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { CSS_COLOR_NAMES, type Bindings } from "@/lib/lang";
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
  "TextBox",
  "Icon",
  "Image",
  "Qr",
  "Repeat",
  "Front",
  "Back",
];

const EXPR_KEYWORDS = ["if", "then", "else", "and", "or", "not", "as", "case", "column"];

/** Exported as pure regexes so contextual-keyword compatibility stays pinned
 * without needing Monaco in the language tests. */
export const GOBLIN_CONTEXTUAL_LET_RE = /^(\s*)(let)(?=\s+[A-Za-z][A-Za-z0-9_]*\s*:)/;
export const GOBLIN_CONTEXTUAL_PARAM_RE =
  /^(\s*)(param)(?=\s+[A-Za-z][A-Za-z0-9_]*\s*:)/;
export const GOBLIN_CONTEXTUAL_BRANCH_RE = /^(\s*)(If|Else)(?=\s*:)/;
export const GOBLIN_CONTEXTUAL_VIRTUAL_RE =
  /^(\s*)(virtual)(?=\s+column\s+[A-Za-z][A-Za-z0-9_]*\s*:)/;
/** Canonical numeric interpolation format: `0` + width 1..64, with no
 * leading zero in the width itself. The checker owns the Number-only rule. */
export const GOBLIN_ZERO_PAD_INTERPOLATION_RE =
  /^\[[A-Za-z][A-Za-z0-9_]*:0(?:[1-9]|[1-5][0-9]|6[0-4])\]$/;
/** The open-tag highlighter uses the compiler's ACTUAL named-color
 * vocabulary, case-insensitively, rather than painting any identifier as a
 * valid color. Scope pairing is deliberately not claimed here: Monarch
 * tokenizes one line lexically, so a recognized open or close tag highlights
 * independently even when its partner is missing. The compiler remains the
 * authority that makes an unbalanced scope raw text. */
const CSS_COLOR_SCOPE_ALTERNATION = [...CSS_COLOR_NAMES]
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join("|");
export const GOBLIN_COLOR_SCOPE_OPEN_RE = new RegExp(
  `\\{color:(?:#[0-9a-fA-F]{6}|${CSS_COLOR_SCOPE_ALTERNATION})\\}`,
  "i",
);
export const GOBLIN_COLOR_SCOPE_CLOSE_RE = /\{\/color\}/;
/** Resolved-text aliases use declaration-name grammar. Whether the named
 * top-level let is Text-valued is semantic and remains the compiler's job. */
export const GOBLIN_ALIAS_MARKER_RE = /(\{alias:)([A-Za-z][A-Za-z0-9_]*)(\})/;

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
      // Contextual forms: do not put these in the global keyword tables.
      // That keeps `column let: Text`, `Template: If`, and `Front: Else`
      // highlighted according to their actual positions.
      [
        GOBLIN_CONTEXTUAL_LET_RE,
        ["white", "keyword"],
      ],
      [GOBLIN_CONTEXTUAL_PARAM_RE, ["white", "keyword"]],
      [GOBLIN_CONTEXTUAL_BRANCH_RE, ["white", "keyword"]],
      [GOBLIN_CONTEXTUAL_VIRTUAL_RE, ["white", "keyword"]],
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
      [/==|!=|<=|>=|[=<>+\-*/%().:]/, "operator"],
      [/[ \t]+/, "white"],
    ],
    string: [
      [/\[\[/, "string.escape"],
      [/\{\{/, "string.escape"],
      // `\n` and `\\` are the only backslash escapes (§3.1 M3); any other
      // `\`-sequence is E001 in the lexer, painted invalid here to match.
      [/\\[n\\]/, "string.escape"],
      [/\\./, "string.invalid"],
      [/\\/, "string.invalid"],
      [
        /(\[[A-Za-z][A-Za-z0-9_]*)(:0(?:[1-9]|[1-5][0-9]|6[0-4]))(\])/,
        ["variable", "number", "variable"],
      ],
      [/\[[A-Za-z][A-Za-z0-9_]*\]/, "variable"],
      [GOBLIN_ALIAS_MARKER_RE, ["tag", "variable", "tag"]],
      [GOBLIN_COLOR_SCOPE_OPEN_RE, "tag"],
      [GOBLIN_COLOR_SCOPE_CLOSE_RE, "tag"],
      [/[^"[\\{]+/, "string"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      [/\[/, "string"],
      [/\{/, "string"],
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
    triggerCharacters: ["[", "]", ".", '"', ":", "{"],
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
          ...(s.snippet
            ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
            : {}),
          // Tier first, then the pure module's deliberate ordering.
          sortText: `${s.group}_${String(i).padStart(4, "0")}`,
          range: { insert, replace },
        })),
      };
    },
  });
}
