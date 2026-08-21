import type { ReactElement } from "react";

export interface CardRowOverlayProps {
  /** Zero-based source row stored on CardInstance metadata. */
  rowIndex: number;
}

/**
 * Preview-only source-row badge shared by single-card and grid views.
 * Keeping it outside CardSVG guarantees it never enters raster or PDF output.
 */
export default function CardRowOverlay({ rowIndex }: CardRowOverlayProps): ReactElement {
  const rowNumber = rowIndex + 1;
  return (
    <span
      data-card-row-overlay
      title={`Source sheet row ${rowNumber}`}
      className="pointer-events-none absolute left-1 top-1 z-10 rounded border border-white bg-red-700 px-1.5 py-0.5 text-sm font-black leading-none text-white shadow-lg"
    >
      Row {rowNumber}
    </span>
  );
}
