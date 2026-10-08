import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { LEGAL_PAGES } from "../../lib/legal";
import { capabilitiesQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";

/**
 * Three ways in, the standard shape every "sign in" prompt (Auth.js,
 * Clerk, Supabase Auth, and Apple/Google's own examples) already
 * converges on: one branded button per OIDC provider, opening a
 * redirect this app doesn't otherwise touch, plus an email fallback
 * for a pilot who'd rather not use either. Google/Apple are plain
 * links to Spring Security's own `/oauth2/authorization/{id}` routes,
 * offered only for the providers the deployment has registered
 * (capabilitiesQuery). Both were offered whatever was registered, and
 * one that was not opened a blank 401 -- on the local stack, which
 * registers neither, both did.
 */
export default function SignInModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const providers = useQuery(capabilitiesQuery).data?.providers ?? [];
  const trimmedEmail = email.trim();
  // The address a link went to is the one it was asked for with -- the
  // mutation's own variable -- not a copy taken from the box when the
  // answer came back, which said "Check" whatever had been typed since,
  // and survived a close and reopen mid-request.
  const magicLink = useMutation({
    mutationFn: (address: string) => api.requestMagicLink(address),
    meta: { silent: true },
  });
  // Said under the field it is about (it was a toast over the map), and
  // whose fault it was: an address the server refused is the pilot's to
  // fix; a server or network failure is not, and "check the address"
  // sent them looking for a typo that was not there.
  const linkError = magicLink.error;
  // Only a 400 is the address: a 401 or 403 is the page's own token
  // refused (an http page that could not read the https port's Secure
  // cookie was one), which a reload replaces.
  const linkFailure = !linkError ? null
    : linkError instanceof ApiError && linkError.status === 429 ? "Too many sign-in links asked for. Wait a few minutes and try again."
      : linkError instanceof ApiError && linkError.status === 400 ? "Couldn't send that link. Check the address and try again."
        : linkError instanceof ApiError && linkError.status < 500 ? "Couldn't send that link. Reload the page and try again."
          : "Couldn't reach the sign-in service. Try again in a minute.";
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
          <DialogTitle>Sign in to Wingtip Maps</DialogTitle>
          <DialogDescription>Save your airplanes and filed flights to your own account.</DialogDescription>
        </DialogHeader>
        {providers.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {providers.includes("google") && (
                <Button asChild variant="outline" className="justify-start gap-3">
                  <a href="/oauth2/authorization/google">
                    <GoogleLogo className="size-4" />
                    Continue with Google
                  </a>
                </Button>
              )}
              {providers.includes("apple") && (
                <Button asChild variant="outline" className="justify-start gap-3">
                  <a href="/oauth2/authorization/apple">
                    <AppleLogo className="size-4" />
                    Continue with Apple
                  </a>
                </Button>
              )}
            </div>
            <div className={`flex items-center gap-3 text-muted-foreground ${TEXT.note} before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border`}>
              or
            </div>
          </>
        )}
        {sent ? (
          <p className={`text-muted-foreground ${TEXT.prose}`} role="status">
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
            {linkFailure && <p className={`text-destructive ${TEXT.prose}`} role="alert" data-testid="sign-in-error">{linkFailure}</p>}
          </form>
        )}
        {/* One row of links, not links in a sentence: each gets its 44-point
            area from a pseudo-element, and a wrapped sentence would put
            those areas on top of each other. */}
        <p className={`text-center text-muted-foreground ${TEXT.note}`} data-testid="sign-in-accept">By signing in you accept the</p>
        <nav aria-label="Legal" className={`flex justify-center gap-2 text-tint ${TEXT.note}`} data-testid="sign-in-legal">
          {[LEGAL_PAGES[1], LEGAL_PAGES[0], LEGAL_PAGES[2]].map(p => (
            <a key={p.key} className="relative after:absolute after:-inset-x-1 after:-inset-y-3.5" href={p.href} target="_blank" rel="noreferrer">{p.title}</a>
          ))}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
