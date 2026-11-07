import { MapPin } from "lucide-react";
import { useTabSearch } from "../../../../lib/tabSearch";
import { SearchField } from "../../../../components/PanelCapsule";
import type { PlanWorkspaceModel } from "../../hooks/usePlanWorkspace";

/**
 * The tab's head (PlanWorkspace's `head`) where it is not FPL's: Aircraft's
 * field, Nearest's, or Airport's search bar, what is typed kept in the view
 * model and lib/tabSearch. One SearchField in the one place whichever it
 * is, as before, so a switch between them changes its props and keeps the
 * field itself.
 */
export default function TabSearchField({ vm }: { vm: PlanWorkspaceModel }) {
  return vm.tab === "aircraft" ? aircraftSearch(vm) : vm.nearOpen ? nearSearch(vm) : airportSearch(vm);
}

/** Airport's search bar, the tab's head: an airport picked opens its card. */
function airportSearch(vm: PlanWorkspaceModel) {
  const { listAway, pickPlace, picking, place, query, quietFocus, search, searchInput, selectPlace, setPanel, setPicking, setQuery, upAsTyped } = vm;
  return (
    <SearchField
      value={query} onChange={q => { setQuery(q); upAsTyped(q); }} inputRef={searchInput}
      placeholder={picking === "home" ? "Search for your home airport" : picking === "favorite" ? "Search for an airport to keep" : "Search airports"}
      onFocus={() => { if (place) selectPlace(null); listAway("favorites"); if (!quietFocus.current) setPanel("full"); }}
      onCancel={() => { setQuery(""); setPicking("place"); listAway("favorites"); if (place) selectPlace(null); setPanel("peek"); }}
      onSubmit={() => {
        const first = search.answered ? search.rows[0] : undefined;
        if (first) void pickPlace({ ident: first.ident, name: first.name, municipality: first.municipality });
        else if (search.typed) void pickPlace({ ident: search.typed.toUpperCase(), name: search.typed.toUpperCase() });
      }}
    />
  );
}

/** Aircraft's field, the search bar's shape in the same place. */
function aircraftSearch(vm: PlanWorkspaceModel) {
  const { aircraftInput, aircraftTyped, listAway, panel, pickingFavorite, pickingMine, quietFocus, setPanel, upAsTyped } = vm;
  return (
    <SearchField
      value={aircraftTyped} onChange={aircraft => { useTabSearch.setState({ aircraft }); upAsTyped(aircraft); }} inputRef={aircraftInput}
      placeholder={pickingMine ? "Search for your airplane" : pickingFavorite ? "Search for an airplane to keep" : "Callsign, N-number or ICAO"}
      label="Find an airplane: callsign, registration or ICAO address" testId="aircraft-search" capitals
      // Up, the list under the field in sight -- not by an Add's focus,
      // which leaves the panel where it is (focusQuietly).
      onFocus={() => { listAway("aircraft-favorites"); listAway("aircraft-recents"); if (panel === "peek" && !quietFocus.current) setPanel("full"); }}
      onCancel={() => { useTabSearch.setState({ aircraft: "", pickingMine: false, pickingFavorite: false }); setPanel("peek"); }}
      onSubmit={() => useTabSearch.getState().submitAircraft?.()}
    />
  );
}

/** Nearest's field: where the nearest fields are measured from. */
function nearSearch(vm: PlanWorkspaceModel) {
  const { nearTyped, panel, setPanel } = vm;
  return (
    <SearchField
      value={nearTyped} onChange={near => useTabSearch.setState({ near })}
      placeholder="Current position" label="Nearest to: a town, an address or an airport" testId="nearest-from" icon={MapPin}
      onFocus={() => { if (panel === "peek") setPanel("full"); }}
      onCancel={() => setPanel("peek")}
      onSubmit={() => useTabSearch.getState().submitNear?.()}
      onClear={() => { const clear = useTabSearch.getState().clearNear; if (clear) clear(); else useTabSearch.setState({ near: "" }); }}
    />
  );
}
