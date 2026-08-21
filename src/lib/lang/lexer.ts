/**
 * Indentation-aware lexer for Goblin script (DESIGN.md §3.1, §4.1).
 *
 * Emits INDENT/DEDENT tokens from raw indent columns; the property-line
 * continuation rule is the parser's job (◆23†). Blank lines and comment-only
 * lines are ignored entirely (no NEWLINE, no indent effect). Block-opener
 * words (Enum, Rectangle, …) lex as plain identifiers — they are contextual
 * keywords recognized by the parser in header position only (◆30†). Only the
 * declaration words (`case`, `column`) and expression-structure words
 * (`if then else and or not as`) are reserved and lex as keyword tokens.
 * The binding/control words `let`, `If`, `Else`, and `virtual` deliberately
 * remain plain identifiers: they are contextual forms recognized only in
 * their parser positions, preserving declarations and columns with those names.
 *
 * A parse never throws: all lexical problems become E001 diagnostics and the
 * lexer recovers on the same line.
 */

import type { Diagnostic, Range } from "./diagnostics";
import { syntaxError } from "./diagnostics";
import type { StringPart } from "./ast";

export type Keyword =
  | "case"
  | "column"
  | "if"
  | "then"
  | "else"
  | "and"
  | "or"
  | "not"
  | "as";

/** Declaration + expression-structure words (◆30†). Exported so the wiki's
 * reserved-word list can be tested against it
 * (`src/lib/docs/__tests__/docFacts.test.ts`). */
export const KEYWORDS: ReadonlySet<string> = new Set([
  "case",
  "column",
  "if",
  "then",
  "else",
  "and",
  "or",
  "not",
  "as",
]);

export type Op =
  | ":"
  | "="
  | "("
  | ")"
  | "."
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type Token =
  | { kind: "identifier"; text: string; range: Range }
  | { kind: "keyword"; word: Keyword; range: Range }
  | { kind: "number"; value: number; text: string; range: Range }
  | { kind: "string"; parts: StringPart[]; range: Range }
  | { kind: "color"; value: string; range: Range }
  | { kind: "ref"; name: string; range: Range }
  | { kind: "op"; op: Op; range: Range }
  | { kind: "newline"; range: Range }
  | { kind: "indent"; range: Range }
  | { kind: "dedent"; range: Range }
  | { kind: "eof"; range: Range };

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isIdentChar = (c: string): boolean =>
  isIdentStart(c) || isDigit(c) || c === "_";
