import { useEffect, useState } from "react";
import { api } from "../../lib/api/client";
import type { DeviceCode } from "../../lib/api/types";
import { TEXT } from "../../lib/text";

/**
 * Signing in on a TV, at the owner's ask (#207): the emailed link opens on
 * the phone where the mail is read, never on the TV, so the TV shows a
 * code and the address to type it at on a phone already signed in, as
 * streaming apps do (DeviceSignInController), and asks every few seconds
 * until it has been typed in -- then it is signed in as that pilot. A
 * code ten minutes old is replaced by a new one.
 */
export default function TvCode() {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const ask = (current: DeviceCode) => {
      timer = window.setTimeout(async () => {
        try {
          const answer = await api.deviceToken(current.deviceCode);
          if (!live) return;
          if (answer === "waiting") ask(current);
          else if (answer === "gone") void begin();
          else window.location.assign(answer.next);
        } catch {
          // The network for a moment: asked again.
          if (live) ask(current);
        }
      }, current.interval * 1000);
    };
    const begin = async () => {
      try {
        const fresh = await api.deviceCode();
        if (!live) return;
        setFailed(false);
        setCode(fresh);
        ask(fresh);
      } catch {
        // No keyboard on a TV to reload with: asked again, as the poll is.
        if (!live) return;
        setFailed(true);
        timer = window.setTimeout(begin, 10_000);
      }
    };
    void begin();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center" data-testid="tv-sign-in">
      <p className={TEXT.prose}>On your phone, signed in to Wingtip Maps, open</p>
      <p className={`font-semibold text-tint ${TEXT.row}`} data-testid="tv-address">
        {window.location.host}{code?.verificationPath ?? "/tv"}
      </p>
      <p className={TEXT.prose}>and enter</p>
      <p className="font-mono text-4xl font-bold tracking-widest tabular-nums" data-testid="tv-code" aria-live="polite">
        {code?.userCode ?? "····-····"}
      </p>
      {failed && (
        <p role="alert" className={`text-destructive ${TEXT.prose}`}>Couldn't get a code. Check the TV's connection.</p>
      )}
    </div>
  );
}
