import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../../components/ui/dialog";
import { ApiError, api } from "../../lib/api/client";

/** The token an emailed sign-in link brought, from the address's
 *  fragment (`#signin=…`), where the link's redirect put it
 *  (MagicLinkController#confirm). */
function linkToken(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("signin");
}

/** Takes the token off the address, so a reload or a shared link does
 *  not ask again. */
function forgetLink() {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", pathname + search);
}

/**
 * The last step of an emailed-link sign-in, in the app's own dialog
 * over the planner rather than on a bare server page.
 *
 * Opening the link signs nobody in: mail scanners fetch links to check
 * them, and one that spent the token would leave the pilot a link that
 * says it was already used. The token is spent by the POST this dialog's
 * Sign in button makes -- the one thing a scanner does not do.
 * Success opens wherever the server sent the browser: the planner, or
 * dev mode for a developer.
 */
export default function LinkSignIn() {
  const [token] = useState(linkToken);
  const [open, setOpen] = useState(token !== null);
  const finish = useMutation({
    mutationFn: (value: string) => api.finishMagicLink(value),
    onSuccess: landing => window.location.assign(landing),
    meta: { silent: true },
  });
  if (token === null) return null;

  const spent = finish.error instanceof ApiError && finish.error.status === 400;
  const close = () => {
    setOpen(false);
    forgetLink();
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>Finish signing in with the link from your email.</DialogDescription>
        </DialogHeader>
        {finish.isError && (
          <p role="alert" className="text-sm text-destructive">
            {spent
              ? "This link has expired or was already used. Ask for a new one from the pilot console."
              : "Couldn't sign in just now. Try again."}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={() => finish.mutate(token)} disabled={finish.isPending || spent}>
            Sign in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