const isHex = (c: string): boolean =>
  isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  // Tab/space consistency (§3.1): spaces or tabs, consistent per file.
  // The first indented, non-ignored line fixes the file's indent character;
  // any later deviation (or a single indent mixing both) is reported ONCE.
  let indentChar: " " | "\t" | null = null;
  let mixReported = false;

  const indentStack: number[] = [0];

  const range = (
    line: number,
    startCol: number,
    endCol: number,
    endLine: number = line,
  ): Range => ({ startLine: line, startCol, endLine, endCol });

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Measure indentation.
    let indentEnd = 0;
    while (
      indentEnd < line.length &&
      (line[indentEnd] === " " || line[indentEnd] === "\t")
    ) {
      indentEnd++;
    }

    // Tokenize the rest of the line into a buffer first, so blank and
    // comment-only lines can be skipped without touching the indent stack.
    const lineTokens: Token[] = [];
    lexLineContent(line, li, indentEnd, lineTokens, diagnostics);
    if (lineTokens.length === 0) continue; // blank or comment-only

    // Indent-character consistency check (once per file).
    if (indentEnd > 0 && !mixReported) {
      const indentText = line.slice(0, indentEnd);
      const hasSpace = indentText.includes(" ");
      const hasTab = indentText.includes("\t");
      let mixed = hasSpace && hasTab;
      if (!mixed) {
        const c: " " | "\t" = hasTab ? "\t" : " ";
        if (indentChar === null) indentChar = c;
        else if (indentChar !== c) mixed = true;
      }
      if (mixed) {
        mixReported = true;
        diagnostics.push(
          syntaxError(
            "Indentation mixes tabs and spaces; use one or the other consistently in a file",
            range(li, 0, indentEnd),
          ),
        );
      }
    }

    // INDENT/DEDENT bookkeeping. Dedenting to a level that is not on the
    // stack emits DEDENT(s) then an INDENT — this keeps every line depth
    // representable; the parser judges whether the structure is legal
    // (needed because property-line continuations may sit at arbitrary
    // columns deeper than their key, ◆23†).
    const cur = indentEnd;
    let top = indentStack[indentStack.length - 1];
    if (cur > top) {
      indentStack.push(cur);
      tokens.push({ kind: "indent", range: range(li, 0, cur) });
    } else {
      while (cur < top) {
        indentStack.pop();
        tokens.push({ kind: "dedent", range: range(li, 0, cur) });
        top = indentStack[indentStack.length - 1];
      }
      if (cur > top) {
        indentStack.push(cur);
        tokens.push({ kind: "indent", range: range(li, 0, cur) });
      }
    }

    tokens.push(...lineTokens);
    tokens.push({
      kind: "newline",
      range: range(li, line.length, line.length),
    });
  }

  const lastLine = lines.length - 1;
  const lastCol = lines[lastLine].length;
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ kind: "dedent", range: range(lastLine, lastCol, lastCol) });
  }
  tokens.push({ kind: "eof", range: range(lastLine, lastCol, lastCol) });

  return { tokens, diagnostics };
}

/** Tokenize one physical line's content (after its indentation). */
function lexLineContent(
  line: string,
  li: number,
  start: number,
  out: Token[],
  diagnostics: Diagnostic[],
): void {
  const range = (startCol: number, endCol: number): Range => ({
    startLine: li,
    startCol,
    endLine: li,
    endCol,
  });
  let i = start;

  while (i < line.length) {
    const c = line[i];

    if (c === " " || c === "\t") {
      i++;
      continue;
    }

    if (c === "#") {
      // `#RRGGBB` is a color literal (§3.1); any other `#` starts a comment
      // (◆22). Disambiguation (spec is silent): `#` + exactly 6 hex digits
      // not followed by another identifier character is a color; everything
      // else — including the CSS 3-digit form `#fff` — is a comment.
      const hex = line.slice(i + 1, i + 7);
      const after = line[i + 7];
      if (
        hex.length === 6 &&
        [...hex].every(isHex) &&
        (after === undefined || !isIdentChar(after))
      ) {
        out.push({ kind: "color", value: line.slice(i, i + 7), range: range(i, i + 7) });
        i += 7;
        continue;
      }
      return; // comment to end of line
    }

    if (c === '"') {
      i = lexString(line, li, i, out, diagnostics);
      continue;
    }

    if (c === "[") {
      i = lexRef(line, li, i, out, diagnostics);
      continue;
    }

    if (isDigit(c)) {
      let j = i + 1;
      while (j < line.length && isDigit(line[j])) j++;
      if (j < line.length && line[j] === "." && isDigit(line[j + 1] ?? "")) {
        j++;
        while (j < line.length && isDigit(line[j])) j++;
      }
      const text = line.slice(i, j);
      out.push({ kind: "number", value: Number(text), text, range: range(i, j) });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < line.length && isIdentChar(line[j])) j++;
      const text = line.slice(i, j);
      if (KEYWORDS.has(text)) {
        out.push({ kind: "keyword", word: text as Keyword, range: range(i, j) });
      } else {
        out.push({ kind: "identifier", text, range: range(i, j) });
      }
      i = j;
      continue;
    }

    // Operators (two-char first).
    const two = line.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      out.push({ kind: "op", op: two, range: range(i, i + 2) });
      i += 2;
      continue;
    }
    if ("()+-*/%<>:.".includes(c)) {
      out.push({ kind: "op", op: c as Op, range: range(i, i + 1) });
      i++;
      continue;
    }
    if (c === "=") {
      // ◆48's one assignment-looking token is declaration punctuation, not
      // an expression operator. Preserve the long-standing `x = 1` hint
      // everywhere else so equality mistakes still point users to `==`.
      const virtualPrefix = line.slice(start, i);
      if (
        /^virtual\s+column\s+[A-Za-z][A-Za-z0-9_]*\s*:\s*[A-Za-z][A-Za-z0-9_]*\s*$/.test(
          virtualPrefix,
        )
      ) {
        out.push({ kind: "op", op: "=", range: range(i, i + 1) });
      } else {
        diagnostics.push(
          syntaxError('Unexpected "="; comparison is written "=="', range(i, i + 1)),
        );
      }
      i++;
      continue;
    }

    diagnostics.push(
      syntaxError(`Unexpected character ${JSON.stringify(c)}`, range(i, i + 1)),
    );
    i++;
  }
}

