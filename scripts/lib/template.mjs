// Templates (.potx/.pptx — a university's, a company's): profile the layouts, derive the safe area, and build
// slides on the template with pptx-automizer + PptxGenJS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import AutomizerPkg from "pptx-automizer";
import { Box } from "./layout.mjs";
import { kid, kids, Package, path as xpath } from "./pptx.mjs";
import { resolveFont } from "./text.mjs";
import { mix, contrast } from "./theme.mjs";

const Automizer = AutomizerPkg.default ?? AutomizerPkg;

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
};
const T_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const T_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const T_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const T_NOTES_MASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CT_NOTES = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
const serialize = (d) => new XMLSerializer().serializeToString(d);

/**
 * Prepare a working copy of the template and profile it.
 * Returns { work, profile, fixes } — fixes lists what was repaired (reported to the user).
 */
export async function loadTemplate(file, workDir) {
  mkdirSync(workDir, { recursive: true });
  const zip = await JSZip.loadAsync(readFileSync(file));
  const fixes = [];

  // .potx -> .pptx: only the main content type differs
  const ct = await zip.file("[Content_Types].xml").async("string");
  if (ct.includes("presentationml.template.main+xml"))
    zip.file(
      "[Content_Types].xml",
      ct.replace("presentationml.template.main+xml", "presentationml.presentation.main+xml"),
    );

  // "Verdana " can't be matched by LibreOffice, which then substitutes a serif face
  for (const f of Object.keys(zip.files).filter((f) =>
    /^ppt\/(theme\/theme|slideMasters\/|slideLayouts\/)[^/]*\.xml$/.test(f),
  )) {
    const s = await zip.file(f).async("string");
    const fixed = s.replace(/typeface="(\s*)([^"]*?)(\s*)"/g, (m, a, name, b) => {
      if (!a && !b) return m;
      fixes.push(`font name «${a}${name}${b}» trimmed to «${name}» (${basename(f)})`);
      return `typeface="${name}"`;
    });
    if (fixed !== s) zip.file(f, fixed);
  }

  const pkg = new Package(zip);
  const profile = await profileTemplate(pkg);
  await addSeeds(zip, pkg, profile);
  const work = join(workDir, "template.pptx");
  writeFileSync(work, await zip.generateAsync({ type: "nodebuffer" }));
  return { work, profile, fixes: [...new Set(fixes)] };
}

