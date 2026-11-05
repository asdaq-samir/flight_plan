// The phone's bundle served for the browser specs (land-and-test.sh specs):
// the static files of a dist under /app/, the app's page for any other
// /app/ address, and /api/, /oauth2/, /login and /logout passed on to the
// live stack's webapp, cookies and all.
//   node serve.mjs <dist> [port] [upstream]
import { createReadStream, statSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const dist = process.argv[2] ?? "/w/dist-traffic";
const port = Number(process.argv[3] ?? 4173);
const upstream = new URL(process.argv[4] ?? "http://host.docker.internal:8080");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm", ".map": "application/json",
};

function file(res, path) {
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(res);
  return true;
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (/^\/(api|oauth2|login|logout|actuator)(\/|$)/.test(url.pathname)) {
    const out = request({
      host: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${upstream.hostname}:${upstream.port || 80}`, "x-forwarded-host": req.headers.host ?? "", "x-forwarded-proto": "http" },
    }, up => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    out.on("error", err => { res.writeHead(502); res.end(String(err)); });
    req.pipe(out);
    return;
  }
  const rel = normalize(url.pathname.replace(/^\/app/, "")).replace(/^(\.\.[/\\])+/, "");
  if (rel !== "/" && file(res, join(dist, rel))) return;
  // The app's page for every address of its own.
  if (!file(res, join(dist, "index.html"))) {
    res.writeHead(404);
    res.end("no bundle");
  }
}).listen(port, () => console.log(`serving ${dist} on ${port}, /api to ${upstream.href}`));
