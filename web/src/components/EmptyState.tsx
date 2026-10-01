import type { ReactNode } from "react";
import { cn } from "cn";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { TEXT } from "../lib/text";

/**
 * Nothing to list yet, said as iOS says it (ContentUnavailableView): a
 * glyph in a soft tile, a title, a line of what to do about it in grey,
 * and an action under them when there is one -- shadcn's Empty, at the
 * app's sizes: the title 20 (iOS's Title 3), the line 15.
 */
export default function EmptyState({ icon, title, children, action, className }: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("gap-3 p-6", className)}>
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="mb-1 size-12 rounded-xl text-tint [&_svg:not([class*='size-'])]:size-6">{icon}</EmptyMedia>
        <EmptyTitle className="text-xl leading-[1.5625rem] font-semibold tracking-tight">{title}</EmptyTitle>
        {children && <EmptyDescription className={TEXT.prose}>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
