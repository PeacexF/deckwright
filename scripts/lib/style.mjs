// Read a style off an example deck: palette, fonts and type sizes, weighted by how much they're used.
// Lets a deck match "something like this" without the example being a template.
import { desc, kid, Package, path } from "./pptx.mjs";

const hex = (c) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);

function hsl(c) {
  const [r, g, b] = hex(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const bump = (m, k, n) => k && m.set(k, (m.get(k) ?? 0) + n);
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

/** Colour of a solidFill: srgbClr directly, or a scheme colour resolved through the theme. */
function fillColor(el, scheme) {
  const fill = kid(el, "solidFill");
  if (!fill) return null;
  const srgb = kid(fill, "srgbClr")?.getAttribute("val");
  if (srgb) return srgb.toUpperCase();
  const sc = kid(fill, "schemeClr")?.getAttribute("val");
  const map = { tx1: "dk1", tx2: "dk2", bg1: "lt1", bg2: "lt2" };
  return sc ? (scheme[map[sc] ?? sc] ?? null) : null;
}

export async function extractStyle(file) {
  const pkg = await Package.open(file);
  const pres = await pkg.presentation();
  const theme = await pkg.theme();
  const resolveFace = (f) => (f === "+mj-lt" ? theme.fonts.major : f === "+mn-lt" ? theme.fonts.minor : f);

  const faces = { big: new Map(), small: new Map() };
  const textColors = new Map();
  const fills = new Map();
  const sizes = { big: [], small: [] };

  for (const sp of pres.slides) {
    const doc = await pkg.xml(sp);
    for (const shape of desc(doc, "sp")) {
      const ext = path(shape, "spPr", "xfrm", "ext");
      const area = ext ? (+ext.getAttribute("cx") / 914400) * (+ext.getAttribute("cy") / 914400) : 0;
      bump(fills, fillColor(kid(shape, "spPr") ?? shape, theme.colors), area);
      const isTitle = ["title", "ctrTitle"].includes(path(shape, "nvSpPr", "nvPr", "ph")?.getAttribute("type"));
      for (const r of desc(shape, "r")) {
        const t = kid(r, "t")?.textContent ?? "";
        if (!t.trim()) continue;
        const rPr = kid(r, "rPr");
        const sz = rPr?.getAttribute("sz") ? +rPr.getAttribute("sz") / 100 : null;
        const big = isTitle || (sz ?? 0) >= 24;
        const face =
          resolveFace(rPr && kid(rPr, "latin")?.getAttribute("typeface")) ??
          (big ? theme.fonts.major : theme.fonts.minor);
        bump(faces[big ? "big" : "small"], face?.trim(), t.length);
        if (sz) for (let i = 0; i < Math.min(t.length, 50); i++) sizes[big ? "big" : "small"].push(sz);
        bump(textColors, rPr && fillColor(rPr, theme.colors), t.length);
      }
    }
  }

  // ink: the most-used dark text colour; primary: the most-used strong colour (fills and text);
  // accent: the next strong colour with a clearly different hue
  const dark = top(textColors).find(([c]) => hsl(c).l < 0.3)?.[0] ?? theme.colors.dk1 ?? "1A1A1A";
  const strong = new Map();
  for (const [c, n] of fills) if (hsl(c).s > 0.25 && hsl(c).l > 0.12 && hsl(c).l < 0.85) bump(strong, c, n * 40);
  for (const [c, n] of textColors) if (hsl(c).s > 0.25 && hsl(c).l < 0.85) bump(strong, c, n);
  const ranked = top(strong).map(([c]) => c);
  const primary = ranked[0] ?? theme.colors.accent1 ?? dark;
  const hueGap = (a, b) => Math.min(Math.abs(hsl(a).h - hsl(b).h), 360 - Math.abs(hsl(a).h - hsl(b).h));
  const accent = ranked.find((c) => c !== primary && hueGap(c, primary) > 30) ?? theme.colors.accent2 ?? primary;

  return {
    file,
    slides: pres.slides.length,
    size: pres.size,
    fonts: {
      heading: top(faces.big)[0]?.[0] ?? theme.fonts.major,
      body: top(faces.small)[0]?.[0] ?? theme.fonts.minor,
    },
    sizes: { title: median(sizes.big), body: median(sizes.small) },
    palette: { ink: dark, primary, accent },
    colors: {
      text: top(textColors)
        .slice(0, 6)
        .map(([c]) => c),
      fills: top(fills)
        .slice(0, 6)
        .map(([c]) => c),
    },
    theme: { fonts: theme.fonts, colors: theme.colors },
  };
}
