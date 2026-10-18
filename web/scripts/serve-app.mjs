// The built site at /app/, as the webapp serves it, for the iOS build's own
// recording of the native sheet (ios.yml's sheet-demo): the app on the
// runner's simulator loads it from http://localhost. Any path under /app/
// that is not a file is the page itself, as the router wants; the API is
// not here, so the planner's answers fail and the page says so in place.
//
//   node scripts/serve-app.mjs <dist> <port>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [root, port] = [process.argv[2] ?? "dist", Number(process.argv[3] ?? 4173)];
const types = {
  ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (!url.startsWith("/app")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
    return;
  }
  let file = path.join(root, url.replace(/^\/app\/?/, "/"));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on ${port}`));
