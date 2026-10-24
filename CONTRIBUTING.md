# Contributing

> Thanks for your interest in contributing to **deckwright**.

Contributions of all kinds are welcome — bug fixes, improvements, documentation, ideas, and new features.

## Getting Started

1. Fork the repository.
2. Create a branch for your change.
3. Make your changes.
4. Run the tests and checks.
5. Open a pull request describing what you changed and why.

## Development

Prerequisites are in [docs/configuration.md](docs/configuration.md).

```bash
npm ci                 # install pinned dependencies
npm run doctor         # check LibreOffice, Poppler, packages and fonts
npm run lint           # ESLint
npm run format         # Prettier (CI runs format:check)
npm run test:unit      # fast tests, no LibreOffice needed
npm run test:e2e       # renders through LibreOffice and Poppler
npm test               # both
```

CI runs on every push and pull request:

- **CI** — lint, Prettier and actionlint; unit tests on Node 22, 24 and 26; end-to-end render on macOS (renders uploaded as an artifact); `claude plugin validate --strict` once a plugin manifest exists.
- **Security** — `npm audit` and registry signature checks, dependency review on pull requests, CodeQL, and a gitleaks secret scan. Also runs weekly.
- **Dependabot** — weekly npm and GitHub Actions updates, held back until a release is a week old.

Actions are pinned to commit SHAs; Dependabot keeps them current.

## What You Can Contribute

Some good ways to contribute include:

* Bug fixes
* New features
* Integrations
* Tests
* Documentation
* Performance improvements
* Refactoring
* Bug reports and suggestions

Please keep changes focused and follow the existing code style and project structure.

## Pull Requests

Keep pull requests clear and focused. Please explain **what changed and why** and include relevant tests when possible.

For larger changes, opening an issue first is recommended so the approach can be discussed before implementation.

Thanks for helping improve the project.
