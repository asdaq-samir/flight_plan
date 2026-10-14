/** A flight's two traces -- its height green, its ground speed amber, as
 *  FlightAware's Track Log draws them -- in one place for the chart that
 *  draws them (PastFlightChart) and the labels that say which is which,
 *  coloured as their traces at the owner's ask in place of the dry run's
 *  axes. Each a shade that reads at WCAG's 4.5:1 as words, on the light
 *  and the dark page alike: the chart's first greens and ambers read as
 *  lines but not as text. */
export const TRACES = {
  alt: { label: "Altitude", light: "#1e7f45", dark: "#4ade80", text: "text-[#1e7f45] dark:text-[#4ade80]" },
  kt: { label: "Ground speed", light: "#a14a06", dark: "#fbbf24", text: "text-[#a14a06] dark:text-[#fbbf24]" },
} as const;
