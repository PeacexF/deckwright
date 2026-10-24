// Deck builder: runs a deck script, lays out every slide, and writes the PPTX plus a manifest.
//
// A deck script is a module whose default export receives the deck API:
//
//   export default (deck) => {
//     deck.meta({ title: "Mongolia", language: "en-US", palette: { primary: "0F3D73", accent: "C4272F" } });
//     deck.cover({ kicker: "Country report", title: "Mongolia", photo: "steppe" });
//     deck.slide({ section: "Экономика", title: "…", source: "…", notes: "…" }, (s) => {
//       const [left, right] = s.body.cols([7, 5]);
//       s.stack(left, [s.kpis([...]), s.bars([...])]);
//       s.place(right, s.photo("camels", { grow: true }));
//     });
//   };
//
// It never imports anything: the library is handed in, so there's nothing to copy into a deck folder.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import PptxGenJS from "pptxgenjs";
import * as C from "./components.mjs";
import { emit } from "./emit.mjs";
import { indexImages, prepareImage } from "./images.mjs";
import { Box } from "./layout.mjs";
import { loadTemplate, writeTemplateDeck } from "./template.mjs";
import { strings } from "./strings.mjs";
import { color, makeTheme } from "./theme.mjs";

const COMPONENTS = [
  "text",
  "bullets",
  "label",
  "kpis",
  "card",
  "photo",
  "bars",
  "stacked",
  "timeline",
  "numbered",
  "bibliography",
  "table",
  "chart",
  "quote",
  "rule",
  "spacer",
];

const fmtIn = (v) => `${v.toFixed(2)} in`;

class SlideCtx {
  constructor(deck, n, opts) {
    this.deck = deck;
    this.n = n;
    this.opts = opts;
    this.theme = deck.theme;
    this.locale = deck.meta.language;
    this.elements = [];
    this.background = null;
    for (const name of COMPONENTS) this[name] = (...args) => C[name](this, ...args);
  }

  problem(message) {
    this.deck.problems.push({ slide: this.n, title: this.opts.title ?? this.opts.role, message });
  }

  checkSize(st) {
    if (st.min && st.size < st.min)
      this.problem(`${st.role} text at ${st.size} pt; the minimum for ${st.role} is ${st.min} pt`);
  }

  image(key) {
    const img = this.deck.images.get(key);
    if (!img) {
      this.problem(`image «${key}» not found in img/ (have: ${[...this.deck.images.keys()].join(", ") || "none"})`);
      return null;
    }
    this.deck.usedImages.set(key, img);
    return img;
  }

  /** Place one component at the top of `box` (or centred/bottom with valign). */
  place(box, comp, { valign = "top" } = {}) {
    let h = comp.grow ? box.h : comp.measure(box.w);
    if (h > box.h + 0.01 && comp.fit && comp.shrinkTo(box.w, box.h)) h = comp.measure(box.w);
    if (h > box.h + 0.01)
      this.problem(
        `content needs ${fmtIn(h)} but the box is ${fmtIn(box.h)} (over by ${fmtIn(h - box.h)}): shorten it, drop something, or split the slide`,
      );
    const y = valign === "middle" ? box.y + (box.h - h) / 2 : valign === "bottom" ? box.y2 - h : box.y;
    this.elements.push(...comp.place(new Box(box.x, y, box.w, comp.grow ? box.h : h)));
    return new Box(box.x, y, box.w, h);
  }

  /** Stack components vertically. Components with grow share the leftover height. */
  stack(box, comps, { gap = 0.3, align = "top" } = {}) {
    const live = comps.filter(Boolean);
    const hs = live.map((c) => (c.grow ? 0 : c.measure(box.w)));
    const growers = live.filter((c) => c.grow).length;
    const fixed = hs.reduce((a, b) => a + b, 0) + gap * (live.length - 1);
    const free = box.h - fixed;
    if (free < -0.01 || (growers && free < 0.5))
      this.problem(
        `stack needs ${fmtIn(fixed + (growers ? 0.5 : 0))} but the box is ${fmtIn(box.h)} (over by ${fmtIn(fixed + (growers ? 0.5 : 0) - box.h)}): shorten it, drop something, or split the slide`,
      );
    const growH = growers ? Math.max(free, 0.5) / growers : 0;
    let g = gap;
    let y = box.y;
    if (!growers && free > 0) {
      if (align === "middle") y += free / 2;
      else if (align === "bottom") y += free;
      else if (align === "spread" && live.length > 1) g = gap + free / (live.length - 1);
    }
    live.forEach((c, i) => {
      const h = c.grow ? growH : hs[i];
      this.elements.push(...c.place(new Box(box.x, y, box.w, h)));
      y += h + g;
    });
    return new Box(box.x, box.y, box.w, y - g - box.y);
  }

