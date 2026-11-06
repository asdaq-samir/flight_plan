import type { ChecklistDto } from "./api/types";
import { callEngine } from "./engine/engine";

/**
 * An airplane's checklist as the pilot writes it, in plain text: a line
 * starting "#" a section, every other line an item, its challenge and its
 * response split by a dash or a run of dots, as a printed checklist sets
 * them ("Fuel selector -- Both", "Mixture ..... Rich"). What the editor
 * shows and what it saves (ChecklistDto). An item before any section is
 * in "Checklist". The webapp's limits are the text's: 40 characters a
 * section's title, 80 a challenge or a response.
 *
 * Read and written by the shared engine (native/engine/src/pilot/
 * checklist.rs, through lib/engine), the code the iPhone app reads a
 * checklist with too: the rule lives there.
 */

export function checklistOf(text: string): ChecklistDto {
  return callEngine<ChecklistDto>("checklist_read", { text });
}

export function textOf(checklist: ChecklistDto): string {
  return callEngine<string>("checklist_write", { checklist });
}
