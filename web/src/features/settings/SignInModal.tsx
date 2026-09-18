import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import AppleLogo from "../../components/icons/AppleLogo";
import GoogleLogo from "../../components/icons/GoogleLogo";
import { Button } from "../../components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";

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
  const [sent, setSent] = useState<string | null>(null);
  const magicLink = useMutation({
    mutationFn: () => api.requestMagicLink(email.trim()),
    onSuccess: () => setSent(email.trim()),
  });

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) { setSent(null); magicLink.reset(); } }}>
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
          <p className="text-sm text-muted-foreground">
            Check <span className="font-semibold text-foreground">{sent}</span> for a sign-in link.
            It expires in 15 minutes.
          </p>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={e => { e.preventDefault(); magicLink.mutate(); }}
          >
            <div className="flex gap-2">
              <Input
                type="email"
                required
                placeholder="you@example.com"
                aria-label="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <Button type="submit" size="icon" disabled={magicLink.isPending} aria-label="Send sign-in link">
                <Mail className="size-4" />
              </Button>
            </div>
            {magicLink.isError && (
              <p className="text-sm text-destructive">Couldn't send that link. Try again in a moment.</p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
