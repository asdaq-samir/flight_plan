import type { ChecklistDto } from "./api/types";

/**
 * An airplane's checklist as the pilot writes it, in plain text: a line
 * starting "#" a section, every other line an item, its challenge and its
 * response split by a dash or a run of dots, as a printed checklist sets
 * them ("Fuel selector -- Both", "Mixture ..... Rich"). What the editor
 * shows and what it saves (ChecklistDto). An item before any section is
 * in "Checklist". The webapp's limits are the text's: 40 characters a
 * section's title, 80 a challenge or a response.
 */

const SPLIT = /\s+(?:-{1,2}|–|—|\.{2,})\s+|\s*\.{3,}\s*|\t+/;

export function checklistOf(text: string): ChecklistDto {
  const sections: ChecklistDto["sections"] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      sections.push({ title: line.replace(/^#+\s*/, "").slice(0, 40) || "Checklist", items: [] });
      continue;
    }
    if (!sections.length) sections.push({ title: "Checklist", items: [] });
    const [challenge, ...rest] = line.split(SPLIT);
    const response = rest.join(" ").trim();
    sections.at(-1)!.items.push({ challenge: challenge!.trim().slice(0, 80), response: response ? response.slice(0, 80) : null });
  }
  return { sections: sections.filter(s => s.items.length) };
}

export function textOf(checklist: ChecklistDto): string {
  return checklist.sections
    .map(s => [`# ${s.title}`, ...s.items.map(i => (i.response ? `${i.challenge} -- ${i.response}` : i.challenge))].join("\n"))
    .join("\n\n");
}
