#!/usr/bin/env node
// QA any .pptx: render through LibreOffice and check overflow, split words, collisions,
// tiny text, fonts, notes and placeholders.
//   node qa.mjs <deck.pptx> [--out <dir>] [--manifest <build/manifest.json>]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runQa } from "./lib/qa.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pptx = args.find((a, i) => !a.startsWith("--") && !["--out", "--manifest"].includes(args[i - 1]));
if (!pptx || !existsSync(pptx)) {
  console.error("usage: qa.mjs <deck.pptx> [--out <dir>] [--manifest <manifest.json>]");
  process.exit(2);
}
const outDir = resolve(opt("--out") ?? join(dirname(resolve(pptx)), "qa"));
const manifest = opt("--manifest") ? JSON.parse(readFileSync(opt("--manifest"), "utf8")) : null;
const r = await runQa(resolve(pptx), { manifest, outDir });
console.log(`QA: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
for (const e of r.errors) console.log(`  ERROR ${e.slide ? `slide ${e.slide}` : "deck"}: ${e.message}`);
for (const w of r.warnings) console.log(`  warn  ${w.slide ? `slide ${w.slide}` : "deck"}: ${w.message}`);
console.log(`report: ${r.reportPath}\ncontact sheet: ${r.sheet}`);
process.exit(r.errors.length ? 1 : 0);
