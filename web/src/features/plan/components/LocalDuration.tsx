import { cn } from "cn";
import { CHIP_TEXT, GLASS_BUTTON } from "../../../components/mapChrome";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";

/** "1 h", "1.5 h", "45 min". */
const hoursOf = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`);

/** How long a local flight stays aloft, from the times PlanWorkspace allows.
 *  Drawn from the route panel's chunk (routePanel), so Radix's Select, 22 KB
 *  of the first load, comes with the panel and not with the page, for a menu
 *  only a local flight shows. */
export default function LocalDuration({ minutes, options, onChange }: { minutes: number; options: readonly number[]; onChange: (minutes: number) => void }) {
  return (
    <Select value={String(minutes)} onValueChange={v => onChange(Number(v))}>
      <SelectTrigger size="sm" aria-label="Time aloft" className={cn("rounded-full [&_svg]:text-foreground", GLASS_BUTTON, CHIP_TEXT)} data-testid="local-duration">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(m => <SelectItem key={m} value={String(m)}>{hoursOf(m)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
