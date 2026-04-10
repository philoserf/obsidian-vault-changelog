# A Theory of obsidian-vault-changelog

## What the system is for

This plugin answers a single question for an Obsidian user: _what have I touched recently?_ It maintains a single markdown file—the changelog—that lists the vault's most recently modified notes, sorted newest-first, with timestamps. The file is regenerated from scratch on every relevant vault event; it is never appended to. There is no history, no diffing, no journaling. The changelog is a materialized view of filesystem modification times, nothing more.

The core entities are **vault files** (which have paths, basenames, and modification timestamps), a **changelog file** (which is both output artifact and member of the vault that must be excluded from its own listing), **excluded folders** (a user-maintained deny-list), and **settings** (the configuration that governs generation). The relationships are simple: files are filtered by exclusion rules, sorted by mtime, truncated to a maximum count, and rendered into a line-per-file markdown format.

## The organizing ideas

The load-bearing architectural decision was made in v1.3.0: extract all pure logic into `changelog.ts`, which imports nothing from Obsidian. This creates a hard boundary between the Obsidian-coupled code (plugin lifecycle in `main.ts`, settings UI in `settings.ts`) and the testable core (`filterAndSort`, `generateChangelog`). The tests exercise only the pure side. This is not merely conventional separation—it is the reason the project can have tests at all, because the Obsidian API is hostile to unit testing (it requires a running app instance, DOM, and vault).

