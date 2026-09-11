import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled, bordered container -- every sidebar section is one of these. */
export default function Card({ title, children, className }: Props) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-3 ${className ?? ""}`}>
      {title && <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>}
      {children}
    </div>
  );
}
