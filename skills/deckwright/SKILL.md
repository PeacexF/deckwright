---
name: deckwright
description: Presentations (.pptx) that are researched, well designed and verified — from a brief, notes, documents, data or an assignment; in a free design, on a supplied .potx/.pptx template, or in the style of example decks. Builds with a measured layout library and checks the real LibreOffice render. Use for any presentation, slide deck, pitch, talk, lecture, seminar or report slides (презентация, доклад, слайды, выступление), plus companion talk scripts and speaker notes.
---

# Presentations that are researched, designed and verified

**Brief → research (if needed) → narrative → deck.mjs → build + QA → hand-off.** Each stage is a file in the deck folder and each is built from the one before — don't jump to slides.

Scripts are in `${CLAUDE_PLUGIN_ROOT}/scripts` (below: `$D`); run them with `node`. A deck is a folder `./deck-output/<slug>/`.

## 0. Setup (once per session)

`node $D/doctor.mjs`. If npm packages are missing, ask before running `npm ci` in `${CLAUDE_PLUGIN_ROOT}`. If LibreOffice or Poppler is missing, give the user the `brew` command from the doctor output — don't install system software yourself.

## 1. Brief → `brief.md`

Start the folder with `node $D/new.mjs "<title>" [--template file.potx]` (it never overwrites: an existing folder gets `-2`, `-3`, …). Then write `brief.md` from the message, the files, and the conversation:

- **purpose and audience** — who's in the room, what they know, what they should do or believe afterwards;
- **the one takeaway**, in a sentence;
- **setting** — presented live (sparse slides, the talk in notes), read on its own (denser, self-explanatory), or both;
- **length** — slide count or minutes (≈ 1 slide per 1–2 minutes when presented);
- **language** of the slides;
- **required content and structure** — points that must be covered, mandated slides, an imposed order;
- **sources and citations** — supplied material, whether to research, the citation style;
- **deliverables** — `.pptx`, PDF, speaker notes, a talk script, a handout;
- **style source** (section 2).

Explicit requirements are hard constraints: put limits into `deck.meta` (`maxSlides`, `language`) so the build enforces them. Ask only what blocks you; otherwise choose, write the assumption into `brief.md`, and mention it at hand-off.

## 2. Style — where it comes from

Use the first that applies, and combine where they don't conflict:

1. **Explicit requirements** — brand colours, fonts, "no photos", "dark background".
2. **A template file** (.potx/.pptx) → `meta.template`. Its master, logo, rules and slide numbers stay; content goes in the area it leaves free.
3. **Example decks** — `node $D/style.mjs example.pptx` prints the palette, fonts and type sizes with a `deck.meta` snippet. For PDFs or screenshots of slides, open them and pick the palette and fonts by eye. Take structure from examples too: how dense, how slides are titled, how sources are shown.
4. **Context** — the organisation's brand, the topic (a country's flag, a company's colours, an era), the venue.
5. **Default** — the `editorial` theme with a palette chosen for the topic.

Write the decision in one line in `brief.md`.

## 3. Presets

Conventions for a kind of presentation live in `references/presets/`. Load a preset only when the context matches; the user's own requirements still override it.

- `university-ru.md` — Russian university reports and seminars: assignments (ТЗ), ГОСТ bibliography, legal and scholarly sources, a talk text, the questions slide, university templates.

For other kinds (a pitch, a conference talk, a lecture, an internal update) follow this file. If the user shows past decks, extract their conventions the way section 2 does and follow those.

## 4. Research → `sources.md`

Only as much as the brief needs. Supplied material comes first; research beyond it only if asked or if the brief can't be met without it.

- Primary sources for facts; search engines to find them. WebFetch summarises pages — quote only text you read in full.
- A figure = value + period + source. Your own calculations are marked as such. Check currency (current office-holders, latest data year) against today's date, not memory.
- Number sources and cite them as `[n]` on slides.
- Pictures: the user's own, or Wikimedia Commons — `node $D/commons.mjs <deck>/img --search "…"`, then `node $D/commons.mjs <deck>/img key="File:…"`; credits go to `img/credits.json`.

Large topics: put the facts, grouped by the brief's points, in `raw_data.md` before writing slides.

## 5. Narrative

Plan one line per slide before writing code: **title as a statement** (not a label), the one idea, the visual that carries it. Build an arc: context → problem or question → evidence → what it means → what to do. Use the density the setting needs, not a one-idea-per-slide dogma. If the deck will be presented, write the talk into each slide's `notes` (and a separate script if asked).

## 6. Write `deck.mjs`

**Read `references/api.md` first** — every component and option is there. Design rules:

- Every content slide has a visual element — figures, bars, a chart, a table, a timeline, a photo, cards — and the layout varies from slide to slide. Avoid repeating the same card grid.
- Large figures for the numbers that matter; a source line on every slide that states facts; notes on every content slide.
- Charts and tables stay native and editable. Never flatten slides into images.
- Never pass a size below a role's minimum. If it doesn't fit: cut, split, or restructure.

## 7. Build and check

```bash
node $D/build.mjs deck-output/<slug>      # add --pdf for a PDF copy
```

The build lays out every slide, writes the PPTX, renders it through LibreOffice and runs QA. Exit code 1 means problems.

1. **Layout problems** come first, with the slide number and what to do («stack needs 4.39 in but the box is 4.12 in»). Fix them in `deck.mjs` — never by going below a minimum size.
2. **QA errors** come from the actual render: text outside its box, words broken mid-word, text colliding with other text or a template's logo or slide number, tiny text, missing notes, empty placeholders, broken font names.
3. Then **look**: open `qa/sheet.jpg` and every PNG listed under «Slides to look at» in `qa/report.md`. Judge balance, empty holes, repetition, whether each visual carries its slide's idea.
4. Rebuild until the build reports no problems and QA no errors. Warnings get a judgement call and a mention at hand-off.

Never claim you looked at slides you didn't open.

## 8. Hand-off

In the reply:
- the slide list, one line per slide;
- where the style came from;
- QA status: what was fixed, which warnings remain and why;
- what to check by hand — fresh figures, fonts that aren't installed (QA lists them), anything you assumed;
- data you couldn't confirm.

Don't commit unless asked.
