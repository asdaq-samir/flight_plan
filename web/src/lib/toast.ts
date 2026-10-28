import type { toast as sonnerToast } from "sonner";

type Sonner = typeof sonnerToast;
type Call = (t: Sonner) => void;

// sonner is 33 KB, and every `import { toast } from "sonner"` kept it in the
// first load, whether or not a toast was ever shown. The app calls toast
// here instead; the calls wait in a queue until AppToaster, which is its own
// chunk, has mounted (ToasterHost, on idle or on the first call) and hands
// over sonner's toast. They run in the order made, so a "loading" then its
// "dismiss" still end with nothing shown. sonner drops a toast made before a
// Toaster has subscribed, which is why they wait for the mount and not for
// the import alone.
let ready: Sonner | null = null;
const queue: Call[] = [];
// If the chunk never loads, a repeated toast.loading would pile up for
// good; the newest calls are the ones worth showing, so the oldest go.
const QUEUE_LIMIT = 50;
const wanting = new Set<() => void>();

function run(call: Call) {
  if (ready) return call(ready);
  queue.push(call);
  if (queue.length > QUEUE_LIMIT) queue.shift();
  wanting.forEach(want => want());
}

/** For ToasterHost: told when a toast is first made, so it mounts the Toaster. */
export function onToastWanted(want: () => void) {
  wanting.add(want);
  if (queue.length) want();
  return () => { wanting.delete(want); };
}

/** For AppToaster, once its Toaster is mounted: sonner's toast, and the queue goes out. */
export function toasterMounted(t: Sonner) {
  ready = t;
  queue.splice(0).forEach(call => call(t));
}

export const toast = Object.assign(
  (message: Parameters<Sonner>[0], options?: Parameters<Sonner>[1]): void => run(t => { t(message, options); }),
  {
    success: (message: Parameters<Sonner["success"]>[0], options?: Parameters<Sonner["success"]>[1]): void =>
      run(t => { t.success(message, options); }),
    loading: (message: Parameters<Sonner["loading"]>[0], options?: Parameters<Sonner["loading"]>[1]): void =>
      run(t => { t.loading(message, options); }),
    dismiss: (id?: string | number): void => run(t => { t.dismiss(id); }),
  },
);