async function profileTemplate(pkg) {
  const pres = await pkg.presentation();
  const { w: W, h: H } = pres.size;
  const master = pres.masters[0];
  const layoutPaths = (await pkg.rels(master)).filter((r) => r.type === "slideLayout").map((r) => r.target);
  const layouts = [];
  for (const lp of layoutPaths) {
    const info = await pkg.layoutInfo(lp);
    for (const s of info.shapes) if (s.ph && !s.box) s.box = await pkg.placeholderBox(s.ph, lp);
    layouts.push(info);
  }
  const phTypes = (l) => new Set(l.shapes.filter((s) => s.ph).map((s) => s.ph.type));
  const title = layouts.find((l) => l.type === "title") ?? layouts.find((l) => phTypes(l).has("ctrTitle"));
  const content =
    layouts.find((l) => l.type === "titleOnly") ??
    layouts.find((l) => l.type === "obj") ??
    layouts.find((l) => phTypes(l).has("title") && l !== title);
  if (!content) throw new Error("template has no layout with a title placeholder to build content slides on");

  // existing slides that already use the title layout keep their decorations (cover, «Спасибо» slide).
  // automizer addresses slides by file number (slideN.xml), not by position.
  const slidesOnTitle = [];
  for (const sp of pres.slides) if ((await pkg.layoutOf(sp)) === title?.path) slidesOnTitle.push(fileNumber(sp));

  // reserved zones: pictures (logos), the slide number and rules on the master and the content layout
  const masterShapes = await pkg.shapes(master);
  // rules are connectors in PowerPoint templates but plain shapes with line geometry elsewhere
  const isRule = (s) => s.kind === "cxnSp" || (s.kind === "sp" && !s.ph && s.geom === "line");
  const zoneFrom = (s, where) => {
    const b = s.box;
    if (!b) return null;
    const pad = isRule(s) ? 0.03 : 0.05;
    const name =
      s.kind === "pic" ? "logo/picture" : s.ph?.type === "sldNum" ? "slide number" : isRule(s) ? "rule" : s.name;
    return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad, name, where };
  };
  const decor = (shapes, where) =>
    shapes
      .filter((s) => s.kind === "pic" || isRule(s) || s.ph?.type === "sldNum")
      .map((s) => zoneFrom(s, where))
      .filter(Boolean);
  const showMaster = true; // layouts may set showMasterSp="0"; rare in practice, not handled yet
  const reserved = [...(showMaster ? decor(masterShapes, "master") : []), ...decor(content.shapes, "layout")];

  const titlePh = content.shapes.find((s) => s.ph?.type === "title");
  const tb = titlePh.box;
  const left = tb.x;
  const right = Math.max(tb.x + tb.w, W - tb.x);
  let top = tb.y + tb.h + 0.15;
  // Wide zones (a rule across the slide) set the floor for everything. Narrow zones in a lower
  // corner (a big slide number) set the floor for the body only; beside them there's a footer
  // strip for the sources line — the layout uni-deck's Мосполитех constants encoded by hand.
  let floor = H - 0.4;
  let bodyBottom = Infinity;
  let footerRight = right;
  for (const z of reserved) {
    if (z.x >= right || z.x + z.w <= left) continue;
    const wide = z.w > 0.4 * (right - left);
    if (z.y > H / 2) {
      if (wide) floor = Math.min(floor, z.y - 0.12);
      else {
        bodyBottom = Math.min(bodyBottom, z.y - 0.1);
        footerRight = Math.min(footerRight, z.x - 0.2);
      }
    } else if (z.y + z.h > top - 0.15) top = Math.max(top, z.y + z.h + 0.15);
  }
  bodyBottom = Math.min(bodyBottom, floor);
  const safe = new Box(left, top, right - left, bodyBottom - top);
  const footer =
    floor - bodyBottom >= 0.25 ? new Box(left, bodyBottom + 0.08, footerRight - left, floor - bodyBottom - 0.08) : null;
  const inside = reserved.filter((z) => new Box(z.x, z.y, z.w, z.h).intersects(safe));

  const theme = await pkg.theme();
  const { size: titleSize, face: titleFace } = await titleStyle(pkg, master, content.path, theme);
  // Our text uses the font the template's own text renders in: the master's body style (Мосполитех:
  // Gilroy Medium), not the theme font (Verdana) that only backs it up. If it isn't installed, the
  // same fallback the template's placeholders get.
  const bodyRPr = (await pkg.xml(master))
    .getElementsByTagNameNS(NS.p, "bodyStyle")[0]
    ?.getElementsByTagNameNS(NS.a, "defRPr")[0];
  const bodyFace = bodyRPr?.getElementsByTagNameNS(NS.a, "latin")[0]?.getAttribute("typeface");
  const themeFace = (f, fallback) => (!f || f.startsWith("+") ? fallback : f.trim());
  const face = (f) => resolveFont(f).family;
  const c = theme.colors;
  const ink = c.dk1 && c.dk1 !== "000000" ? c.dk1 : "1A1A1A";
  const dark = c.dk2 && contrast(c.dk2, "FFFFFF") > 7 ? c.dk2 : ink;
  return {
    size: { w: W, h: H },
    layouts: layouts.map((l) => ({ path: l.path, name: l.name, type: l.type })),
    title: title && { path: title.path, name: title.name, slides: slidesOnTitle, shapes: title.shapes },
    content: { path: content.path, name: content.name, shapes: content.shapes },
    titleBox: tb,
    titleSize,
    titleFace,
    safe,
    footer,
    reserved,
    reservedInside: inside,
    fonts: {
      heading: face(titleFace),
      body: face(themeFace(bodyFace, theme.fonts.minor?.trim() ?? "Arial")),
      intended: { title: titleFace, body: themeFace(bodyFace, theme.fonts.minor?.trim()) },
    },
    palette: {
      ink,
      primary: dark,
      accent: c.accent1 ?? "C00000",
      muted: mix(ink, "FFFFFF", 0.42),
      onPrimary: "FFFFFF",
      bg: "FFFFFF",
    },
  };
}