  /** Lay components out side by side. Panels (cards) share the tallest height. */
  row(box, comps, { gap = 0.3, widths, valign = "top" } = {}) {
    const cols = box.cols(widths ?? comps.length, gap);
    const hs = comps.map((c, i) => (c.grow ? box.h : c.measure(cols[i].w)));
    const tallest = Math.max(...hs);
    if (tallest > box.h + 0.01)
      this.problem(
        `row needs ${fmtIn(tallest)} but the box is ${fmtIn(box.h)} (over by ${fmtIn(tallest - box.h)}): shorten it or split the slide`,
      );
    comps.forEach((c, i) => {
      const h = c.stretch ? tallest : hs[i];
      const y = valign === "middle" ? box.y + (tallest - h) / 2 : box.y;
      this.elements.push(...c.place(new Box(cols[i].x, y, cols[i].w, h)));
    });
    return new Box(box.x, box.y, box.w, tallest);
  }

  /** Nothing we place may cover the template's logo, slide number or rules. */
  checkReserved() {
    const seen = new Set();
    for (const el of this.elements) {
      const h = el.kind === "table" ? el.rowH.reduce((a, b) => a + b, 0) : el.h;
      if (el.kind === "line" || h == null) continue;
      const b = new Box(el.x, el.y, el.w, h);
      for (const z of this.reserved ?? []) {
        if (seen.has(z.name) || !b.intersects(new Box(z.x, z.y, z.w, z.h))) continue;
        seen.add(z.name);
        this.problem(
          `${el.kind} at y ${fmtIn(el.y)} reaches into the template's ${z.name} area: keep content inside s.body`,
        );
      }
    }
  }

  rect(b, fill) {
    this.elements.push({ kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h, fill: color(this.theme, fill) });
  }

  line(x1, y1, x2, y2, c = "rule", width = 0.75) {
    this.elements.push({ kind: "line", x1, y1, x2, y2, color: color(this.theme, c), width });
  }
}

/** Chrome for the free-design "editorial" theme: running header, title, sources line, page number. */
const editorial = {
  content(s, d) {
    const { left, right, top, bottom } = d.theme.margins;
    const cw = d.W - left - right;
    const head = new Box(left, top, cw, 0.2);
    const short = d.meta.short ?? d.meta.title;
    s.place(head.cols([1, 1], 0.2)[0], s.text(short, { role: "kicker" }));
    if (s.opts.section) s.place(head.cols([1, 1], 0.2)[1], s.text(s.opts.section, { role: "kicker", align: "right" }));
    s.line(left, top + 0.26, left + cw, top + 0.26, "rule");
    const titleBox = s.place(new Box(left, top + 0.5, cw, 1.6), s.text(s.opts.title, { role: "title" }));
    const footBottom = d.H - bottom;
    let footTop = footBottom - 0.22;
    if (s.opts.source) {
      const src = s.text(s.opts.source, { role: "source" });
      const h = src.measure(cw - 1.0);
      footTop = footBottom - h;
      s.place(new Box(left, footTop, cw - 1.0, h), src);
    }
    s.place(
      new Box(left + cw - 0.8, footBottom - 0.24, 0.8, 0.3),
      s.text(String(s.n), { role: "pageNumber", align: "right" }),
      { valign: "bottom" },
    );
    const y = titleBox.y2 + 0.34;
    return new Box(left, y, cw, footTop - 0.3 - y);
  },

  cover(s, d, o) {
    const { left, right } = d.theme.margins;
    const cw = d.W - left - right;
    const photoH = o.photo ? (o.photoHeight ?? 4.1) : 0;
    if (o.photo) s.place(new Box(0, 0, d.W, photoH), s.photo(o.photo, { grow: true, fy: o.fy ?? 0.5 }));
    else s.background = color(d.theme, "primary");
    const fg = o.photo ? {} : { color: "onPrimary" };
    const area = new Box(left, photoH + 0.35, cw, d.H - photoH - 0.35 - 0.45);
    const [main, side] = o.stats ? area.cols([6, 5], 0.6) : [area, null];
    s.stack(
      main,
      [
        o.kicker && s.text(o.kicker, { role: "label", color: o.photo ? "accent" : "onPrimaryMuted" }),
        s.text(o.title, { role: "coverTitle", ...fg }),
        o.subtitle && s.text(o.subtitle, { role: "coverSubtitle", ...(o.photo ? {} : { color: "onPrimaryMuted" }) }),
      ],
      { gap: 0.14 },
    );
    if (side) s.place(side.with({ y: side.y + 0.32 }), s.kpis(o.stats, { size: 24 }));
    const foot = new Box(left, d.H - 0.42, cw, 0.25);
    if (o.presenter) s.place(foot.cols([1, 1])[0], s.text(o.presenter, { role: "source", ...fg }));
    const credit = o.photo && d.images.get(o.photo)?.credit;
    if (o.photoCaption || credit)
      s.place(
        foot.cols([1, 1])[1],
        s.text(o.photoCaption ?? `${d.t.photo}: ${credit.artist || d.t.noAuthor}, ${credit.license || d.t.noLicense}`, {
          role: "source",
          align: "right",
        }),
      );
  },

  closing(s, d, o) {
    const { left, right, top } = d.theme.margins;
    const cw = d.W - left - right;
    s.background = color(d.theme, "primary");
    const area = new Box(left, top + 0.5, cw, d.H - top - 0.5 - 0.5);
    const [main, foot] = area.bottom(0.5, 0.3);
    const comps = [
      o.kicker && s.text(o.kicker, { role: "label", color: "onPrimaryMuted" }),
      o.title && s.text(o.title, { role: "closingTitle" }),
    ];
    const headBox = s.stack(main, comps, { gap: 0.16 });
    if (o.points?.length) {
      const grid = new Box(left, headBox.y2 + 0.5, cw, main.y2 - headBox.y2 - 0.5);
      const cols = o.columns ?? 2;
      const rowsN = Math.ceil(o.points.length / cols);
      grid.rows(rowsN, 0.35).forEach((rb, r) => {
        const items = o.points.slice(r * cols, (r + 1) * cols);
        s.row(
          rb,
          items.map((p) => s.card({ title: p.title, text: p.text, fill: "none", dark: true })),
          { gap: 0.6, widths: cols },
        );
      });
    }
    s.line(left, foot.y - 0.15, left + cw, foot.y - 0.15, "onPrimaryMuted", 0.75);
    if (o.thanks !== false)
      s.place(foot, s.text(o.thanks ?? d.t.thanks, { role: "lead", color: "onPrimary" }), {
        valign: "middle",
      });
  },
};

