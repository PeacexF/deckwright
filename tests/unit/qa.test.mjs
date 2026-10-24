import { test } from "node:test";
import assert from "node:assert/strict";
import { alignShape, checkPage, matchToken, parseBbox } from "../../scripts/lib/qa.mjs";

// words on a line at height y (inches), each 0.2 in tall, laid out left to right
const line = (y, ...ts) => {
  let x = 1;
  return ts.map((t) => {
    const w = { t, x0: x, x1: x + 0.1 * t.length, y0: y, y1: y + 0.2 };
    x = w.x1 + 0.05;
    return w;
  });
};

test("pdftotext -bbox output becomes words in inches", () => {
  const xml = `<page width="960" height="540"><word xMin="72" yMin="36" xMax="144" yMax="54">Привет&amp;</word></page>`;
  const [p] = parseBbox(xml);
  assert.equal(p.w, 960 / 72);
  assert.deepEqual(p.words[0], { x0: 1, y0: 0.5, x1: 2, y1: 0.75, t: "Привет&" });
});

test("a word split across two lines is a mid-word break", () => {
  const words = [...line(1, "ком"), ...line(1.3, "итет")];
  assert.deepEqual(matchToken("комитет", words, 0), { n: 2, kind: "split" });
});

test("fragments on the same line are letter spacing, not a break", () => {
  const words = line(1, "М", "О", "НГ");
  assert.deepEqual(matchToken("МОНГ", words, 0), { n: 3, kind: "ok" });
});

test("breaks at a hyphen or a dash are legitimate", () => {
  assert.equal(matchToken("Улан-Батор", [...line(1, "Улан-"), ...line(1.3, "Батор")], 0).kind, "hyphen");
  assert.equal(matchToken("35–44.", [...line(1, "35"), ...line(1.3, "–44.")], 0).kind, "hyphen");
});

test("alignment prefers the occurrence nearest the shape's box", () => {
  // «2024» appears on a chart axis first and in the text box second
  const words = [...line(5, "2024"), ...line(1, "2024")];
  const r = alignShape(["2024"], words, 0, { x: 0.9, y: 0.9, w: 3, h: 0.5 });
  assert.deepEqual(r.idx, [1]);
});

test("text running below its box is an overflow", () => {
  const page = { w: 13.333, h: 7.5, words: [...line(1, "раз", "два"), ...line(1.5, "три")] };
  const shapes = [{ kind: "sp", name: "TextBox 1", text: "раз два три", box: { x: 1, y: 1, w: 3, h: 0.3 } }];
  const { errors } = checkPage(page, shapes, { slide: 2 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].check, "overflow");
  assert.match(errors[0].message, /below its box/);
});

test("text from two shapes on top of each other collides", () => {
  const page = { w: 13.333, h: 7.5, words: [...line(1, "первый"), ...line(1.05, "второй")] };
  const shapes = [
    { kind: "sp", name: "A", text: "первый", box: { x: 1, y: 1, w: 3, h: 0.3 } },
    { kind: "sp", name: "B", text: "второй", box: { x: 1, y: 1, w: 3, h: 0.3 } },
  ];
  assert.ok(checkPage(page, shapes, { slide: 1 }).errors.some((e) => e.check === "collision"));
});

test("content in a template's reserved zone is reported", () => {
  const page = { w: 13.333, h: 7.5, words: line(6.5, "текст") };
  const shapes = [{ kind: "sp", name: "A", text: "текст", box: { x: 1, y: 6.4, w: 3, h: 0.4 } }];
  const reserved = [{ x: 0.5, y: 6.3, w: 2, h: 1, name: "slide number" }];
  assert.ok(checkPage(page, shapes, { slide: 1, reserved }).errors.some((e) => e.check === "reserved"));
});