/** Title size and typeface: the layout's title placeholder overrides the master's title style. */
async function titleStyle(pkg, master, layout, theme) {
  const read = (rPr) => ({
    size: rPr?.getAttribute("sz") ? +rPr.getAttribute("sz") / 100 : null,
    face: rPr?.getElementsByTagNameNS(NS.a, "latin")[0]?.getAttribute("typeface") ?? null,
  });
  let size = null;
  let face = null;
  for (const sp of [...(await pkg.xml(layout)).getElementsByTagNameNS(NS.p, "sp")]) {
    if (xpath(sp, "nvSpPr", "nvPr", "ph")?.getAttribute("type") !== "title") continue;
    ({ size, face } = read(sp.getElementsByTagNameNS(NS.a, "defRPr")[0]));
  }
  const m = read(
    (await pkg.xml(master)).getElementsByTagNameNS(NS.p, "titleStyle")[0]?.getElementsByTagNameNS(NS.a, "defRPr")[0],
  );
  size ??= m.size ?? 32;
  face ??= m.face;
  if (!face || face === "+mj-lt") face = theme.fonts.major;
  else if (face === "+mn-lt") face = theme.fonts.minor;
  return { size, face: face?.trim() ?? "Arial" };
}

/** Add one slide per role built straight from a layout: title and slide-number placeholders only. */
async function addSeeds(zip, pkg, profile) {
  const presDoc = parse(await zip.file("ppt/presentation.xml").async("string"));
  const presRels = parse(await zip.file("ppt/_rels/presentation.xml.rels").async("string"));
  const ctDoc = parse(await zip.file("[Content_Types].xml").async("string"));
  const sldIdLst = presDoc.getElementsByTagNameNS(NS.p, "sldIdLst")[0];
  let nextFile =
    Math.max(0, ...Object.keys(zip.files).map((f) => +(f.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1] ?? 0))) + 1;
  let nextId = Math.max(255, ...kids(sldIdLst, "sldId").map((s) => +s.getAttribute("id"))) + 1;
  let nextRid =
    Math.max(
      0,
      ...kids(presRels.documentElement, "Relationship").map((r) => +r.getAttribute("Id").replace(/\D/g, "") || 0),
    ) + 1;

  const seed = (layout, phs) => {
    const n = nextFile++;
    const shapes = phs
      .map((s, i) => {
        const idx = s.ph.idx ? ` idx="${s.ph.idx}"` : "";
        const body =
          s.ph.type === "sldNum"
            ? `<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>‹#›</a:t></a:fld></a:p>`
            : `<a:p><a:endParaRPr/></a:p>`;
        return `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="${esc(seedName(s.ph.type))}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${s.ph.type}"${idx}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;
      })
      .join("");
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${T_LAYOUT}" Target="../slideLayouts/${basename(layout)}"/></Relationships>`,
    );
    const o = ctDoc.createElementNS(NS.ct, "Override");
    o.setAttribute("PartName", `/ppt/slides/slide${n}.xml`);
    o.setAttribute("ContentType", CT_SLIDE);
    ctDoc.documentElement.appendChild(o);
    const rid = `rId${nextRid++}`;
    const rel = presRels.createElementNS(NS.rel, "Relationship");
    rel.setAttribute("Id", rid);
    rel.setAttribute("Type", T_SLIDE);
    rel.setAttribute("Target", `slides/slide${n}.xml`);
    presRels.documentElement.appendChild(rel);
    const sid = presDoc.createElementNS(NS.p, "p:sldId");
    sid.setAttribute("id", String(nextId++));
    sid.setAttributeNS(NS.r, "r:id", rid);
    sldIdLst.appendChild(sid);
    return n;
  };

  const keep = (shapes, types) => shapes.filter((s) => s.ph && types.includes(s.ph.type));
  profile.seeds = { content: seed(profile.content.path, keep(profile.content.shapes, ["title", "sldNum"])) };
  if (profile.title) {
    profile.seeds.cover =
      profile.title.slides[0] ??
      seed(profile.title.path, keep(profile.title.shapes, ["ctrTitle", "title", "subTitle"]));
    // a second slide on the title layout is usually the template's closing «thank you» slide
    profile.seeds.closing =
      profile.title.slides.at(-1) !== profile.seeds.cover
        ? profile.title.slides.at(-1)
        : seed(profile.title.path, keep(profile.title.shapes, ["ctrTitle", "title", "subTitle"]));
  }
  profile.seedNames = { title: seedName("title"), ctrTitle: seedName("ctrTitle"), subTitle: seedName("subTitle") };
  // existing template slides name their placeholders in the template's language
  profile.slideNames = {};
  for (const n of profile.title?.slides ?? []) {
    const shapes = await pkg.shapes(`ppt/slides/slide${n}.xml`);
    profile.slideNames[n] = Object.fromEntries(shapes.filter((s) => s.ph).map((s) => [s.ph.type, s.name]));
  }
  zip.file("ppt/presentation.xml", serialize(presDoc));
  zip.file("ppt/_rels/presentation.xml.rels", serialize(presRels));
  zip.file("[Content_Types].xml", serialize(ctDoc));
}

