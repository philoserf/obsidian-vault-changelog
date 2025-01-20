# Obsidian Vault Changelog Plugin

This is a simple plugin that maintains a changelog of recently edited files in your vault.
The changelog update can be triggered both manually and automatically.

<img src="https://raw.githubusercontent.com/MrZeroo00/obsidian-vault-changelog/main/resources/demo.png" width=50% height=50%>

**Everything in the changelog note will be overwritten**. It's best to use a dedicated changelog note and embed it in other notes.

<img src="https://raw.githubusercontent.com/MrZeroo00/obsidian-vault-changelog/main/resources/demo-embedded.png" width=50% height=50%>

## How to Install

### Manual installation

1. Download zip archive from GitHub releases page.
1. Extract the archive into `<vault>/.obsidian/plugins`.
1. Reload Obsidian

### From within Obsidian

You can install the plugin via the Community Plugins tab within Obsidian. Just search for "Changelog".

## How to use

Once the plugin is installed and activated, you must provide it with the changelog file path.

You can update the changelog using the new command `Vault changelog: update` in the command palette.

You can configure two other options:

1. Number of recent files to show in the changelog
1. Automatic refresh of the changelog: this option automatically updates changelog on any note modification, deletion or rename.

### Changelog file location

The changelog file location is a path relative to the root including file name and extension. e.g. `Changelog.md` or `data/changes.md`.

```
./
├── notes/
│   └── misc/
│       └── changelog.md
├── pictures/
├── some-note.md
└── some-other-note.md
```

If you want to use `changelog.md` from the example above, you should input `notes/misc/changelog.md` in the preference pane.

## Development

This project uses Typescript to provide type checking and documentation.  
This plugin depends on the latest [plugin API](https://github.com/obsidianmd/obsidian-api) in Typescript Definition format, which contains TSDoc comments describing what it does.

**Note:** the Obsidian API is still in early alpha and is subject to change at any time!

If you want to contribute to development and/or just customize it with your own
tweaks, you can do the following:

- Clone this repository.
- `npm i` or `yarn` to install dependencies
- `npm run build` to compile.
- Copy `manifest.json`, `main.js` and `styles.css` to a subfolder of your plugins
  folder (e.g. `<vault>/.obsidian/plugins/obsidian-vault-changelog/`)
- Reload obsidian to see changes

## Notes

This is experimental and may have instability. It is possible that there are
bugs which may delete data in the current note. Please make backups!

## Common issues and solutions

### Issue 1: Couldn`t write changelog: check the file path

1. Create a new file, for example - `notes/misc/changelog`
2. Go to **Settings -> Plugin Option -> Vault Changelog**
2. Enter path in **Changelog note location - notes/misc/changelog.md**
3. Restart Obsidian

#### **Notes:**
> - Make sure to keep a **_proper file path and a name_**, like the one I have used.
> - If you are creating a new file with Obsidian, then **_don't put a (.md) extension_**. 
