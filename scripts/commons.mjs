#!/usr/bin/env node
// Download images from Wikimedia Commons and record their credits (title, author, licence).
//
//   node commons.mjs <img-dir> --search "Ulaanbaatar Sukhbaatar Square" [-n 10]   find File: titles
//   node commons.mjs <img-dir> ub="File:Ulaanbaatar.jpg" flag="File:Flag of Mongolia.svg"
//
// Writes <img-dir>/<key>.jpg|png and <img-dir>/credits.json: { key: { file, title, artist, license, page } }.
// Keys already on disk are skipped. SVGs arrive as PNG renders. Every photo in a deck needs a credit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://commons.wikimedia.org/w/api.php";
const HEADERS = { "User-Agent": "deckwright/0.1 (presentation builder; https://github.com/PeacexF/deckwright)" };

async function get(url, { binary = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.json();
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

const strip = (html = "") =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Commons puts boilerplate in the author field when nobody is credited. */
export function cleanArtist(s) {
  const a = strip(s);
  return !a || /see file history|unknown author|^unknown$/i.test(a) ? "" : a;
}

export function titleOf(file) {
  return file
    .replace(/^File:/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_/g, " ");
}

async function search(q, n) {
  const p = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: q,
    srnamespace: "6",
    srlimit: String(n),
    format: "json",
  });
  const d = await get(`${API}?${p}`);
  for (const r of d.query.search) console.log(r.title);
}

async function download(dir, key, file, width) {
  const credPath = join(dir, "credits.json");
  const credits = existsSync(credPath) ? JSON.parse(readFileSync(credPath, "utf8")) : {};
  const p = new URLSearchParams({
    action: "query",
    titles: file,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(width),
    format: "json",
  });
  const page = Object.values((await get(`${API}?${p}`)).query.pages)[0];
  const info = page.imageinfo?.[0];
  if (!info) return console.log(`NOT FOUND ${key} ${file}`);
  const m = info.extmetadata ?? {};
  const data = await get(info.thumburl ?? info.url, { binary: true });
  // by magic bytes: thumbnail URLs carry query strings, so the URL's extension can't be trusted
  const ext = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png" : "jpg";
  writeFileSync(join(dir, `${key}.${ext}`), data);
  credits[key] = {
    file,
    title: titleOf(file),
    artist: cleanArtist(m.Artist?.value),
    license: strip(m.LicenseShortName?.value) || "licence not stated",
    page: info.descriptionurl,
  };
  writeFileSync(credPath, JSON.stringify(credits, null, 1));
  console.log(`${key}: ${credits[key].license} — ${credits[key].artist || "author not stated"}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir || dir.startsWith("-")) {
    console.error('usage: commons.mjs <img-dir> key="File:Title.jpg" … | --search "query" [-n 10] [--width 1920]');
    process.exit(2);
  }
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  if (args.includes("--search")) return search(opt("--search"), Number(opt("-n", 10)));
  mkdirSync(dir, { recursive: true });
  const width = Number(opt("--width", 1920));
  for (const pair of args.slice(1).filter((a) => a.includes("="))) {
    const [key, file] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
    if (["jpg", "png"].some((e) => existsSync(join(dir, `${key}.${e}`)))) continue;
    await download(dir, key, file.startsWith("File:") ? file : `File:${file}`, width);
    await new Promise((r) => setTimeout(r, 1000)); // be polite to the API
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
