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

## Changelog

### 1.1.0

- Added folder suggestion for the "Changelog path"
- Added "Excluded folders"
- Added input validation for "Datetime format" and "Max recent files"

### 1.0.0

- Transferred to a new maintainer.
- Fixed file creation bug.
- Improved error messages for file creation failures.
- Added date format customization.
- Refactored code to align with Obsidian community guidelines.
- Updated README with revised installation and usage instructions.
- Added LICENSE file.

### 0.1.0

- Initial release by Badr Bouslikhin.

## Code of Conduct

We are all human beings, being human.  
Treat each other with respect and decorum.  
Assume good intentions.  
Practice a **"Yes, and"** worldview.

## Contributing

💡 Want to improve the plugin? Here’s how you can help:

- **Discussions**: [GitHub Discussions](https://github.com/philoserf/obsidian-vault-changelog/discussions)
- **Bug Reports**: [Open an Issue](https://github.com/philoserf/obsidian-vault-changelog/issues)
- **Feature Requests**: [Open a Pull Request](https://github.com/philoserf/obsidian-vault-changelog/pulls)
- **Community**: [Obsidian Forum](https://forum.obsidian.md) | [Obsidian Discord](https://discord.gg/obsidianmd)

## Development

1. Clone this repository `gh repo clone philoserf/obsidian-vault-changelog`.
2. Install dependencies with `npm install`.
3. Build the project with `npm run build`.

### Using the test-vault

The project includes a test-vault for development:

1. Open the test-vault in Obsidian (`File > Open another vault > Open folder as vault` and select the `test-vault` directory)
2. Build the plugin with hot-reload: `npm run dev`
3. Changes will automatically be applied to the plugin in the test-vault

### Manual installation

Alternatively, you can manually install the plugin in your own vault:

1. Copy `manifest.json` and `main.js` into your **Obsidian plugins folder** (`.obsidian/plugins/obsidian-vault-changelog`).
2. Reload Obsidian and enable the plugin.
