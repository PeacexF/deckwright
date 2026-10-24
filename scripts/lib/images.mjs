// Images: index the deck's img/ folder, read credits, and prepare crops for placement.
// Every image is re-encoded with sharp to JPEG or PNG before it reaches pptxgenjs.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";

const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".svg", ".avif", ".heic"]);
const DPI = 220; // crop resolution: sharp on a projector, small enough to keep decks light

/** { key: { path, width, height, credit } } for every image in dir (key = file name without extension). */
export async function indexImages(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  const credits = existsSync(join(dir, "credits.json"))
    ? JSON.parse(readFileSync(join(dir, "credits.json"), "utf8"))
    : {};
  for (const f of readdirSync(dir)) {
    if (!EXTS.has(extname(f).toLowerCase())) continue;
    const path = join(dir, f);
    const { width, height, orientation } = await sharp(path).metadata();
    const rotated = orientation >= 5; // EXIF 5–8 swap width and height
    const key = basename(f, extname(f));
    out.set(key, {
      key,
      path,
      width: rotated ? height : width,
      height: rotated ? width : height,
      credit: credits[key],
    });
  }
  return out;
}

/**
 * Write the image as it will appear in a w × h box: cover-cropped around the focal point
 * (fx, fy in 0..1) when crop is given, else just normalised. Returns the new file's path.
 */
export async function prepareImage(src, { w, h, crop }, outDir) {
  mkdirSync(outDir, { recursive: true });
  const meta = await sharp(src).metadata();
  const alpha = meta.hasAlpha;
  const ext = alpha ? "png" : "jpg";
  const name = `${basename(src, extname(src))}_${Math.round(w * 100)}x${Math.round(h * 100)}${crop ? `_${crop.fx}_${crop.fy}` : ""}.${ext}`;
  const out = join(outDir, name);
  if (existsSync(out)) return out;
  let img = sharp(src).rotate(); // honour EXIF orientation
  const pxW = Math.round(w * DPI);
  const pxH = Math.round(h * DPI);
  if (crop) {
    const { width: iw, height: ih } = await img
      .clone()
      .toBuffer({ resolveWithObject: true })
      .then((r) => r.info);
    const box = w / h;
    let cw = iw;
    let ch = ih;
    if (iw / ih > box) cw = Math.round(ih * box);
    else ch = Math.round(iw / box);
    const left = Math.round((iw - cw) * crop.fx);
    const top = Math.round((ih - ch) * crop.fy);
    img = sharp(await img.toBuffer()).extract({ left, top, width: cw, height: ch });
    if (cw > pxW) img = img.resize(pxW, pxH);
  } else if (meta.width > pxW || meta.height > pxH) {
    img = img.resize(pxW, pxH, { fit: "inside" });
  }
  img = alpha ? img.png() : img.flatten({ background: "#ffffff" }).jpeg({ quality: 88 });
  await img.toFile(out);
  return out;
}
