// Locate the external tools deckwright shells out to.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SOFFICE_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
];

export function which(cmd) {
  try {
    return execFileSync("/usr/bin/which", [cmd], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

export function findSoffice() {
  if (process.env.SOFFICE && existsSync(process.env.SOFFICE)) return process.env.SOFFICE;
  return which("soffice") ?? SOFFICE_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export function requireTool(name, path, hint) {
  if (!path) throw new Error(`${name} not found. ${hint}`);
  return path;
}

const FONT_DIRS = ["/System/Library/Fonts", "/Library/Fonts", join(homedir(), "Library", "Fonts")];
const FALLBACK = ["Arial", "Helvetica Neue", "Liberation Sans", "DejaVu Sans"];

/**
 * One fontconfig setup for both LibreOffice and our own font lookups (fc-match), so QA describes
 * the render that actually happens.
 *
 * Headless LibreOffice on macOS uses its bundled fontconfig, which only knows LibreOffice's own
 * fonts (Arial silently becomes Liberation Sans, Georgia becomes Linux Libertine). Given the system
 * font folders but no default rules, it falls back for a missing family to whatever covers the
 * charset best — a template's Gilroy Bold came out as Hiragino Maru Gothic. So: system fonts,
 * LibreOffice's metric-compatible aliases (Calibri → Carlito …), and Arial as the last resort.
 */
export function fontconfigFile(soffice = findSoffice()) {
  const dir = join(homedir(), ".cache", "deckwright", "fontconfig");
  mkdirSync(dir, { recursive: true });
  const bundled = soffice ? join(dirname(dirname(soffice)), "Resources", "fonts", "truetype") : null;
  const dirs = [...FONT_DIRS, bundled].filter((d) => d && existsSync(d));
  const aliases =
    bundled && existsSync(join(bundled, "fc_local.conf"))
      ? `  <include ignore_missing="yes">${join(bundled, "fc_local.conf")}</include>\n`
      : "";
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
${dirs.map((d) => `  <dir>${d}</dir>`).join("\n")}
${aliases}  <match target="pattern">
    <edit name="family" mode="append_last">${FALLBACK.map((f) => `<string>${f}</string>`).join("")}</edit>
  </match>
  <cachedir>${join(dir, "cache")}</cachedir>
</fontconfig>
`;
  const file = join(dir, "fonts.conf");
  if (!existsSync(file) || readFileSync(file, "utf8") !== xml) writeFileSync(file, xml);
  return file;
}

/** Environment for fc-match and soffice. On machines without macOS font folders, the system config is used. */
export function fontEnv() {
  if (process.platform !== "darwin") return process.env;
  return { ...process.env, FONTCONFIG_FILE: fontconfigFile() };
}

export const tools = {
  soffice: () =>
    requireTool(
      "LibreOffice (soffice)",
      findSoffice(),
      "Install: brew install --cask libreoffice (or set SOFFICE=/path/to/soffice)",
    ),
  pdftoppm: () => requireTool("pdftoppm", which("pdftoppm"), "Install: brew install poppler"),
  pdftotext: () => requireTool("pdftotext", which("pdftotext"), "Install: brew install poppler"),
};
