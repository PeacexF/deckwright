# deckwright

A Claude Code plugin that makes presentations worth presenting. From a brief, your notes, documents or data — or a formal assignment — it researches what's needed, plans the narrative, and builds an editable `.pptx`: in its own design, on your `.potx` template, or in the style of decks you show it. Then it renders the deck through LibreOffice and checks what actually came out.

- **Measured layout.** Every text block is measured with the real font before it's placed. A slide that doesn't fit is reported with its number and by how much; nothing is silently shrunk or clipped.
- **Enforced readability.** Every text role has a minimum size, and the build fails below it.
- **QA on the render.** Text outside its box, words broken mid-word, text colliding with a template's logo or slide number, tiny text, substituted fonts, missing notes — found on the LibreOffice render, with a contact sheet to review.
- **Style from your context.** Explicit requirements, a template, example decks (`style.mjs` reads their palette and fonts), your brand or the topic — in that order. Templates stay intact: master, logo, rules and slide numbers keep their place.
- **Presets, not hardcoding.** Conventions for a kind of presentation — say, Russian university reports with ГОСТ citations — live in preset files the skill loads only when the context calls for them.

## Install

```bash
git clone https://github.com/PeacexF/deckwright && cd deckwright
npm ci && npm run doctor     # needs LibreOffice and Poppler: brew install --cask libreoffice; brew install poppler
claude --plugin-dir .        # or: /plugin marketplace add PeacexF/deckwright, then /plugin install deckwright@deckwright
```

## Use

Ask for a presentation and say what it's for. Attach a template, an example deck, a brief or source documents if you have them. Decks are built in `./deck-output/<topic>/`.

See [docs/architecture.md](docs/architecture.md) for how it works and [docs/configuration.md](docs/configuration.md) for setup details.
