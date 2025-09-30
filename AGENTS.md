# Repository Guidelines

## Project Structure & Module Organization
- `cli/go/`: Go CLI sources in `cmd/prompd`; keep `_test.go` beside implementations.
- `cli/python/`: Installable Python package with `.pdpkg` fixtures and pytest suites in `cli/python/tests`.
- `cli/npm/`: TypeScript CLI in `src/`, compiled to `dist/`, executable shim under `bin/`.
- `examples/` + root `.prmd` bundles: canonical prompt references for integration and packaging checks.
- `vscode-extension/`: VS Code tooling aligned with prompt bundles; update alongside CLI changes.

## Build, Test, and Development Commands
- `cd cli/go && go build -o prompd ./cmd/prompd`: build Go binary for local/manual testing.
- `./build.sh`: emit cross-platform artifacts to `dist/`.
- `pip install -e "cli/python/[dev]"`: install editable Python CLI with dev tooling.
- `python -m pytest cli/python/tests`: run Python suite; append `--cov=prompd` after core edits.
- `cd cli/npm && npm install && npm run build`: compile Node CLI; follow with `npm test` for Jest specs.

## Coding Style & Naming Conventions
- Python: 4-space indent, run `black --line-length 100` and `ruff check`; modules stay snake_case.
- Go: format with `gofmt`, keep package names concise, commands under `cmd/prompd`.
- TypeScript: camelCase functions, PascalCase classes, document exports; keep `dist/` lint-clean.
- Prompt bundles: kebab-case filenames ending in `.prmd` or `.pdpkg`.

## Testing Guidelines
- Co-locate tests (`test_*.py`, `_test.go`, `*.test.ts`) with targets and fixtures.
- `python cli/python/run_tests.py`: smoke validates CLI interactions.
- `go test ./...` plus `go vet ./...`: mandatory before shipping parser/registry changes.
- `npm test -- --coverage`: capture metrics after TypeScript updates.
- `python test_all_production.py` and `validate_production_prompts.py`: required before packaging prompts.

## Commit & Pull Request Guidelines
- Write imperative, scoped commit subjects (e.g., “Add prompt validation smoke tests”).
- In PRs, spell out affected CLIs, manual test commands, linked issues, and UX diffs.
- Update docs, examples, or bundles with code changes; call out new binaries or scripts.
- Verify all relevant build/test commands locally and flag follow-up work when needed.
