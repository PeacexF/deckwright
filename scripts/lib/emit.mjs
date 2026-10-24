// Turn layout elements into PptxGenJS calls. Shared by the free-design and template backends
// (pptx-automizer hands its generate() callback the same PptxGenJS slide API).
import { contrast } from "./theme.mjs";

const runOptions = (r, p, lang) => ({
  fontFace: r.style.face,
  fontSize: r.style.size,
  bold: !!r.style.bold,
  italic: !!r.style.italic,
  color: r.style.color,
  charSpacing: r.style.spacing || undefined,
  lang,
  ...(r.link ? { hyperlink: { url: r.link } } : {}),
  align: p.align,
  lineSpacingMultiple: p.style.lineSpacing,
  paraSpaceAfter: p.spaceAfter,
  // Real bullets (buChar), never a literal "•" in the text. Indent is in points.
  ...(p.bullet ? { bullet: { indent: Math.round(p.indent * 72) } } : {}),
});

/** Paragraphs -> PptxGenJS text runs (breakLine ends a paragraph). */
export function textRuns(paras, lang) {
  const out = [];
  paras.forEach((p, pi) => {
    p.runs.forEach((r, ri) => {
      const last = ri === p.runs.length - 1;
      const text = r.style.caps ? String(r.text).toUpperCase() : String(r.text);
      out.push({ text, options: { ...runOptions(r, p, lang), breakLine: last && pi < paras.length - 1 } });
    });
  });
  return out;
}

/** White or ink, whichever stays most readable on every series colour (labels sit inside the bars). */
function labelColor(colors, ink) {
  const worst = (c) => Math.min(...colors.map((f) => contrast(c, f)));
  return worst("FFFFFF") >= worst(ink) ? "FFFFFF" : ink;
}

function chartOptions(el) {
  const t = el.theme;
  const o = el.opts;
  const body = t.roles.small;
  const values = el.data.flatMap((s) => s.values);
  const decimals = o.decimals ?? (values.some((v) => !Number.isInteger(v)) ? 1 : 0);
  const number = decimals ? `0.${"0".repeat(decimals)}` : "0";
  // Values too small to hold a label get none: a "1.0" squeezed onto a 1 % segment spills over it.
  // The decimal separator follows the viewer's locale (and the deck's language in QA renders).
  const hideBelow = o.hideBelow ?? (o.stacked ? 2 : null);
  const format = o.format ?? (hideBelow != null ? `[<${hideBelow}]"";${number}` : number);
  const colors = (o.colors ?? ["primary", "accent", "tint", "muted"]).map((c) => t.palette[c] ?? c);
  const inside = o.stacked || el.type === "pie" || el.type === "doughnut";
  const base = {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    chartColors: colors,
    showValue: o.showValue ?? true,
    // charts round labels to whole numbers unless told otherwise (23.9 -> 24)
    dataLabelFormatCode: format,
    dataLabelFontFace: body.face,
    dataLabelFontSize: o.labelSize ?? 12,
    dataLabelColor: inside ? labelColor(colors, t.palette.ink) : t.palette.ink,
    showLegend: o.legend ?? el.data.length > 1,
    legendFontFace: body.face,
    legendFontSize: 12,
    legendPos: o.legendPos ?? "b",
  };
  if (el.type === "pie" || el.type === "doughnut") {
    return {
      ...base,
      showPercent: o.percent ?? false,
      showLegend: o.legend ?? true,
      holeSize: o.holeSize ?? 55,
    };
  }
  return {
    ...base,
    barDir: el.type === "bar" ? "bar" : "col",
    ...(o.stacked ? { barGrouping: o.stacked === "percent" ? "percentStacked" : "stacked" } : {}),
    // horizontal bar charts list categories bottom-up by default; read top-down instead
    ...(el.type === "bar" ? { catAxisOrientation: "maxMin", valAxisOrientation: "minMax" } : {}),
    catAxisLabelFontFace: body.face,
    catAxisLabelFontSize: o.axisSize ?? 13,
    catAxisLabelColor: t.palette.ink,
    catAxisLineShow: true,
    catAxisLineColor: t.palette.rule,
    valAxisHidden: o.valueAxis !== true,
    valAxisLabelFormatCode: format,
    valGridLine: { style: "none" },
    barGapWidthPct: o.gap ?? (o.stacked ? 45 : 60),
    // stacked segments can only carry their labels inside
    dataLabelPosition: el.type === "line" ? "t" : o.stacked ? "ctr" : "outEnd",
    lineDataSymbolSize: 8,
  };
}

const CHART_TYPES = { bar: "bar", column: "bar", line: "line", pie: "pie", doughnut: "doughnut" };

/** Draw elements on a PptxGenJS slide. `images` maps element -> prepared file path. */
export function emit(slide, pptx, elements, { lang = "en-US", images = new Map() } = {}) {
  for (const el of elements) {
    switch (el.kind) {
      case "rect":
        slide.addShape(pptx.ShapeType.rect, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: el.fill },
          line: el.line ? { color: el.line, width: el.lineWidth ?? 0.75 } : { type: "none" },
        });
        break;
      case "ellipse":
        slide.addShape(pptx.ShapeType.ellipse, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: el.fill },
          line: { type: "none" },
        });
        break;
      case "line":
        slide.addShape(pptx.ShapeType.line, {
          x: el.x1,
          y: el.y1,
          w: Math.max(el.x2 - el.x1, 0),
          h: Math.max(el.y2 - el.y1, 0),
          line: { color: el.color, width: el.width, ...(el.arrow ? { endArrowType: "triangle" } : {}) },
        });
        break;
      case "image":
        slide.addImage({ path: images.get(el) ?? el.src, x: el.x, y: el.y, w: el.w, h: el.h });
        break;
      case "text":
        slide.addText(textRuns(el.paras, lang), {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          margin: 0,
          valign: el.valign ?? "top",
          fit: "none",
          wrap: true,
          lang,
        });
        break;
      case "table":
        slide.addTable(
          el.rows.map((r) =>
            r.map((c) => ({
              text: textRuns(c.paras, lang),
              options: { fill: c.fill ? { color: c.fill } : undefined, valign: "top" },
            })),
          ),
          {
            x: el.x,
            y: el.y,
            w: el.w,
            colW: el.colW,
            rowH: el.rowH,
            margin: el.pad,
            border: { type: "solid", color: el.border, pt: 0.75 },
            autoPage: false,
          },
        );
        break;
      case "chart":
        slide.addChart(CHART_TYPES[el.type], el.data, chartOptions(el));
        break;
      default:
        throw new Error(`unknown element kind ${el.kind}`);
    }
  }
}
