# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that maintains a changelog of recently edited notes. The changelog file is **fully overwritten** on every update — no history is preserved.

**Version history is not linear.** 1.8.0 ships 1.5.4's plugin code under a higher version number. 1.6.0 and 1.7.0 were withdrawn — the file-ownership guard they introduced failed in both directions — and their code was reverted off `main`; 1.8.0's number exists only so an update reaches anyone left on 1.6.0. Do not resume that work without reading [#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250), which records why it failed. `CHANGELOG.md` marks both releases withdrawn in place.

The current next step for this repo is tracked in the workspace backlog at `../NEXT.md` (the `obsidian-vault-changelog` row). Read it when starting work; update it when that step ships.

`THEORY.md` (design rationale and invariants) and `WALKTHROUGH.md` (linear code tour) are tracked and go deeper than this file. `.issues/` is untracked scratch output from the review skills — a backlog of candidate issues, not decisions.

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # typecheck + biome check
bun run typecheck        # tsc --noEmit
bun run lint:fix         # Auto-fix lint and format
bun run audit            # bun audit --audit-level=critical (also gates CI)
bun run version          # Sync package.json version → manifest.json + versions.json
bun test                 # Run all tests
bun test src/changelog.test.ts         # Run a single test file
bun test -t "pattern"                  # Run tests matching a name pattern
bun run deploy           # Copy main.js/manifest.json/styles.css into a local vault
```

`bun run deploy` requires `OBSIDIAN_DEPLOY_DEST` (the plugin folder inside the target vault), set in the gitignored `.env.local`.

`bun run version` reads `npm_package_version`, so it only works when invoked through `bun run` after bumping `package.json`.

## Architecture

The plugin splits pure logic from Obsidian integration, and that boundary is the one thing to protect.

- `src/changelog.ts` — **pure functions**: `filterAndSort`, `generateChangelog`, `normalizeLoadedSettings`, `clampMaxRecentFiles`, `isValidChangelogPath`, `validateExcludedFolder`. The file has **no imports at all** — not Obsidian, not `moment`. All 30 tests target it. Obsidian is kept out by injection in exactly two places: a `TimeFormatter` callback (production closes over `window.moment`; tests pass the npm `moment` package, which is why it is a devDependency and never ships) and a path normalizer passed into `normalizeLoadedSettings`. `ChangelogFile` is a structural interface of the three fields the core reads — `path`, `basename`, `stat.mtime` — so a real `TFile` satisfies it and so does an object literal. Nothing is mocked anywhere.
- `src/main.ts` — `ChangelogPlugin` extends `Plugin`. Wires the command, three vault handlers, and all I/O. **No tests, by construction.**
- `src/settings.ts` — `ChangelogSettingsTab` + `PathSuggest`. `PathSuggest` offers folders **and every markdown file in the vault**, and serves both the changelog-path and excluded-folder fields; suggestions are cached per suggester instance to avoid per-keystroke scanning. **No tests, by construction.**

When you add behaviour, "can this live in `changelog.ts`?" is the design question. A rule that ends up in an event handler is a rule no test will ever reach.

### Rendering

`updateChangelog` calls `filterAndSort` and then `generateChangelog` — two calls, nine arguments, and **an ordering contract the caller must honour**: `generateChangelog` formats whatever list it is handed and filters nothing itself. A new setting that affects output means widening a signature at both the definition and this call site.

`filterAndSort` appends a separator before prefix-matching an excluded folder (`folder.endsWith("/") ? folder : folder + "/"`). Without it, excluding `Notes` would also exclude `Notes2/` and `Notebook/`. The suite pins that case; keep it.

### Settings persistence

Settings arrive from two trust boundaries — `data.json` at load, the settings tab at edit time — and **only `clampMaxRecentFiles` is shared between them.** Its doc comment says so. Every other field is validated in one place or in two places that disagree:

| Field              | Settings tab                 | Loader                                             |
| ------------------ | ---------------------------- | -------------------------------------------------- |
| `changelogPath`    | must end `.md`, else reverts | no extension check                                 |
| `datetimeFormat`   | empty replaced by default    | empty kept (`moment().format("")` yields ISO-8601) |
| `excludedFolders`  | root markers rejected        | no per-element check                               |
| `maxRecentFiles`   | `clampMaxRecentFiles`        | `clampMaxRecentFiles`                              |
| `changelogHeading` | `.trim()` inline             | `.trim()` inline, separately                       |

So a persisted value can be one the settings tab would refuse to display. Adding an eighth setting will acquire the same split unless you put its rule in `changelog.ts` and call it from both sides.

`normalizeLoadedSettings` filters persisted data through a `knownKeys` Set, spreads it over the defaults, then walks the result three more times restoring defaults where the runtime type is wrong. Two consequences to preserve: the filter running **before** the spread is what keeps a `__proto__` key out of the result, and it is also what drops settings that were renamed or removed. The two `as const` key tuples are maintained **by hand** — add a setting, forget to list it, and nothing fails.

The settings tab assigns directly into `plugin.settings` and then calls `saveSettingsSafely()`. There are eight such pairs. The assignment has already happened when the write is attempted and nothing restores it on failure, so a failed save leaves memory and disk diverged until the next restart.

### Writing the changelog

`writeToFile` tolerates a TOCTOU race: if `vault.create` throws because a concurrent event created the file, it falls back to `getAbstractFileByPath` rather than erroring. Preserve this.

**It does not check what it is about to destroy.** `changelogPath` is free text naming any note in the vault, the only validation is `isValidChangelogPath` — a `.md` suffix test that every note satisfies — and `vault.modify` then replaces the whole file. `PathSuggest` offers existing notes as completions for that field. A guard for this was attempted in 1.6.0 and withdrawn; see [#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250) before reaching for it again.

### Events

All three vault events — `modify`, `delete`, `rename` — share one handler, gated on `autoUpdate` and routed through a 200 ms `debounce`. Two details are easy to misread:

- The `debounce` call **omits `resetTimer`**, which defaults to `false`. The function is therefore a throttle: it fires 200 ms into a burst and repeats, rather than once after editing stops.
- `rename` receives an `oldPath` that this handler discards. That argument is the only value capable of telling the plugin its own changelog has moved, so renaming the changelog leaves `changelogPath` stale.

`onunload` is empty. `registerEvent` releases the listeners; an in-flight debounce is not its business.

### Build system

- `build.ts` uses Bun's native bundler; entry `src/main.ts` → `./main.js` (CommonJS, minified in production).
- `obsidian` and `electron` are marked external — never bundle them.
- Watch mode (`bun run dev`) skips rebuilds when only test files change.
- **`main.js` is committed** — Obsidian ships the committed bundle. CI runs `bun run build` then `git diff --exit-code main.js`, so any change to `src/` or to dependencies must be followed by a rebuild and a commit of `main.js` or the PR fails. Bun is deliberately unpinned in CI, so a bundler-output shift trips the same check — differing minified identifier names are enough — and the fix is the same: rebuild and commit.
- `tsconfig.json` includes the tests, so `bun run typecheck` covers them. This matters because `ChangelogFile` is structural rather than nominal — a fixture drifting from the real shape is exactly the error only the compiler catches.

## Release Process

Run the `release-gate` skill, then the `release-ship` skill — **do not tag by hand**, and do not work through ship's phases manually even though they are readable shell. `release-ship` is **user-invoked only**: when the gate says a release is ready, say so and stop.

Tags are bare semver (`1.8.0`, no `v` prefix) and point at the merged commit of a `release/<version>` prep PR, never at a branch head. `.github/workflows/release.yml` triggers on that tag and publishes `main.js`, `manifest.json` and `styles.css` with build provenance — so the tag is what publishes, which is exactly why it is not a thing to push by hand.

The prep PR carries the version bump, the `CHANGELOG.md` section and the regenerated narrative documents **together**. Splitting the docs into their own PR makes the gate's walkthrough-staleness row fail, correctly: that row asks whether the document moved with the code.

## Code Style

Biome is the single source of truth (2-space indent, organized imports). Run `bun run lint:fix` before committing. Target Bun as the runtime; use `bunx`/`bun run`/`bun install`, never npm or yarn.
