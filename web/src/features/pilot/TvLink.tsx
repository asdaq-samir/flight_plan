import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { ApiError, api } from "../../lib/api/client";
import { pilotQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import SignInModal from "./SignInModal";

/** Whether the page was opened from a TV's address (/tv, WebMvcConfig). */
function fromTvAddress(): boolean {
  return new URLSearchParams(window.location.search).has("tv-link");
}

/** Takes the TV's mark off the address, so a reload does not ask again. */
function forgetTvAddress() {
  const url = new URL(window.location.href);
  url.searchParams.delete("tv-link");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/**
 * Signing a TV in from the phone (#207, TvCode the TV's half): opened by
 * the address the TV shows, the box
 * for its code -- signed in, the code typed signs the TV in as this
 * pilot; signed out, sign in first, then open the TV's address again.
 */
export default function TvLink() {
  const [open, setOpen] = useState(fromTvAddress);
  const [typed, setTyped] = useState("");
  const { data: pilot, isLoading } = useQuery(pilotQuery);
  const approve = useMutation({ mutationFn: (code: string) => api.approveDevice(code), meta: { silent: true } });
  // Off the address at once, so a reload does not open the box again.
  useEffect(() => { if (open) forgetTvAddress(); }, [open]);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <Dialog open onOpenChange={next => { if (!next) close(); }}>
      <DialogContent data-testid="tv-link">
        <DialogHeader>
          <DialogTitle>Sign in a TV</DialogTitle>
          <DialogDescription>Enter the code the TV shows, and it signs in as you.</DialogDescription>
        </DialogHeader>
        {isLoading ? null : !pilot ? (
          <div className="flex flex-col items-start gap-3">
            <p className={TEXT.prose}>Sign in on this phone first, then open the address the TV shows again.</p>
            <SignInModal />
          </div>
        ) : approve.isSuccess ? (
          <p role="status" className={TEXT.prose} data-testid="tv-link-done">
            The TV is signing in as <span className="font-semibold">{pilot.email}</span>.
          </p>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); approve.mutate(typed); }}>
            <Input
              value={typed} onChange={e => setTyped(e.target.value)} placeholder="XXXX-XXXX" aria-label="The TV's code"
              autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
              className="font-mono tracking-widest" data-testid="tv-link-code"
            />
            {approve.isError && (
              <p role="alert" className={`text-destructive ${TEXT.prose}`} data-testid="tv-link-error">
                {approve.error instanceof ApiError ? approve.error.message : "Couldn't reach the server. Try again."}
              </p>
            )}
            <Button type="submit" disabled={approve.isPending || typed.replace(/[^a-z0-9]/gi, "").length < 8} data-testid="tv-link-approve">
              Sign in the TV
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
