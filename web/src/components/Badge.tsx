import type { ReactNode } from "react";

interface Props {
  color: string;
  children: ReactNode;
  className?: string;
}

/**
 * The colour-coded pill used for ratings, scores, roles and DEP/DEST
 * tags. Colour is data (`COLORS[rating]`, `scoreColor(score)`), so it's
 * the one thing here that can't be a Tailwind class -- everything else
 * (shape, padding, type) is.
 */
export default function Badge({ color, children, className }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white ${className ?? ""}`}
      style={{ backgroundColor: color }}
    >
      {children}
    </span>
  );
}
