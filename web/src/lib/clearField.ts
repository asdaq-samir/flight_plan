/** A field emptied as typing it out would, so its owner hears it as
 *  typed: React's onChange for a controlled field, a form's own for an
 *  uncontrolled one. Through the prototype's setter, which React's own
 *  value tracking does not see, so the input event reads as a change. */
export function clearField(field: HTMLInputElement | null) {
  if (!field) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}