const fileNumber = (p) => +p.match(/slide(\d+)\.xml$/)[1];

const seedName = (type) =>
  ({ title: "Title", ctrTitle: "Title", subTitle: "Subtitle", sldNum: "Slide Number" })[type] ?? type;

/** Set a placeholder's text. Template placeholders are often empty, so modify.setText has no run to change. */
export const setPlaceholderText =
  (text, lang = "en-US") =>
  (el) => {
    const doc = el.ownerDocument;
    const txBody = el.getElementsByTagNameNS(NS.p, "txBody")[0];
    const paras = [...txBody.getElementsByTagNameNS(NS.a, "p")];
    paras.slice(1).forEach((p) => txBody.removeChild(p));
    const p = paras[0];
    for (const r of [...p.getElementsByTagNameNS(NS.a, "r"), ...p.getElementsByTagNameNS(NS.a, "br")]) p.removeChild(r);
    String(text)
      .split("\n")
      .forEach((line, i) => {
        if (i)
          p.insertBefore(doc.createElementNS(NS.a, "a:br"), p.getElementsByTagNameNS(NS.a, "endParaRPr")[0] ?? null);
        const r = doc.createElementNS(NS.a, "a:r");
        const rPr = doc.createElementNS(NS.a, "a:rPr");
        rPr.setAttribute("lang", lang);
        const t = doc.createElementNS(NS.a, "a:t");
        t.appendChild(doc.createTextNode(line));
        r.appendChild(rPr);
        r.appendChild(t);
        p.insertBefore(r, p.getElementsByTagNameNS(NS.a, "endParaRPr")[0] ?? null);
      });
  };

/**
 * Write the deck on the template. slides: [{ seed, texts: { type: text }, elements, images, notes }].
 */
