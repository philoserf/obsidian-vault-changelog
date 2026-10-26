# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that keeps a note listing the vault's recently edited notes. It is in maintenance mode: bug fixes and changes users ask for, no new features otherwise. Bun-only toolchain: Bun runs the tests, bundles `src/main.ts` into the committed `main.js` (`bun build`, invoked from `package.json`), and copies the build into a vault (`deploy.ts`).

`THEORY.md` explains why the code is shaped the way it is; `WALKTHROUGH.md` is a linear read of every module. Start from them for intent rather than re-deriving it, but they are brought current only at release time, so check a claim against the source before relying on it.

## Commands

```bash
bun test                        # all tests
bun test -t "rename"            # tests whose describe+test name matches
bun run check                   # typecheck + biome + bun fmt --check on **/*.md
bun run lint:fix                # biome check --write (Markdown: bun run format)
bun run build                   # check, then bundle to main.js
bun run dev                     # watch-mode rebuild, no check, sourcemaps
bun run deploy                  # build, then copy main.js/manifest.json into a vault
bun run version                 # sync package.json's version into manifest.json + versions.json
```

## Architecture

`src/changelog.ts` is pure — settings rules, loading, event rules, rendering — and imports nothing. `src/main.ts` (the plugin: events, the write queue, the write path) and `src/settings.ts` (the declarative settings tab) do the I/O and call into it. `src/changelog.test.ts` tests `changelog.ts` only; `src/fixtures/1.8.0.json` holds changelogs 1.8.0 actually wrote, replayed by the tests. `main.ts` and `settings.ts` cannot run outside Obsidian and are verified by hand, in a vault — moving a decision into `changelog.ts` is how it becomes testable.

The tests load the npm `moment` package (a devDependency standing in for Obsidian's `window.moment`) with a dynamic `import()`. A static import is forbidden by the community lint, because in shipped code it would bundle a second copy of moment.

## Gotchas

- **`main.js` is committed, and nothing automated checks it.** Any source change — or a dependency bump, or a Bun release that shifts bundler output — must be followed by `bun run build` and a commit of `main.js`; `git diff --exit-code main.js` after a build should be clean. `bun run dev` writes an unminified, sourcemapped `main.js`, so run `bun run build` before committing.
- **No `console.log` in any TypeScript file, dev scripts included.** The community site's scanner reads every `.ts` file in the repository and flags `console.log` (#272). `console.error` is not flagged. `version-bump.ts` throws on every failure, so silence means success.
- **`bun run typecheck` is `bun --check`, not `bun check`:** the bare subcommand runs this package's own `check` script, which calls `typecheck` and would loop. `tsconfig.json`'s `include` and Biome's `files.includes` are explicit lists, so a new top-level `.ts` file must be added to both.
- `bun run deploy` requires `OBSIDIAN_DEPLOY_DEST` (path to the plugin folder inside a vault), and creates the folder if it is missing. See `.env.local.example`; Bun loads `.env.local` when it runs `deploy.ts`. It runs `build` first, so it refuses to deploy when `check` fails.
- If issue descriptions (line numbers, function names, code structure) don't match the current codebase, stop and flag the discrepancy before proceeding with a fix.

## Release process

Use the `release-gate` then `release-ship` skills — do not tag by hand. Tags are bare semver (no `v` prefix) and must agree with `package.json`, `manifest.json` and `versions.json`. A release carries `main.js` and `manifest.json`; there is no `styles.css`. `versions.json` maps each version to its `minAppVersion` and is append-only.
