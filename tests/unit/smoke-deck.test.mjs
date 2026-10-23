import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildSmokeDeck, SLIDES } from "../fixtures/smoke-deck.mjs";

test("smoke deck package has slides, notes, a native chart and media", async () => {
  const pptx = await buildSmokeDeck(join(mkdtempSync(join(tmpdir(), "deck-unit-")), "smoke.pptx"));
  const files = Object.keys((await JSZip.loadAsync(readFileSync(pptx))).files);
  const count = (re) => files.filter((f) => re.test(f)).length;

  assert.equal(count(/^ppt\/slides\/slide\d+\.xml$/), SLIDES);
  assert.equal(count(/^ppt\/notesSlides\/notesSlide\d+\.xml$/), SLIDES);
  assert.equal(count(/^ppt\/charts\/chart\d+\.xml$/), 1);
  assert.ok(count(/^ppt\/media\//) >= 1);
});
