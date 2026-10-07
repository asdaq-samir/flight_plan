import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { pilotQuery } from "../../lib/queryClient";

/** Logging out: the session ended on the server, then the pilot and
 *  everything that was theirs (their airplanes, their flights)
 *  dropped from the cache, so the consoles read signed-out at once. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.setQueryData(pilotQuery.queryKey, null);
      queryClient.removeQueries({ queryKey: ["aircraft"] });
      queryClient.removeQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: pilotQuery.queryKey });
    },
  });
}
