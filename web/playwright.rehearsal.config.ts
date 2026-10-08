// The suite against the local production rehearsal: Caddy's local
// certificate authority is not one the browser knows.
import base from "./playwright.config";

export default {
  ...base,
  use: { ...base.use, ignoreHTTPSErrors: true },
};
