/** The five bars that rise and fall while the microphone listens, in the
 *  tint, as Siri's do (index.css's `wave` keyframes): in the mic's own
 *  circle while it listens (RadioButton), where the glyph was. */
export default function Waveform() {
  return (
    <span className="flex h-5 items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i} className="h-full w-1 origin-center rounded-full bg-tint motion-safe:animate-[wave_0.9s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.12}s`, transform: "scaleY(0.4)" }}
        />
      ))}
    </span>
  );
}
