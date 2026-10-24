#!/usr/bin/env node
// Start a deck folder: deck-output/<slug>/ with img/ and a deck.mjs skeleton. Never overwrites:
// if the folder exists, the next free <slug>-2, <slug>-3 … is used.
//   node new.mjs "<title>" [--root <dir>] [--template <file.potx>]
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Lowercase, hyphenated, letters of any script kept ("Q3 Results: EMEA" -> "q3-results-emea", «Монголия» -> «монголия»). */
export function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "deck"
  );
}

/** First free folder name under root: slug, slug-2, slug-3 … */
export function freeDir(root, slug) {
  let dir = join(root, slug);
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${slug}-${i}`);
  return dir;
}

const skeleton = (title, template) => `// ${title}
export default (deck) => {
  deck.meta({
    title: ${JSON.stringify(title)},
    language: "en-US",${template ? `\n    template: ${JSON.stringify(template)},` : `\n    theme: "editorial",\n    palette: { primary: "0F3D73", accent: "C4272F" },`}
  });

  deck.cover({ title: ${JSON.stringify(title)}, notes: "…" });

  deck.slide({ title: "…", source: "…", notes: "…" }, (s, body) => {
    s.place(body, s.text("…"));
  });

  deck.sources({ groups: [{ title: "…", entries: [] }], notes: "…" });
};
`;

function main() {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const title = args.find((a, i) => !a.startsWith("--") && !["--root", "--template"].includes(args[i - 1]));
  if (!title) {
    console.error('usage: new.mjs "<title>" [--root <dir>] [--template <file.potx>]');
    process.exit(2);
  }
  const root = resolve(opt("--root") ?? "deck-output");
  const dir = freeDir(root, slugify(title));
  mkdirSync(join(dir, "img"), { recursive: true });
  let template;
  if (opt("--template")) {
    template = basename(opt("--template"));
    copyFileSync(resolve(opt("--template")), join(dir, template));
  }
  writeFileSync(join(dir, "deck.mjs"), skeleton(title, template));
  console.log(dir);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
