/**
 * Whether the browser is looking straight at a development stack, and
 * so whether the other services' own ports are reachable at this same
 * host.
 *
 * The developer console links out to planning-service, model-service,
 * Jupyter and Airflow on ports 8084, 8000, 8888 and 8081. Those are
 * published by docker-compose on the machine running the stack, so the
 * links only make sense when this page is being served from that same
 * machine -- and they are actively wrong on a real deployment, where
 * those ports are not open to the world.
 *
 * The test used to be an exact match on "localhost" or "127.0.0.1",
 * which is true of the developer's own browser and false of the phone
 * on the same desk. Reaching the stack from a phone means typing the
 * machine's LAN address (10.0.0.218, say), and the console silently
 * dropped half its links -- the ports were open the whole time.
 *
 * So the question is "is this host on this network" rather than "is
 * this host this machine": loopback, a private IPv4 range, or an mDNS
 * .local name. A deployed domain matches none of them.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** 10/8, 192.168/16, 172.16/12 and 169.254/16 -- RFC 1918 plus
 *  link-local, which is what a phone on a desk gets. */
const PRIVATE_IPV4 =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/;

export function isLocalStack(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK.has(host) || PRIVATE_IPV4.test(host) || host.endsWith(".local");
}
