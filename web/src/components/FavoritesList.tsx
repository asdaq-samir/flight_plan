import { useState } from "react";
import { House, Plus } from "lucide-react";
import type { RecentAirport } from "../lib/preferences";
import { placeLink } from "../lib/flightLink";
import { SwipeToDelete } from "./SwipeToDelete";
import { ListGroup, ListRow } from "./GroupedList";
import { EditToggle, KeptMark, ListPageHead, Mark, RemoveMinus } from "./Favorites";
import { MoveHandle, SortableRow, SortableRows } from "./SortableRows";

/**
 * Favorites in full, as Maps' own list: Home, which a tap changes
 * through the search bar, and the kept airports, which a tap opens --
 * and with Edit, a minus before each to let it go and a handle after
 * each to drag it up or down the list (or move it with the arrow keys).
 * Add a Favorite asks the search bar for one more.
 */
export default function FavoritesList({ home, favorites, onBack, onOpen, onChangeHome, onRemoveHome, onRemove, onMove, onAdd }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onBack: () => void;
  onOpen: (airport: RecentAirport) => void;
  onChangeHome: () => void;
  onRemoveHome: () => void;
  onRemove: (airport: RecentAirport) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6" data-testid="favorites-list">
      {/* Every list's head (ListPageHead), where this was a copy of it. */}
      <ListPageHead
        title="Favorites" backLabel="Back to the search" onBack={onBack} testId="favorites-page"
        action={<EditToggle editing={editing} onToggle={() => setEditing(e => !e)} testId="favorites-edit" />}
      />
      <ListGroup title="Home">
        {!home ? (
          <ListRow media={<Plus className="size-5" />} title="Add Home" onClick={onChangeHome} data-testid="favorites-home" />
        ) : (
          // Taken off as every kept list's rows are: a swipe to the left, or
          // Edit's minus bringing out the Delete (SwipeToDelete).
          <SwipeToDelete label={`Remove ${home.ident} as Home`} onDelete={onRemoveHome} share={placeLink(home)}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${home.ident} as Home…`} testId="favorites-home-remove" />}
                title={<><span className="font-mono font-semibold">{home.ident}</span> · {home.name}</>}
                description={home.municipality ?? undefined}
              />
            ) : (
              <ListRow
                media={<Mark icon={<House />} className="bg-teal-600 text-white" />} chevron
                title={<><span className="font-mono font-semibold">{home.ident}</span> · {home.name}</>}
                description={home.municipality ?? undefined} onClick={onChangeHome} data-testid="favorites-home"
              />
            )}
          </SwipeToDelete>
        )}
      </ListGroup>
      <SortableRows ids={favorites.map(a => a.ident)} onMove={onMove}>
      <ListGroup title="Airports">
        {favorites.length === 0 && <ListRow muted title="A star on an airport's card adds it here" />}
        {favorites.map((a, index) => (
          <SortableRow key={a.ident} id={a.ident}>
          <SwipeToDelete label={`Remove ${a.ident} from Favorites`} onDelete={() => onRemove(a)} share={placeLink(a)}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${a.ident} from Favorites…`} />}
                title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
                description={a.municipality ?? undefined}
              >
                <MoveHandle label={`Move ${a.ident}`} index={index} count={favorites.length} onMove={onMove} />
              </ListRow>
            ) : (
              <ListRow
                media={<KeptMark airport={a} />} chevron
                title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
                description={a.municipality ?? undefined} onClick={() => onOpen(a)}
              />
            )}
          </SwipeToDelete>
          </SortableRow>
        ))}
        <ListRow media={<Plus className="size-5" />} title="Add a Favorite" onClick={onAdd} data-testid="favorites-add" />
      </ListGroup>
      </SortableRows>
    </div>
  );
}
