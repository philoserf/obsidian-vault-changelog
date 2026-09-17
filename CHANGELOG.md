# Changelog

## 1.8.0

**This release returns the plugin to the code that shipped as 1.5.4.** Versions 1.6.0 and 1.7.0 have been withdrawn — the file protection they introduced did not work — and 1.8.0 exists so that everyone, including anyone already running 1.6.0, ends up back on that known-good code. The version number is higher than 1.7.0 because that is the only way an update reaches you; the plugin's behaviour is 1.5.4's.

### Withdrawn

- **1.6.0 and 1.7.0 are no longer supported.** Both are marked as pre-releases. Their tags and downloaded files remain available for reference, but neither will be offered as an update and neither should be installed.

### Changed

- The plugin's code is identical to 1.5.4. `main.js` is a fresh build of that source and differs from 1.5.4's published file only in the internal names the minifier chose; nothing it does has changed.

### Upgrading

**Coming from 1.5.4 or earlier:** nothing about the plugin changes. Your settings and your changelog note are untouched, and there is nothing to do.

**Coming from 1.6.0 — please read this before updating.** 1.8.0 is a higher version number but it is a step _backwards_ in behaviour. One of those changes is the reason 1.6.0 was withdrawn at all:

- **The file protection added in 1.6.0 is gone, because it did not work.** It was meant to refuse writing to a file that did not look like a changelog this plugin had generated. It was unreliable in both directions: it still accepted ordinary notes whose lines happened to contain a middle dot, and it could refuse to update the very changelog it had written. A safeguard that fails that way is worse than none, because it invites trust it cannot carry.

  So the rule in 1.8.0 is the same as it was in 1.5.4, and it is worth knowing plainly: **the note at "Changelog path" is overwritten in full on every update, with no checks.** Point that setting at a note created for this purpose and nothing else. Path suggestions offer existing notes, so take care when choosing one.

- **Renaming or moving the changelog note no longer updates the setting.** The setting goes stale, the changelog begins listing itself, and a copy reappears under the old name.
- **Auto-update fires during editing rather than after it stops**, so with autosave on the changelog is rewritten repeatedly while you type.
- **Disabling the plugin within 200 ms of an edit can still trigger one more write.**
- **Notes that share a filename produce identical entries again**, with both links resolving to whichever note the vault picks.
- **Update failures report less detail** — one generic message rather than one naming the file that failed.

Before updating, open Settings → Vault Changelog and confirm "Changelog path" points at a note you are willing to have overwritten — ideally one this plugin created and nothing else writes to.

## 1.7.0

**Withdrawn — do not install.** Superseded by 1.8.0; see that entry.

Settings are validated at two trust boundaries — `data.json` at load and the settings tab at
edit time — and for most of this plugin's history each one validated independently. They had
drifted. This release makes every settings rule a single function that both boundaries call,
and fixes the defects the split had been producing.

### Fixed

