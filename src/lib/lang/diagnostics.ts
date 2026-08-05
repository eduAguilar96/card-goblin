/**
 * Shared diagnostic types for the Goblin script compiler pipeline (DESIGN.md §3.8, §4.1).
 *
 * Positions are 0-based and Monaco-friendly: lines and columns are character
 * offsets, `endCol` is exclusive. Converting to a Monaco `IRange` is
 * `{ startLineNumber: startLine + 1, startColumn: startCol + 1, ... }`.
 */

export interface Range {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  /** Catalog code, e.g. "E001" (§3.8). */
  code: string;
  severity: Severity;
  message: string;
  range: Range;
}

/** E001 — syntax error (incl. malformed interpolation). The only code the lexer/parser emit. */
export function syntaxError(message: string, range: Range): Diagnostic {
  return { code: "E001", severity: "error", message, range };
}

/** Merge two ranges into the smallest range covering both. */
export function spanRanges(a: Range, b: Range): Range {
  return {
    startLine: a.startLine,
    startCol: a.startCol,
    endLine: b.endLine,
    endCol: b.endCol,
  };
}
