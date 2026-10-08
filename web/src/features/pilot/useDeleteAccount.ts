import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { showError } from "../../lib/problems";

/** What this device keeps for a pilot -- their preferences, the tracks
 *  they flew (lib/track), their drills (lib/drills), the charts kept for
 *  a route -- all under the app's two prefixes in localStorage. */
const ON_THIS_DEVICE = ["vfr.", "wingtip."];

/** This device's copies taken out, as the account they were kept for
 *  goes: the server deletes its own, but cannot reach these. */
export function forgetThisDevice(storage: Storage = window.localStorage) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => key !== null && ON_THIS_DEVICE.some(prefix => key.startsWith(prefix)));
  for (const key of keys) storage.removeItem(key);
}

/** Deleting the signed-in pilot's account (App Review 5.1.1(v)): the
 *  server takes everything that was theirs and the session, this device
 *  its own copies, and the page starts again signed out -- every store
 *  that read the old preferences reads none. A failure deleted nothing,
 *  and says so in an alert (lib/problems). */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      forgetThisDevice();
      window.location.assign("/app/plan");
    },
    onError: err => showError("Your account was not deleted", err instanceof Error ? err.message : null),
  });
}
