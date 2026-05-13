# Changelog

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
