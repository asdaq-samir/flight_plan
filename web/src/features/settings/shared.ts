import { ApiError } from "../../lib/api/client";
import type { Pilot } from "../../lib/api/types";

export type PilotState = Pilot | null | "loading" | "error";

export const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : err ? fallback : null;
