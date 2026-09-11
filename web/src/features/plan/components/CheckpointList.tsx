import Card from "../../../components/Card";
import Row from "../../../components/Row";
import Badge from "../../../components/Badge";
import { deg, scoreColor, type PanelRow } from "../format";

interface Props {
  rows: PanelRow[];
  selectedRow: number | null;
  onSelectRow: (index: number) => void;
  placeholder: string;
}

export default function CheckpointList({ rows, selectedRow, onSelectRow, placeholder }: Props) {
  return (
    <Card title="Checkpoints" className="max-h-[45vh] overflow-y-auto">
      {!rows.length && <div className="text-sm text-slate-500">{placeholder}</div>}
      {rows.map((r, i) => (
        <Row key={`${r.kind}-${r.lat}-${r.lon}`} selected={i === selectedRow} onClick={() => onSelectRow(i)}>
          {r.kind === "endpoint" ? (
            <>
              <Badge color="#142430">{r.tag}</Badge> {r.ident}
              <div className="text-sm text-slate-500">{r.name}</div>
            </>
          ) : (
            <>
              <Badge color={scoreColor(r.score)}>{r.n}</Badge> {r.name}{" "}
              <span style={{ color: scoreColor(r.score) }}>{r.score.toFixed(2)}</span>
              <div className="text-sm text-slate-500">
                {r.category} · {r.along_track_nm.toFixed(1)} nm along
                {r.nextLeg && ` · next leg ${r.nextLeg.distance_nm.toFixed(1)} nm, ` +
                             `${deg(r.nextLeg.magnetic_heading_deg).replace("°", "")}°M`}
              </div>
            </>
          )}
        </Row>
      ))}
    </Card>
  );
}
