import type { ReactNode } from "react";
import { CloudSun, Headset, Radar, Radio, RadioTower, TowerControl } from "lucide-react";
import { ListRow } from "../../../components/GroupedList";
import { RowBadge } from "../../../components/RowBadge";
import { frequencyLine, mhzText, type FrequencyKind } from "../../../lib/frequencies";
import { BADGE } from "../../../lib/rowBadges";

const GLYPH: Record<FrequencyKind, ReactNode> = {
  tower: <TowerControl />, ground: <Headset />, weather: <CloudSun />, approach: <Radar />, traffic: <RadioTower />, other: <Radio />,
};

/**
 * A field's frequency as a row: named in words (TWR is "Tower"), a glyph
 * by its kind, and the frequency as pilots write it at the right in the
 * text's own colour, as Nearest has a field's distance -- the pilot's ask
 * for every card to read as Nearest's does. An airport's card and the
 * route's Airports tab list them alike: the tab's were the card's old
 * rows, the FAA's type in words over its description and the figure in
 * grey.
 */
export function FrequencyRow({ type, description, mhz, testId }: {
  type: string | null | undefined;
  description: string | null | undefined;
  mhz: number | null | undefined;
  testId?: string;
}) {
  const line = frequencyLine(type, description);
  return (
    <ListRow
      media={<RowBadge colour={BADGE[line.kind]}>{GLYPH[line.kind]}</RowBadge>}
      title={line.name} description={line.detail ?? undefined}
      value={mhz != null ? <span className="font-semibold text-foreground">{mhzText(mhz)}</span> : "—"}
      data-testid={testId}
    />
  );
}
