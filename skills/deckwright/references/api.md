# Deck script API

A deck is one file, `deck-output/<slug>/deck.mjs`. It imports nothing — the library is passed in:

```js
export default (deck) => {
  deck.meta({ title: "Mongolia", language: "en-US", palette: { primary: "0F3D73", accent: "C4272F" }, slides: 18 });
  deck.cover({ kicker: "Country report · Asia", title: "Mongolia", photo: "herd", stats: [...] });
  deck.slide({ section: "4 · Economy", title: "A resource economy growing on copper and coal", source: "Sources: …", notes: "…" }, (s, body) => {
    const [l, r] = body.cols([7, 5]);
    s.stack(l, [s.kpis([...]), s.bars([...])]);
    s.place(r, s.photo("camels", { grow: true, caption: "…" }));
  });
  deck.sources({ groups: [{ title: "Data", entries: ["…"] }] });
  deck.closing({ kicker: "Takeaway", title: "…", points: [{ title: "…", text: "…" }] });
};
```

Units are inches; font sizes are points. The slide is 13.33 × 7.5 in (or the template's size).

## Deck

| Call | Options |
|---|---|
| `deck.meta(o)` | `title`, `short` (running header), `file` (PPTX name), `theme` (`"editorial"`), `palette` `{ primary, accent, ink, muted, … }`, `fonts` `{ heading, body }`, `template` (path to .potx/.pptx in the deck folder), `language` (`"en-US"` default; sets the slide text language, number formatting and the few words the library writes itself), `strings` (override those words: `sources`, `credits`, `thanks`, `conclusions`, `photo`, `noAuthor`, `noLicense`), `slides` (planned count — checked), `maxSlides` (ТЗ limit — checked), `uncredited` (image keys that are the user's own) |
| `deck.cover(o)` | `kicker`, `title`, `subtitle`, `photo` (image key), `fy` (photo focal point 0..1), `photoHeight`, `stats` (KPI items), `presenter`, `photoCaption`, `blank: true` (template: leave the title slide for the user), `notes` |
| `deck.slide(o, fn)` | `title` (a statement), `section` (running header, free design), `source` (footer line), `notes` (required); `fn(s, body)` lays out the body |
| `deck.sources(o)` | `title` (default from `language`: «Sources» / «Источники»), `groups: [{ title, entries: [...] }]` (numbered, numbering runs on), `credits` (image credits appended, default true), `columns` (2), `size` (≥ 10), `start` (first number, for a second bibliography slide), `notes` |
| `deck.closing(o)` | `kicker`, `title`, `points: [{ title, text }]`, `columns` (2), `thanks` (text or `false`), `notes`. On a template: the thank-you goes on the title layout; with `points` it becomes a content slide titled with `strings.conclusions` |

## Boxes

`body` and every region are `Box` objects: `x, y, w, h, x2, y2`.

| Method | Returns |
|---|---|
| `b.cols(n \| [ratios], gap = 0.4)` | boxes side by side: `body.cols([7, 5])` |
| `b.rows(n \| [ratios], gap = 0.3)` | boxes stacked |
| `b.top(h, gap)` | `[top part, rest]` |
| `b.bottom(h, gap)` | `[rest, bottom part]` |
| `b.left(w, gap)` / `b.right(w, gap)` | `[left, rest]` / `[rest, right]` |
| `b.inset(t, r, b, l)` | shrunk box |
| `b.with({ y, h, … })` | copy with changes |

## Placing

| Call | Does |
|---|---|
| `s.place(box, comp, { valign })` | one component at the top (`"middle"`, `"bottom"`) of box. Returns the box it used |
| `s.stack(box, [comps], { gap = 0.3, align })` | vertical stack; components with `grow` share the leftover height; `align`: `"top"`, `"middle"`, `"bottom"`, `"spread"` |
| `s.row(box, [comps], { gap = 0.3, widths, valign })` | side by side; cards stretch to the tallest |
| `s.rect(box, fill)`, `s.line(x1, y1, x2, y2, color, width)` | raw shapes |

Fill what's left after a block: `const used = s.place(body, s.table(…)); s.row(body.with({ y: used.y2 + 0.25, h: body.y2 - used.y2 - 0.25 }), […])`.

Everything is measured before it's placed. When content doesn't fit, the build reports it with the slide number and by how much — it is never silently shrunk or clipped.

## Components

| Component | Options |
|---|---|
| `s.text(content, o)` | content: string (one paragraph per line), list of strings, or `{ text \| runs: [{ text, bold, italic, color }], role, bullet, align, color }`. `o`: `role` (default `body`), `align`, `color`, `bold`, `italic`, `size`, `fit` (shrink to the box, not below the role minimum), `oneLine` (shrink to one line), `spaceAfter` (pt) |
| `s.bullets(items, o)` | real bullets; same options as text |
| `s.label(str)` | small caps heading over a block |
| `s.kpis([{ value, label, color }], { size, gap })` | big figures in columns; values never wrap — the build says so if one can't fit |
| `s.card({ label, title, text, fill, accent, dark }, { role, pad })` | panel; `fill`: palette name or hex, `"none"` for no panel; `accent`: coloured bar on the left; dark fills (`primary`, `ink`) switch to light text |
| `s.photo(key, o)` | image `img/<key>.*`; `h` or `aspect` or natural ratio; `grow: true` fills the leftover height; `fit: "contain"` (flags, maps) or cover-crop with focal point `fx`, `fy`; `caption` |
| `s.bars([{ label, value, color }], o)` | horizontal bars drawn as shapes: `max`, `decimals`, `unit` (`" %"`), `labelWidth` (share, 0.32), `valueWidth`, `rowGap`, `color` |
| `s.stacked([{ label, value, color }], o)` | one 100 % bar with a legend: `decimals`, `unit`, `legendColumns` |
| `s.timeline([{ date, title, text, highlight }], { gap })` | horizontal timeline; `highlight` uses the accent |
| `s.numbered([{ title, text }], o)` | large numbers: `columns` (1–2), `start`, `gap`, `titleRole` (`lead` for big items), `role` |
| `s.table(rows, o)` | native table; `rows[0]` is the header unless `head: false`; `columns` (width ratios), `align` per column, `zebra`; cells: string or `{ text, bold, color, fill, align }` |
| `s.chart(type, data, o)` | native editable chart: `bar`, `column`, `line`, `pie`, `doughnut`; data `[{ name, labels, values }]`; `h` (else grows), `decimals`/`format`, `colors`, `legend`, `valueAxis` |
| `s.quote(text, { author })` | pull quote with a coloured bar |
| `s.rule()`, `s.spacer(h)` | hairline, gap |
| `s.bibliography(entries, { start, size })` | numbered references with literal numbers (LibreOffice ignores autonumber start values) |

## Text roles and minimums

| Role | Size | Minimum | Use |
|---|---|---|---|
| `title` | 30 | 24 | slide title (chrome) |
| `lead` | 18 | 16 | intro line, big list items |
| `body` | 15 | 14 | default text |
| `small` | 13 | 12 | card text, bars, legends |
| `cardTitle` | 15 bold | 13 | card and list titles |
| `kpi` / `kpiLabel` | 30 / 12 | 22 / 11 | figures and their labels |
| `label` | 11 caps | 10 | block headings |
| `caption` | 11 italic | 10 | photo captions |
| `source`, `bibliography` | 10 / 11 | 10 | sources line, references |
| `quote`, `number`, `tableHead`, `tableBody` | 22, 22, 13, 13 | 18, 16, 12, 12 | |

Passing `size` below a role's minimum is reported as a build problem.

## Colours

To match an example deck: `node $D/style.mjs example.pptx` prints its palette and fonts as a `deck.meta` snippet.


Palette names: `primary`, `accent`, `ink`, `muted`, `bg`, `onPrimary`, and derived tints `rule`, `track`, `tint`, `onPrimaryMuted`. Any `RRGGBB` hex also works.

## Images

Put files in `img/`; the key is the file name without extension. Every image used needs a credit in `img/credits.json` (`commons.mjs` writes it) or its key in `meta.uncredited`. The sources slide lists the credits automatically.

## Fixing build problems

| Problem | Fix |
|---|---|
| `stack needs X but the box is Y` | cut text, drop an item, use `columns: 2`, or split the slide |
| `word too long for its line` | the column is too narrow for a long word — widen it or use a table |
| `doesn't fit on one line` (KPI) | shorter value (move the unit to the label) or fewer KPIs per row |
| `reaches into the template's … area` | content left `s.body`; keep it inside |
| `title needs X but the template's title box is Y` | shorten the title |
| `sources need more room` | more `columns`, shorter entries, or a second `deck.sources({ start })` |
| `no speaker notes` | add `notes` |
