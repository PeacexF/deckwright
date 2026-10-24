// Layout-level checks: problems are reported with slide numbers before anything is rendered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deck } from "../../scripts/lib/deck.mjs";
import { freeDir, slugify } from "../../scripts/new.mjs";
import { cleanArtist, titleOf } from "../../scripts/commons.mjs";

async function layout(script) {
  const d = new Deck(mkdtempSync(join(tmpdir(), "deck-layout-")));
  script(d.api());
  await d.layout();
  return d;
}

test("a slide that fits has no problems", async () => {
  const d = await layout((deck) => {
    deck.slide({ title: "Заголовок", source: "Источник", notes: "заметки" }, (s, body) => {
      s.place(body, s.text("Короткий текст."));
    });
  });
  assert.deepEqual(d.problems, []);
});

test("too much text is reported with the slide number and the overrun", async () => {
  const d = await layout((deck) => {
    deck.slide({ title: "Первый", notes: "n" }, () => {});
    deck.slide({ title: "Второй", notes: "n" }, (s, body) => {
      s.place(body, s.text(Array(60).fill("Очень длинный абзац текста, который не помещается.").join(" ")));
    });
  });
  assert.equal(d.problems.length, 1);
  assert.equal(d.problems[0].slide, 2);
  assert.match(d.problems[0].message, /content needs .* \(over by/);
});

test("text below its role's minimum is a problem", async () => {
  const d = await layout((deck) => {
    deck.slide({ title: "T", notes: "n" }, (s, body) => s.place(body, s.text("мелко", { size: 9 })));
  });
  assert.match(d.problems[0].message, /body text at 9 pt; the minimum for body is 14 pt/);
});

test("missing notes and slide limits are problems", async () => {
  const d = await layout((deck) => {
    deck.meta({ maxSlides: 1 });
    deck.slide({ title: "A" }, () => {});
    deck.slide({ title: "B", notes: "n" }, () => {});
  });
  const msgs = d.problems.map((p) => p.message);
  assert.ok(msgs.includes("no speaker notes"));
  assert.ok(msgs.some((m) => /the limit is 1/.test(m)));
});

test("an image that isn't in img/ is reported", async () => {
  const d = await layout((deck) => {
    deck.slide({ title: "T", notes: "n" }, (s, body) => s.place(body, s.photo("missing", { h: 2 })));
  });
  assert.match(d.problems[0].message, /image «missing» not found/);
});

test("deck folders get a readable slug and never overwrite", () => {
  assert.equal(slugify("Монголия: доклад!"), "монголия-доклад");
  const root = mkdtempSync(join(tmpdir(), "deck-new-"));
  assert.equal(freeDir(root, "x"), join(root, "x"));
});

test("Commons boilerplate isn't shown as an author", () => {
  assert.equal(cleanArtist("See File history below for details."), "");
  assert.equal(cleanArtist('<a href="x">Bernard Gagnon</a>'), "Bernard Gagnon");
  assert.equal(titleOf("File:Flag_of_Mongolia.svg"), "Flag of Mongolia");
});
