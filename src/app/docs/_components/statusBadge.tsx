/**
 * The per-page status badge.
 *
 * CardGoblin is a living project, so a page that documents a settled feature
 * and a page that documents something about to change should not look
 * identical. The badge is about the SUBJECT's stability, not the prose's
 * completeness — a `planned` page is a deliberate placeholder, not an
 * unfinished one.
 */

import type { DocStatus } from "@/lib/docs/nav";
import type { ReactElement } from "react";

const STYLES: Record<DocStatus, { label: string; className: string; title: string }> = {
  stable: {
    label: "Stable",
    className: "border-teal-700 bg-teal-950 text-teal-300",
    title: "This part of CardGoblin is settled — expect it to keep working.",
  },
  evolving: {
    label: "Evolving",
    className: "border-amber-800 bg-amber-950 text-amber-300",
    title: "This is shipped but still moving — details may change.",
  },
  planned: {
    label: "Planned",
    className: "border-gray-700 bg-gray-800 text-gray-400",
    title: "A placeholder for something not written or not built yet.",
  },
};

export default function StatusBadge({
  status,
  className = "",
}: {
  status: DocStatus;
  className?: string;
}): ReactElement {
  const style = STYLES[status];
  return (
    <span
      title={style.title}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${style.className} ${className}`}
    >
      {style.label}
    </span>
  );
}
