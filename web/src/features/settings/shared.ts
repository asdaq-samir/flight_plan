import { describeError } from "../../lib/api/client";
import type { Pilot } from "../../lib/api/types";

export type PilotState = Pilot | null | "loading" | "error";

/** `describeError` for a query's `error` field, which is null while
 *  nothing has failed -- and so is this. */
export const errorMessage = (err: unknown, fallback: string) => (err ? describeError(err, fallback) : null);
