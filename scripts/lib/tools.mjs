// Locate the external tools claude-deck shells out to.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

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
