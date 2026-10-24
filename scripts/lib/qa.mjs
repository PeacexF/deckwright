// QA: render a deck through LibreOffice and check what actually came out.
// Works on any .pptx; a build manifest adds reserved zones and roles.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";
import { Package } from "./pptx.mjs";
import { contactSheet, convert, rasterize } from "./render.mjs";
import { resolveFont } from "./text.mjs";
import { tools } from "./tools.mjs";

const run = promisify(execFile);
const TOL = 0.03; // in — rendered text may poke this far past its box before it counts
// Rendered size is estimated from pdftotext word height ≈ 1.12 × font size: within 2 % for
// Arial, Georgia and Times, ~8 % high for Verdana. 8.8 keeps real 9 pt text out of the errors.
const MIN_PT = 8.8;
const SMALL_PT = 11.5;
const GLYPH_BOX = 1.12;
const BULLET = /^[•▪◦●■‣–—]$/u;
const NON_CONTENT_PH = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);

const clean = (s) => s.replace(/[\u00a0\u202f]/g, " ").replace(/\u00ad/g, "");
const tokens = (s) => clean(s).split(/\s+/).filter(Boolean);

/** Words per page from pdftotext -bbox, in inches. */
export function parseBbox(xml) {
  const pages = [];
  for (const m of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const words = [...m[3].matchAll(/xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map(
      (w) => ({
        x0: +w[1] / 72,
        y0: +w[2] / 72,
        x1: +w[3] / 72,
        y1: +w[4] / 72,
        t: clean(
          w[5]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'"),
        ),
      }),
    );
    pages.push({ w: +m[1] / 72, h: +m[2] / 72, words });
  }
  return pages;
}

/**
 * Match one token against rendered words starting at i. Returns { n, kind } where n is how many
 * words it took: kind "ok", "hyphen" (broken after a real hyphen — fine), "split" (broken
 * mid-word), "autohyphen" (LibreOffice inserted a hyphen). null when it doesn't match.
 */
export function matchToken(tok, words, i) {
  const w = words[i]?.t;
  if (w == null) return null;
  if (w === tok) return { n: 1, kind: "ok" };
  if (!tok.startsWith(w.replace(/-$/, ""))) return null;
  let acc = w;
  let newLine = false;
  for (let k = 1; k < 5 && words[i + k]; k++) {
    const prev = words[i + k - 1];
    const next = words[i + k];
    // pdftotext also splits letter-spaced text into fragments; only a fragment on the next line is a line break
    const broke = next.y0 > prev.y0 + 0.5 * (prev.y1 - prev.y0);
    newLine ||= broke;
    if (broke && acc.endsWith("-") && !tok.startsWith(acc) && acc.slice(0, -1) + next.t === tok)
      return { n: k + 1, kind: "autohyphen" };
    acc += next.t;
    if (acc === tok)
      return { n: k + 1, kind: !newLine ? "ok" : /[-–—]$/.test(prev.t) || /^[–—]/.test(next.t) ? "hyphen" : "split" };
    if (!tok.startsWith(acc)) return null;
  }
  return null;
}

/**
 * Align a shape's tokens with the page's word stream. Returns matched word indices and line-break events.
 * The same words often appear twice on a slide ("2024" in a text box and on a chart axis), so among
 * candidate starts the one nearest the shape's own box wins, then the one nearest the stream cursor.
 */
export function alignShape(toks, words, from = 0, box = null) {
  const tryAt = (start) => {
    const idx = [];
    const events = [];
    let i = start;
    let matched = 0;
    for (const tok of toks) {
      while (words[i] && BULLET.test(words[i].t) && words[i].t !== tok) i++;
      const m = matchToken(tok, words, i);
      if (!m) break;
      for (let k = 0; k < m.n; k++) idx.push(i + k);
      if (m.kind !== "ok" && m.kind !== "hyphen") events.push({ kind: m.kind, token: tok, at: i });
      i += m.n;
      matched++;
    }
    return { idx, events, matched, end: i };
  };
  // a one-word start like «в» matches anywhere; require two tokens in a row when there are two
  const need = Math.min(2, toks.length);
  const dist = (w) => {
    if (!box) return 0;
    const dx = Math.max(box.x - w.x1, 0, w.x0 - (box.x + box.w));
    const dy = Math.max(box.y - w.y1, 0, w.y0 - (box.y + box.h));
    return Math.hypot(dx, dy);
  };
  let best = null;
  for (let s = 0; s < words.length; s++) {
    if (!matchToken(toks[0], words, s)) continue;
    const r = tryAt(s);
    if (r.matched < need) continue;
    // full matches first, then nearest the box (0.1 in steps), then after the cursor, then nearest it
    const score = [
      r.matched === toks.length ? 0 : 1,
      Math.round(dist(words[s]) * 10),
      s < from ? 1 : 0,
      Math.abs(s - from),
    ];
    if (!best || lexLess(score, best.score)) best = { ...r, score };
  }
  return best ?? { idx: [], events: [], matched: 0, end: from };
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

const union = (ws) =>
  ws.reduce(
    (u, w) => ({
      x0: Math.min(u.x0, w.x0),
      y0: Math.min(u.y0, w.y0),
      x1: Math.max(u.x1, w.x1),
      y1: Math.max(u.y1, w.y1),
    }),
    {
      x0: Infinity,
      y0: Infinity,
      x1: -Infinity,
      y1: -Infinity,
    },
  );

const overlap = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

const boxOf = (b) => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
const fmt = (v) => `${v.toFixed(2)} in`;

/** Check one rendered page against the slide's text shapes. */
export function checkPage(page, shapes, { reserved = [], slide, smallShare = true }) {
  const errors = [];
  const warnings = [];
  const owner = new Array(page.words.length).fill(-1);
  let cursor = 0;
  const textShapes = shapes.filter(
    (s) => s.text.trim() && s.box && !s.hasField && (s.kind === "sp" || s.kind === "table"),
  );
  textShapes.forEach((s, si) => {
    const toks = tokens(s.text);
    const r = alignShape(toks, page.words, cursor, s.box);
    if (!r.idx.length) return;
    cursor = r.end;
    for (const i of r.idx) owner[i] = si;
    for (const e of r.events) {
      const where = `«${s.name}»`;
      if (e.kind === "split")
        errors.push({
          slide,
          check: "split-word",
          message: `«${e.token}» is broken mid-word across lines in ${where}`,
        });
      else warnings.push({ slide, check: "hyphenation", message: `LibreOffice hyphenated «${e.token}» in ${where}` });
    }
    if (s.kind === "table") return; // table rows grow to fit; the page-bounds check still applies
    const u = union(r.idx.map((i) => page.words[i]));
    const b = boxOf(s.box);
    const label = `«${clip(s.text)}»`;
    if (u.y1 > b.y1 + TOL)
      errors.push({ slide, check: "overflow", message: `text ${label} runs ${fmt(u.y1 - b.y1)} below its box` });
    if (u.x1 > b.x1 + TOL)
      errors.push({
        slide,
        check: "overflow",
        message: `text ${label} runs ${fmt(u.x1 - b.x1)} past the right edge of its box`,
      });
    if (u.y0 < b.y0 - 0.3)
      warnings.push({
        slide,
        check: "overflow",
        message: `text ${label} starts ${fmt(b.y0 - u.y0)} above its box (anchored to the bottom or middle?)`,
      });
  });

  // the slide's own text off the page (a template's oversized slide number may bleed off by design)
  page.words.forEach((w, i) => {
    if (owner[i] === -1) return;
    if (w.x0 < -TOL || w.y0 < -TOL || w.x1 > page.w + TOL || w.y1 > page.h + TOL)
      errors.push({ slide, check: "off-slide", message: `«${w.t}» is outside the slide` });
  });

  // text colliding with text from another shape (or with master text like the slide number)
  const seen = new Set();
  for (let i = 0; i < page.words.length; i++) {
    for (let j = i + 1; j < page.words.length; j++) {
      if (owner[i] === owner[j] && owner[i] !== -1) continue;
      if (owner[i] === -1 && owner[j] === -1) continue;
      if (overlap(page.words[i], page.words[j]) < 0.2) continue;
      const a = owner[i] === -1 ? `«${page.words[i].t}»` : `«${clip(textShapes[owner[i]].text)}»`;
      const b = owner[j] === -1 ? `«${page.words[j].t}»` : `«${clip(textShapes[owner[j]].text)}»`;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({ slide, check: "collision", message: `text ${a} overlaps ${b}` });
    }
  }

  for (const z of reserved) {
    const zb = boxOf(z);
    const hit = page.words.find((w, i) => owner[i] !== -1 && overlap(w, zb) > 0 && !(z.allow ?? []).includes(owner[i]));
    if (hit) errors.push({ slide, check: "reserved", message: `«${hit.t}» sits in the template's ${z.name} area` });
  }

  // rendered size
  const pt = (w) => (w.y1 - w.y0) * (72 / GLYPH_BOX);
  const real = page.words.filter((w) => !BULLET.test(w.t));
  const tiny = real.filter((w) => pt(w) < MIN_PT);
  if (tiny.length)
    errors.push({
      slide,
      check: "tiny-text",
      message: `${tiny.length} word(s) render below 9 pt, e.g. «${tiny[0].t}»`,
    });
  // Share of small text, by characters: pdftotext splits letter-spaced caps into one-letter fragments,
  // which would inflate a per-word count. Decks we build enforce role minimums instead (smallShare: false).
  if (smallShare) {
    const chars = real.reduce((n, w) => n + w.t.length, 0);
    const small = real.filter((w) => pt(w) < SMALL_PT).reduce((n, w) => n + w.t.length, 0);
    if (chars >= 120 && small / chars > 0.25)
      warnings.push({
        slide,
        check: "small-text",
        message: `${Math.round((100 * small) / chars)} % of the text is under ${SMALL_PT} pt`,
      });
  }
  return { errors, warnings, words: page.words.length };
}

const clip = (s, n = 32) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Run every check. Returns { errors, warnings, reportPath, sheet, pdf, pngs }. */
export async function runQa(pptx, { manifest = null, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const errors = [];
  const warnings = [];
  const pkg = await Package.open(pptx);
  const pres = await pkg.presentation();

  // structure
  const slides = [];
  for (const [i, sp] of pres.slides.entries()) {
    const n = i + 1;
    const m = manifest?.slides?.[i];
    const shapes = await pkg.slideShapes(sp);
    const notes = await pkg.notesText(sp);
    if (!notes?.trim() && (!m || m.role === "content" || m.role === "sources"))
      (m ? errors : warnings).push({ slide: n, check: "notes", message: "no speaker notes" });
    for (const s of shapes.filter((s) => s.ph && !NON_CONTENT_PH.has(s.ph.type) && !s.text.trim() && s.kind === "sp")) {
      if (m?.blank) continue;
      const isTitle = ["title", "ctrTitle"].includes(s.ph.type);
      (isTitle ? errors : warnings).push({
        slide: n,
        check: "placeholder",
        message: `empty ${s.ph.type} placeholder «${s.name}»`,
      });
    }
    for (const s of shapes.filter((s) => s.box && s.kind !== "cxnSp")) {
      const b = s.box;
      if (b.x < -0.01 || b.y < -0.01 || b.x + b.w > pres.size.w + 0.01 || b.y + b.h > pres.size.h + 0.01)
        if (s.text.trim())
          warnings.push({ slide: n, check: "shape-bounds", message: `«${s.name}» extends past the slide edge` });
    }
    slides.push({ n, path: sp, shapes, notes });
  }

  // fonts
  const parts = new Set(pres.slides);
  for (const sp of pres.slides) {
    const l = await pkg.layoutOf(sp);
    if (l) {
      parts.add(l);
      parts.add(await pkg.masterOf(l));
    }
  }
  const fonts = [];
  for (const [name, where] of await pkg.typefaces([...parts].filter(Boolean))) {
    const r = resolveFont(name.trim());
    const entry = { name, installed: !r.substituted, rendersAs: r.family, where: [...where].length };
    fonts.push(entry);
    if (name !== name.trim())
      errors.push({
        slide: 0,
        check: "font",
        message: `font name «${name}» has stray whitespace — LibreOffice can't match it and substitutes another font`,
      });
    else if (r.substituted)
      warnings.push({
        slide: 0,
        check: "font",
        message: `font «${name}» isn't installed; it renders as «${r.family}»`,
      });
  }

  // render
  const pdf = await convert(pptx, outDir, "pdf", { locale: manifest?.language });
  const { stdout: xml } = await run(tools.pdftotext(), ["-bbox", pdf, "-"], { maxBuffer: 64 << 20 });
  const pages = parseBbox(xml);
  if (pages.length !== slides.length)
    errors.push({
      slide: 0,
      check: "render",
      message: `the PDF has ${pages.length} pages for ${slides.length} slides`,
    });
  const pngs = await rasterize(pdf, join(outDir, "png"));
  const sheet = await contactSheet(pngs, join(outDir, "sheet.jpg"));
  const { stdout: pf } = await run("pdffonts", [pdf]).catch(() => ({ stdout: "" }));
  const embedded = [
    ...new Set(
      pf
        .split("\n")
        .slice(2)
        .map((l) => l.split(/\s+/)[0]?.replace(/^[A-Z]{6}\+/, ""))
        .filter(Boolean),
    ),
  ];
  // fonts in the PDF that the deck never asked for mean per-glyph fallback (a «₽» missing from the
  // body font) or a substitution the font table can't see
  const key = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
  const expected = fonts.flatMap((f) => [key(f.name), key(f.rendersAs)]);
  const stray = embedded.filter((e) => !/^opensymbol/i.test(e) && !expected.some((k) => k && key(e).startsWith(k)));
  if (stray.length)
    warnings.push({
      slide: 0,
      check: "font",
      message: `LibreOffice drew some text in fonts the deck doesn't name: ${stray.join(", ")} — glyphs missing from the deck's fonts, or a substitution`,
    });

  // rendered checks
  const perSlide = [];
  for (const s of slides) {
    const page = pages[s.n - 1];
    if (!page) continue;
    const reserved = manifest?.slides?.[s.n - 1]?.reserved ?? [];
    const r = checkPage(page, s.shapes, { reserved, slide: s.n, smallShare: !manifest });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (!r.words && !s.shapes.some((x) => x.kind === "pic") && !manifest?.slides?.[s.n - 1]?.blank)
      warnings.push({ slide: s.n, check: "empty", message: "slide renders no text and no pictures" });
    perSlide.push({ n: s.n, words: r.words });
  }

  const flagged = new Set([...errors, ...warnings].map((e) => e.slide).filter(Boolean));
  const look = [...new Set([1, ...flagged, slides.length])].sort((a, b) => a - b);
  const report = {
    deck: basename(pptx),
    renderedAt: new Date().toISOString(),
    slides: slides.length,
    errors,
    warnings,
    fonts,
    embeddedFonts: embedded,
    look: look.map((n) => ({ slide: n, png: relative(outDir, pngs[n - 1] ?? "") })),
    sheet: relative(outDir, sheet),
  };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const reportPath = join(outDir, "report.md");
  writeFileSync(reportPath, markdown(report, manifest));
  return { ...report, reportPath, sheet, pdf, pngs };
}

function markdown(r, manifest) {
  const line = (e) => `- ${e.slide ? `slide ${e.slide}` : "deck"} — ${e.message}`;
  const titles = new Map((manifest?.slides ?? []).map((s) => [s.n, s.title]));
  return [
    `# QA report — ${r.deck}`,
    "",
    `Rendered ${r.renderedAt.slice(0, 16).replace("T", " ")} with LibreOffice (the reference renderer). ${r.slides} slides.`,
    "",
    `**${r.errors.length} error(s), ${r.warnings.length} warning(s).** Contact sheet: \`${r.sheet}\``,
    "",
    "## Errors",
    "",
    ...(r.errors.length ? r.errors.map(line) : ["None."]),
    "",
    "## Warnings",
    "",
    ...(r.warnings.length ? r.warnings.map(line) : ["None."]),
    "",
    "## Slides to look at",
    "",
    ...r.look.map((l) => `- slide ${l.slide}${titles.get(l.slide) ? ` «${titles.get(l.slide)}»` : ""} — \`${l.png}\``),
    "",
    "## Fonts",
    "",
    "| Font in the deck | Installed | Renders as |",
    "| --- | --- | --- |",
    ...r.fonts.map((f) => `| \`${f.name}\` | ${f.installed ? "yes" : "no"} | ${f.rendersAs} |`),
    "",
    `Embedded in the PDF: ${r.embeddedFonts.join(", ") || "—"}`,
    "",
  ].join("\n");
}
