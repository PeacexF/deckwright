// End-to-end: PptxGenJS -> LibreOffice PDF -> PNG pages -> contact sheet, plus HTML -> ODT.
// Needs LibreOffice and Poppler. Set DECK_TEST_OUT to keep the renders (CI uploads them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { buildSmokeDeck, SLIDES } from "../fixtures/smoke-deck.mjs";
import { contactSheet, convert, rasterize } from "../../scripts/lib/render.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const dir = process.env.DECK_TEST_OUT ?? mkdtempSync(join(tmpdir(), "deck-e2e-"));
mkdirSync(dir, { recursive: true });

test("smoke deck renders to PDF, page images and a contact sheet", async () => {
  const pptx = await buildSmokeDeck(join(dir, "smoke.pptx"));

  const pdf = await convert(pptx, dir);
  assert.match(execFileSync("pdfinfo", [pdf], { encoding: "utf8" }), new RegExp(`Pages:\\s+${SLIDES}\\b`));
  const text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  assert.match(text, /Монголия: тестовая презентация/);
  assert.match(text, /Госдолг, % ВВП/);

  const pngs = await rasterize(pdf, join(dir, "png"));
  assert.equal(pngs.length, SLIDES);
  // a second render must not leave stale pages behind
  assert.equal((await rasterize(pdf, join(dir, "png"))).length, SLIDES);

  const sheet = await contactSheet(pngs, join(dir, "sheet.jpg"));
  assert.ok(statSync(sheet).size > 10_000);
});

test("HTML handout converts to a real ODT text document", async () => {
  const odt = await convert(join(FIXTURES, "handout.html"), dir, "odt:writer8");
  const zip = await JSZip.loadAsync(readFileSync(odt));
  assert.equal(await zip.file("mimetype").async("string"), "application/vnd.oasis.opendocument.text");
  const content = await zip.file("content.xml").async("string");
  assert.match(content, /<text:h[^>]*>Ключевые цифры/);
  assert.match(content, /<table:table /);
});
