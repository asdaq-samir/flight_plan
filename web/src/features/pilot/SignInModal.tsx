import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { notifyProblem } from "../../lib/notify";
import { Mail } from "lucide-react";
import AppleLogo from "../../components/icons/AppleLogo";
import GoogleLogo from "../../components/icons/GoogleLogo";
import IconButton from "../../components/IconButton";
import { Button } from "../../components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";
import { ApiError, api } from "../../lib/api/client";

/**
 * Three ways in, the standard shape every "sign in" prompt (Auth.js,
 * Clerk, Supabase Auth, and Apple/Google's own examples) already
 * converges on: one branded button per OIDC provider, opening a
 * redirect this app doesn't otherwise touch, plus an email fallback
 * for a pilot who'd rather not use either. Google/Apple are plain
 * links to Spring Security's own `/oauth2/authorization/{id}` routes
 * -- nothing for this component to do once clicked, including while
 * that provider isn't actually configured server-side yet (Apple,
 * today): the same honest 404 Google gives unconfigured, not a second
 * "is this available" check duplicating what the click itself already
 * answers.
 */
export default function SignInModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const trimmedEmail = email.trim();
  // The address a link went to is the one it was asked for with -- the
  // mutation's own variable -- not a copy taken from the box when the
  // answer came back, which said "Check" whatever had been typed since,
  // and survived a close and reopen mid-request.
  const magicLink = useMutation({
    mutationFn: (address: string) => api.requestMagicLink(address),
    // Whose fault it was: an address the server refused is the pilot's
    // to fix; a server or network failure is not, and "check the
    // address" sent them looking for a typo that was not there.
    onError: error => notifyProblem({
      title: error instanceof ApiError && error.status === 429 ? "Too many sign-in links asked for. Wait a few minutes and try again."
        : error instanceof ApiError && error.status >= 400 && error.status < 500 ? "Couldn't send that link. Check the address and try again."
          : "Couldn't reach the sign-in service. Try again in a minute.",
    }),
    meta: { silent: true },
  });
  const sent = magicLink.isSuccess ? magicLink.variables : null;

  return (
    <Dialog open={open} onOpenChange={o => {
      setOpen(o);
      if (!o) {
        setEmail("");
        magicLink.reset();
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Sign in</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>Save your aeroplanes and filed flights to your own account.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="justify-start gap-3">
            <a href="/oauth2/authorization/google">
              <GoogleLogo className="size-4" />
              Continue with Google
            </a>
          </Button>
          <Button asChild variant="outline" className="justify-start gap-3">
            <a href="/oauth2/authorization/apple">
              <AppleLogo className="size-4" />
              Continue with Apple
            </a>
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          or
        </div>
        {sent ? (
          <p className="text-sm text-muted-foreground" role="status">
            Check <span className="font-semibold text-foreground">{sent}</span> for a sign-in link.
            It expires in 15 minutes.
          </p>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={e => { e.preventDefault(); magicLink.mutate(trimmedEmail); }}
          >
            <div className="flex gap-2">
              <Input
                type="email"
                required
                placeholder="you@example.com"
                aria-label="Email address"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              {/* A spinner in place of the envelope while the link is on
                  its way: disabled alone looked like nothing happened. */}
              <IconButton
                type="submit"
                variant="default"
                disabled={magicLink.isPending || !trimmedEmail}
                aria-busy={magicLink.isPending}
                label="Send sign-in link"
              >
                {magicLink.isPending ? <Spinner className="size-5" role="presentation" aria-label={undefined} aria-hidden /> : <Mail className="size-5" />}
              </IconButton>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
