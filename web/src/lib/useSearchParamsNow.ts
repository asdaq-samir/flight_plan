import { useCallback } from "react";
import { createSearchParams, useNavigate, useSearchParams, type SetURLSearchParams } from "react-router-dom";

/**
 * React Router's `useSearchParams`, except that a change written as a
 * function is applied to the address as it is now, not as it was when
 * this component last rendered.
 *
 * The router's own hands the function the params of the last render.
 * Two changes before the next render -- the drawer opened just as the
 * default route arrives -- and the second is worked out from an address
 * without the first, and replaces it: on a phone-speed processor the tap
 * on the drawer was lost every time the routes answered within 30 ms of
 * it. The router writes the browser's address as each navigation lands,
 * so that is the one to start from -- or, while one this app asked for
 * has not landed yet, that one: the data router lands a navigation a
 * moment later, not as it is asked for, and the drawer closed with
 * Ctrl+B just as the default route arrived came back open (the route's
 * change worked out from the address with view=briefing still in it).
 */
let pending: string | null = null;

export function useSearchParamsNow(): [URLSearchParams, SetURLSearchParams] {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setSearchParams = useCallback<SetURLSearchParams>((next, options) => {
    const base = pending ?? window.location.search;
    const search = `?${createSearchParams(typeof next === "function" ? next(new URLSearchParams(base)) : next)}`;
    pending = search;
    void Promise.resolve(navigate(search, options)).finally(() => {
      if (pending === search) pending = null;
    });
  }, [navigate]);
  return [searchParams, setSearchParams];
}
