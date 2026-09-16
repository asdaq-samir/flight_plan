import ErrorTab from "./ErrorTab";
import StatusPopup from "./StatusPopup";

interface Props {
  /** "Reading the chart 45%," "Planning… 60%," "Generating 12/21." */
  progress: string | null;
  /** A failure -- rendered as its own full-width drawer at the bottom,
   *  independent of `progress` (the checkpoint description stream
   *  keeps counting progress even after a global failure). */
  error: string | null;
  /** Pixels from the top of the map area -- right below whatever bar
   *  sits above it. */
  top: number;
  /** The error drawer's own live height, so the map (or the nav log
   *  table) behind it can shrink to clear it. */
  onErrorHeightChange: (height: number) => void;
}

/**
 * The progress popup and the error drawer together -- every page that
 * has one has the other, wired the same way, so this is written once
 * instead of copied at each place a page needs the pair.
 */
export default function PageStatus({ progress, error, top, onErrorHeightChange }: Props) {
  return (
    <>
      <StatusPopup progress={progress} top={top} />
      <ErrorTab message={error} onHeightChange={onErrorHeightChange} />
    </>
  );
}