/** Lex a `[name]` data reference outside a string. Returns the index after it. */
function lexRef(
  line: string,
  li: number,
  start: number,
  out: Token[],
  diagnostics: Diagnostic[],
): number {
  const range = (startCol: number, endCol: number): Range => ({
    startLine: li,
    startCol,
    endLine: li,
    endCol,
  });
  let j = start + 1;
  let name = "";
  if (j < line.length && isIdentStart(line[j])) {
    const nameStart = j;
    while (j < line.length && isIdentChar(line[j])) j++;
    name = line.slice(nameStart, j);
  }
  if (name !== "" && line[j] === "]") {
    // Reserved words inside brackets (e.g. `[if]`) are accepted here; brackets
    // always denote data refs (◆30) and the checker reports the unknown name.
    out.push({ kind: "ref", name, range: range(start, j + 1) });
    return j + 1;
  }
  const close = line.indexOf("]", start + 1);
  if (name !== "" && line[j] === ":" && close !== -1) {
    diagnostics.push(
      syntaxError(
        `Formatted interpolation is only allowed inside a quoted string; use [${name}] for an ordinary expression reference`,
        range(start, close + 1),
      ),
    );
    // Recover as the ordinary [name] expression so the parser still receives
    // one value token and does not cascade with a second "missing value" E001.
    out.push({ kind: "ref", name, range: range(start, close + 1) });
    return close + 1;
  }
  if (close === -1) {
    diagnostics.push(
      syntaxError(
        "Unclosed data reference: expected [name]",
        range(start, line.length),
      ),
    );
    return line.length;
  }
  diagnostics.push(
    syntaxError(
      "Malformed data reference: expected [name] with a plain identifier",
      range(start, close + 1),
    ),
  );
  return close + 1;
}

/**
 * Lex a double-quoted, single-line string with `[ref]` and Number-only
 * `[ref:0N]` formatted interpolation (§3.5)
 * and the M3 escapes (§3.1): `\n` is a newline character and `\\` a literal
 * backslash — the lexer's ONLY backslash escapes (besides `[[` for a literal
 * `[`). Any other `\`-sequence is E001 with a hint listing the valid ones;
 * recovery keeps the backslash as literal text, mirroring the malformed-`[`
 * path. Hard breaks produced by `\n` are honored by TextBox and render as
 * spaces in single-line Text (§3.3 — the evaluator's job, not ours).
 */
