import { ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { CHIP_TEXT, GLASS_BUTTON } from "../../../components/mapChrome";
import PullDown from "../../../components/PullDown";
import { duration } from "../../../lib/clock";


/** How long a local flight stays aloft, from the times PlanWorkspace allows:
 *  the app's pull-down (PullDown) behind a glass chip beside the pill's
 *  other chips, its words black as every glass button's are. Drawn from the
 *  route panel's chunk (routePanel), as only a local flight shows it. */
export default function LocalDuration({ minutes, options, onChange }: { minutes: number; options: readonly number[]; onChange: (minutes: number) => void }) {
  return (
    <PullDown
      label="Time aloft" value={`${minutes}`} align="start"
      options={options.map(m => ({ value: `${m}`, label: duration(m) }))}
      onChange={v => onChange(Number(v))}
      trigger={(
        <button
          type="button" aria-label={`Time aloft: ${duration(minutes)}`} data-testid="local-duration"
          className={cn("relative flex h-8 items-center gap-1 rounded-full pr-2 pl-2.5 outline-none after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", GLASS_BUTTON, CHIP_TEXT)}
        >
          {duration(minutes)}
          <ChevronsUpDown className="size-4" aria-hidden="true" />
        </button>
      )}
    />
  );
}
