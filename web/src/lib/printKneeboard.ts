/**
 * Prints the kneeboard card (Kneeboard) in place of the briefing: the
 * page marked so the stylesheet shows the card alone, on half-letter
 * paper (5.5 by 8.5 in, a kneeboard's), and put back once printed.
 * `@page` sizes can't be scoped to a class, so the size goes in a style
 * of its own for the one print.
 */
export function printKneeboard(): void {
  const root = document.documentElement;
  const page = document.createElement("style");
  page.dataset.kneeboard = "";
  page.textContent = "@page { size: 5.5in 8.5in; margin: 0.3in; }";
  document.head.append(page);
  root.classList.add("print-kneeboard");
  const done = () => {
    root.classList.remove("print-kneeboard");
    page.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
