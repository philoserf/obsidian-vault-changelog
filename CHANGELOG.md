# Changelog

## Unreleased

### Added

- Test vault for easier development and testing
- Hot-reload plugin to test vault for seamless development
- "Use wiki-links" setting to optionally disable wiki-link formatting (addresses #9)
- "Changelog heading" setting to optionally prepend a heading to the changelog (addresses #4)

### Changed

- Moved styles to external CSS file
- Restructured documentation into separate files following GitHub standards

### Maintenance

- Improved internal documentation
- Added Dependabot configuration for GitHub Actions
- Updated all development dependencies to latest versions:
  - TypeScript 5.7.3 → 5.9.3
  - TypeScript ESLint parser 8.25.0 → 8.46.0
  - TypeScript ESLint plugin 8.25.0 → 8.46.0
  - ESLint 9.22.0 → 9.37.0
  - Prettier 3.5.3 → 3.6.2
  - eslint-config-prettier 10.1.1 → 10.1.8
  - Obsidian API 1.8.7 → 1.10.0

## 1.1.0

- Added folder suggestion for the "Changelog path"
- Added "Excluded folders"
- Added input validation for "Datetime format" and "Max recent files"

## 1.0.0

- Transferred to a new maintainer.
- Fixed file creation bug.
- Improved error messages for file creation failures.
- Added date format customization.
- Refactored code to align with Obsidian community guidelines.
- Updated README with revised installation and usage instructions.
- Added LICENSE file.

## 0.1.0

- Initial release by Badr Bouslikhin.