export async function writeTemplateDeck({ work, profile }, slides, out, { lang, emit }) {
  // automizer generates shapes in a scratch PptxGenJS presentation (an instance, not the class)
  const generator = new PptxGenJS();
  generator.defineLayout({ name: "TEMPLATE", width: profile.size.w, height: profile.size.h });
  generator.layout = "TEMPLATE";
  const pres = new Automizer({
    templateDir: dirname(work),
    outputDir: dirname(out),
    removeExistingSlides: true,
    autoImportSlideMasters: false,
    cleanup: false,
    compression: 6,
    pptxGenJs: generator,
    verbosity: 0,
  })
    .loadRoot(basename(work))
    .load(basename(work), "tpl");

  for (const sl of slides) {
    pres.addSlide("tpl", sl.seed, (s) => {
      const names = profile.slideNames[sl.seed] ?? profile.seedNames;
      for (const [type, text] of Object.entries(sl.texts ?? {})) {
        const name = names[type] ?? names[type === "title" ? "ctrTitle" : "title"];
        if (name && text != null) s.modifyElement(name, setPlaceholderText(text, lang));
      }
      if (sl.elements.length) s.generate((p, pg) => emit(p, pg, sl.elements, { lang, images: sl.images }));
    });
  }
  await pres.write(basename(out));
  await writeNotes(
    out,
    slides.map((s) => s.notes ?? ""),
  );
  return out;
}

/** Put speaker notes on every slide, reusing a slide's notes page when it has one. */
export async function writeNotes(file, notes, lang = "en-US") {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const pkg = new Package(zip);
  const pres = await pkg.presentation();
  if (!pres.notesMaster) return false;
  const ctDoc = parse(await zip.file("[Content_Types].xml").async("string"));
  let next =
    Math.max(
      0,
      ...Object.keys(zip.files).map((f) => +(f.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)?.[1] ?? 0)),
    ) + 1;
  const body = (text) =>
    String(text)
      .split("\n")
      .map((l) => `<a:p><a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>`)
      .join("");

  for (const [i, sp] of pres.slides.entries()) {
    const text = notes[i];
    if (!text) continue;
    const rels = await pkg.rels(sp);
    const existing = rels.find((r) => r.type === "notesSlide");
    if (existing) {
      const doc = parse(await zip.file(existing.target).async("string"));
      const bodyPh = [...doc.getElementsByTagNameNS(NS.p, "sp")].find((s) => {
        const ph = xpath(s, "nvSpPr", "nvPr", "ph");
        return ph && (ph.getAttribute("type") || "body") === "body";
      });
      if (bodyPh) {
        const tx = kid(bodyPh, "txBody");
        for (const p of kids(tx, "p")) tx.removeChild(p);
        const frag = parse(`<x xmlns:a="${NS.a}">${body(text)}</x>`);
        for (const p of kids(frag.documentElement)) tx.appendChild(doc.importNode(p, true));
        zip.file(existing.target, serialize(doc));
        continue;
      }
    }
    const n = next++;
    const slideFile = basename(sp);
    zip.file(
      `ppt/notesSlides/notesSlide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body(text)}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
    );
    zip.file(
      `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${T_NOTES_MASTER}" Target="../notesMasters/${basename(pres.notesMaster)}"/><Relationship Id="rId2" Type="${T_SLIDE}" Target="../slides/${slideFile}"/></Relationships>`,
    );
    const relPath = `ppt/slides/_rels/${slideFile}.rels`;
    const relDoc = parse(await zip.file(relPath).async("string"));
    const ids = kids(relDoc.documentElement, "Relationship").map((r) => +r.getAttribute("Id").replace(/\D/g, "") || 0);
    const rel = relDoc.createElementNS(NS.rel, "Relationship");
    rel.setAttribute("Id", `rId${Math.max(0, ...ids) + 1}`);
    rel.setAttribute("Type", T_NOTES);
    rel.setAttribute("Target", `../notesSlides/notesSlide${n}.xml`);
    relDoc.documentElement.appendChild(rel);
    zip.file(relPath, serialize(relDoc));
    const o = ctDoc.createElementNS(NS.ct, "Override");
    o.setAttribute("PartName", `/ppt/notesSlides/notesSlide${n}.xml`);
    o.setAttribute("ContentType", CT_NOTES);
    ctDoc.documentElement.appendChild(o);
  }
  zip.file("[Content_Types].xml", serialize(ctDoc));
  writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return true;
}
