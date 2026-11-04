// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TabBar, { type BarTab } from "./TabBar";
import { PanelSize, TabBarMinimized, TabDock } from "./mapChrome";
import { AirportGlyph, RouteGlyph } from "./tabGlyphs";
import { TooltipProvider } from "./ui/tooltip";

const TABS: BarTab<"fpl" | "airport">[] = [
  { value: "fpl", label: "FPL", icon: RouteGlyph },
  { value: "airport", label: "Airport", icon: AirportGlyph },
];

/** The sheet and the dock under it, made once a test. */
let made: [HTMLElement, HTMLElement] | null = null;
function places(): [HTMLElement, HTMLElement] {
  if (!made) {
    const dock = document.createElement("div");
    dock.dataset.testid = "dock";
    made = [document.body.appendChild(document.createElement("section")), document.body.appendChild(dock)];
  }
  return made;
}

/** The bar as MapPanel places it: in the sheet (`panel`), its tabs drawn
 *  into the dock at the screen's foot when one is given, under the
 *  sheet's own drag. */
function Placed({ docked, minimized, onDrag = () => {} }: { docked: boolean; minimized: boolean; onDrag?: () => void }) {
  const [panel, dock] = places();
  return (
    <TooltipProvider>
      <div onPointerDown={onDrag} data-testid="head">
        <TabDock.Provider value={docked ? { dock, panel } : null}>
          <TabBarMinimized.Provider value={minimized}>
            <PanelSize.Provider value={{ size: "half", to: () => {}, card: false }}>
              <TabBar tabs={TABS} tab="fpl" title="KDLH" onPick={() => {}} onClose={() => {}} />
            </PanelSize.Provider>
          </TabBarMinimized.Provider>
        </TabDock.Provider>
      </div>
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  made = null;
});

describe("TabBar docked at the screen's foot", () => {
  it("draws its tabs into the dock, nothing where the bar was", () => {
    const { getByTestId } = render(<Placed docked minimized={false} />);
    const dock = document.querySelector<HTMLElement>("[data-testid=dock]")!;
    expect(dock.querySelector("[data-testid=tab-bar]")).not.toBeNull();
    expect(dock.querySelectorAll("button")).toHaveLength(3);
    expect(getByTestId("head").querySelector("[data-testid=tab-bar], [data-testid=tab-head]")).toBeNull();
  });

  it("over a card keeps the tabs in the dock and names the card in the sheet, its title no button to show the tabs", () => {
    const { getByTestId } = render(<Placed docked minimized />);
    const dock = document.querySelector<HTMLElement>("[data-testid=dock]")!;
    expect(dock.querySelector("[data-testid=tab-fpl]")).not.toBeNull();
    const line = getByTestId("head").querySelector<HTMLElement>("[data-testid=tab-head]")!;
    expect(line).not.toBeNull();
    const title = line.querySelector<HTMLElement>("[data-testid=tab-title]")!;
    expect(title.textContent).toBe("KDLH");
    expect(title.tagName).not.toBe("BUTTON");
    expect(line.querySelector("[data-testid=tab-close]")).not.toBeNull();
    // One tab bar on the page: the dock's.
    expect(document.querySelectorAll("[data-testid=tab-bar]")).toHaveLength(1);
  });

  it("hands a press on a docked tab to the sheet's drag, as the tabs in the sheet did", () => {
    const onDrag = vi.fn();
    render(<Placed docked minimized={false} onDrag={onDrag} />);
    fireEvent.pointerDown(document.querySelector("[data-testid=dock] [data-testid=tab-airport]")!);
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it("is the card's first row, minimized to its name, where it is not docked", () => {
    const { getByTestId } = render(<Placed docked={false} minimized />);
    const bar = getByTestId("head").querySelector<HTMLElement>("[data-testid=tab-bar]")!;
    expect(bar.querySelector("[data-testid=tab-title]")!.tagName).toBe("BUTTON");
    expect(document.querySelector("[data-testid=dock] [data-testid=tab-bar]")).toBeNull();
  });
});