function lexString(
  line: string,
  li: number,
  start: number,
  out: Token[],
  diagnostics: Diagnostic[],
): number {
  const range = (startCol: number, endCol: number): Range => ({
    startLine: li,
    startCol,
    endLine: li,
    endCol,
  });
  const parts: StringPart[] = [];
  let text = "";
  let textStart = start + 1;
  let j = start + 1;

  const flushText = (end: number): void => {
    if (text !== "") {
      parts.push({ kind: "text", value: text, range: range(textStart, end) });
      text = "";
    }
    textStart = end;
  };

  while (j < line.length) {
    const c = line[j];
    if (c === '"') {
      flushText(j);
      out.push({ kind: "string", parts, range: range(start, j + 1) });
      return j + 1;
    }
    if (c === "\\") {
      const next = line[j + 1];
      if (next === "n") {
        text += "\n"; // `\n` — a hard line break (§3.1 M3)
        j += 2;
        continue;
      }
      if (next === "\\") {
        text += "\\"; // `\\` — a literal backslash
        j += 2;
        continue;
      }
      if (next !== undefined) {
        // A `\` as the LAST character of the line is not reported here: the
        // string is necessarily unterminated, and that diagnostic below owns
        // the line (one mistake, one diagnostic).
        diagnostics.push(
          syntaxError(
            `Unknown escape "\\${next}" — the only escapes are "\\n" (newline) and "\\\\" (backslash); for a literal "[" use "[["`,
            range(j, j + 2),
          ),
        );
      }
      text += "\\"; // recover: treat as literal text
      j++;
      continue;
    }
    if (c === "[") {
      if (line[j + 1] === "[") {
        text += "["; // `[[` escapes a literal `[` (§3.5)
        j += 2;
        continue;
      }
      let k = j + 1;
      if (k < line.length && isIdentStart(line[k])) {
        while (k < line.length && isIdentChar(line[k])) k++;
      }
      if (k > j + 1 && line[k] === "]") {
        flushText(j);
        parts.push({
          kind: "ref",
          name: line.slice(j + 1, k),
          range: range(j, k + 1),
        });
        j = k + 1;
        textStart = j;
        continue;
      }
      if (k > j + 1 && line[k] === ":") {
        const name = line.slice(j + 1, k);
        const formatStart = k + 1;
        let close = line.indexOf("]", formatStart);
        const quote = line.indexOf('"', formatStart);
        if (close !== -1 && quote !== -1 && quote < close) close = -1;
        if (close === -1) {
          diagnostics.push(
            syntaxError(
              `Unclosed formatted interpolation '[${name}:…': expected ']' after a :0N format`,
              range(j, Math.min(quote === -1 ? line.length : quote, line.length)),
            ),
          );
          text += "[";
          j++;
          continue;
        }

        const format = line.slice(formatStart, close);
        // Canonical `0` + non-zero decimal width: 01…064. The width itself
        // has no leading zero (`001` is rejected rather than normalized).
        const match = /^0([1-9][0-9]*)$/.exec(format);
        if (match) {
          const width = Number(match[1]);
          if (width >= 1 && width <= 64) {
            flushText(j);
            parts.push({
              kind: "ref",
              name,
              padWidth: width,
              range: range(j, close + 1),
            });
            j = close + 1;
            textStart = j;
            continue;
          }
          diagnostics.push(
            syntaxError(
              `Formatted interpolation width must be from 1 to 64, got ${match[1]}`,
              range(formatStart, close),
            ),
          );
        } else {
          diagnostics.push(
            syntaxError(
              `Unsupported interpolation format ':${format}' — expected ':0N' with a decimal width from 1 to 64 (for example [${name}:03])`,
              range(k, close),
            ),
          );
        }
        // One malformed formatted interpolation is recovered as literal text
        // as a unit, avoiding cascaded errors from characters inside it.
        text += line.slice(j, close + 1);
        j = close + 1;
        continue;
      }
      diagnostics.push(
        syntaxError(
          'Malformed interpolation: "[" must open a [name] reference — write "[[" for a literal "["',
          range(j, j + 1),
        ),
      );
      text += "["; // recover: treat as literal text
      j++;
      continue;
    }
    text += c;
    j++;
  }

  // End of line before the closing quote.
  flushText(line.length);
  diagnostics.push(
    syntaxError(
      "Unterminated string: strings are single-line and closed with '\"'",
      range(start, line.length),
    ),
  );
  out.push({ kind: "string", parts, range: range(start, line.length) });
  return line.length;
}
