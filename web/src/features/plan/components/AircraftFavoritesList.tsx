import { useState } from "react";
import { Plane, Plus } from "lucide-react";
import { EditToggle, HomePlane, ListPageHead, Mark, MoveHandle, RemoveMinus } from "../../../components/Favorites";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { SwipeToDelete } from "../../../components/SwipeToDelete";
import { usePreferences, type KeptAircraft } from "../../../lib/preferences";

/**
 * The Aircraft tab's Favorites in full, from their title, at the owner's
 * ask ("What about aircraft fav?"), as Airport's are (FavoritesList): the
 * Plane, the pilot's own, which a tap changes through the search, and the
 * airplanes kept, which a tap opens -- and with Edit, a minus before each
 * to let it go and a handle after each to drag it up or down the list (or
 * move it with the arrow keys). Add a Favorite asks the search for one more.
 */
export default function AircraftFavoritesList({ onBack, onOpen, onChangeMine, onAdd }: {
  onBack: () => void;
  onOpen: (hex: string) => void;
  /** The search asked for the pilot's own airplane. */
  onChangeMine: () => void;
  /** The search asked for one more to keep. */
  onAdd: () => void;
}) {
  const favorites = usePreferences(s => s.favoriteAircraft);
  const mine = usePreferences(s => s.myAircraft);
  const setMine = usePreferences(s => s.setMyAircraft);
  const remove = usePreferences(s => s.toggleFavoriteAircraft);
  const move = usePreferences(s => s.moveFavoriteAircraft);
  const [editing, setEditing] = useState(false);
  const name = (a: KeptAircraft) => <span className="font-semibold">{a.name}</span>;
  return (
    <div className="space-y-6" data-testid="aircraft-favorites-list">
      <ListPageHead
        title="Favorites" backLabel="Back to the airplanes" onBack={onBack} testId="aircraft-favorites-page"
        action={<EditToggle editing={editing} onToggle={() => setEditing(e => !e)} testId="aircraft-favorites-edit" />}
      />
      <ListGroup title="Plane">
        {!mine ? (
          <ListRow media={<Plus className="size-5" />} title="Add your Plane" onClick={onChangeMine} data-testid="aircraft-favorites-mine" />
        ) : (
          // Taken off as every kept list's rows are (SwipeToDelete).
          <SwipeToDelete label={`Remove ${mine.name} as your Plane`} onDelete={() => setMine(null)}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${mine.name} as your Plane…`} testId="aircraft-favorites-mine-remove" />}
                title={name(mine)} description={mine.type ?? undefined}
              />
            ) : (
              <ListRow
                media={<Mark icon={<HomePlane />} className="bg-teal-600 text-white" />} chevron
                title={name(mine)} description={mine.type ?? undefined} onClick={onChangeMine} data-testid="aircraft-favorites-mine"
              />
            )}
          </SwipeToDelete>
        )}
      </ListGroup>
      <ListGroup title="Airplanes">
        {favorites.length === 0 && <ListRow muted title="A star on an airplane's card adds it here" />}
        {favorites.map((a, index) => (
          <SwipeToDelete key={a.hex} label={`Remove ${a.name} from Favorites`} onDelete={() => remove(a)}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${a.name} from Favorites…`} />}
                title={name(a)} description={a.type ?? undefined} data-testid="aircraft-favorites-row"
              >
                <MoveHandle label={`Move ${a.name}`} index={index} count={favorites.length} onMove={move} />
              </ListRow>
            ) : (
              <ListRow
                media={<Mark icon={<Plane />} className="bg-sky-600 text-white" />} chevron
                title={name(a)} description={a.type ?? undefined} onClick={() => onOpen(a.hex)} data-testid="aircraft-favorites-row"
              />
            )}
          </SwipeToDelete>
        ))}
        <ListRow media={<Plus className="size-5" />} title="Add a Favorite" onClick={onAdd} data-testid="aircraft-favorites-add" />
      </ListGroup>
    </div>
  );
}