/**
 * Chrome on a template (a university's, a company's): the title goes into the template's placeholder, the slide
 * number is the template's own, and content stays inside the safe area clear of logo and rules.
 */
const templateChrome = {
  content(s, d) {
    const p = d.template.profile;
    s.seed = p.seeds.content;
    s.texts = { title: s.opts.title };
    s.reserved = p.reserved;
    // the template's title box has a fixed size: check the title fits at the template's own font and size
    const t = s.text(s.opts.title ?? "", {
      role: "title",
      face: p.titleFace,
      size: p.titleSize,
      lineSpacing: 0.9,
      color: "ink",
    });
    const need = t.measure(p.titleBox.w - 0.2);
    if (need > p.titleBox.h + 0.05)
      s.problem(`title needs ${fmtIn(need)} but the template's title box is ${fmtIn(p.titleBox.h)}: shorten the title`);
    let body = p.safe;
    if (s.opts.source) {
      const src = s.text(s.opts.source, { role: "source" });
      // beside the slide number when the template leaves a strip there, else at the bottom of the body
      const strip = p.footer && src.measure(p.footer.w) <= p.footer.h ? p.footer : null;
      if (strip) s.place(strip, src);
      else {
        const h = src.measure(body.w);
        s.place(new Box(body.x, body.y2 - h, body.w, h), src);
        body = body.with({ h: body.h - h - 0.2 });
      }
    }
    return body;
  },

  cover(s, d, o) {
    const p = d.template.profile;
    if (!p.seeds.cover) return s.problem("the template has no title layout for a cover slide");
    s.seed = p.seeds.cover;
    s.texts = o.blank ? {} : { ctrTitle: o.title, subTitle: [o.subtitle, o.presenter].filter(Boolean).join("\n") };
  },

  closing(s, d, o) {
    const p = d.template.profile;
    s.seed = p.seeds.closing ?? p.seeds.content;
    s.texts = { ctrTitle: o.thanks ?? d.t.thanks, subTitle: o.subtitle ?? "" };
  },
};

/** Conclusion points as cards, for a closing slide built on a content layout. */
function closingPoints(s, def) {
  const cols = def.columns ?? 2;
  const rows = Math.ceil(def.points.length / cols);
  s.body.rows(rows, 0.3).forEach((rb, r) => {
    const items = def.points.slice(r * cols, (r + 1) * cols);
    s.row(
      rb,
      items.map((p) => s.card({ title: p.title, text: p.text })),
      { widths: cols },
    );
  });
}

