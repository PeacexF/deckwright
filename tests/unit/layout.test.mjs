import { test } from "node:test";
import assert from "node:assert/strict";
import { Box } from "../../scripts/lib/layout.mjs";
import { color, contrast, makeTheme, mix, style } from "../../scripts/lib/theme.mjs";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("edges are numbers, not the split methods", () => {
  // regression: a getter and a method both named `bottom` made box.bottom return a function
  const b = new Box(1, 2, 3, 4);
  assert.equal(b.x2, 4);
  assert.equal(b.y2, 6);
  assert.equal(typeof b.bottom, "function");
});

test("cols and rows split by ratio with gaps", () => {
  const [a, b] = new Box(0, 0, 10, 4).cols([3, 1], 2);
  assert.deepEqual([a.x, a.w, b.x, b.w], [0, 6, 8, 2]);
  const rows = new Box(0, 0, 4, 10).rows(3, 0.5);
  close(rows[2].y2, 10);
});

test("top/bottom/left/right split off a part", () => {
  const [t, rest] = new Box(0, 0, 10, 10).top(2, 1);
  assert.deepEqual([t.h, rest.y, rest.h], [2, 3, 7]);
  const [above, b] = new Box(0, 0, 10, 10).bottom(2, 1);
  assert.deepEqual([above.h, b.y], [7, 8]);
  const [, r] = new Box(0, 0, 10, 10).right(3);
  assert.equal(r.x, 7);
});

test("a topic palette derives its tints from the primary colour", () => {
  const t = makeTheme("editorial", { palette: { primary: "0F3D73" } });
  assert.equal(t.palette.primary, "0F3D73");
  assert.equal(t.palette.track, mix("0F3D73", "FFFFFF", 0.92));
  assert.equal(color(t, "accent"), t.palette.accent);
  assert.equal(color(t, "aabbcc"), "AABBCC");
  assert.throws(() => color(t, "teal"), /Unknown colour/);
});

test("roles carry minimum sizes", () => {
  const t = makeTheme("editorial");
  assert.equal(style(t, "body").min, 14);
  assert.equal(style(t, "body", { size: 12 }).size, 12); // the build reports it; style() just resolves
  assert.throws(() => style(t, "huge"), /Unknown text role/);
});

test("contrast follows WCAG", () => {
  close(contrast("000000", "FFFFFF"), 21);
  close(contrast("777777", "777777"), 1);
});
