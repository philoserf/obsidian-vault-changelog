# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that maintains a changelog of recently edited notes. The changelog file is **fully overwritten** on every update — no history is preserved.

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

The plugin has an intentional split between pure logic and Obsidian integration:

- `src/changelog.ts` — **pure functions** (`filterAndSort`, `renderChangelog`, `normalizeLoadedSettings`, the per-field rules `coerceChangelogPath`, `coerceDatetimeFormat`, `coerceExcludedFolders` and `clampMaxRecentFiles`, plus `isPluginGeneratedChangelog` and `validateExcludedFolder`) with no Obsidian imports. All unit tests target this file. `renderChangelog` is the one render entry point: it takes the whole `ChangelogSettings` rather than six fields positionally, and calls `filterAndSort` itself. Obsidian is kept out by injection — a `TimeFormatter` callback so tests don't need `window.moment`, a `LinkTextResolver` (production passes `MetadataCache.fileToLinktext`), and an injected path normalizer for `normalizeLoadedSettings`.
- `src/main.ts` — `ChangelogPlugin` extends `Plugin`. Wires up the command, vault event handlers (`modify`/`delete`/`rename`), and I/O. Auto-update uses a 200 ms **trailing-edge** `debounce` (the `resetTimer` argument is passed explicitly, since it defaults to false and would otherwise throttle) and skips edits to the changelog file itself (avoids self-triggering loops). `onunload` cancels the pending timer; `registerEvent` handles the listeners.
- `src/settings.ts` — `ChangelogSettingsTab` + `PathSuggest`. The tab never assigns into `plugin.settings`; every change goes through `plugin.updateSettings(patch)`, and handlers read `this.plugin.settings` at event time rather than closing over a binding captured in `display()` — `updateSettings` replaces the settings object, so such a binding goes stale on the first edit. `PathSuggest` offers **folders only**, for both the changelog-path and excluded-folder fields: completing the changelog path to an existing note is one click away from overwriting it, and an excluded _folder_ is never a file. Suggestions are cached per suggester instance to avoid per-keystroke scanning.

### Settings persistence quirks

Settings arrive from two trust boundaries — `data.json` at load and the settings tab at edit time — and **every rule with a choice in it is one exported function that both boundaries call.** That is the invariant to preserve when adding a setting; a rule implemented once in the loader and once in an event handler is how the two drifted apart before 1.7.0.

Each rule takes a trailing `fallback`. `normalizeLoadedSettings` omits it, because at load there is no prior value, so a rejected value becomes the default. The settings tab passes the value the plugin is currently running on, so a typo reverts rather than resetting the setting. The one deliberate exception is `coerceDatetimeFormat`, which the tab also calls without a fallback: clearing that field is its only reset-to-default affordance.

The rules are `coerceChangelogPath` (must end `.md`, normalized), `coerceDatetimeFormat` (an empty format is not a format — `moment().format("")` silently yields ISO-8601), `coerceExcludedFolders` (normalize, then run each entry through `validateExcludedFolder` against the accumulating result, which drops root markers and duplicates in one pass) and `clampMaxRecentFiles` (floor, clamp to `[1, MAX_RECENT_FILES=500]`; note only _non-numeric_ input takes the fallback — an out-of-range number still clamps).

`normalizeLoadedSettings` is then one rule call per field. Unknown keys cannot survive it and no filter enforces that: the result is built as an object literal reading each field by name, never spread from the persisted data, which is also what makes it immune to a `__proto__` key. `changelogHeading` is trimmed inline; the booleans have no rule a typed toggle could get wrong.

**Rules run once per edit.** The handler coerces, compares the result against its input to decide whether to show a `Notice`, and hands the coerced value to `updateSettings`, which stores it without re-validating. Do not add a defensive re-validation in `updateSettings` — that reintroduces a double-run where the two call sites can disagree about which result was stored.

### Writing the changelog

`updateChangelog` does the whole write, and two behaviors in it are load-bearing.

It tolerates a TOCTOU race: if `vault.create` throws because a concurrent event created the file, it falls back to `getAbstractFileByPath` rather than erroring, attaching the original error as `cause`. Preserve this when editing.

It also refuses to overwrite a file that does not look plugin-generated, via `isPluginGeneratedChangelog`. The plugin replaces the file at `changelogPath` wholesale and every note in the vault satisfies the only other check (`.md`), so that predicate is what enforces the ownership invariant. Note its deliberate tolerance: the heading slot accepts _whatever_ heading is currently in the file, so changing `changelogHeading` cannot lock the plugin out of the changelog it wrote.

### Build system

- `build.ts` uses Bun's native bundler; entry `src/main.ts` → `./main.js` (CommonJS, minified in production).
- `obsidian` and `electron` are marked external — never bundle them.
- Watch mode (`bun run dev`) skips rebuilds when only test files change.
- **`main.js` is committed** — Obsidian ships the committed bundle. CI runs `bun run build` then `git diff --exit-code main.js`, so any change to `src/` or to dependencies must be followed by a rebuild and a commit of `main.js` or the PR fails. Bun is deliberately unpinned in CI, so a bundler-output shift trips the same check; the fix is the same.
- `tsconfig.json` includes the tests, so `bun run typecheck` covers them. This matters because the pure layer's `ChangelogFile` is structural rather than nominal — a fixture drifting from the real shape is exactly the error only the compiler catches.

## Release Process

Run the `release-gate` skill, then the `release-ship` skill — **do not tag by hand**, and do not work through ship's phases manually even though they are readable shell. `release-ship` is **user-invoked only**: when the gate says a release is ready, say so and stop.

Tags are bare semver (`1.7.0`, no `v` prefix) and point at the merged commit of a `release/<version>` prep PR, never at a branch head. `.github/workflows/release.yml` triggers on that tag and publishes `main.js`, `manifest.json` and `styles.css` with build provenance — so the tag is what publishes, which is exactly why it is not a thing to push by hand.

The prep PR carries the version bump, the `CHANGELOG.md` section and the regenerated narrative documents **together**. Splitting the docs into their own PR makes the gate's walkthrough-staleness row fail, correctly: that row asks whether the document moved with the code.

## Code Style

Biome is the single source of truth (2-space indent, organized imports). Run `bun run lint:fix` before committing. Target Bun as the runtime; use `bunx`/`bun run`/`bun install`, never npm or yarn.
