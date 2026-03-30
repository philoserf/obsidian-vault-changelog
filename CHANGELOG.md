# Changelog

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
