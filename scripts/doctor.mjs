#!/usr/bin/env node
// Check that everything deckwright needs is installed. Exit 1 if anything required is missing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSoffice, which } from "./lib/tools.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FONT_DIRS = [
  "/System/Library/Fonts/Supplemental",
  "/System/Library/Fonts",
  "/Library/Fonts",
  `${process.env.HOME}/Library/Fonts`,
];
const FONTS = ["Arial.ttf", "Arial Bold.ttf", "Georgia.ttf", "Georgia Bold.ttf"];

const rows = [];
const check = (name, ok, detail, fix, required = true) => rows.push({ name, ok, detail, fix, required });

const [major] = process.versions.node.split(".").map(Number);
check("Node.js >= 22", major >= 22, process.version, "Install a current Node.js (brew install node)");

for (const dep of ["pptxgenjs", "sharp", "fontkit", "jszip", "pptx-automizer"]) {
  // read package.json from disk: packages with an "exports" map refuse require("<dep>/package.json")
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(ROOT, "node_modules", dep, "package.json"), "utf8")).version;
  } catch {
    // not installed: reported as missing below
  }
  check(`npm: ${dep}`, !!version, version ?? "missing", `cd "${ROOT}" && npm install`);
}

const soffice = findSoffice();
let lo = soffice;
if (soffice) {
  try {
    lo = execFileSync(soffice, ["--version"], { encoding: "utf8", timeout: 60000 }).trim();
  } catch {
    // binary exists but won't report a version; the path is still useful
  }
}
check("LibreOffice (soffice)", !!soffice, lo ?? "missing", "brew install --cask libreoffice");

for (const tool of ["pdftoppm", "pdftotext"]) {
  const p = which(tool);
  check(tool, !!p, p ?? "missing", "brew install poppler");
}

for (const font of FONTS) {
  const hit = FONT_DIRS.map((d) => join(d, font)).find(existsSync);
  check(`font: ${font}`, !!hit, hit ?? "missing", "Install the font or pick a theme that doesn't use it", false);
}

let failed = 0;
for (const r of rows) {
  const mark = r.ok ? "ok  " : r.required ? "FAIL" : "warn";
  if (!r.ok && r.required) failed++;
  console.log(`${mark}  ${r.name.padEnd(24)} ${r.detail}${r.ok ? "" : `\n      fix: ${r.fix}`}`);
}
console.log(failed ? `\n${failed} required check(s) failed.` : "\nAll required checks passed.");
process.exit(failed ? 1 : 0);
