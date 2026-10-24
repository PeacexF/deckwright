# Preset: Russian university reports and seminars

Load when the user asks for a доклад, презентация к семинару, групповая преза, or gives a ТЗ or a university template. Everything here is a default; the ТЗ and the user's words override it.

Set `deck.meta({ language: "ru-RU" })`. Write slides, notes and texts in plain spoken Russian.

## The ТЗ

Write into `brief.md`:

- the topic and **required points** — each becomes a section of `raw_data.md` and at least one slide;
- the slide limit and what counts toward it (title, bibliography, questions, conclusion) → `maxSlides`;
- who makes the title slide — «титульник сам сделаю» means `deck.cover({ blank: true })`;
- source types for the bibliography (laws, scholarly articles, statistics, websites);
- solo or group (who presents which slides), and the time limit;
- the university template (.potx/.pptx) or free design.

## Stages

**ТЗ → sources.md → raw_data.md → report.md (+ speech.md) → deck.mjs.**

### Where to look

| Topic | Where | Notes |
|---|---|---|
| Law, state bodies | КонсультантПлюс (current edition!), pravo.gov.ru, kremlin.ru | quote legal text only from a page read in full |
| Scholarly articles | CyberLeninka, publications.hse.ru, elpub | issue, pages, DOI and the author's position from the article page itself |
| Regions, countries | Росстат «Регионы России», national statistics offices, World Bank, IMF | tables with numbers |
| Economics, companies | annual reports / IFRS, ЦБ, ministries; Коммерсант / РБК for recent figures | |
| History, philosophy, sociology | БРЭ, monographs and ВАК journals, primary texts | |
| Programming | the user's code | |

### `sources.md` — ГОСТ Р 7.0.100-2018

```markdown
# Источники: <тема>
Проверено <дата>.
## Нормативные правовые акты        ← sections by the types the ТЗ asks for
1. Федеральный закон от 17.01.1992 № 2202-1 «О прокуратуре Российской Федерации» (ред. от …).
## Научные статьи
12. Фамилия И. О. Название // Журнал. 2024. № 3. С. 10–20. DOI: …
## Новости и данные (не для списка литературы)
- <what was used> — <URL>
```

Numbers run through and are cited on slides as `[n]`.

### `raw_data.md`

Facts grouped **by the ТЗ's points**, each with `[n]`; tables for comparisons; legal text close to the original; a «научные позиции» section (author → thesis) when the ТЗ asks for articles.

### `report.md` — the talk

- Split by slide: `## Заголовок (слайд N)`; read aloud, plain spoken Russian.
- About 120 words per minute of the time limit; without one, 8–10 minutes.
- Only facts from raw_data; cite authors by surname.
- Group work: `speech.md` with blocks «Участник K — слайды a–b (≈N сек)».
- No filler, no repetition between sections.

## Slides

- The bibliography goes on `deck.sources()` with the ТЗ's groups (НПА, статьи, …); if it doesn't fit at 10 pt, a second `deck.sources({ start })` slide — within the slide limit.
- «Вопросы по презентации» as the last slide when asked: a `numbered` list; the answers go in `report.md` and the slide's notes.
- University templates often name fonts that aren't installed (Gilroy at Мосполитех): QA reports it — tell the user which font to install for the intended look.

## Hand-off

In the deck folder: `brief.md`, `sources.md`, `raw_data.md`, `report.md` (+ `speech.md`), `deck.mjs`, the `.pptx`, `qa/`.
