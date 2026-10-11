/**
 * The cards open in the map's panel (CardHead's), the last opened on top:
 * a device's own Back -- Android's, a TV remote's (lib/back) -- closes the
 * top one, as its close button does, before the panel is lowered. A card
 * under another (an airport's over Nearest's list) is closed after it.
 */
const open: { close: () => void }[] = [];

/** A card's close, kept while it is open; answers its removal. */
export function holdOpenCard(entry: { close: () => void }): () => void {
  open.push(entry);
  return () => {
    const at = open.indexOf(entry);
    if (at >= 0) open.splice(at, 1);
  };
}

/** The top card closed; whether there was one. */
export function closeTopCard(): boolean {
  const top = open.at(-1);
  if (!top) return false;
  top.close();
  return true;
}
