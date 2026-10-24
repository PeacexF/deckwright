#!/usr/bin/env node
// Build a deck folder: lay out deck.mjs, write the PPTX, render it, run QA.
//   node build.mjs <deck-folder | deck.mjs> [--no-qa] [--pdf]
// Exit code 1 when layout or QA reports errors.
import { copyFileSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildDeck } from "./lib/deck.mjs";
import { runQa } from "./lib/qa.mjs";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: build.mjs <deck-folder | deck.mjs> [--no-qa] [--pdf]");
  process.exit(2);
}
const file = statSync(resolve(target)).isDirectory() ? join(resolve(target), "deck.mjs") : resolve(target);
if (!existsSync(file)) {
  console.error(`no deck script at ${file}`);
  process.exit(2);
}

const { pptx, manifest, problems } = await buildDeck(file);
console.log(`wrote ${pptx} (${manifest.slides.length} slides)`);
if (problems.length) {
  console.log(`\nlayout problems (${problems.length}):`);
  for (const p of problems)
    console.log(`  ${p.slide ? `slide ${p.slide}` : "deck"}${p.title ? ` «${p.title}»` : ""}: ${p.message}`);
}

let qaErrors = 0;
if (!args.includes("--no-qa")) {
  const report = await runQa(pptx, { manifest, outDir: join(resolve(file, ".."), "qa") });
  qaErrors = report.errors.length;
  console.log(`\nQA: ${report.errors.length} error(s), ${report.warnings.length} warning(s) — ${report.reportPath}`);
  for (const e of report.errors.slice(0, 30)) console.log(`  ERROR slide ${e.slide}: ${e.message}`);
  if (report.errors.length > 30) console.log(`  … ${report.errors.length - 30} more in the report`);
  console.log(`contact sheet: ${report.sheet}`);
  if (args.includes("--pdf")) {
    const out = pptx.replace(/\.pptx$/, ".pdf");
    copyFileSync(report.pdf, out);
    console.log(`pdf: ${basename(out)}`);
  }
}
process.exit(problems.length || qaErrors ? 1 : 0);