export class Deck {
  constructor(dir) {
    this.dir = dir;
    this.meta = { theme: "editorial", language: "en-US" };
    this.defs = [];
    this.problems = [];
    this.usedImages = new Map();
  }

  // ---- the API a deck script sees ----
  api() {
    return {
      meta: (m) => Object.assign(this.meta, m),
      cover: (o = {}) => this.defs.push({ role: "cover", ...o }),
      slide: (o, fn) => this.defs.push({ role: "content", ...o, fn }),
      sources: (o = {}) => this.defs.push({ role: "sources", ...o }),
      closing: (o = {}) => this.defs.push({ role: "closing", ...o }),
    };
  }

  async layout() {
    this.t = strings(this.meta.language, this.meta.strings);
    this.images = await indexImages(join(this.dir, "img"));
    if (this.meta.template) {
      const file = resolve(this.dir, this.meta.template);
      this.template = await loadTemplate(file, join(this.dir, "build", "template"));
      const p = this.template.profile;
      this.theme = makeTheme(this.meta.theme, {
        palette: { ...p.palette, ...this.meta.palette },
        fonts: { ...p.fonts, ...this.meta.fonts },
        roles: this.meta.roles,
      });
      [this.W, this.H] = [p.size.w, p.size.h];
    } else {
      this.theme = makeTheme(this.meta.theme, {
        palette: this.meta.palette,
        fonts: this.meta.fonts,
        roles: this.meta.roles,
      });
      [this.W, this.H] = this.meta.size ?? [13.333, 7.5];
    }
    const chrome = this.template ? templateChrome : editorial;
    this.slides = this.defs.map((def, i) => {
      // on a template, a closing slide with points is a content slide; the thank-you goes on the title layout
      if (def.role === "closing" && this.template && def.points) def.title ??= this.t.conclusions;
      if (def.role === "sources") def.title ??= this.t.sources;
      const s = new SlideCtx(this, i + 1, def);
      if (def.role === "cover") chrome.cover(s, this, def);
      else if (def.role === "closing" && !(this.template && def.points)) chrome.closing(s, this, def);
      else {
        s.body = chrome.content(s, this);
        if (def.role === "sources") this.sourcesBody(s, def);
        else if (def.role === "closing") closingPoints(s, def);
        else {
          try {
            def.fn?.(s, s.body);
          } catch (e) {
            s.problem(`deck script error: ${e.message}`);
          }
        }
        if (!def.notes) s.problem("no speaker notes");
        s.checkReserved();
      }
      return {
        n: i + 1,
        role: def.role,
        title: def.title,
        notes: def.notes,
        background: s.background,
        elements: s.elements,
        body: s.body,
        texts: s.texts,
        seed: s.seed,
        blank: !!def.blank,
        reserved: s.reserved ?? [],
      };
    });
    if (this.meta.slides && this.slides.length !== this.meta.slides)
      this.problems.push({
        slide: 0,
        message: `deck has ${this.slides.length} slides; the plan says ${this.meta.slides}`,
      });
    if (this.meta.maxSlides && this.slides.length > this.meta.maxSlides)
      this.problems.push({
        slide: 0,
        message: `deck has ${this.slides.length} slides; the limit is ${this.meta.maxSlides}`,
      });
    for (const [key, img] of this.usedImages)
      if (!img.credit && !this.meta.uncredited?.includes(key))
        this.problems.push({
          slide: 0,
          message: `image «${key}» has no credit in img/credits.json (add one, or list it in meta.uncredited if it's the user's own)`,
        });
  }

  /**
   * Sources slide: numbered references and image credits flowed across columns like a document.
   * Numbering runs on across groups and columns.
   */
  sourcesBody(s, def) {
    const groups = [...(def.groups ?? [])];
    if (def.credits !== false && this.usedImages.size) {
      const lines = [...this.usedImages.values()].filter((i) => i.credit).map((i) => creditLine(i, this.t));
      if (lines.length) groups.push({ title: def.creditsTitle ?? this.t.credits, entries: lines, plain: true });
    }
    const cols = s.body.cols(def.columns ?? 2, 0.5);
    const w = cols[0].w;
    const items = [];
    let n = def.start ?? 1;
    for (const g of groups) {
      items.push({ comp: s.label(g.title), head: true });
      for (const e of g.entries)
        items.push({
          comp: g.plain
            ? s.text(e, { role: "bibliography", size: def.size })
            : s.bibliography([e], { start: n++, size: def.size }),
        });
    }
    const gap = 0.07;
    let c = 0;
    let y = cols[0].y;
    items.forEach((it, i) => {
      const h = it.comp.measure(w);
      // keep a heading with its first entry
      const need = it.head && items[i + 1] ? h + gap + items[i + 1].comp.measure(w) : h;
      if (y + need > cols[c].y2 + 0.01 && c < cols.length - 1) {
        c++;
        y = cols[c].y;
      }
      const top = it.head && y > cols[c].y ? y + 0.12 : y;
      s.place(new Box(cols[c].x, top, w, Math.max(h, cols[c].y2 - top)), it.comp);
      y = top + h + gap;
    });
    if (y - gap > cols[c].y2 + 0.01)
      s.problem(
        `sources need more room than ${cols.length} columns give: try sources({ columns: ${cols.length + 1} }), shorter entries, or two slides`,
      );
  }

