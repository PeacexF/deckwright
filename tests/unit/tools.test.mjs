import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { findSoffice, requireTool } from "../../scripts/lib/tools.mjs";

const saved = process.env.SOFFICE;
afterEach(() => {
  if (saved === undefined) delete process.env.SOFFICE;
  else process.env.SOFFICE = saved;
});

test("SOFFICE overrides the soffice lookup when the file exists", () => {
  process.env.SOFFICE = process.execPath; // any existing file will do
  assert.equal(findSoffice(), process.execPath);
});

test("a SOFFICE path that doesn't exist is ignored", () => {
  process.env.SOFFICE = "/nonexistent/soffice";
  assert.notEqual(findSoffice(), "/nonexistent/soffice");
});

test("requireTool returns the path or throws with the install hint", () => {
  assert.equal(requireTool("x", "/bin/x", "hint"), "/bin/x");
  assert.throws(() => requireTool("pdftoppm", null, "Install: brew install poppler"), {
    message: "pdftoppm not found. Install: brew install poppler",
  });
});
