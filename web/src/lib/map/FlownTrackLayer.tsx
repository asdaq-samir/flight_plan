import { Polyline } from "react-leaflet";
import type { Course } from "../api/types";
import { useFlownTrack } from "./flownTrack";

/** Consecutive points of a line, in runs on each side of `off`, each run
 *  sharing its first point with the last one's end so the line is whole. */
function runs(line: { lat: number; lon: number; off: boolean }[]): { off: boolean; points: [number, number][] }[] {
  const out: { off: boolean; points: [number, number][] }[] = [];
  line.forEach((pt, i) => {
    const last = out[out.length - 1];
    if (last && last.off === pt.off) last.points.push([pt.lat, pt.lon]);
    else out.push({ off: pt.off, points: i > 0 ? [[line[i - 1]!.lat, line[i - 1]!.lon], [pt.lat, pt.lon]] : [[pt.lat, pt.lon]] });
  });
  return out;
}

/**
 * The flown track over the planned course (lib/map/flownTrack), while the
 * course on the chart is that flight's: a white casing under a solid
 * near-black line, red where the flight was outside a tolerance, so it
 * reads against the course's dashed orange-red and the chart's own
 * colours alike.
 */
export function FlownTrackLayer({ course }: { course: Course }) {
  const track = useFlownTrack(s => s.track);
  if (!track || track.departure !== course.departure.ident || track.destination !== course.destination.ident) return null;
  const all: [number, number][] = track.line.map(pt => [pt.lat, pt.lon]);
  return (
    <>
      <Polyline positions={all} pathOptions={{ color: "#ffffff", weight: 6, opacity: 0.9, interactive: false }} />
      {runs(track.line).map((run, i) => (
        <Polyline
          key={i} positions={run.points}
          pathOptions={{ color: run.off ? "#d70015" : "#1d1d1f", weight: run.off ? 3.5 : 2.5, opacity: 1, interactive: false }}
        />
      ))}
    </>
  );
}