  manifest() {
    return {
      title: this.meta.title,
      theme: this.theme.name,
      size: { w: this.W, h: this.H },
      expected: this.meta.slides ?? null,
      template: this.template ? { file: this.meta.template, fixes: this.template.fixes } : null,
      slides: this.slides.map((sl) => ({
        n: sl.n,
        role: sl.role,
        title: sl.title ?? null,
        notes: !!sl.notes,
        blank: sl.blank,
        reserved: sl.reserved,
        texts: sl.elements
          .filter((e) => e.kind === "text")
          .map((e) => ({
            x: e.x,
            y: e.y,
            w: e.w,
            h: e.h,
            role: e.paras[0]?.style.role,
            size: Math.min(...e.paras.map((p) => p.style.size)),
            text: e.paras
              .map((p) => p.runs.map((r) => (r.style.caps ? String(r.text).toUpperCase() : r.text)).join(""))
              .join("\n"),
          })),
      })),
      images: [...this.usedImages.values()].map((i) => ({ key: i.key, credited: !!i.credit })),
      problems: this.problems,
    };
  }

  async prepareImages(sl) {
    const images = new Map();
    for (const el of sl.elements.filter((e) => e.kind === "image"))
      images.set(el, await prepareImage(el.src, { w: el.w, h: el.h, crop: el.crop }, join(this.dir, "build", "img")));
    return images;
  }

  async writePptx(out) {
    if (this.template) {
      const slides = [];
      for (const sl of this.slides) slides.push({ ...sl, images: await this.prepareImages(sl) });
      return writeTemplateDeck(this.template, slides, out, { lang: this.meta.language, emit });
    }
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "DECK", width: this.W, height: this.H });
    pptx.layout = "DECK";
    // the default theme names Calibri, which notes and empty paragraphs would fall back to
    pptx.theme = { headFontFace: this.theme.fonts.heading, bodyFontFace: this.theme.fonts.body };
    pptx.title = this.meta.title ?? "";
    if (this.meta.author) pptx.author = this.meta.author;
    for (const sl of this.slides) {
      const images = await this.prepareImages(sl);
      const ps = pptx.addSlide();
      if (sl.background) ps.background = { color: sl.background };
      emit(ps, pptx, sl.elements, { lang: this.meta.language, images });
      if (sl.notes) ps.addNotes(sl.notes);
    }
    await pptx.writeFile({ fileName: out });
    return out;
  }
}

/** «Title — Author, Licence» for the sources slide. Commons puts boilerplate in the author field when there's no author. */
export function creditLine(img, t = strings()) {
  const c = img.credit;
  const title = c.title ?? c.file?.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "") ?? img.key;
  const artist =
    !c.artist || /file history|unknown|not stated|не указан/i.test(c.artist) ? t.noAuthor : c.artist.slice(0, 60);
  return `${title} — ${artist}, ${c.license || t.noLicense}`;
}

const safeName = (s) =>
  String(s)
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

/** Build a deck folder: deck.mjs -> <Title>.pptx + build/manifest.json. */
export async function buildDeck(deckFile) {
  const dir = dirname(deckFile);
  const deck = new Deck(dir);
  const mod = await import(`${pathToFileURL(deckFile).href}?v=${Date.now()}`);
  if (typeof mod.default !== "function")
    throw new Error(`${basename(deckFile)} must export a default function (deck) => { … }`);
  mod.default(deck.api());
  await deck.layout();
  const pptx = join(dir, `${safeName(deck.meta.file ?? deck.meta.title ?? "deck")}.pptx`);
  await deck.writePptx(pptx);
  mkdirSync(join(dir, "build"), { recursive: true });
  const manifest = deck.manifest();
  writeFileSync(join(dir, "build", "manifest.json"), JSON.stringify(manifest, null, 1));
  return { pptx, manifest, problems: deck.problems };
}
