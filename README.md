# Obsidian Vault Changelog Plugin

A plugin to maintain a change log of recently edited files in your Obsidian vault. Updates can be triggered manually or automatically.

## Why Use This Plugin?

**Vault Changelog** is ideal if you want:
- **A persistent, text-based record** of recently edited files that survives vault moves and syncing
- **Simple configuration** with a single command to update your changelog
- **Minimal overhead** without needing to learn query syntax or manage complex workflows
- **Embeddable output** that can be referenced from other notes (e.g., a dashboard or index)
- **Clean graph view option** by disabling wiki-links to avoid cluttering your graph

### Use Cases

- **Personal knowledge base**: Track your daily writing and review what you've been working on
- **Team collaboration**: Share a changelog of recent edits with collaborators
- **Obsidian Publish**: Display a nicely formatted list of recent updates on your published site
- **Daily/weekly reviews**: Embed the changelog in periodic notes to reflect on your work
- **Project tracking**: Monitor activity in specific folders (using excluded folders feature)

## Features

- Tracks recently edited notes in a centralized changelog.
- Supports both manual and automatic updates.
- Customizable file paths, timestamps, and entry limits.
- Optional wiki-links and heading configuration.

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

With wiki-links enabled (default):
```markdown
- 2024-01-28T14:30 · [[Note Title]]
- 2024-01-28T14:25 · [[Another Note]]
```

With wiki-links disabled:
```markdown
- 2024-01-28T14:30 · Note Title
- 2024-01-28T14:25 · Another Note
```

With a heading configured:
```markdown
# Changelog

- 2024-01-28T14:30 · [[Note Title]]
- 2024-01-28T14:25 · [[Another Note]]
```

## Settings

- **Auto update**: Enable automatic updates (`false` by default).
- **Changelog path**: File location for the changelog (`Changelog.md` by default).
- **Datetime format**: Moment.js format string (`YYYY-MM-DD[T]HHmm` by default).
- **Max recent files**: Number of tracked files (`25` by default).
- **Use wiki-links**: Format filenames as wiki-links `[[note]]` instead of plain text (`true` by default).
- **Changelog heading**: Optional heading to prepend to the changelog (empty by default). Example: `# Changelog`
- **Excluded folders**: Folders to exclude from the changelog (empty by default).

## Alternatives

While **Vault Changelog** provides a simple, persistent changelog, you might prefer alternatives depending on your needs:

### Other Plugins

- **[List Modified](https://github.com/franciskafieh/obsidian-list-modified)**: A more advanced changelog plugin that links modified files to daily, weekly, or monthly notes. Best for users who want changelog entries integrated into periodic notes rather than a single standalone file.

- **[Recent Files](https://github.com/tgrosinger/recent-files-obsidian)**: Adds a sidebar pane showing recently opened (not edited) files. Great for quick navigation but doesn't create a persistent text record.

- **[Obsidian Git](https://github.com/denolehov/obsidian-git)**: For detailed version control and change history. Overkill if you only need a simple list of recently edited files, but essential for tracking actual content changes and collaboration.

### Dataview Alternative

If you already use the **[Dataview](https://github.com/blacksmithgu/obsidian-dataview)** plugin, you can achieve similar results with a query:

````markdown
```dataview
TABLE dateformat(file.mtime, "yyyy-MM-dd HH:mm") AS "Last Modified"
FROM ""
SORT file.mtime DESC
LIMIT 25
```
````

**Dataview pros**: Dynamic queries, no plugin needed if you already use Dataview, can filter by folders/tags
**Dataview cons**: Requires learning query syntax, queries don't work in all contexts (e.g., mobile widgets, some themes)

**Vault Changelog pros**: Simple one-command update, works everywhere (embeds, Obsidian Publish, mobile), persistent text output, no query syntax needed

## Documentation

- [Changelog](CHANGELOG.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing Guide](CONTRIBUTING.md)
