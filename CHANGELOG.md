# Changelog

## 1.6.0

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
