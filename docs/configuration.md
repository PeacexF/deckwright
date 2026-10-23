# Configuration

## Requirements

claude-deck targets macOS (Apple Silicon).

| Tool | Used for | Install |
| --- | --- | --- |
| Node.js 20+ | everything | `brew install node` |
| LibreOffice | PPTX → PDF, HTML → ODT; the reference renderer | `brew install --cask libreoffice` |
| Poppler (`pdftoppm`, `pdftotext`, `pdfinfo`) | page images, rendered text positions for QA | `brew install poppler` |

npm packages (installed by `npm ci`): `pptxgenjs`, `pptx-automizer` (university templates), `sharp` (images, contact sheets), `fontkit` (text measurement), `jszip`.

## Setup

```bash
npm ci            # install pinned dependencies
npm run doctor    # check tools, packages and fonts
npm test          # render a smoke deck end to end
```

## Environment variables

| Variable | Effect |
| --- | --- |
| `SOFFICE` | Path to the `soffice` binary. By default it's looked up on `PATH`, then inside `/Applications/LibreOffice.app`. |

## Notes

- Every LibreOffice conversion runs with its own temporary profile, so it works while the LibreOffice app is open.
- HTML is imported with the Writer filter; otherwise LibreOffice saves a Writer/Web document instead of a real ODT.
- Rendering differs between LibreOffice, PowerPoint and Keynote. Decks are checked against LibreOffice only.
- `npm audit` reports a denial-of-service advisory in `image-size` (a pptxgenjs dependency) for JXL, HEIF and ICNS files. Images are normalised to JPEG/PNG with `sharp` before they reach pptxgenjs.
