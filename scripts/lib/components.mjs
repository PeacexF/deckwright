// Slide components. Each one is { measure(w) => height, place(box) => elements[], grow? }.
// Components measure themselves before anything is placed, so a slide that doesn't fit is
// reported at build time with its slide number, not discovered in the render.
import { Box } from "./layout.mjs";
import { color, style } from "./theme.mjs";
import { lineHeight, measureParagraphs } from "./text.mjs";

const BULLET_INDENT = 0.25; // in
const CELL_PAD = 0.08; // in, table cell padding on each side

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Normalise text content into paragraphs of styled runs. */
export function paragraphs(ctx, content, opts = {}) {
  const list = Array.isArray(content) ? content : String(content ?? "").split("\n");
  return list.map((item) => {
    const p = typeof item === "string" ? { text: item } : item;
    const role = p.role ?? opts.role ?? "body";
    const over = pick({ ...opts, ...p }, ["size", "bold", "italic", "caps", "lineSpacing", "face", "spacing"]);
    const c = p.color ?? opts.color;
    if (c) over.color = c;
    const pst = style(ctx.theme, role, over);
    ctx.checkSize(pst);
    const runs = (p.runs ?? [{ text: p.text ?? "" }]).map((r) => {
      const rs = { ...pst, ...pick(r, ["bold", "italic", "size"]) };
      if (r.color) rs.color = color(ctx.theme, r.color);
      return { text: r.text, style: rs, link: r.link };
    });
    const bullet = p.bullet ?? opts.bullet ?? false;
    return {
      runs,
      style: pst,
      align: p.align ?? opts.align ?? "left",
      bullet,
      indent: bullet ? BULLET_INDENT : 0,
      spaceAfter: p.spaceAfter ?? opts.spaceAfter ?? (bullet ? 6 : 4),
    };
  });
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function scaled(paras, k) {
  return paras.map((p) => {
    const size = Math.max(p.style.min ?? 0, Math.round(p.style.size * k * 2) / 2);
    return {
      ...p,
      style: { ...p.style, size },
      runs: p.runs.map((r) => ({ ...r, style: { ...r.style, size: Math.max(r.style.min ?? 0, size) } })),
    };
  });
}

const textEl = (b, paras, h, extra = {}) => ({ kind: "text", x: b.x, y: b.y, w: b.w, h, paras, ...extra });

/**
 * Text block. content: string (one paragraph per line), or a list of strings or
 * { text | runs: [{ text, bold, italic, color, link }], role, bullet, align, color }.
 * opts.fit shrinks the text (never below its role's minimum) when placed in a box that's too small.
 */
export function text(ctx, content, opts = {}) {
  let paras = paragraphs(ctx, content, opts);
  // oneLine: shrink (down to the role minimum) until every paragraph fits on one line — for figures
  // like «1,56 млн км²» that must never wrap
  const fitted = (w) => {
    if (!opts.oneLine) return paras;
    for (let k = 1; k >= 0.5; k -= 0.03) {
      const p = k === 1 ? paras : scaled(paras, k);
      if (measureParagraphs(p, w).paras.every((x) => x.lines.length === 1)) return p;
      if (p.every((x) => x.style.size <= x.style.min)) return p;
    }
    return paras;
  };
  const measure = (w) => measureParagraphs(fitted(w), w).height;
  return {
    measure,
    fit: opts.fit ?? false,
    shrinkTo(w, h) {
      for (let k = 0.97; k >= 0.5; k -= 0.03) {
        const next = scaled(paras, k);
        if (measureParagraphs(next, w).height <= h) return ((paras = next), true);
        if (next.every((p) => p.style.size <= p.style.min)) break;
      }
      return false;
    },
    place(b) {
      const ps = fitted(b.w);
      const m = measureParagraphs(ps, b.w);
      if (m.tooWide.length)
        ctx.problem(`word too long for its line: «${m.tooWide[0]}» — LibreOffice will break it mid-word`);
      if (opts.oneLine && m.paras.some((x) => x.lines.length > 1))
        ctx.problem(
          `«${ps[0].runs.map((r) => r.text).join("")}» doesn't fit on one line even at ${ps[0].style.size} pt: shorten it or give it a wider column`,
        );
      return [textEl(b, ps, m.height, { valign: opts.valign })];
    },
  };
}

export const bullets = (ctx, items, opts = {}) => text(ctx, items, { ...opts, bullet: true });

export const label = (ctx, str, opts = {}) => text(ctx, str, { role: "label", ...opts });

export function spacer(_ctx, h) {
  return { measure: () => h, place: () => [] };
}

export function rule(ctx, opts = {}) {
  const c = color(ctx.theme, opts.color ?? "rule");
  return {
    measure: () => 0.02,
    place: (b) => [
      { kind: "line", x1: b.x, y1: b.y + 0.01, x2: b.x2, y2: b.y + 0.01, color: c, width: opts.width ?? 0.75 },
    ],
  };
}

/** Vertical stack of components inside one component (used by cards, KPI columns, etc.). */
function column(parts, gap) {
  const live = parts.filter(Boolean);
  return {
    measure: (w) => sum(live.map((p) => p.measure(w))) + gap * Math.max(0, live.length - 1),
    place(b) {
      let y = b.y;
      const out = [];
      for (const p of live) {
        const h = p.measure(b.w);
        out.push(...p.place(new Box(b.x, y, b.w, h)));
        y += h + gap;
      }
      return out;
    },
  };
}

/** Row of KPI figures: [{ value, label, color }]. */
export function kpis(ctx, items, opts = {}) {
  const gap = opts.gap ?? 0.35;
  const cols = items.map((it) =>
    column(
      [
        text(ctx, String(it.value), { role: "kpi", color: it.color, size: opts.size, oneLine: true }),
        it.label && text(ctx, it.label, { role: "kpiLabel" }),
      ],
      0.06,
    ),
  );
  const widths = (w) => new Box(0, 0, w, 0).cols(items.length, gap);
  return {
    measure: (w) => Math.max(...widths(w).map((b, i) => cols[i].measure(b.w))),
    place: (b) => b.cols(items.length, gap).flatMap((cb, i) => cols[i].place(cb)),
  };
}

/** Card: optional label, title and text on a tinted panel. fill: palette name or hex; "none" for no panel. */
export function card(ctx, { label: lab, title, text: body, fill = "track", accent, dark } = {}, opts = {}) {
  const pad = opts.pad ?? 0.2;
  const isDark = dark ?? ["primary", "ink"].includes(fill);
  const fg = isDark ? "onPrimary" : undefined;
  const inner = column(
    [
      lab && text(ctx, lab, { role: "label", color: isDark ? "onPrimaryMuted" : (accent ?? undefined) }),
      title && text(ctx, title, { role: "cardTitle", color: fg }),
      body && text(ctx, body, { role: opts.role ?? "small", color: isDark ? "onPrimaryMuted" : undefined }),
    ],
    0.08,
  );
  const hasPanel = fill !== "none";
  const p = hasPanel ? pad : 0;
  // the accent bar sits on the left edge; without a panel the text needs its own gap from it
  const bar = accent ? 0.06 + (hasPanel ? 0 : 0.16) : 0;
  return {
    stretch: true,
    measure: (w) => inner.measure(w - 2 * p - bar) + 2 * p,
    place(b) {
      const out = [];
      if (hasPanel) out.push({ kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h, fill: color(ctx.theme, fill) });
      if (accent) out.push({ kind: "rect", x: b.x, y: b.y, w: 0.06, h: b.h, fill: color(ctx.theme, accent) });
      const x = b.x + p + bar;
      const w = b.x2 - p - x;
      out.push(...inner.place(new Box(x, b.y + p, w, inner.measure(w))));
      return out;
    },
  };
}

/** Photo or illustration from the deck's img/ folder, cover-cropped (or contained) to its box. */
export function photo(ctx, key, opts = {}) {
  const img = ctx.image(key);
  const cap = opts.caption && text(ctx, opts.caption, { role: "caption" });
  const capGap = 0.08;
  const capH = (w) => (cap ? cap.measure(w) + capGap : 0);
  const natural = img ? img.height / img.width : 0.66;
  const imgH = (w) => opts.h ?? (opts.aspect ? w / opts.aspect : w * natural);
  return {
    grow: opts.grow ?? false,
    measure: (w) => imgH(w) + capH(w),
    place(b) {
      const h = opts.grow ? b.h - capH(b.w) : imgH(b.w);
      const out = [];
      if (!img) out.push({ kind: "rect", x: b.x, y: b.y, w: b.w, h, fill: "DDDDDD" });
      else if (opts.fit === "contain") {
        const k = Math.min(b.w / img.width, h / img.height);
        const [iw, ih] = [img.width * k, img.height * k];
        const x = opts.align === "center" ? b.x + (b.w - iw) / 2 : b.x;
        out.push({ kind: "image", x, y: b.y + (h - ih) / 2, w: iw, h: ih, src: img.path });
      } else
        out.push({
          kind: "image",
          x: b.x,
          y: b.y,
          w: b.w,
          h,
          src: img.path,
          crop: { fx: opts.fx ?? 0.5, fy: opts.fy ?? 0.5 },
        });
      if (cap) out.push(...cap.place(new Box(b.x, b.y + h + capGap, b.w, cap.measure(b.w))));
      return out;
    },
  };
}

const fmt = (v, { decimals, unit = "", locale = "en-US" }) =>
  v.toLocaleString(
    locale,
    decimals == null ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  ) + unit;

/** Horizontal bars drawn with shapes: [{ label, value, color }]. Good for shares and rankings. */
export function bars(ctx, items, opts = {}) {
  const max = opts.max ?? Math.max(...items.map((i) => i.value));
  const labelFrac = opts.labelWidth ?? 0.32;
  const valueW = opts.valueWidth ?? 0.85;
  const barH = opts.barHeight ?? 0.16;
  const rowGap = opts.rowGap ?? 0.1;
  const labels = items.map((it) => text(ctx, it.label, { role: "small" }));
  const values = items.map((it) =>
    text(ctx, fmt(it.value, { locale: ctx.locale, ...opts }), { role: "small", bold: true, align: "right" }),
  );
  const rowH = (w) => labels.map((l) => Math.max(l.measure(w * labelFrac - 0.1), barH));
  return {
    measure: (w) => sum(rowH(w)) + rowGap * (items.length - 1),
    place(b) {
      const out = [];
      const lw = b.w * labelFrac - 0.1;
      const trackX = b.x + b.w * labelFrac;
      const trackW = b.w - b.w * labelFrac - valueW - 0.1;
      let y = b.y;
      rowH(b.w).forEach((h, i) => {
        const it = items[i];
        out.push(...labels[i].place(new Box(b.x, y, lw, h)));
        // centre the bar on the label's first line
        const by = y + lineHeight(style(ctx.theme, "small")) / 2 - barH / 2 + 0.02;
        out.push({ kind: "rect", x: trackX, y: by, w: trackW, h: barH, fill: color(ctx.theme, "track") });
        const fw = Math.max(0.02, (trackW * it.value) / max);
        out.push({
          kind: "rect",
          x: trackX,
          y: by,
          w: fw,
          h: barH,
          fill: color(ctx.theme, it.color ?? opts.color ?? "primary"),
        });
        out.push(...values[i].place(new Box(b.x2 - valueW, y, valueW, h)));
        y += h + rowGap;
      });
      return out;
    },
  };
}

/** One 100 % bar split into segments with a legend: [{ label, value, color }]. */
export function stacked(ctx, segments, opts = {}) {
  const total = sum(segments.map((s) => s.value));
  const barH = opts.barHeight ?? 0.32;
  const legendCols = opts.legendColumns ?? Math.min(3, segments.length);
  const palette = ["primary", "tint", "rule", "accent", "muted", "ink"];
  const colors = segments.map((s, i) => color(ctx.theme, s.color ?? palette[i % palette.length]));
  const entries = segments.map((s) =>
    text(ctx, `${s.label} — ${fmt(s.value, { locale: ctx.locale, ...opts })}`, { role: "small" }),
  );
  const legendRows = (w) => {
    const cw = (w - 0.3 * (legendCols - 1)) / legendCols - 0.24;
    const rows = [];
    for (let i = 0; i < entries.length; i += legendCols)
      rows.push(Math.max(...entries.slice(i, i + legendCols).map((e) => e.measure(cw))));
    return { rows, cw };
  };
  return {
    measure: (w) => barH + 0.14 + sum(legendRows(w).rows) + 0.06 * (legendRows(w).rows.length - 1),
    place(b) {
      const out = [];
      let x = b.x;
      segments.forEach((s, i) => {
        const w = (b.w * s.value) / total;
        out.push({ kind: "rect", x, y: b.y, w, h: barH, fill: colors[i] });
        x += w;
      });
      const { rows, cw } = legendRows(b.w);
      let y = b.y + barH + 0.14;
      rows.forEach((rh, r) => {
        for (let c = 0; c < legendCols; c++) {
          const i = r * legendCols + c;
          if (i >= segments.length) break;
          const cx = b.x + c * (cw + 0.24 + 0.3);
          out.push({ kind: "rect", x: cx, y: y + 0.05, w: 0.14, h: 0.14, fill: colors[i] });
          out.push(...entries[i].place(new Box(cx + 0.24, y, cw, rh)));
        }
        y += rh + 0.06;
      });
      return out;
    },
  };
}

/** Horizontal timeline: [{ date, title, text, highlight }]. */
export function timeline(ctx, items, opts = {}) {
  const gap = opts.gap ?? 0.3;
  const dates = items.map((it) =>
    text(ctx, it.date, { role: "lead", bold: true, color: it.highlight ? "accent" : "primary" }),
  );
  const bodies = items.map((it) =>
    column(
      [it.title && text(ctx, it.title, { role: "cardTitle" }), it.text && text(ctx, it.text, { role: "small" })],
      0.05,
    ),
  );
  const cols = (w) => new Box(0, 0, w, 0).cols(items.length, gap);
  const dateH = (w) => Math.max(...cols(w).map((c, i) => dates[i].measure(c.w)));
  const dot = 0.14;
  return {
    measure: (w) => dateH(w) + 0.12 + dot + 0.16 + Math.max(...cols(w).map((c, i) => bodies[i].measure(c.w))),
    place(b) {
      const out = [];
      const dh = dateH(b.w);
      const ly = b.y + dh + 0.12 + dot / 2;
      out.push({ kind: "line", x1: b.x, y1: ly, x2: b.x2, y2: ly, color: color(ctx.theme, "rule"), width: 1.5 });
      b.cols(items.length, gap).forEach((c, i) => {
        out.push(...dates[i].place(new Box(c.x, b.y, c.w, dh)));
        const fill = color(ctx.theme, items[i].highlight ? "accent" : "primary");
        out.push({ kind: "rect", x: c.x, y: ly - dot / 2, w: dot, h: dot, fill });
        const by = ly + dot / 2 + 0.16;
        out.push(...bodies[i].place(new Box(c.x, by, c.w, bodies[i].measure(c.w))));
      });
      return out;
    },
  };
}

/** Numbered points with a large number: [{ title, text }]. columns: 1 or 2 (filled top to bottom). */
export function numbered(ctx, items, opts = {}) {
  const start = opts.start ?? 1;
  const numW = opts.numberWidth ?? 0.5;
  const ncols = opts.columns ?? 1;
  const gapY = opts.gap ?? 0.22;
  const nums = items.map((_, i) => text(ctx, String(start + i), { role: "number" }));
  const bodies = items.map((it) =>
    column(
      [
        it.title && text(ctx, it.title, { role: opts.titleRole ?? "cardTitle" }),
        it.text && text(ctx, it.text, { role: opts.role ?? "small", color: it.title ? "muted" : undefined }),
      ],
      0.04,
    ),
  );
  const split = () => {
    const per = Math.ceil(items.length / ncols);
    return Array.from({ length: ncols }, (_, c) => items.map((_, i) => i).slice(c * per, (c + 1) * per));
  };
  const itemH = (i, w) => Math.max(nums[i].measure(numW), bodies[i].measure(w - numW));
  const colH = (idx, w) => sum(idx.map((i) => itemH(i, w))) + gapY * Math.max(0, idx.length - 1);
  return {
    measure(w) {
      const cw = (w - 0.4 * (ncols - 1)) / ncols;
      return Math.max(...split().map((idx) => colH(idx, cw)));
    },
    place(b) {
      const out = [];
      b.cols(ncols, 0.4).forEach((cb, c) => {
        let y = cb.y;
        for (const i of split()[c]) {
          const h = itemH(i, cb.w);
          out.push(...nums[i].place(new Box(cb.x, y, numW, h)));
          out.push(...bodies[i].place(new Box(cb.x + numW, y + 0.03, cb.w - numW, h)));
          y += h + gapY;
        }
      });
      return out;
    },
  };
}

/**
 * Bibliography with literal numbers — LibreOffice ignores autonumber startAt, so a list split
 * across two columns would restart at 1. entries: strings. opts.start: first number.
 */
export function bibliography(ctx, entries, opts = {}) {
  const start = opts.start ?? 1;
  const numW = opts.numberWidth ?? 0.42;
  const gap = opts.gap ?? 0.07;
  const role = opts.role ?? "bibliography";
  const nums = entries.map((_, i) => text(ctx, `${start + i}.`, { role, size: opts.size }));
  const bodies = entries.map((e) => text(ctx, e, { role, size: opts.size }));
  const h = (i, w) => bodies[i].measure(w - numW);
  return {
    measure: (w) => sum(entries.map((_, i) => h(i, w))) + gap * Math.max(0, entries.length - 1),
    place(b) {
      const out = [];
      let y = b.y;
      entries.forEach((_, i) => {
        const hi = h(i, b.w);
        out.push(...nums[i].place(new Box(b.x, y, numW, hi)));
        out.push(...bodies[i].place(new Box(b.x + numW, y, b.w - numW, hi)));
        y += hi + gap;
      });
      return out;
    },
  };
}

/**
 * Native table. rows[0] is the header unless opts.head === false. opts.columns: width ratios.
 * Cells: strings or { text, bold, color, fill, align }.
 */
export function table(ctx, rows, opts = {}) {
  const head = opts.head !== false;
  const ratios = opts.columns ?? rows[0].map(() => 1);
  const cell = (c) => (typeof c === "object" && c !== null ? c : { text: String(c ?? "") });
  const cells = rows.map((r, ri) =>
    r.map((c, ci) => {
      const cc = cell(c);
      const isHead = ri === 0 && head;
      const p = paragraphs(ctx, cc.text, {
        role: isHead ? "tableHead" : (opts.role ?? "tableBody"),
        bold: cc.bold,
        color: cc.color ?? (isHead ? "onPrimary" : undefined),
        align: cc.align ?? opts.align?.[ci],
      });
      return { ...cc, paras: p };
    }),
  );
  const colW = (w) => ratios.map((r) => (w * r) / sum(ratios));
  const rowH = (w) =>
    cells.map(
      (r) =>
        Math.max(...r.map((c, ci) => measureParagraphs(c.paras, colW(w)[ci] - 2 * CELL_PAD).height)) + 2 * CELL_PAD,
    );
  return {
    measure: (w) => sum(rowH(w)),
    place: (b) => [
      {
        kind: "table",
        x: b.x,
        y: b.y,
        w: b.w,
        colW: colW(b.w),
        rowH: rowH(b.w),
        pad: CELL_PAD,
        rows: cells.map((r, ri) =>
          r.map((c) => ({
            paras: c.paras,
            fill: c.fill
              ? color(ctx.theme, c.fill)
              : ri === 0 && head
                ? color(ctx.theme, "primary")
                : opts.zebra && ri % 2 === 0
                  ? color(ctx.theme, "track")
                  : undefined,
          })),
        ),
        border: color(ctx.theme, "rule"),
      },
    ],
  };
}

/** Native chart: type bar | column | line | pie | doughnut. data: [{ name, labels, values }]. */
export function chart(ctx, type, data, opts = {}) {
  return {
    grow: opts.h == null,
    measure: () => opts.h ?? 3,
    place: (b) => [{ kind: "chart", type, data, x: b.x, y: b.y, w: b.w, h: opts.h ?? b.h, opts, theme: ctx.theme }],
  };
}

/** Pull quote with a coloured bar and attribution. */
export function quote(ctx, str, opts = {}) {
  const q = text(ctx, str, { role: "quote" });
  const a = opts.author && text(ctx, opts.author, { role: "caption" });
  const inner = column([q, a], 0.1);
  return {
    measure: (w) => inner.measure(w - 0.3),
    place: (b) => [
      {
        kind: "rect",
        x: b.x,
        y: b.y,
        w: 0.06,
        h: inner.measure(b.w - 0.3),
        fill: color(ctx.theme, opts.color ?? "accent"),
      },
      ...inner.place(new Box(b.x + 0.3, b.y, b.w - 0.3, inner.measure(b.w - 0.3))),
    ],
  };
}

export { column };
