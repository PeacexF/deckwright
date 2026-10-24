import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import { Deck } from "../../scripts/lib/deck.mjs";
import { strings } from "../../scripts/lib/strings.mjs";
import { extractStyle } from "../../scripts/lib/style.mjs";

test("library words follow the deck's language and can be overridden", () => {
  assert.equal(strings().sources, "Sources");
  assert.equal(strings("ru-RU").sources, "Источники");
  assert.equal(strings("de-DE").thanks, "Thank you"); // unknown language falls back to English
  assert.equal(strings("en-GB", { thanks: "Questions?" }).thanks, "Questions?");
});

test("a deck is English unless it says otherwise", async () => {
  const layout = async (meta) => {
    const d = new Deck(mkdtempSync(join(tmpdir(), "deck-lang-")));
    const api = d.api();
    api.meta(meta);
    api.sources({ groups: [{ title: "Data", entries: ["One"] }], notes: "n" });
    await d.layout();
    return d.slides[0].title;
  };
  assert.equal(await layout({}), "Sources");
  assert.equal(await layout({ language: "ru-RU" }), "Источники");
});

test("style is read off an example deck, weighted by use", async () => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  for (let i = 0; i < 3; i++) {
    const s = p.addSlide();
    s.addText("A headline about the quarter", {
      x: 0.5,
      y: 0.4,
      w: 12,
      h: 1,
      fontFace: "Georgia",
      fontSize: 32,
      color: "8E3122",
    });
    s.addShape(p.ShapeType.rect, { x: 0.5, y: 1.6, w: 6, h: 4, fill: { color: "8E3122" } });
    s.addShape(p.ShapeType.rect, { x: 7, y: 1.6, w: 1, h: 1, fill: { color: "C9A24A" } });
    s.addText("Body text that explains the chart in a sentence or two.", {
      x: 7,
      y: 3,
      w: 5,
      h: 2,
      fontFace: "Arial",
      fontSize: 14,
      color: "1C1815",
    });
  }
  const file = join(mkdtempSync(join(tmpdir(), "deck-style-")), "example.pptx");
  await p.writeFile({ fileName: file });

  const st = await extractStyle(file);
  assert.equal(st.slides, 3);
  assert.deepEqual(st.fonts, { heading: "Georgia", body: "Arial" });
  assert.deepEqual(st.sizes, { title: 32, body: 14 });
  assert.equal(st.palette.primary, "8E3122");
  assert.equal(st.palette.accent, "C9A24A");
  assert.equal(st.palette.ink, "1C1815");
});
