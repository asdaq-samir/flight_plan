import type { ReactNode } from "react";

interface Props {
  form: ReactNode;
  actions: ReactNode;
  dev?: boolean;
}

/** Shared header for the independent pilot and developer pages. */
export default function MapHeader({ form, actions, dev = false }: Props) {
  return (
    <header
      data-mode={dev ? "dev" : "pilot"}
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background p-2 sm:px-4 print:hidden"
    >
      <div className="min-w-0">{form}</div>
      <div className="flex items-center gap-2 [&>*]:size-8 sm:[&>*]:size-9">{actions}</div>
    </header>
  );
}
