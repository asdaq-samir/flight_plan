import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import type { Alternates } from "../../../lib/api/types";
import { useSearchParamsNow } from "../../../lib/useSearchParamsNow";

export interface AlternateWhere {
  /** The destination, its ident. */
  dest: string;
  /** The ETA there, an ISO instant; null before the nav log has one. */
  eta: string | null;
  /** The airplane's cruise speed, the way on to an alternate flown at it. */
  tasKt: number;
}

/** The alternate filed (the address's `alternate`, per route), and the
 *  planner's check of it and of the destination (vfr.alternates). */
export function useAlternate({ dest, eta, tasKt }: AlternateWhere) {
  const [params] = useSearchParamsNow();
  const filed = params.get("alternate") ?? "";
  const query = useQuery({
    queryKey: ["alternate", dest, eta, tasKt, filed],
    queryFn: () => api.alternate(dest, eta!, tasKt, filed),
    enabled: !!dest && !!eta, staleTime: 5 * 60_000,
    // Said in its own section, where it was asked for.
    meta: { silent: true },
  });
  return { filed, ...query };
}

/** What the alternate comes to for the Go / No-Go: a stop where the one
 *  filed will not do, a caution where one is needed and none is filed or
 *  the one filed is the pilot's to check; nothing where none is needed. */
export function alternateFinding(data: Alternates | undefined): { finding: "caution" | "stop"; detail: string } | null {
  if (!data || !data.destination.required) return null;
  if (!data.alternate) return { finding: "caution", detail: "An alternate is required (14 CFR 91.169): file one in Weather" };
  if (data.alternate.good === false) return { finding: "stop", detail: `${data.alternate.ident} is under its alternate minimums at the ETA there` };
  if (data.alternate.good === null) return { finding: "caution", detail: `${data.alternate.ident}: ${data.alternate.reasons[0] ?? "check it"}` };
  return null;
}
