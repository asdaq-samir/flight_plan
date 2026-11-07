// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { WordsAnswer } from "../../../../lib/api/words";
import WordsSection from "./WordsSection";
import { wordsState } from "./wordsState";

afterEach(cleanup);

const ANSWER: WordsAnswer = {
  sentences: [
    { text: "Duluth is reporting 12 knots gusting 18 from 270.", sources: ["metar:KDLH"] },
    { text: "The ceiling is 4,500 feet.", sources: ["metar:KDLH"] },
  ],
  sources: [{ id: "metar:KDLH", label: "METAR KDLH 1753Z", text: "KDLH 031753Z 27012G18KT 10SM BKN045 08/M02 A2992" }],
  model: "claude-haiku-5-5", unavailable: null,
};

describe("a section of words", () => {
  test("while the words are written it is a skeleton, not words", () => {
    render(<WordsSection title="Risk picture" testId="w" state={{ answer: undefined, error: null, pending: true }} />);
    expect(screen.getByTestId("w-pending")).toBeTruthy();
    expect(screen.queryByTestId("w-words")).toBeNull();
  });

  test("with the model unreachable it says so in the note's size and shows nothing else, no toast", () => {
    const unavailable: WordsAnswer = { sentences: [], sources: [], model: null, unavailable: "the model did not answer in time" };
    render(<WordsSection title="Risk picture" testId="w" state={wordsState({ data: unavailable, error: null })} />);
    expect(screen.getByTestId("w-unavailable").textContent).toBe("Words unavailable: the model did not answer in time");
    expect(screen.queryByTestId("w-words")).toBeNull();
    expect(screen.queryByTestId("w-source")).toBeNull();
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });

  test("a failed request reads the same way, with the error's own words", () => {
    render(<WordsSection title="Risk picture" testId="w" state={wordsState({ data: undefined, error: new Error("The planner is not answering") })} />);
    expect(screen.getByTestId("w-unavailable").textContent).toBe("Words unavailable: The planner is not answering");
  });

  test("the sentences read as one paragraph, each source one chip that opens the report as sent", () => {
    render(<WordsSection title="The weather, in words" testId="w" state={wordsState({ data: ANSWER, error: null })} />);
    expect(screen.getByTestId("w-words").textContent).toBe(ANSWER.sentences.map(s => s.text).join(" "));
    const chips = screen.getAllByTestId("w-source");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe("METAR KDLH 1753Z");
    fireEvent.click(chips[0]!);
    expect(screen.getByTestId("source-text").textContent).toBe(ANSWER.sources[0]!.text);
  });
});
