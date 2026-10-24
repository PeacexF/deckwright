// Read a .pptx/.potx package: slides, layouts, masters, theme, shapes with their boxes in inches.
// Used by QA (any deck, not only ours) and by the template backend.
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

export const EMU = 914400;

export const kids = (el, name) =>
  [...(el?.childNodes ?? [])].filter((n) => n.nodeType === 1 && (!name || n.localName === name));
export const kid = (el, name) => kids(el, name)[0];
export const desc = (el, name) => (el ? [...el.getElementsByTagNameNS("*", name)] : []);
export const path = (el, ...names) => names.reduce((e, n) => kid(e, n), el);

const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);
function resolveTarget(from, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(from) + target).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}
const relsPath = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf("/") + 1)}.rels`;

// placeholder types that inherit from the same master placeholder
const PH_FAMILY = { ctrTitle: "title", title: "title", subTitle: "body", body: "body", obj: "body" };

export class Package {
  constructor(zip) {
    this.zip = zip;
    this.cache = new Map();
  }

  static async open(file) {
    return new Package(await JSZip.loadAsync(readFileSync(file)));
  }

  has(p) {
    return !!this.zip.file(p);
  }

  async text(p) {
    return this.zip.file(p)?.async("string");
  }

  async xml(p) {
    if (!this.cache.has(p)) {
      const s = await this.text(p);
      this.cache.set(p, s == null ? null : new DOMParser().parseFromString(s, "application/xml"));
    }
    return this.cache.get(p);
  }

  async rels(p) {
    const doc = await this.xml(relsPath(p));
    if (!doc) return [];
    return kids(doc.documentElement, "Relationship").map((r) => ({
      id: r.getAttribute("Id"),
      type: r.getAttribute("Type").split("/").pop(),
      target:
        r.getAttribute("TargetMode") === "External"
          ? r.getAttribute("Target")
          : resolveTarget(p, r.getAttribute("Target")),
      external: r.getAttribute("TargetMode") === "External",
    }));
  }

  async presentation() {
    const doc = await this.xml("ppt/presentation.xml");
    const root = doc.documentElement;
    const sz = kid(root, "sldSz");
    const rels = await this.rels("ppt/presentation.xml");
    const byId = new Map(rels.map((r) => [r.id, r.target]));
    const rid = (el) => el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    return {
      size: { w: +sz.getAttribute("cx") / EMU, h: +sz.getAttribute("cy") / EMU },
      slides: kids(kid(root, "sldIdLst"), "sldId").map((s) => byId.get(rid(s))),
      masters: kids(kid(root, "sldMasterIdLst"), "sldMasterId").map((s) => byId.get(rid(s))),
      notesMaster: rels.find((r) => r.type === "notesMaster")?.target ?? null,
      theme: rels.find((r) => r.type === "theme")?.target ?? null,
    };
  }

  /** Shapes on a slide, layout or master, in z-order, with boxes in inches (null when inherited). */
  async shapes(p) {
    const doc = await this.xml(p);
    const tree = desc(doc, "spTree")[0];
    const out = [];
    walk(tree, identity, out);
    return out;
  }

  async layoutOf(slidePath) {
    return (await this.rels(slidePath)).find((r) => r.type === "slideLayout")?.target;
  }

  async masterOf(layoutPath) {
    return (await this.rels(layoutPath)).find((r) => r.type === "slideMaster")?.target;
  }

  async layoutInfo(lp) {
    const doc = await this.xml(lp);
    const root = doc.documentElement;
    return {
      path: lp,
      name: path(root, "cSld")?.getAttribute("name") ?? "",
      type: root.getAttribute("type") || "cust",
      shapes: await this.shapes(lp),
      master: await this.masterOf(lp),
    };
  }

  /** Resolve a placeholder's box through layout and master when the slide doesn't set one. */
  async placeholderBox(ph, layoutPath) {
    const find = async (p) => {
      const shapes = (await this.shapes(p)).filter((s) => s.ph && s.box);
      return (
        shapes.find((s) => ph.idx != null && s.ph.idx === ph.idx && ph.idx !== "0") ??
        shapes.find((s) => s.ph.type === ph.type) ??
        shapes.find((s) => PH_FAMILY[s.ph.type] && PH_FAMILY[s.ph.type] === PH_FAMILY[ph.type])
      );
    };
    const fromLayout = layoutPath && (await find(layoutPath));
    if (fromLayout) return fromLayout.box;
    const master = layoutPath && (await this.masterOf(layoutPath));
    return (master && (await find(master)))?.box ?? null;
  }

  /** Slide shapes with every placeholder box resolved. */
  async slideShapes(sp) {
    const layout = await this.layoutOf(sp);
    const shapes = await this.shapes(sp);
    for (const s of shapes) if (s.ph && !s.box) s.box = await this.placeholderBox(s.ph, layout);
    return shapes;
  }

  async notesText(sp) {
    const n = (await this.rels(sp)).find((r) => r.type === "notesSlide");
    if (!n) return null;
    const shapes = await this.shapes(n.target);
    const body = shapes.find((s) => s.ph?.type === "body");
    return body ? body.text : null;
  }

  async theme() {
    const pres = await this.presentation();
    const master = pres.masters[0];
    const t = (await this.rels(master)).find((r) => r.type === "theme")?.target ?? pres.theme;
    const doc = await this.xml(t);
    const font = (k) => path(desc(doc, k)[0], "latin")?.getAttribute("typeface") ?? null;
    const colors = {};
    const scheme = desc(doc, "clrScheme")[0];
    for (const c of kids(scheme)) {
      const v = kid(c, "srgbClr")?.getAttribute("val") ?? kid(c, "sysClr")?.getAttribute("lastClr");
      if (v) colors[c.localName] = v.toUpperCase();
    }
    return { path: t, fonts: { major: font("majorFont"), minor: font("minorFont") }, colors };
  }

  /** Every typeface named in slide, layout and master XML (theme references like +mn-lt resolved). */
  async typefaces(parts) {
    const theme = await this.theme();
    const out = new Map(); // name -> parts it appears in
    const add = (name, part) => {
      if (!name) return;
      const resolved =
        name === "+mj-lt"
          ? theme.fonts.major
          : name === "+mn-lt"
            ? theme.fonts.minor
            : name.startsWith("+")
              ? null
              : name;
      if (resolved == null) return;
      if (!out.has(resolved)) out.set(resolved, new Set());
      out.get(resolved).add(part);
    };
    for (const p of parts) {
      const doc = await this.xml(p);
      if (!doc) continue;
      for (const el of desc(doc, "latin")) add(el.getAttribute("typeface"), p);
    }
    add("+mj-lt", "theme");
    add("+mn-lt", "theme");
    return out;
  }
}

const identity = { a: 1, d: 1, e: 0, f: 0 }; // x' = a*x + e, y' = d*y + f (no rotation)

function xfrmBox(xfrm, t) {
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return null;
  const x = +off.getAttribute("x") / EMU;
  const y = +off.getAttribute("y") / EMU;
  const w = +ext.getAttribute("cx") / EMU;
  const h = +ext.getAttribute("cy") / EMU;
  return { x: t.a * x + t.e, y: t.d * y + t.f, w: t.a * w, h: t.d * h };
}

function paraTexts(txBody) {
  return kids(txBody, "p").map((p) =>
    kids(p)
      .map((n) => (n.localName === "r" ? (kid(n, "t")?.textContent ?? "") : n.localName === "br" ? "\n" : ""))
      .join(""),
  );
}

function walk(tree, t, out) {
  for (const el of kids(tree)) {
    const name = el.localName;
    const nv = kids(el).find((k) => k.localName.startsWith("nv"));
    const cNvPr = kid(nv, "cNvPr");
    const base = { name: cNvPr?.getAttribute("name") ?? "", id: cNvPr?.getAttribute("id") };
    if (name === "sp" || name === "cxnSp" || name === "pic") {
      const phEl = path(nv, "nvPr", "ph");
      const ph = phEl ? { type: phEl.getAttribute("type") || "body", idx: phEl.getAttribute("idx") || null } : null;
      const xfrm = path(el, "spPr", "xfrm");
      const txBody = kid(el, "txBody");
      const paras = txBody ? paraTexts(txBody) : [];
      out.push({
        ...base,
        kind: name,
        ph,
        geom: path(el, "spPr", "prstGeom")?.getAttribute("prst") ?? null,
        box: xfrm ? xfrmBox(xfrm, t) : null,
        paras,
        text: paras.join("\n"),
        hasField: txBody ? desc(txBody, "fld").length > 0 : false,
        autofit: txBody
          ? desc(txBody, "normAutofit").length
            ? "shrink"
            : desc(txBody, "spAutoFit").length
              ? "resize"
              : "none"
          : null,
      });
    } else if (name === "graphicFrame") {
      const tbl = desc(el, "tbl")[0];
      const xfrm = kid(el, "xfrm");
      out.push({
        ...base,
        kind: tbl ? "table" : "graphic",
        ph: null,
        box: xfrm ? xfrmBox(xfrm, t) : null,
        paras: tbl ? desc(tbl, "txBody").flatMap(paraTexts) : [],
        text: tbl ? desc(tbl, "txBody").flatMap(paraTexts).join("\n") : "",
      });
    } else if (name === "grpSp") {
      const x = path(el, "grpSpPr", "xfrm");
      let inner = t;
      if (x) {
        const g = (n, a) => +kid(x, n)?.getAttribute(a) / EMU;
        const [ox, oy, cx, cy] = [g("off", "x"), g("off", "y"), g("ext", "cx"), g("ext", "cy")];
        const [chx, chy, chcx, chcy] = [g("chOff", "x"), g("chOff", "y"), g("chExt", "cx"), g("chExt", "cy")];
        const a = chcx ? cx / chcx : 1;
        const d = chcy ? cy / chcy : 1;
        // child -> group space, then group -> parent space
        inner = { a: t.a * a, d: t.d * d, e: t.a * (ox - chx * a) + t.e, f: t.d * (oy - chy * d) + t.f };
      }
      walk(el, inner, out);
    }
  }
}