- **Clearing the "Datetime format" field to retype no longer overwrites your saved format.** The field saved on every keystroke, so selecting all and deleting — the ordinary way to replace a value — wrote the default into the input and persisted it before you had typed the first character of the replacement. The live preview still updates as you type; the save now happens when you leave the field (#199)
- **Adding a folder that is already excluded now says so.** The "Add" button computed a "duplicate" verdict and then discarded it: no message, the input was not cleared, the list did not redraw. It was indistinguishable from a dead button (#203)
- **A settings change that fails to save no longer leaves the plugin running on it.** The value was applied in memory before the write was attempted and nothing put it back, so the plugin kept behaving as though the save had worked until the next restart silently reverted it. The failure message now also says why it failed (#206, #215)
- **A corrupt `maxRecentFiles` no longer truncates the changelog to a single entry.** A `data.json` holding `null`, `""`, `[]` or `false` for that setting produced a one-line changelog — quiet enough to read as "the plugin stopped working" rather than as a settings problem. These now fall back to the default of 25 (#209)
- **"Max recent files" now tells you whenever it had to change your input.** Entering `1000` or `25.9` silently rewrote the field while `0` and `abc` produced a message naming a range the field did not actually enforce (#210)
- Excluded folders that differ only in a trailing slash no longer appear as two identical rows whose remove buttons both delete the first one (#211)
- An excluded-folder path that normalizes to the vault root is now rejected in every spelling. One of them slipped through and became a row that excluded nothing, permanently (#204)

### Changed

- **Settings loaded from `data.json` are now held to the same rules as settings typed into the settings tab.** Previously the settings tab refused a "Changelog path" without a `.md` extension while the loader accepted one, so a vault could be writing to a file its own settings tab would not display. The same split applied to an empty datetime format and to excluded folders (#213)
- Invalid input typed into a settings field still reverts to the value you had, rather than resetting to the default — that behaviour is unchanged and is now explicit rather than incidental (#213)

### Internal

- Each setting's rule is one exported function in the pure layer, called by both the loader and the settings tab, with a trailing fallback that lets the two boundaries differ in what a rejected value becomes (#213)
- `updateSettings` is the one commit path for a settings change, and the one place a failed write can roll back. `saveSettings` and `saveSettingsSafely` are gone (#215, #216)
- `normalizeLoadedSettings` builds its result once instead of filtering persisted data and then walking it three more times to repair it. Dropping unknown keys and resisting a `__proto__` key are now properties of the construction rather than of guards (#208)
- `isValidChangelogPath` folded into `coerceChangelogPath`; it was `endsWith(".md")` behind an export, an import and three tests (#207)
- The excluded-folder verdict is now handled by an exhaustive switch, so a fourth verdict cannot be added without the compiler naming the call site (#203)
- `datetimePreview` is null-guarded rather than relying on an unstated ordering assumption the compiler could not see (#200)
- `THEORY.md` and `WALKTHROUGH.md` regenerated. Walkthrough snippets are now sliced from source programmatically and marked `prettier-ignore`, because prettier reformats code inside fenced blocks — which had silently dated two snippets in the previous edition
- Test suite grown from 47 to 65

### Upgrading

Most vaults are unaffected. If your `data.json` was hand-edited, or migrated from an old enough version, three settings may load differently than before — correctly, but differently:

- A **"Changelog path" without a `.md` extension** now falls back to `Changelog.md`. The plugin had been writing to the extensionless file while the settings tab refused to display that value, so there was no way to re-enter the path the plugin was actually using.
- An **empty "Datetime format"** now falls back to the default. An empty format string does not fail — it silently produces a full ISO-8601 timestamp on every row.
- An **excluded folder that is the vault root**, or a duplicate of another entry, is dropped. Both were inert rows that excluded nothing.

Settings you change through the settings tab are not affected by any of this.

## 1.6.0

**Withdrawn — do not install.** Superseded by 1.8.0; see that entry.

### Changed

- **The plugin now refuses to overwrite a note it did not generate.** Before writing, it checks whether the file at "Changelog path" looks like a changelog this plugin produced, and refuses with a notice if not. Nothing guarded this before — the only check was that the path ended in `.md`, which every note satisfies — so pointing the setting at an existing note destroyed it on the next update (#197)
- **Path suggestions for "Changelog path" and "Add excluded folder" now offer folders only.** Previously every markdown file in the vault was offered as a completion for the changelog path, and selecting one committed it in a single click, which was the fastest route to the overwrite above (#197)
- Entries for notes that share a filename now show enough path to tell them apart, in both wiki-link and plain-text mode. `Projects/Meeting Notes.md` and `Archive/Meeting Notes.md` previously produced two identical rows whose links both resolved to whichever note the vault picked (#202)
- Auto-update now waits until editing stops before regenerating, rather than firing 200 ms into a burst and repeating. During sustained typing with autosave on, the changelog was being rewritten several times a second (#193)

### Fixed

- Renaming or moving the changelog note keeps the setting pointing at it. Previously the setting went stale, the changelog began listing itself, and a ghost copy reappeared under the old name (#196)
- A failed update now says why. All three failure paths reported the same four words and discarded the error, including the one message that named the failing path (#217)
- Disabling or reloading the plugin within 200 ms of an edit no longer writes to the vault afterwards. The pending timer was never cancelled, so a torn-down instance could still run an update — and during a plugin update, two instances could write the same file (#201)
- The README named a command the palette does not show. Obsidian prefixes the plugin name, so the entry reads "Vault Changelog: Update Changelog" (#212)

### Internal

- `generateChangelog` is now `renderChangelog`, taking the whole settings object plus an injected link-text resolver rather than nine positional arguments across two calls (#195, #202)
- `writeToFile` folded into `updateChangelog`; it had one caller that always passed the same path (#218)
- Test files are typechecked again — `tsconfig.json` had excluded them, so fixture drift in the structurally-typed pure layer was invisible to `tsc` (#214)
- CI workflow token scoped to `contents: read` (#198)
- Removed an unreachable build-failure branch in `build.ts` — `Bun.build` rejects rather than returning `success: false` — and a stale `scripts/**/*.ts` glob from `biome.json` (#194)
- `THEORY.md` and `WALKTHROUGH.md` regenerated. The walkthrough now labels every snippet by file and symbol instead of line range, which is what had let it rot: only 9 of its 29 previous probes still reproduced
- Test suite grown from 30 to 47

### Upgrading

If your changelog note contains anything other than a heading and the plugin's own entry lines — notes you added by hand, for instance — the first update after upgrading will refuse to overwrite it and show a notice. Clear the file, or point "Changelog path" somewhere new, and updates resume. A changelog written by 1.5.x and left alone is unaffected.

## 1.5.4

### Fixed

- Malformed persisted settings (hand-edited or corrupt `data.json`) no longer crash plugin load; known settings keys fall back to defaults when their runtime type doesn't match (#174)
- "Max recent files" now validates on blur instead of on every keystroke, so clearing the field to retype no longer reverts mid-edit (#175)

### Added

- Accessible label on the excluded-folder remove button (#176)

### Internal

- Bump devDependencies: @biomejs/biome 2.5.2, @types/node 26.1.0

## 1.5.3

### Fixed

- Changelog heading is trimmed at the settings boundary and on load, keeping spacing predictable (#164)

### Changed

- Load-time settings normalization extracted to `normalizeLoadedSettings` and tested (#165)
- `clampMaxRecentFiles` is the single clamping authority for load and UI (#161)
- Path and excluded-folder validation extracted to pure functions and tested (#147, #162)
- Update dependencies

## 1.5.2

### Internal

- Attest release-asset build provenance via `actions/attest-build-provenance@v3` (#169). Consumers can verify with `gh attestation verify main.js -R philoserf/obsidian-vault-changelog`.

## 1.5.1

### Fixed

- Resolve all 16 Obsidian community plugin checker warnings (#166)
- Align `versions.json` with `manifest.json` `minAppVersion` so Obsidian's plugin browser stops offering 1.5.0 to Obsidian < 1.6.6 (#167)
- Handle promise rejections in fire-and-forget call sites; settings-save and command failures now surface a `Notice` instead of becoming unhandled rejections (#167)

### Added

- `fundingUrl` in `manifest.json` and `.github/FUNDING.yml` (Buy Me a Coffee)

### Internal

- Bump devDependencies: @biomejs/biome 2.4.15, @types/bun 1.3.13, @types/node 25.7.0, typescript 6.0.3

## 1.5.0

### Fixed

- Cache vault paths in PathSuggest to avoid per-keystroke scanning
- Strip stale settings keys when loading persisted data
- Skip rebuild when test files change in watch mode
- Capture text input reference instead of DOM traversal
- Render datetime preview below its setting input
- Add onunload method to ChangelogPlugin

### Changed

- Use dedicated property for debounced vault change handler

### Internal

- Bump actions/checkout from 4 to 6
- CI workflow updates
- Bump @types/node to 25.5.2

## 1.4.0

### Refactors

- Inline `formatEntry` into `generateChangelog` (single call site)
- Inline `PathSuggest` into `settings.ts`, delete `suggest.ts`
- Drop unnecessary generic on `filterAndSort`
- Inject `TimeFormatter` into `generateChangelog`, removing implicit `window.moment` dependency (#131)
- Move changelog-path and auto-update guards before debounce (#133)
- Delete `scripts/validate-plugin.ts` (duplicated build pipeline)
- Delete dead test blocks (DEFAULT_SETTINGS snapshot, maxRecentFiles JS-builtin tests)

### Fixes

- Reject empty and root-level excluded folder paths (#141)
- Reject non-markdown changelog paths with Notice feedback (#142)
- Cap `maxRecentFiles` at 500 with `Number.isFinite` guard for corrupt data (#132)
- Normalize `changelogPath` and `excludedFolders` on settings load
- Dispatch blur from `PathSuggest.selectSuggestion` so autocomplete saves immediately

### CI/CD

- Run tests in release workflow before building (#140)
- Restrict release tag pattern to semver (#139)
- Add bundler step to CI pipeline (#138)
- Implement file watcher for `bun run dev` (#134)
- Simplify biome.json file discovery (#137)

## 1.3.0

### Refactors

- Extract pure changelog logic into `src/changelog.ts` with no Obsidian imports
- Plugin class is now a thin shell; tests import real code instead of duplicating it

### Fixes

- Eliminate event listener leak when toggling auto-update (#97)
- Remove manual style loading that duplicated Obsidian built-in (#99)
- Replace no-op datetime format validation with live preview (#98)
- Normalize excluded folder paths on save and load (#100)
- Enforce trailing slash in excluded folder matching to prevent prefix false matches (#101)
- Truncate float values for maxRecentFiles setting (#128)
- Handle TOCTOU race condition in writeToFile (#110)
- Add bun-types and node to tsconfig types field

### Chores

- Update @biomejs/biome to 2.4.9

## 1.2.0

### Features

- Add configurable changelog heading
- Add optional wiki-links setting

### Chores

- Migrate from esbuild to Bun bundler
- Modernize build tooling and configurations
- Improve TypeScript type safety and modernize tsconfig
- Move styles to external CSS file

## 1.1.0

### Features

- Add excluded folders setting
- Add recent files validation with datetime check
- Add suggest for changelog path

### Chores

- Modernize build tooling and configurations

## 1.0.0

### Chores

- Plugin management transfer and version 1.0.0 release
- Fix changelog.md path in ascii tree

## 0.1.0

Initial release. Maintain a changelog of recently edited notes in Obsidian.
