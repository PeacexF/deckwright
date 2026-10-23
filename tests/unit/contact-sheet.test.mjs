import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { contactSheet } from "../../scripts/lib/render.mjs";

test("contact sheet lays slides out in a labelled grid", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-sheet-"));
  const pngs = await Promise.all(
    ["#0F3D73", "#C4272F", "#5677A3", "#EDF0F4", "#1A2433"].map(async (bg, i) => {
      const p = join(dir, `slide-${i + 1}.png`);
      await sharp({ create: { width: 320, height: 180, channels: 3, background: bg } })
        .png()
        .toFile(p);
      return p;
    }),
  );

  const { width, height } = await sharp(await contactSheet(pngs, join(dir, "sheet.jpg"), { cols: 2 })).metadata();
  // 2 columns of 480px tiles with 12px gaps; 3 rows of 270px tiles plus a 22px label each
  assert.equal(width, 2 * 480 + 3 * 12);
  assert.equal(height, 3 * (270 + 22) + 4 * 12);
});
