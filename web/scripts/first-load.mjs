// How much JavaScript a pilot's phone loads before the planner can draw:
// the entry and the chunks index.html preloads, and every chunk those
// import statically. Chunks behind a dynamic import() load later, when
// something asks for them, so they are not counted. The planner page
// (MapPage) is in the entry's static graph; were it split behind a lazy
// import again, it would leave this count and that would need saying here.
// CI fails the build over the budget, so
// that the first load cannot creep up unnoticed: it went from 1.00 MB to
// 1.30 MB in two weeks before anyone measured it (2026-10-06).
//
//   node scripts/first-load.mjs [dist] [--budget <bytes>]
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const budgetAt = args.indexOf("--budget");
const budget = budgetAt >= 0 ? Number(args[budgetAt + 1]) : null;
// With no --budget, budgetAt is -1 and the first argument is index 0, which
// "i !== budgetAt + 1" alone would skip: the dist named on its own was ignored.
const dist = args.find((a, i) => !a.startsWith("--") && (budgetAt < 0 || i !== budgetAt + 1)) ?? "dist";
const assets = join(dist, "assets");

const html = readFileSync(join(dist, "index.html"), "utf8");
const roots = [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"/]+\.js)"/g)].map(m => m[1]);
if (roots.length === 0) {
  console.error(`first-load: no script in ${join(dist, "index.html")}`);
  process.exit(2);
}

// Static imports only: `from"./x.js"` and `import"./x.js"`. A dynamic
// import is written `import("./x.js")`, which this does not match.
const staticImport = /(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g;
const seen = new Map();
const visit = (file) => {
  if (seen.has(file)) return;
  const code = readFileSync(join(assets, file), "utf8");
  seen.set(file, Buffer.byteLength(code));
  for (const [, dep] of code.matchAll(staticImport)) visit(dep);
};
roots.forEach(visit);

const total = [...seen.values()].reduce((a, b) => a + b, 0);
const mb = (n) => (n / 1e6).toFixed(2) + " MB";
for (const [file, bytes] of [...seen].sort((a, b) => b[1] - a[1])) {
  console.log(`${(bytes / 1e3).toFixed(0).padStart(6)} KB  ${file}`);
}
console.log(`first load: ${mb(total)} of JavaScript in ${seen.size} chunks` + (budget ? `, budget ${mb(budget)}` : ""));
// The exact count, for the nightly speed trend (ci.yml, Speed lab).
console.log(`first load bytes: ${total}`);
// The shared engine's WebAssembly (lib/engine), which index.html preloads
// and main.tsx waits for before the first render: said, but not in the
// budget, which is JavaScript's -- the parse and run that held the first
// draw up on a phone. A module is compiled as it streams in, off the main
// thread, and its 143 KB were 66 KB gzipped on 2026-11-03.
const wasm = [...html.matchAll(/<link[^>]*rel="preload"[^>]*href="[^"]*\/assets\/([^"/]+\.wasm)"/g)].map(m => m[1]);
const wasmBytes = wasm.reduce((sum, file) => sum + statSync(join(assets, file)).size, 0);
if (wasm.length) console.log(`plus ${mb(wasmBytes)} of WebAssembly the first render waits for (${wasm.join(", ")}), not in the budget`);
if (budget && total > budget) {
  console.error(`::error title=First load over budget::${mb(total)} of JavaScript, over the ${mb(budget)} budget. Find what grew with this script's list against main's, and see the measure-speed skill.`);
  process.exit(1);
}
