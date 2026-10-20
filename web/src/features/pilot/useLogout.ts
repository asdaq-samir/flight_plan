import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { forgetPilot } from "../../lib/preferences";
import { pilotQuery } from "../../lib/queryClient";

/** Logging out: the session ended on the server, then the pilot and
 *  everything that was theirs (their airplanes, their flights)
 *  dropped from the cache, so the consoles read signed-out at once, and
 *  what this device kept of theirs forgotten (forgetPilot), at the
 *  owner's pick of the audit's recommendation. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      forgetPilot();
      queryClient.setQueryData(pilotQuery.queryKey, null);
      queryClient.removeQueries({ queryKey: ["aircraft"] });
      queryClient.removeQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: pilotQuery.queryKey });
    },
  });
}
