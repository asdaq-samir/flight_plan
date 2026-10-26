import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A 32-point text field (`h-8`) reaches the 44-point tap area only through
// FieldHit's label (components/FieldHit), which a button's ::after can't be
// for a field. The pilot console's pages each had some bare ones: the
// airplane's inspections, VOR check and equipment, a squawk's date, an
// endorsement's day. A plain <label> round the field, with its words, is
// as good: a tap on either lands in it.
describe("the pilot console's text fields", () => {
  const dir = __dirname;
  const pages = readdirSync(dir).filter(f => f.endsWith(".tsx"));

  it.each(pages)("%s wraps every 32-point field in FieldHit", page => {
    const source = readFileSync(join(dir, page), "utf8");
    const fields = [...source.matchAll(/<(Input|InputGroup)\b[^>]*?h-8[^>]*>/gs)];
    const wrapped = [...source.matchAll(/<(FieldHit|label)\b[^>]*>\s*(<span>[^<]*<\/span>\s*)?<(Input|InputGroup)\b[^>]*?h-8[^>]*>/gs)];
    expect(fields.length - wrapped.length, `${page}: ${fields.length} fields, ${wrapped.length} in FieldHit`).toBe(0);
  });
});
