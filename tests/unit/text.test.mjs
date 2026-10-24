import { test } from "node:test";
import assert from "node:assert/strict";
import { breakSegments, lineHeight, wrapWords } from "../../scripts/lib/text.mjs";

// one inch per character keeps the arithmetic obvious
const mono = (s) => [...s].length;

test("lines break at spaces, greedily", () => {
  assert.deepEqual(wrapWords("aa bb cc dd", 5, mono).lines, ["aa bb", "cc dd"]);
  assert.deepEqual(wrapWords("aa bb cc", 100, mono).lines, ["aa bb cc"]);
});

test("newlines start new paragraphs", () => {
  assert.deepEqual(wrapWords("aa\nbb", 100, mono).lines, ["aa", "bb"]);
});

test("LibreOffice may break after a hyphen inside a word", () => {
  assert.deepEqual(
    breakSegments("(Таван-Толгой), Улан-Батор").map((s) => s.text),
    ["(Таван-", "Толгой),", "Улан-", "Батор"],
  );
  assert.deepEqual(wrapWords("уголь (Таван-Толгой)", 14, mono).lines, ["уголь (Таван-", "Толгой)"]);
});

test("no break after a leading hyphen or before digits", () => {
  assert.deepEqual(
    breakSegments("-5 °C").map((s) => s.text),
    ["-5", "°C"],
  );
  assert.deepEqual(
    breakSegments("172-ФЗ").map((s) => s.text),
    ["172-", "ФЗ"],
  );
  assert.deepEqual(
    breakSegments("2022-2024").map((s) => s.text),
    ["2022-2024"],
  );
});

test("a word wider than the line is kept whole and reported", () => {
  const r = wrapWords("ab administrative cd", 6, mono);
  assert.deepEqual(r.tooWide, ["administrative"]);
  assert.ok(r.lines.includes("administrative"));
});

test("line height is 1.2 × size × spacing, whatever the font", () => {
  assert.ok(Math.abs(lineHeight({ size: 72, lineSpacing: 1 }) - 1.2) < 1e-9);
  assert.ok(Math.abs(lineHeight({ size: 36, lineSpacing: 1.5 }) - 0.9) < 1e-9);
});
