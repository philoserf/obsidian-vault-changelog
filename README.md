# Obsidian Vault Changelog Plugin

A plugin to maintain a change log of recently edited files in your Obsidian vault. Updates can be triggered manually or automatically.

**Important:** The change log note will be entirely overwritten at each update. Use a dedicated change log note and embed it in other notes if needed.

**Note:** This is a continuation of the original work by Badr Bouslikhin from 2020 to 2024. In January, Badr entrusted the project to Mark Ayers by transferring the code repository. On behalf of the Obsidian community, I want to express our gratitude to Badr for this valuable contribution.

## Installation

1. Open settings.
2. Navigate to "Community plugins".
3. Select "Browse".
4. Search for "Changelog."
5. Install and enable.

link: <https://obsidian.md/plugins?id=obsidian-vault-changelog#>

## Usage

Use the command palette command `Vault Changelog: Update` to update the
change log manually.

## Example

```markdown
- 2024-01-28T1430 · [[Note Title]]
- 2024-01-28T1425 · [[Another Note]]
```

## Settings

- **Auto Update**: Toggle automatic changelog updates (default: `false`)
- **Changelog Path**: Location of changelog file (default: `Changelog.md`)
- **Datetime Format**: Moment.js format string (default: `YYYY-MM-DD[T]HHmm`)
- **Max Recent Files**: Number of files to track (default: `25`)

## Changelog

### v1.0.0

- placeholder

### v0.1.0

- The initial release by Badr Bouslikhin

## Code of conduct

We are all human beings, being human. Treat each other with respect and decorum. Assume good intentions. Practice a "Yes, and" worldview.

## Contributing

- Open (or contribute to) a [Discussion on GitHub](https://github.com/philoserf/obsidian-vault-changelog/discussions)
- Open (or contribute to) an [Issue on GitHub](https://github.com/philoserf/obsidian-vault-changelog/issues)
- Open (or contribute to) a [Pull Request on GitHub](<(https://github.com/philoserf/obsidian-vault-changelog/pulls)>)
- Discuss the plugin in the [Forum](https://forum.obsidian.md)
- Discuss the plugin on [Discord](https://discord.gg/obsidianmd)

## Development

1. Clone this repository `gh repo clone philoserf/obsidian-vault-changelog`.
2. Install dependencies with `npm install`.
3. Build the project with `npm run build`.
4. Add the `manifest.json` and `main.js` files to your plugins.
