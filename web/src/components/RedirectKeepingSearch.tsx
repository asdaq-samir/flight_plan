import { Navigate, useLocation } from "react-router-dom";

/** A redirect that keeps the query string -- an old `/label?dep=…&dest=…`
 *  link lands on the same route on the Dev page. */
export default function RedirectKeepingSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}
