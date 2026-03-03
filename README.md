# Vault Changelog

Maintain a changelog of recently edited notes in [Obsidian](https://obsidian.md/).

Originally created by [Badr Bouslikhin](https://github.com/badrbouslikhin).

**The changelog note is entirely overwritten on each update.** Use a dedicated note and embed it elsewhere if you need historical tracking.

## Installation

1. Open Settings in Obsidian.
2. Navigate to Community plugins > Browse.
3. Search for "Changelog".
4. Install and enable the plugin.

## Usage

- **Manual**: Command palette > `Vault Changelog: Update`
- **Automatic**: Enable in settings; the changelog updates whenever a file is modified.

## Example Output

```markdown
- 2025-01-28T1430 · [[Note Title]]
- 2025-01-28T1425 · [[Another Note]]
```

With wiki-links disabled, `[[Note Title]]` becomes `Note Title`. With a heading configured, the heading appears above the list.

## Settings

| Setting           | Default             | Description                                      |
| ----------------- | ------------------- | ------------------------------------------------ |
| Auto update       | `false`             | Update changelog on vault changes                |
| Changelog path    | `Changelog.md`      | File location for the changelog                  |
| Datetime format   | `YYYY-MM-DD[T]HHmm` | Moment.js format string                          |
| Max recent files  | `25`                | Number of tracked files                          |
| Use wiki-links    | `true`              | Format filenames as `[[note]]`                   |
| Changelog heading | _(empty)_           | Optional heading to prepend (e.g. `# Changelog`) |
| Excluded folders  | _(empty)_           | Folders to exclude from the changelog            |

## Alternatives

- [Bases](https://help.obsidian.md/bases) — built-in Obsidian feature for querying and displaying vault data
- [Recent Files](https://github.com/tgrosinger/recent-files-obsidian) — sidebar pane of recently opened files
- [List Modified](https://github.com/franciskafieh/obsidian-list-modified) — links modified files to daily, weekly, or monthly notes
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) — dynamic query: `TABLE dateformat(file.mtime, "yyyy-MM-dd HH:mm") SORT file.mtime DESC LIMIT 25`
