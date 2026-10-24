// PPTX -> PDF -> PNG pages -> contact sheet. LibreOffice is the reference renderer.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { fontconfigFile, tools } from "./tools.mjs";

const run = promisify(execFile);

/**
 * Convert a document with headless LibreOffice. Each call gets its own profile dir,
 * otherwise conversion silently does nothing while the LibreOffice app is open.
 * HTML input is forced through the Writer import filter: the default opens it in
 * Writer/Web and the "ODT" comes out as a web document (mimetype text-web).
 */
export async function convert(input, outDir, format = "pdf") {
  mkdirSync(outDir, { recursive: true });
  const soffice = tools.soffice();
  const profile = mkdtempSync(join(tmpdir(), "deck-lo-"));
  const infilter = /\.html?$/i.test(input) ? ["--infilter=HTML (StarWriter)"] : [];
  const env = { ...process.env, FONTCONFIG_FILE: fontconfigFile(soffice) };
  try {
    await run(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--norestore",
        ...infilter,
        "--convert-to",
        format,
        "--outdir",
        outDir,
        input,
      ],
      { timeout: 180000, env },
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  const ext = format.split(":")[0];
  const out = join(outDir, `${basename(input, extname(input))}.${ext}`);
  if (!existsSync(out)) throw new Error(`LibreOffice produced no ${ext} for ${input}`);
  return out;
}

/** Render every PDF page to PNG. Returns paths in page order. */
export async function rasterize(pdf, outDir, { dpi = 96, prefix = "slide" } = {}) {
  mkdirSync(outDir, { recursive: true });
  const ours = () => readdirSync(outDir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".png"));
  // pages from an earlier, longer render would otherwise survive and be reviewed as current
  for (const f of ours()) rmSync(join(outDir, f));
  await run(tools.pdftoppm(), ["-png", "-r", String(dpi), pdf, join(outDir, prefix)], { timeout: 180000 });
  // pdftoppm pads page numbers to the page count's width; normalise to slide-01.png ...
  const pages = ours().sort((a, b) => parseInt(a.slice(prefix.length + 1)) - parseInt(b.slice(prefix.length + 1)));
  return pages.map((f, i) => {
    const to = join(outDir, `${prefix}-${String(i + 1).padStart(2, "0")}.png`);
    if (join(outDir, f) !== to) renameSync(join(outDir, f), to);
    return to;
  });
}

/** Grid of slide thumbnails with slide numbers, for whole-deck review. */
export async function contactSheet(pngs, out, { cols = 4, width = 480, gap = 12 } = {}) {
  const meta = await sharp(pngs[0]).metadata();
  const height = Math.round((width * meta.height) / meta.width);
  const rows = Math.ceil(pngs.length / cols);
  const label = 22;
  const W = cols * width + (cols + 1) * gap;
  const H = rows * (height + label) + (rows + 1) * gap;
  const tiles = await Promise.all(
    pngs.map(async (p, i) => {
      const x = gap + (i % cols) * (width + gap);
      const y = gap + Math.floor(i / cols) * (height + label + gap);
      const img = await sharp(p).resize(width, height).png().toBuffer();
      const num = Buffer.from(
        `<svg width="${width}" height="${label}"><text x="0" y="16" font-family="Arial" font-size="14" fill="#555">${i + 1}</text></svg>`,
      );
      return [
        { input: img, left: x, top: y + label },
        { input: num, left: x, top: y },
      ];
    }),
  );
  await sharp({ create: { width: W, height: H, channels: 3, background: "#e9e9e9" } })
    .composite(tiles.flat())
    .jpeg({ quality: 85 })
    .toFile(out);
  return out;
}
