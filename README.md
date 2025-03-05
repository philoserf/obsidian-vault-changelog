# Obsidian Vault Changelog Plugin

A plugin to maintain a change log of recently edited files in your Obsidian vault. Updates can be triggered manually or automatically.

## Features

- Tracks recently edited notes in a centralized changelog.
- Supports both manual and automatic updates.
- Customizable file paths, timestamps, and entry limits.

## Important

⚠️ **The change log note is entirely overwritten at each update.**  
Use a dedicated change log note and embed it elsewhere if you need historical tracking.

## Project History

This project was originally created by **Badr Bouslikhin (2020-2024)**.  
In January 2025, Badr transferred the repository to **Mark Ayers**.  
On behalf of the Obsidian community, we extend our gratitude to Badr for this valuable contribution.

## Installation

1. Open **Settings** in Obsidian.
2. Navigate to **Community plugins**.
3. Select **Browse**.
4. Search for **Changelog**.
5. Install and enable the plugin.

🔗 **[Plugin Page](https://obsidian.md/plugins?id=obsidian-vault-changelog#)**

## Usage

- **Manual Update**: Use the command palette and run `Vault Changelog: Update`.
- **Automatic Update**: If enabled, the changelog updates whenever a file is modified.

## Example Output

```markdown
- 2024-01-28T14:30 · [[Note Title]]
- 2024-01-28T14:25 · [[Another Note]]
```

## Settings

- **Auto update**: Enable automatic updates (`false` by default).
- **Changelog path**: File location for the changelog (`Changelog.md` by default).
- **Datetime format**: Moment.js format string (`YYYY-MM-DD[T]HHmm` by default).
- **Max recent files**: Number of tracked files (`25` by default).
- **Excluded folders**: Folders to exclude from the changelog (empty by default).

## Documentation

- [Changelog](CHANGELOG.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing Guide](CONTRIBUTING.md)