The `TimeFormatter` type injection in `generateChangelog` is a deliberate seam. The plugin passes `window.moment` at the call site; tests pass the `moment` npm package directly. This was an explicit refactor (commit 9ec35ef, PR #131) to remove the implicit dependency on a global. It is the only place where the code negotiates between the Obsidian runtime environment and a test environment.

The `ChangelogFile` interface in `changelog.ts` is a structural type with exactly three fields: `path`, `basename`, `stat.mtime`. It is not `TFile`—it is the minimal projection of `TFile` that the pure functions need. Obsidian's `TFile` satisfies it structurally, so no adapter is required. This is the central abstraction, and it is almost invisible: a three-field interface that makes the entire test story possible.

Settings are loaded with a defensive posture that reflects real-world experience with corrupt or stale persisted data. `loadSettings` strips unknown keys (protecting against schema drift between versions), normalizes paths (so that comparisons elsewhere can assume canonical form), and clamps `maxRecentFiles` with `Number.isFinite` (guarding against `NaN` from corrupted JSON). The `MAX_RECENT_FILES` cap of 500 exists to prevent performance degradation in large vaults—it is a product decision, not a technical limit.

## The seams

**Plugin ↔ Obsidian API.** The plugin extends `Plugin`, registers events via `this.registerEvent`, and uses `this.app.vault` for file operations. These are the points where Obsidian owns the lifecycle. The event handler in `onload` is the system's single entry point for reactive behavior: it listens on modify, delete, and rename, guards against the changelog triggering itself (the `file.path !== this.settings.changelogPath` check), and debounces at 200ms. The debounce is critical—without it, a burst of saves would cause a cascade of full regenerations.

**Pure logic ↔ Plugin.** `changelog.ts` exports types, constants, and two functions. It has zero imports from `obsidian`. This boundary is principled and load-bearing. If someone adds an Obsidian import to `changelog.ts`, the test story breaks.

**Settings UI ↔ Plugin.** `settings.ts` reaches back into the plugin via `this.plugin.settings` and `this.plugin.saveSettings()`. The settings tab mutates the plugin's settings object in place and then persists. There is no intermediate model, no validation layer between UI and state—the UI _is_ the validation layer. The `PathSuggest` class caches vault paths on first access to avoid scanning the vault on every keystroke, a fix from commit b50d8d5 that addressed a real performance problem.

**Build ↔ Runtime.** The build produces a single `main.js` (CJS, minified) that Obsidian loads directly. The `obsidian` and `electron` packages are externalized—Obsidian provides them at runtime. This is standard for Obsidian plugins, but it means the build output is not self-contained and cannot be tested outside the Obsidian host.

**Release.** The GitHub Actions release workflow is triggered by pushing a semver tag (not a `v`-prefixed tag—the regex is `[0-9]+.[0-9]+.[0-9]+`). It runs tests and build, then creates a GitHub release with three artifacts (`main.js`, `styles.css`, `manifest.json`). The `versions.json` file maps plugin versions to minimum Obsidian versions, which is how Obsidian's plugin update system knows compatibility. The `version-bump.ts` script keeps `manifest.json` and `versions.json` in sync with `package.json`—it reads the version from `npm_package_version`, so it must be run via `bun run version`.

**Deploy.** The `deploy` script in `package.json` is a raw `cp` into the author's own Obsidian vault's plugin directory. This is a local development convenience, not a deployment pipeline. It is the only place the path to the author's vault appears.

## What changes the system accommodates

**Easy changes:** Adding a new setting follows an established pattern—add a field to `ChangelogSettings`, a default to `DEFAULT_SETTINGS`, a UI control in `settings.ts`, and consume it wherever relevant. The recent history shows several of these (wiki-links, heading, max files). Adding new output format options (grouping by date, different list styles) would be straightforward modifications to `generateChangelog`. New exclusion criteria (by tag, by frontmatter property) would be additions to `filterAndSort`.

**Moderate changes:** Supporting multiple changelogs, or changelogs scoped to folders, would require rethinking the single-path assumption that pervades the code. The self-exclusion guard, the settings schema, and the file-write path all assume one changelog.

**Hard changes:** Making the changelog incremental (append-only, or diff-based) rather than full-regeneration would be a fundamental redesign. The current architecture has no concept of prior state—it reads all files, sorts them, and writes the result. There is no diffing, no event log, no stored previous output. Similarly, adding real-time collaboration awareness or conflict resolution would require engaging with parts of the Obsidian API that the plugin currently ignores entirely.

**Where to look first:** A maintainer who understood the theory would start in `changelog.ts` for any logic change and `settings.ts` for any UI change, knowing that `main.ts` is glue that should rarely change. A maintainer who didn't might add Obsidian API calls into `changelog.ts` (breaking testability), or duplicate validation logic between `loadSettings` and the settings UI (the code already has mild tension here—see below).

## Tensions and uncertainties

**Validation is split.** `loadSettings` clamps `maxRecentFiles` and normalizes paths on load. The settings UI _also_ validates `maxRecentFiles` (rejecting `NaN`, flooring floats, capping at `MAX_RECENT_FILES`) and rejects non-`.md` changelog paths. These two validation sites are not identical in behavior—`loadSettings` uses `Number.isFinite` while the UI uses `Number.isNaN`, and `loadSettings` accepts and clamps values the UI would reject outright. This isn't a bug, but it is a place where two defenses serve overlapping purposes with subtly different semantics. The load-time validation is defending against corrupted stored data; the UI validation is defending against user input. They evolved separately (the load-time guards were added in response to specific bug reports: #132 for NaN, stale-key stripping in 530743d).

**The changelog file's dual identity.** The changelog is both an output artifact and a file in the vault. This creates a self-triggering problem: modifying the changelog fires a vault event, which could trigger another changelog update. The guard `file.path !== this.settings.changelogPath` prevents this, but it relies on exact path equality. Since both the event's `file.path` and `this.settings.changelogPath` go through Obsidian's `normalizePath`, this should hold, but it is a correctness invariant that is not tested (because testing it would require the Obsidian runtime). The TOCTOU race handling in `writeToFile` (the catch-and-retry around `vault.create`) is another artifact of this dual identity—the changelog file might be created by a concurrent event between the existence check and the create call.

**Test coverage has a deliberate gap.** The open issue #147 notes the absence of tests for `settings.ts` and `main.ts`. This is not an oversight but a consequence of the architectural bet: the pure logic is testable; the Obsidian-coupled code is not, without mocking an API surface that the authors have chosen not to mock. The entire test file imports only from `changelog.ts`. Whether this gap should be closed (by introducing Obsidian API mocks or integration tests) or accepted (as the cost of the clean-separation design) is an open question.

**The `onunload` is empty.** Commit 9883681 added an explicit empty `onunload` method. Obsidian's `Plugin` base class handles event cleanup for anything registered via `registerEvent`, so this is likely there to satisfy a linter, a type checker, or Obsidian's plugin validation. But it means teardown of the debounced handler relies entirely on Obsidian's own cleanup—if the debounce fires after unload, it would attempt to update a changelog in a potentially torn-down state. I suspect this is harmless in practice (debounce timers would be short-lived), but it is a place where the theory is thin.

**Provenance.** The manifest says "originally by Badr Bouslikhin." The earliest commits show a different coding style and architecture (the original had no separation between plugin and logic, no tests, and used async patterns that caused startup exceptions). The current codebase is effectively a rewrite that preserved the original's purpose and plugin identity. The v1.3.0 changelog entry—"Plugin class is now a thin shell"—marks the moment the current theory was established. Everything before it is archaeological; everything after it is refinement of that same idea.
