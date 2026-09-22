/**
 * Whether this page is being served from the very machine running the
 * stack, and so whether the other services' own ports can be reached
 * at this same host.
 *
 * Loopback only, and that is not a conservative guess -- it is what
 * docker-compose.yml actually does. Every non-webapp port is published
 * as `127.0.0.1:PORT:PORT` rather than `0.0.0.0`, with its own comment
 * saying why: they are local-debugging conveniences, not a public
 * surface, and binding them to the loopback interface keeps
 * `docker compose up` safe to run on a shared or internet-reachable
 * host without also publishing an unauthenticated Jupyter, database or
 * service port to it. webapp is the only intended front door.
 *
 * So a phone on the same desk, reaching the app at the machine's LAN
 * address, genuinely cannot open those links. An earlier version of
 * this file widened the test to private IPv4 ranges so the phone would
 * see them -- which showed four links that could not possibly work.
 * The original two-host test was right; what was missing was saying so
 * rather than silently dropping them (see DevPanel).
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalStack(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}
