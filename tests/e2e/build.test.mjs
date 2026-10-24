// Build real decks through LibreOffice and check that QA agrees with the layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pptxgen from "pptxgenjs";
import sharp from "sharp";
import { buildDeck } from "../../scripts/lib/deck.mjs";
import { Package } from "../../scripts/lib/pptx.mjs";
import { runQa } from "../../scripts/lib/qa.mjs";
import { makeTemplate } from "../fixtures/make-template.mjs";

const root = process.env.DECK_TEST_OUT ?? mkdtempSync(join(tmpdir(), "deck-e2e-"));

async function deckFolder(name, script) {
  const dir = join(root, name);
  mkdirSync(join(dir, "img"), { recursive: true });
  await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#5677A3" } })
    .jpeg()
    .toFile(join(dir, "img", "photo.jpg"));
  writeFileSync(
    join(dir, "img", "credits.json"),
    JSON.stringify({ photo: { title: "Test photo", artist: "Tester", license: "CC0" } }),
  );
  writeFileSync(join(dir, "deck.mjs"), script);
  return dir;
}

const CONTENT = `
  deck.slide({ section: "Раздел", title: "Цифры и столбики", source: "Источник: тест [1]", notes: "Заметки." }, (s, body) => {
    const [l, r] = body.cols([7, 5]);
    s.stack(l, [
      s.kpis([{ value: "25,4 млрд $", label: "ВВП, 2025" }, { value: "6,9 %", label: "рост", color: "accent" }]),
      s.bars([{ label: "Овцы", value: 23.9 }, { label: "Козы", value: 23.2 }, { label: "Верблюды", value: 0.5 }], { decimals: 1 }),
    ]);
    s.place(r, s.photo("photo", { grow: true, caption: "Подпись к фото" }));
  });
  deck.slide({ title: "Таблица и карточки", source: "Источник: тест [2]", notes: "Заметки." }, (s, body) => {
    const used = s.place(body, s.table([["Акт", "Статья"], ["Протест", "ст. 23"], ["Представление", "ст. 24"]], { columns: [3, 1] }));
    s.row(body.with({ y: used.y2 + 0.3, h: body.y2 - used.y2 - 0.3 }), [
      s.card({ title: "Надзор", text: "За исполнением законов органами власти" }),
      s.card({ title: "Иные функции", text: "Уголовное преследование и координация", fill: "primary" }),
    ]);
  });
  deck.sources({ groups: [{ title: "Источники", entries: ["Первый источник", "Второй источник"] }], notes: "Источники." });
`;

test("a free-design deck builds with no layout problems and no QA errors", async () => {
  const dir = await deckFolder(
    "free",
    `export default (deck) => {
      deck.meta({ title: "Тестовая презентация", palette: { primary: "0F3D73", accent: "C4272F" }, slides: 5 });
      deck.cover({ kicker: "Доклад", title: "Тестовая презентация", subtitle: "Подзаголовок", photo: "photo", stats: [{ value: "1,56 млн", label: "км²" }], notes: "Титул." });
      ${CONTENT}
      deck.closing({ kicker: "Вывод", title: "Итог", points: [{ title: "Один", text: "Текст" }, { title: "Два", text: "Текст" }], notes: "Конец." });
    };`,
  );
  const { pptx, manifest, problems } = await buildDeck(join(dir, "deck.mjs"));
  assert.deepEqual(problems, []);
  const qa = await runQa(pptx, { manifest, outDir: join(dir, "qa") });
  assert.deepEqual(qa.errors, []);
  assert.equal(qa.slides, 5);
  // regression: headless LibreOffice used to swap Arial for its bundled Liberation Sans
  assert.ok(
    qa.embeddedFonts.some((f) => /^Arial/.test(f)),
    `embedded: ${qa.embeddedFonts}`,
  );
  assert.ok(!qa.embeddedFonts.some((f) => /Liberation/.test(f)));
});

test("a deck on a template keeps the template's chrome and passes QA", async () => {
  const dir = await deckFolder(
    "template",
    `export default (deck) => {
      deck.meta({ title: "На шаблоне", template: "template.pptx" });
      ${CONTENT}
    };`,
  );
  await makeTemplate(join(dir, "template.pptx"));
  const { pptx, manifest, problems } = await buildDeck(join(dir, "deck.mjs"));
  assert.deepEqual(problems, []);
  assert.ok(manifest.slides[0].reserved.some((z) => z.name === "slide number"));

  const pkg = await Package.open(pptx);
  const pres = await pkg.presentation();
  assert.equal(pres.slides.length, 3);
  const shapes = await pkg.slideShapes(pres.slides[0]);
  assert.equal(shapes.find((s) => s.ph?.type === "title")?.text, "Цифры и столбики");
  assert.equal(await pkg.notesText(pres.slides[0]), "Заметки.");

  const qa = await runQa(pptx, { manifest, outDir: join(dir, "qa") });
  assert.deepEqual(qa.errors, []);
});

test("QA catches overflow, mid-word breaks and tiny text in a deck it didn't build", async () => {
  const dir = join(root, "broken");
  mkdirSync(dir, { recursive: true });
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  const s = p.addSlide();
  s.addText("Этот текст слишком длинный для такой маленькой рамки и обязательно вылезет за её нижний край", {
    x: 1,
    y: 1,
    w: 3,
    h: 0.4,
    fontFace: "Arial",
    fontSize: 18,
    margin: 0,
    valign: "top",
    fit: "none",
  });
  s.addText("Достопримечательности", {
    x: 1,
    y: 3,
    w: 1.2,
    h: 1,
    fontFace: "Arial",
    fontSize: 20,
    margin: 0,
    valign: "top",
  });
  s.addText("Сноска мелким шрифтом", { x: 1, y: 6.5, w: 5, h: 0.3, fontFace: "Arial", fontSize: 7, margin: 0 });
  s.addNotes("заметки");
  const pptx = join(dir, "broken.pptx");
  await p.writeFile({ fileName: pptx });

  const qa = await runQa(pptx, { outDir: join(dir, "qa") });
  const checks = new Set(qa.errors.map((e) => e.check));
  assert.ok(checks.has("overflow"), JSON.stringify(qa.errors));
  assert.ok(checks.has("split-word"), JSON.stringify(qa.errors));
  assert.ok(checks.has("tiny-text"), JSON.stringify(qa.errors));
  assert.match(execFileSync("pdfinfo", [qa.pdf], { encoding: "utf8" }), /Pages:\s+1\b/);
});
