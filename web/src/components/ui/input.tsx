import * as React from "react"
import { cn } from "cn"
import ClearButton from "../ClearButton"
import { clearField } from "../../lib/clearField"

const BASE =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm pointer-coarse:text-[1.0625rem] dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

/** The fields words are typed into: a clear at their end while typed in
 *  (ClearButton), at the pilot's ask. Not a number's, a date's or a
 *  figure's (inputMode numeric or decimal), as iOS's are not. */
const WORDS = new Set([undefined, "text", "search", "email", "url", "tel"])
/** A field's classes that size and place its box, which go to the box
 *  round it and its clear; the rest stay the field's. */
const BOX = /^(?:[a-z0-9-]+:)*(?:h|w|min-w|max-w|min-h|max-h|flex|basis|grow|shrink|self|order|col|row|m|mx|my|mt|mr|mb|ml|ms|me)(?:-|$)/

/** iOS's Done: a field with no Return of its own (no form to send, no
 *  key handling of the owner's) puts the keyboard away. */
function doneOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.currentTarget.form) e.currentTarget.blur()
}

function Input({ className, type, ref, onChange, ...given }: React.ComponentProps<"input">) {
  // Every field names its return key and its AutoFill, as iOS's text
  // fields do (HIG, "Text fields"; the iOS audit's P19): Done and none
  // unless the field says otherwise -- most of the app's fields are
  // figures and idents, which Safari's AutoFill would offer a contact for.
  const props = {
    enterKeyHint: "done" as const, autoComplete: "off",
    ...(given.onKeyDown || given.enterKeyHint ? {} : { onKeyDown: doneOnEnter }),
    ...given,
  }
  const field = React.useRef<HTMLInputElement | null>(null)
  const words = WORDS.has(type) && !props.disabled && !props.readOnly && props.inputMode !== "numeric" && props.inputMode !== "decimal"
  // Whether something is typed: the value where the owner holds it, else
  // as the field says it as it is typed.
  const [typed, setTyped] = React.useState(() => String(props.defaultValue ?? "").length > 0)
  const filled = props.value !== undefined ? String(props.value).length > 0 : typed
  if (!words) {
    return <input type={type} ref={ref} onChange={onChange} data-slot="input" className={cn(BASE, className)} {...props} />
  }
  const classes = (className ?? "").split(/\s+/).filter(Boolean)
  const setRef = (el: HTMLInputElement | null) => {
    field.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) ref.current = el
  }
  return (
    <span data-slot="input-box" className={cn("relative inline-flex h-9 w-full min-w-0 items-center align-middle", classes.filter(c => BOX.test(c)))}>
      <input
        type={type} ref={setRef} data-slot="input"
        className={cn(BASE, classes.filter(c => !BOX.test(c)), "h-full", filled && "pr-9")}
        onChange={e => { setTyped(e.target.value.length > 0); onChange?.(e) }}
        {...props}
      />
      {filled && <ClearButton onClear={() => clearField(field.current)} className="absolute right-2.5" />}
    </span>
  )
}

export { Input }
