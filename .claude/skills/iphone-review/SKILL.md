---
name: iphone-review
description: Build or review a screen of the planner the way it will be judged as an iOS app, at iPhone size, against Apple's Human Interface Guidelines and this app's own iOS rules, with measurements rather than impressions. Use for any change a pilot sees, for UI audits, and when the user reports something from their iPhone.
---

# iPhone review

The planner is becoming an iOS app, and the user tests it on an iPhone. Judge every screen on the phone first:
1. iPhone portrait: 402 × 874 at 3x, the iPhone 16 Pro.
2. iPhone landscape.
3. iPad.
4. Desktop, last.

## 1. Measure
- **Run the iOS audit** (`web/e2e/ios`; how to run it is in the `checks` skill). Each rule there is a measurement on iOS's own geometries with a touch pointer. A new screen or state gets an entry in `e2e/ios/screens.ts`.
- **Take screenshots** on the phone project with a scratch script in the Playwright image, and look at them before and after.
- **Report numbers:** sizes, contrast ratios and overflow in pixels, not "looks fine".

## 2. The rules
1. **Hit areas are 44 pt, and controls never grow to get there.**
   - Stock sizes stay. An invisible pseudo-element (`after:absolute after:-inset-…`) makes the area.
   - Icon buttons in a row sit at `gap-2`, so 36 px buttons' areas meet. 32 px buttons need `gap-3`.
   - Verify with `document.elementFromPoint` at ±((44 − size) / 2 − 1) px outside the box, never by size alone.
   - The one exception is switches, drawn at iOS's 51 × 31 on a touch pointer.
2. **Everything tappable is the blue tint.** Filled buttons use `--primary`. The words and glyphs of every other tappable thing use `text-tint`: outline, ghost and link buttons, action rows, checkmarks, chevrons and select values. Destructive stays red. Plain text, field-like pickers and list choices stay in the text colour.
3. **Type sizes come from `web/src/lib/text.ts` (`TEXT`),** never raw `text-sm`/`text-xs`. On touch that's 17 for rows and titles, 15 for detail and prose, 13 for notes. Nothing goes below 11 pt, and text must survive Larger Text at 125%.
4. **Panels are Liquid Glass sheets with detents, like Apple Maps:** a pill, half and full. The map follows the sheet. **Never move a panel or a control to another part of the screen** unless the owner said so in the issue.
5. **Discrete settings are a menu or a segmented control,** never a slider.
6. **Errors show where they happen,** through `web/src/lib/problems.ts`, not in a toast.
7. **Use stock components first** (shadcn/ui, Radix), and delete a hand-rolled one once nothing uses it.
8. **Fit:**
   - safe-area insets respected;
   - nothing scrolls sideways (`scrollWidth > clientWidth` on any container is a failure);
   - text contrast at least 4.5:1;
   - Reduce Motion honoured;
   - every icon-only button has a name VoiceOver can read.
9. **Words:** "airplane", the FAA's own word. FAA capitals go to sentence case with their codes kept (`faaWords` in `web/src/lib/advisories.ts`). Raw reports (METAR, TAF, NOTAM) stay exactly as sent.
10. **Safari:**
    - Anything that sends requests, stores data, asks for the position or uses the service worker gets a WebKit run (the `webkit-iphone` project, or a WebKit repro).
    - The phone is served the working tree as saved, but its service worker shows the previous build for one more load. Compare a phone screenshot with the code before acting on it.

## 3. The industry standards, and where each is checked

| Standard | What it asks | Checked |
|---|---|---|
| Apple HIG | Tap targets of at least 44 × 44 pt; text no smaller than 11 pt | P1 and P2 in the iOS audit, every CI run |
| WCAG 2.2 AA 1.4.3 / 1.4.11 | Contrast of 4.5:1 for text (3:1 for large text, controls and graphics) | P15 (light and dark), every run |
| WCAG 2.2 AA 1.4.10 | Reflow at 320 CSS px with no sideways scroll | P11 at 100% and 150% page zoom, every run |
| WCAG 2.2 AA (all) | No serious or critical axe-core violation | a11y.spec on the main states every run; every audited screen nightly |
| WCAG 2.2 AA 2.5.8 | Targets of at least 24 × 24 CSS px | Covered by P1's stricter 44 pt; axe's own rule is off, as it can't see the `::after` hit areas |
| Core Web Vitals (web.dev) | LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms at the 75th percentile | Lighthouse nightly (TBT ≤ 200 ms stands in for INP); a miss opens a "standards" issue |
| Lighthouse | 90+ for performance, accessibility and best practices | Nightly, same issue route |
| Size | First-load JavaScript within 1.10 MB | `web/scripts/first-load.mjs`, every run |

A change a pilot sees should keep every row green. A "standards" issue is fixed like any other: measure, change, measure again, with the numbers in the pull request.

**Style in the source** (the design audit runs these):
- Raw text sizes outside the type scale, which should be `TEXT.*`:
  `grep -rn -E '\btext-(xs|sm|base|lg|xl|2xl|3xl)\b' web/src --include='*.tsx' --include='*.ts' | grep -v -E 'src/lib/text\.ts|src/components/ui/|\.test\.'`
  There were 29 on 2026-10-08. The allowed exceptions are SVG chart labels, print-only styles and the screen-reader skip link; say why in a comment.
- Controls grown to 44 px, which should use a pseudo-element hit area instead:
  `grep -rn -E 'min-(h|w)-(11|\[44px\])|\bh-11\b|\bsize-11\b' web/src --include='*.tsx' | grep -v 'src/components/ui/'`
  There were 10 on 2026-10-08.

## 4. Report
For each screen and device, give each rule with its measurement, pass or fail. Fix the failures that are within the change. List the rest as findings with the owner's decision noted where one is needed.
