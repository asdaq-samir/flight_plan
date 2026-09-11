import Card from "../../../components/Card";
import type { Leg, NavLog } from "../../../lib/api/types";
import { deg, one, signed, totalsParts } from "../format";
import type { Totals } from "../../../lib/api/types";

interface Props {
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  navError: string | null;
  reading: boolean;
  showNav: boolean;
  onToggle: () => void;
}

export default function NavLogCard({ totals, nav, legs, navError, reading, showNav, onToggle }: Props) {
  const parts = totals ? totalsParts(totals) : null;
  return (
    <Card>
      <div onClick={onToggle} className="flex flex-wrap items-center gap-2 text-sm cursor-pointer">
        <span className="font-semibold text-slate-700">Nav log</span>
        {parts && (
          <span>
            <b>{parts.distance}</b> · <b>{parts.time}</b> · <b>{parts.fuel}</b>
            {parts.warning && <> · <span className="text-red-600">{parts.warning}</span></>}
          </span>
        )}
        {nav && (
          <span className="text-slate-500">
            {nav.altitude_ft} ft{" "}
            {nav.altitude_selection
              ? `(auto: floor ${nav.altitude_selection.floor_ft} ft, ${nav.aircraft.name})`
              : "(you set this)"}
          </span>
        )}
        <span className="ml-auto text-slate-500">{showNav ? "hide" : "show"}</span>
      </div>

      {showNav && (
        // Capped and scrollable on its own: without this, a long nav log
        // grows into the fixed-height column and shrinks the map to make
        // room for it -- the same "fighting for space" the original
        // app.css's #navscroll{max-height:34vh} prevented.
        <div className="mt-2 max-h-[34vh] overflow-auto">
          <table cellPadding={4} className="text-right text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left">From</th><th className="text-left">To</th>
                <th>Dist</th><th>TC</th><th>Wind</th><th>WCA</th>
                <th>TH</th><th>Var</th><th>MH</th><th>GS</th><th>ETE</th><th>Fuel</th>
              </tr>
            </thead>
            <tbody>
              {navError && (
                <tr><td className="text-left text-red-600" colSpan={12}>{navError}</td></tr>
              )}
              {!navError && reading && (
                <tr><td className="text-left text-slate-500" colSpan={12}>reading terrain, airspace and winds…</td></tr>
              )}
              {legs.map((l, i) => (
                // A leg with no nearby winds-aloft station is a no-wind
                // estimate, not a calm one. Shading keeps that visible
                // rather than letting it read as a confident zero.
                <tr key={i} className={l.wind ? undefined : "text-slate-400"}>
                  <td className="text-left">{l.from}</td><td className="text-left">{l.to}</td>
                  <td>{l.distance_nm.toFixed(1)}</td>
                  <td>{deg(l.true_course_deg)}</td>
                  <td>{l.wind
                    ? `${deg(l.wind.wind_dir_true_deg)}/${Math.round(l.wind.wind_speed_kt)}`
                    : "no data"}</td>
                  <td>{signed(l.wca_deg)}</td>
                  <td>{deg(l.true_heading_deg)}</td>
                  <td>{signed(l.magnetic_variation_deg)}</td>
                  <td>{deg(l.magnetic_heading_deg)}</td>
                  <td>{l.groundspeed_kt === null ? "—" : Math.round(l.groundspeed_kt)}</td>
                  <td>{l.ete_min === null ? "unflyable" : one(l.ete_min)}</td>
                  <td>{one(l.fuel_gal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
