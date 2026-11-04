import { describe, expect, test } from "vitest";
import { readAssistantStream, type AssistantEvent } from "./assistant";

/** A stream of the chunks given, as bytes, cut wherever the chunks are. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function eventsOf(chunks: string[]): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  await readAssistantStream(streamOf(chunks), e => events.push(e));
  return events;
}

describe("the assistant's stream", () => {
  test("events are read whole across chunk boundaries, in order", async () => {
    // A line cut in the middle of a word and of a JSON string, and two
    // lines in one chunk: each event once, whole, as the planner sent it.
    const events = await eventsOf([
      '{"type":"tool","name":"weather_at","la',
      'bel":"The weather at KDLH"}\n{"type":"text","text":"Wind 270 at 12"}\n{"type":"te',
      'xt","text":", gusting 18."}\n',
      '{"type":"sources","sources":[{"id":"metar:KDLH","label":"METAR KDLH 1753Z","text":"KDLH 031753Z 27012G18KT"}]}\n{"type":"done"}\n',
    ]);
    expect(events).toEqual([
      { type: "tool", name: "weather_at", label: "The weather at KDLH" },
      { type: "text", text: "Wind 270 at 12" },
      { type: "text", text: ", gusting 18." },
      { type: "sources", sources: [{ id: "metar:KDLH", label: "METAR KDLH 1753Z", text: "KDLH 031753Z 27012G18KT" }] },
      { type: "done" },
    ]);
  });

  test("a change proposed comes after the words and before the sources", async () => {
    const events = await eventsOf([
      '{"type":"text","text":"Rhinelander as a stop."}\n{"type":"action","change":{"stops":["KRHI"]},"words":"A fuel stop halfway."}\n',
      '{"type":"sources","sources":[]}\n{"type":"done"}\n',
    ]);
    expect(events.map(e => e.type)).toEqual(["text", "action", "sources", "done"]);
    expect(events[1]).toEqual({ type: "action", change: { stops: ["KRHI"] }, words: "A fuel stop halfway." });
  });

  test("a last line with no newline after it is still read", async () => {
    const events = await eventsOf(['{"type":"text","text":"Yes."}\n{"type":"done"}']);
    expect(events.map(e => e.type)).toEqual(["text", "done"]);
  });

  test("an error event ends the answer with its words, and nothing after it is read", async () => {
    const events = await eventsOf([
      '{"type":"text","text":"Checking"}\n{"type":"error","words":"The assistant cannot be reached: timed out"}\n{"type":"text","text":"never"}\n',
    ]);
    expect(events).toEqual([
      { type: "text", text: "Checking" },
      { type: "error", words: "The assistant cannot be reached: timed out" },
    ]);
  });

  test("a line that is not JSON is one plain error, not a parser's", async () => {
    await expect(eventsOf(['{"type":"text","text":"a"}\n<html>bad gateway</html>\n'])).rejects.toThrow("garbled");
  });
});
