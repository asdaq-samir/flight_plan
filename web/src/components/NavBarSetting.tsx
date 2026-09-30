import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useNavEdge } from "../hooks/use-nav-edge";
import { usePreferences, type NavEdge } from "../lib/preferences";

/**
 * Which edge of the screen the header is on: the top, or the bottom,
 * where a thumb reaches it on a phone. The map's buttons follow it, and
 * on a phone so do the consoles and every panel, which come in from it
 * (useNavEdge). Until one is picked, the bottom on a phone and the top
 * from `md` up; shown as whichever of the two that is. Lives at the top
 * of the map's settings, on both pages.
 */
export default function NavBarSetting() {
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Navigation bar</div>
      <div className="flex items-center gap-2">
        <Label htmlFor="nav-bar" className="w-24 shrink-0 font-normal">Position</Label>
        <Select value={edge} onValueChange={value => setNavBar(value as NavEdge)}>
          <SelectTrigger id="nav-bar" size="sm" aria-label="Navigation bar position" className="w-full" data-testid="nav-bar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="bottom">Bottom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        The map&apos;s buttons sit on the same edge, and on a phone the consoles and panels come in from it.
      </p>
    </div>
  );
}
