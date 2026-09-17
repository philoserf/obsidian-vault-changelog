# Vault Changelog

Maintain a changelog of recently edited notes in [Obsidian](https://obsidian.md/).

Originally created by [Badr Bouslikhin](https://github.com/badrbouslikhin).

**The changelog note is entirely overwritten on each update.** Use a dedicated note and embed it elsewhere if you need historical tracking.

## Installation

1. Open Settings in Obsidian.
2. Navigate to Community plugins > Browse.
3. Search for "Changelog".
4. Install and enable the plugin.

## Troubleshooting

### The plugin will not install or update

Most often reported on Windows, and usually the plugin files could not be replaced while
Obsidian had them open. Try these in order — the first two resolve it most of the time:

1. **Restart Obsidian.** The files may have been written correctly despite the error.
2. **Disable the plugin first.** Settings → Community plugins → toggle Vault Changelog off,
   update, then toggle it back on.
3. **Uninstall and reinstall.**
4. **Install by hand with Obsidian closed.** Download `main.js`, `manifest.json` and
   `styles.css` from the [latest release](https://github.com/philoserf/obsidian-vault-changelog/releases/latest)
   into `.obsidian/plugins/obsidian-vault-changelog/` in your vault.

If none of that works, something is likely holding the files open. Real-time antivirus scanning,
file-sync clients (OneDrive, Dropbox, Syncthing) and backup plugins all do this. Pausing them
before updating is worth a try.

### Reporting a problem

Please include the output from the developer console — `Ctrl+Shift+I` (`Cmd+Option+I` on macOS),
then the Console tab — captured while the failure happens, along with your operating system and
Obsidian version. Installation failures look alike from the outside, and the console is what
separates a file that could not be written from one that could not be downloaded.

## Usage

- **Manual**: Command palette > `Vault Changelog: Update Changelog`
- **Automatic**: Enable in settings; the changelog updates whenever a note is modified, renamed, or deleted.

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
