/**
 * How a button on the map is drawn: the outline button on a solid
 * surface of its own, with a shadow, so it reads over any chart colour.
 * Solid in the dark theme too: the stock outline button's dark fill is
 * white at 4.5%, next to nothing over a bright chart, and the zoom and
 * full-screen buttons were a bare white icon on the sectional -- hard to
 * find. The popover's surface there (a dark grey), and the accent under
 * the pointer.
 */
export const MAP_BUTTON = "bg-background shadow-md dark:bg-popover dark:hover:bg-accent";
