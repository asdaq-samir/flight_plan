import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { forgetPilot } from "../../lib/preferences";
import { pilotQuery } from "../../lib/queryClient";

/** Logging out: the session ended on the server, then the pilot and
 *  everything that was theirs (their airplanes, their flights)
 *  dropped from the cache, so the consoles read signed-out at once, and
 *  what this device kept of theirs forgotten (forgetPilot, and the
 *  service worker's pilot-own cache), at the owner's pick of the audit's
 *  recommendation. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      forgetPilot();
      // The service worker's copy of their account, airplanes and
      // flights (vite.config.ts, pilot-own), which a start with no
      // signal would otherwise show the next person to pick up the phone.
      if ("caches" in globalThis) void caches.delete("pilot-own").catch(() => undefined);
      queryClient.setQueryData(pilotQuery.queryKey, null);
      queryClient.removeQueries({ queryKey: ["aircraft"] });
      queryClient.removeQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: pilotQuery.queryKey });
    },
  });
}
