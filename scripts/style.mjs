#!/usr/bin/env node
// Read the style of an example deck (.pptx/.potx) and print it with a deck.meta snippet to start from.
//   node style.mjs <example.pptx> [--json]
import { existsSync } from "node:fs";
import { resolveFont } from "./lib/text.mjs";
import { extractStyle } from "./lib/style.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file || !existsSync(file)) {
  console.error("usage: style.mjs <example.pptx|.potx> [--json]");
  process.exit(2);
}
const st = await extractStyle(file);
if (args.includes("--json")) {
  console.log(JSON.stringify(st, null, 1));
  process.exit(0);
}
const note = (f) => (f && resolveFont(f).substituted ? ` (not installed: renders as ${resolveFont(f).family})` : "");
console.log(`${st.slides} slides, ${st.size.w.toFixed(2)} × ${st.size.h.toFixed(2)} in`);
console.log(
  `fonts: headings ${st.fonts.heading}${note(st.fonts.heading)}; body ${st.fonts.body}${note(st.fonts.body)}`,
);
console.log(`sizes: titles ~${st.sizes.title ?? "?"} pt, body ~${st.sizes.body ?? "?"} pt`);
console.log(`text colours: ${st.colors.text.join(" ")}   fills: ${st.colors.fills.join(" ")}`);
console.log(`\nStart from:\n  deck.meta({
    palette: { primary: "${st.palette.primary}", accent: "${st.palette.accent}", ink: "${st.palette.ink}" },
    fonts: { heading: "${st.fonts.heading}", body: "${st.fonts.body}" },
  });`);
