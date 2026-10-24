// Font resolution and text measurement. Line breaks match LibreOffice's for the fonts we use,
// so layout can size every text box before rendering instead of guessing.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fontEnv } from "./tools.mjs";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const PT = 72; // points per inch

const resolved = new Map();
const loaded = new Map();

/**
 * Find the font file fontconfig would use for a family/style.
 * Returns { family, style, file, substituted } — substituted is true when the requested
 * family isn't installed and fontconfig fell back to another one.
 */
export function resolveFont(family, { bold = false, italic = false } = {}) {
  const key = `${family}|${bold}|${italic}`;
  if (resolved.has(key)) return resolved.get(key);
  const style = [bold && "Bold", italic && "Italic"].filter(Boolean).join(" ") || "Regular";
  let out;
  try {
    const raw = execFileSync("fc-match", ["-f", "%{family[0]}|%{style[0]}|%{file}", `${family}:style=${style}`], {
      encoding: "utf8",
      env: fontEnv(), // same fonts and fallbacks as the LibreOffice render
    });
    const [fam, sty, file] = raw.split("|");
    out = { family: fam, style: sty, file, substituted: norm(fam) !== norm(family) };
  } catch {
    out = { family, style, file: null, substituted: true };
  }
  resolved.set(key, out);
  return out;
}

const norm = (s) => s.trim().toLowerCase();

function load(family, bold, italic) {
  const { file } = resolveFont(family, { bold, italic });
  if (!file) throw new Error(`No font file for "${family}". Is fontconfig (fc-match) installed?`);
  if (!loaded.has(file)) {
    let font = fontkit.openSync(file);
    if (font.fonts) font = font.fonts[0]; // .ttc collection
    loaded.set(file, font);
  }
  return loaded.get(file);
}

/** Width of a string in inches. `spacing` is extra letter spacing in points. */
export function textWidth(text, { face, size, bold = false, italic = false, spacing = 0 }) {
  if (!text) return 0;
  const font = load(face, bold, italic);
  const units = font.layout(text).advanceWidth;
  return ((units / font.unitsPerEm) * size + spacing * [...text].length) / PT;
}

// LibreOffice lays out PPTX text at 1.2 × size × spacing whatever the font's own metrics
// (measured for ten fonts with hhea line heights from 1.13 to 1.30). PowerPoint uses the
// font metrics instead; LibreOffice is the reference renderer, so we model LibreOffice.
const LO_LINE = 1.2;
// The last line's glyphs reach up to ~0.1 × size below its line box (Courier New, the worst case).
const TAIL = 0.1;

/** Height of one line in inches. */
export function lineHeight({ size, lineSpacing = 1 }) {
  return (size * lineSpacing * LO_LINE) / PT;
}

/**
 * Split a paragraph at the places LibreOffice may break a line: spaces, after a hyphen
 * inside a word ("Улан-|Батор"), and after a dash that isn't followed by a space.
 * Returns [{ text, sep }] where sep is what joins the segment to the previous one.
 */
export function breakSegments(para) {
  const out = [];
  for (const word of para.split(/ +/).filter(Boolean)) {
    const parts = word.split(/(?<=[\p{L}\p{N})»"]-)(?=\p{L})|(?<=[–—])(?=\S)/u);
    parts.forEach((text, i) => out.push({ text, sep: i === 0 ? " " : "" }));
  }
  return out;
}

/**
 * Greedy line breaking, like LibreOffice. `measure(str) => inches`.
 * A segment wider than the line stays whole on its own line and is reported in `tooWide`
 * (LibreOffice would then break it mid-word).
 */
export function wrapWords(text, width, measure) {
  const lines = [];
  const tooWide = [];
  for (const para of String(text).split("\n")) {
    let cur = "";
    for (const { text: seg, sep } of breakSegments(para)) {
      if (measure(seg) > width) tooWide.push(seg);
      const trial = cur ? cur + sep + seg : seg;
      if (!cur || measure(trial) <= width) cur = trial;
      else {
        lines.push(cur);
        cur = seg;
      }
    }
    lines.push(cur);
  }
  return { lines, tooWide };
}

/** Apply a style's caps transform to a run's text. */
export const runText = (text, s) => (s.caps ? String(text).toUpperCase() : String(text));

/**
 * Break one paragraph made of styled runs into lines.
 * runs: [{ text, style }]. Each segment is measured once with the style of the run(s) it spans.
 */
export function wrapRuns(runs, width) {
  const texts = runs.map((r) => runText(r.text, r.style));
  const starts = [];
  let total = "";
  for (const t of texts) {
    starts.push(total.length);
    total += t;
  }
  const styleAt = (i) =>
    runs[
      Math.max(
        0,
        starts.findLastIndex((s) => s <= i),
      )
    ].style;
  const sliceWidth = (from, to) => {
    let w = 0;
    runs.forEach((r, k) => {
      const a = Math.max(from, starts[k]);
      const b = Math.min(to, starts[k] + texts[k].length);
      if (a < b) w += textWidth(total.slice(a, b), r.style);
    });
    return w;
  };

  // segments with offsets into `total`
  const segs = [];
  for (const m of total.matchAll(/\S+/g)) {
    let off = m.index;
    breakSegments(m[0]).forEach(({ text, sep }, i) => {
      const at = total.indexOf(text, off);
      segs.push({ text, sep: i === 0 ? " " : sep, start: at, end: at + text.length });
      off = at + text.length;
    });
  }

  const lines = [];
  const tooWide = [];
  let cur = null;
  for (const seg of segs) {
    const w = sliceWidth(seg.start, seg.end);
    if (w > width) tooWide.push(seg.text);
    const sepW = seg.sep ? textWidth(" ", styleAt(seg.start)) : 0;
    if (!cur) cur = { text: seg.text, w };
    else if (cur.w + sepW + w <= width) cur = { text: cur.text + seg.sep + seg.text, w: cur.w + sepW + w };
    else {
      lines.push(cur.text);
      cur = { text: seg.text, w };
    }
  }
  lines.push(cur ? cur.text : "");
  return { lines, tooWide };
}

/**
 * Lay out paragraphs in a box of `width` inches.
 * paras: [{ runs: [{ text, style }], style, indent? (in), spaceAfter? (pt) }] — `style` is the
 * paragraph's line style (size and lineSpacing set the line height).
 * Returns { height, lines, tooWide, paras: [{ lines, height }] }.
 */
export function measureParagraphs(paras, width) {
  let height = 0;
  let lineCount = 0;
  const tooWide = [];
  const out = paras.map((p, i) => {
    const r = wrapRuns(p.runs, width - (p.indent ?? 0));
    const h = r.lines.length * lineHeight(p.style);
    const after = i < paras.length - 1 ? (p.spaceAfter ?? 0) / PT : 0;
    height += h + after;
    lineCount += r.lines.length;
    tooWide.push(...r.tooWide);
    return { lines: r.lines, height: h };
  });
  if (paras.length) height += (TAIL * paras.at(-1).style.size) / PT;
  return { height, lines: lineCount, tooWide, paras: out };
}
