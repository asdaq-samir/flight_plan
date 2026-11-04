import { useState } from "react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import type { Source } from "../../../../lib/api/assistant";
import { TEXT } from "../../../../lib/text";

/**
 * The reports an answer rests on, a chip each after it -- "METAR KDLH
 * 1753Z" -- as the assistant's answers and the Brief's words have them
 * (AskCard, WordsSection). A tap opens the report as it was sent, in a
 * dialog, monospace and never reformatted: a METAR, a TAF or a NOTAM is
 * read in its own code (the iOS review's rule 9), and the pilot checks
 * the words against it. The chips are the map's microphone's (RadioLayer):
 * small, round, in the tint.
 */
export default function SourceChips({ sources, testId = "source-chip" }: { sources: Source[]; testId?: string }) {
  const [open, setOpen] = useState<Source | null>(null);
  // One chip a report: the same source under two sentences is one.
  const shown = sources.filter((s, i) => sources.findIndex(o => o.id === s.id) === i);
  if (!shown.length) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1" data-testid={`${testId}s`}>
        {shown.map(s => (
          <Button
            key={s.id} size="sm" variant="secondary" className="rounded-full text-tint" data-testid={testId} data-source={s.id}
            onClick={() => setOpen(s)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={o => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto" data-testid="source-dialog">
          <DialogHeader>
            <DialogTitle>{open?.label}</DialogTitle>
            <DialogDescription>As sent.</DialogDescription>
          </DialogHeader>
          {/* Raw, in a monospace face, wrapped only at the box's edge. */}
          <pre className={cn("overflow-x-auto font-mono break-words whitespace-pre-wrap", TEXT.note)} data-testid="source-text">{open?.text}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
