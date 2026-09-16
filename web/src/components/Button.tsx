import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The one primary-action color/interaction states, applied
 * consistently everywhere an inline button (not a floating map
 * overlay -- see darkButton.ts for that, a deliberately different,
 * higher-contrast style for sitting over satellite/chart tiles) needs
 * one: `slate-800`, the shade `RouteForm` and `BuildNotice` already
 * used before this component existed. Playground and the Flight
 * Briefing page had drifted to `slate-700` on their own; this is what
 * pulls them back in line.
 *
 * `size` is the one dimension actually worth varying: Label's own
 * "Load" button uses larger tap targets on purpose (`lg`) for a more
 * touch-driven, one-handed labeling workflow, while every other
 * button in the app is fine at the smaller default. Sharing color and
 * states while still allowing that is the point of the prop --
 * forcing every button to one literal size would have meant either
 * regressing Label's touch targets or not sharing this component with
 * it at all.
 *
 * A plain `<button>` (or, via `as="a"`, a link styled the same way --
 * "Sign in with Google" is a navigation, not an action, but reads as
 * the same kind of button) rather than a wrapper with its own prop
 * surface: every caller already knows `<button>`'s own attributes.
 */
type Size = "sm" | "lg";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button"; size?: Size };
type LinkProps = { as: "a"; href: string; children: ReactNode; className?: string; size?: Size };

const BASE = "rounded text-white hover:bg-slate-700 active:bg-slate-900 disabled:opacity-50 bg-slate-800";
const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2",
};

export default function Button(props: Props | LinkProps) {
  const size = props.size ?? "sm";
  if (props.as === "a") {
    const { href, children, className } = props;
    return (
      <a href={href} className={`${BASE} ${SIZE[size]} ${className ?? ""}`}>
        {children}
      </a>
    );
  }
  const { className, size: _size, ...rest } = props;
  return <button type="button" {...rest} className={`${BASE} ${SIZE[size]} ${className ?? ""}`} />;
}
