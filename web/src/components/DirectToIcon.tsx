import type { SVGProps } from "react";

/**
 * The Direct-To symbol an avionics panel's key wears -- a D with an arrow
 * through it -- for Fly Here, which is the Direct-To from where the
 * pilot is (PlanWorkspace's flyHere), at the pilot's ask: it wore a
 * navigation arrow. Drawn as lucide draws its glyphs (24 box, 2 line,
 * round ends), so it sits beside them; lucide has none of its own.
 */
export default function DirectToIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}
    >
      <path d="M7 5h4a7 7 0 0 1 0 14H7z" />
      <path d="M2 12h20" />
      <path d="m18 8 4 4-4 4" />
    </svg>
  );
}
