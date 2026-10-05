import type { ReactNode } from "react";

/**
 * A text field's 44-point tap band: a label round it, six points proud of
 * it above and below and taking no room, so a tap beside a row's 32-point
 * field still lands in it -- where a button reaches 44 with a ::after
 * (index.css), which a field cannot carry. The checkpoint's note in the
 * nav log does the same (DescriptionCell).
 */
export default function FieldHit({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="relative -my-1.5 block py-1.5">{children}</label>;
}
