// @vitest-environment jsdom
/**
 * A card's ident takes what was typed on Return, and a suggestion only once
 * an arrow has chosen it (cmdk lights the first row by itself, which must
 * not stand in for the pilot's typing).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const search = vi.fn();
vi.mock("../../../lib/useAirportSearch", () => ({ useAirportSearch: (...a: unknown[]) => search(...a) }));

const { default: CardIdent } = await import("./CardIdent");

beforeAll(() => {
  // cmdk and Radix want these of a browser.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const rows = [
  { kind: "airport", ident: "KOSH", name: "Wittman Regional", city: "Oshkosh", state: "WI", lat: 0, lon: 0 },
  { kind: "airport", ident: "KOSU", name: "Ohio State", city: "Columbus", state: "OH", lat: 0, lon: 0 },
];

function setup(props: Partial<ComponentProps<typeof CardIdent>> = {}) {
  search.mockReturnValue({ typed: "KOS", rows, answered: true });
  const onCommit = vi.fn();
  render(<CardIdent value="KUGN" label="Ident" testId="ident" onCommit={onCommit} {...props} />);
  const field = screen.getByTestId("ident");
  field.focus();
  fireEvent.change(field, { target: { value: "kos" } });
  return { field, onCommit };
}

describe("CardIdent", () => {
  test("Return takes what was typed, not the row lit by default", () => {
    const { field, onCommit } = setup();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("KOS");
  });

  test("asks for fixes only where told, and does not search for a rename", () => {
    setup();
    expect(search).toHaveBeenLastCalledWith("KOS", true, false);
    cleanup();
    setup({ fixes: true });
    expect(search).toHaveBeenLastCalledWith("KOS", true, true);
    cleanup();
    setup({ suggest: false });
    expect(search).toHaveBeenLastCalledWith("KOS", false, false);
  });
});
