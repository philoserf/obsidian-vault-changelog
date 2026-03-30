# Obsidian Vault Changelog — Code Walkthrough

*2026-03-30T16:06:24Z by Showboat 0.6.1*
<!-- showboat-id: 41ae9c6e-7f9a-41f2-b732-2c2a5fa10f64 -->

## Overview

This is an Obsidian plugin that tracks recently edited markdown files and maintains a chronological changelog. When files are created, modified, deleted, or renamed, the plugin regenerates a changelog file listing the most recent changes with timestamps.

**Key technologies:** TypeScript, Obsidian API, Bun (runtime, bundler, test runner), Biome (linting/formatting)

**Architecture:** Pure changelog logic lives in `src/changelog.ts` with zero Obsidian imports. The plugin class in `src/main.ts` is a thin shell that wires Obsidian events to those pure functions. Settings UI is in `src/settings.ts`, and path autocompletion in `src/suggest.ts`.

**Entry point:** `src/main.ts` → `ChangelogPlugin.onload()`

## Architecture

### Directory layout

```bash
find . -name '*.ts' -not -path './node_modules/*' -not -path './.git/*' | sort
```

```output
./build.ts
./scripts/validate-plugin.ts
./src/changelog.test.ts
./src/changelog.ts
./src/main.ts
./src/settings.ts
./src/suggest.ts
./version-bump.ts
```

### Module dependency graph

```bash
cat <<'HEREDOC'
main.ts ──→ changelog.ts (pure logic: types, defaults, formatEntry, filterAndSort, generateChangelog)
   │
   └──→ settings.ts ──→ changelog.ts (imports DEFAULT_SETTINGS)
           │
           └──→ suggest.ts (path autocompletion)
HEREDOC
```

```output
main.ts ──→ changelog.ts (pure logic: types, defaults, formatEntry, filterAndSort, generateChangelog)
   │
   └──→ settings.ts ──→ changelog.ts (imports DEFAULT_SETTINGS)
           │
           └──→ suggest.ts (path autocompletion)
```

The key architectural boundary: `changelog.ts` has no Obsidian imports. It operates on a `ChangelogFile` interface (path, basename, mtime) that both Obsidian's `TFile` and plain test objects satisfy. This makes the pure logic fully testable without mocks.

## Core Walkthrough

### 1. Pure Logic — `src/changelog.ts`

This module defines the settings type, defaults, and three pure functions. No Obsidian imports — only `window.moment` (provided globally by Obsidian at runtime).

#### Settings type and defaults

```bash
sed -n '1,19p' src/changelog.ts
```

```output
export interface ChangelogSettings {
  autoUpdate: boolean;
  changelogPath: string;
  datetimeFormat: string;
  maxRecentFiles: number;
  excludedFolders: string[];
  useWikiLinks: boolean;
  changelogHeading: string;
}

export const DEFAULT_SETTINGS: ChangelogSettings = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [],
  useWikiLinks: true,
  changelogHeading: "",
};
```

#### ChangelogFile interface

The internal interface decouples pure logic from Obsidian's `TFile`. Any object with `path`, `basename`, and `stat.mtime` satisfies it — including plain objects in tests.

```bash
sed -n '21,25p' src/changelog.ts
```

```output
interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

#### formatEntry — single line formatting

Formats one file into a changelog line: `- <timestamp> · <filename>`. Uses `window.moment` for date formatting and optionally wraps the filename in wiki-links.

```bash
sed -n '27,36p' src/changelog.ts
```

```output
export function formatEntry(
  file: ChangelogFile,
  datetimeFormat: string,
  useWikiLinks: boolean,
): string {
  const m = window.moment(file.stat.mtime);
  const formattedTime = m.format(datetimeFormat);
  const fileName = useWikiLinks ? `[[${file.basename}]]` : file.basename;
  return `- ${formattedTime} · ${fileName}`;
}
```

#### filterAndSort — generic file selection pipeline

Filters out the changelog file itself and any files in excluded folders, sorts by modification time (newest first), and truncates to `maxRecentFiles`. The generic type parameter `<T extends ChangelogFile>` preserves the caller's concrete type (e.g. `TFile`) through the pipeline without requiring a cast. The trailing-slash check on excluded folders prevents prefix false matches (e.g. excluding "Notes" won't exclude "Notes2").

```bash
sed -n '38,56p' src/changelog.ts
```

```output
export function filterAndSort<T extends ChangelogFile>(
  files: T[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): T[] {
  return files
    .filter((file) => {
      if (file.path === changelogPath) return false;
      for (const folder of excludedFolders) {
        if (file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`))
          return false;
      }
      return true;
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}

```

#### generateChangelog — assembles the full output

Combines an optional heading with formatted entries. Returns the complete changelog string ready to write to disk.

```bash
sed -n '58,72p' src/changelog.ts
```

```output
  files: ChangelogFile[],
  datetimeFormat: string,
  useWikiLinks: boolean,
  changelogHeading: string,
): string {
  let content = "";
  if (changelogHeading) {
    content += `${changelogHeading}\n\n`;
  }
  for (const file of files) {
    content += `${formatEntry(file, datetimeFormat, useWikiLinks)}\n`;
  }
  return content;
}
```

### 2. Plugin Shell — `src/main.ts`

The plugin class is a thin adapter between Obsidian's API and the pure logic. It handles lifecycle, event wiring, file I/O, and settings persistence.

#### Imports and class declaration

```bash
sed -n '1,19p' src/main.ts
```

```output
import {
  debounce,
  Notice,
  normalizePath,
  Plugin,
  type TAbstractFile,
  TFile,
} from "obsidian";

import {
  type ChangelogSettings,
  DEFAULT_SETTINGS,
  filterAndSort,
  generateChangelog,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
```

#### onload — lifecycle entry point

Loads settings, registers the settings tab and command, then wires up vault events. A shared `handler` function is reused across all three event types. Events are registered unconditionally — the `autoUpdate` check happens at runtime in `onVaultChange`, preventing listener leaks when the toggle is flipped. The command callback is `async` to properly await `updateChangelog`.

```bash
sed -n '21,40p' src/main.ts
```

```output
  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: async () => this.updateChangelog(),
    });

    this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);

    const handler = (file: TAbstractFile) => {
      if (file instanceof TFile) this.onVaultChange(file);
    };
    this.registerEvent(this.app.vault.on("modify", handler));
    this.registerEvent(this.app.vault.on("delete", handler));
    this.registerEvent(this.app.vault.on("rename", handler));
  }

```

#### Event handling and changelog generation

`onVaultChange` is the debounced event handler — it gates on `autoUpdate` and skips changes to the changelog file itself to avoid infinite loops. Errors from `updateChangelog` are caught and surfaced via `console.error` and a `Notice`. `updateChangelog` delegates to the pure functions and writes the result.

```bash
sed -n '42,65p' src/main.ts
```

```output
    if (!this.settings.autoUpdate) return;
    if (file.path !== this.settings.changelogPath) {
      void this.updateChangelog().catch((err) => {
        console.error("Changelog update failed:", err);
        new Notice("Failed to update changelog");
      });
    }
  }

  async updateChangelog(): Promise<void> {
    const recentFiles = filterAndSort(
      this.app.vault.getMarkdownFiles(),
      this.settings.changelogPath,
      this.settings.excludedFolders,
      this.settings.maxRecentFiles,
    );
    const changelog = generateChangelog(
      recentFiles,
      this.settings.datetimeFormat,
      this.settings.useWikiLinks,
      this.settings.changelogHeading,
    );
    await this.writeToFile(this.settings.changelogPath, changelog);
  }
```

#### writeToFile — TOCTOU-safe file creation

Creates the changelog file if it doesn't exist, then writes content. The try/catch around `vault.create` handles a race condition where another event creates the file between the existence check and the create call. If the file still doesn't exist after the catch, the error is rethrown rather than swallowed.

```bash
sed -n '67,83p' src/main.ts
```

```output
  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, "");
      } catch {
        // File may have been created by a concurrent event (TOCTOU race)
        file = this.app.vault.getAbstractFileByPath(path);
        if (!file) throw new Error(`Failed to create changelog at: ${path}`);
      }
    }
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      new Notice(`Could not update changelog at path: ${path}`);
    }
  }
```

#### loadSettings — with self-healing migration

Merges saved settings over defaults (so new fields get default values). Then normalizes any previously saved excluded folder paths and ensures they have a trailing slash for correct prefix matching in `filterAndSort`.

```bash
sed -n '85,101p' src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
    };

    if (this.settings.excludedFolders.length > 0) {
      this.settings.excludedFolders = this.settings.excludedFolders.map(
        (folder) => {
          const normalized = normalizePath(folder);
          return normalized.endsWith("/") ? normalized : `${normalized}/`;
        },
      );
    }
  }

```

### 3. Settings UI — `src/settings.ts`

The settings tab renders Obsidian's `Setting` components. Key design choices:

- **Live datetime preview** replaces validation — users see exactly what their format produces
- **`nextFormat` pattern** — computes the effective format once, resets the input when cleared, and keeps preview/saved value in sync
- **`Math.floor`** on maxRecentFiles prevents float values, and the text input is updated to show the floored integer
- **`normalizePath` + trailing slash** on excluded folder input sanitizes paths on save
- **Auto-update toggle** simply persists the boolean — no event re-registration needed

```bash
sed -n '74,95p' src/settings.ts
```

```output
    const datetimePreview = containerEl.createEl("div", {
      cls: "setting-item-description",
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
    });

    new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js format string")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          .onChange(async (format) => {
            const nextFormat = format || DEFAULT_SETTINGS.datetimeFormat;
            if (!format) {
              text.setValue(nextFormat);
            }
            settings.datetimeFormat = nextFormat;
            datetimePreview.textContent = `Preview: ${window.moment().format(nextFormat)}`;
            await this.plugin.saveSettings();
          }),
      );
```

### 4. Path Autocompletion — `src/suggest.ts`

Extends Obsidian's `AbstractInputSuggest` to provide folder and file path suggestions in settings text fields. Folders get a trailing `/` appended, and filtering is case-insensitive.

```bash
sed -n '11,36p' src/suggest.ts
```

```output
  getSuggestions(inputStr: string): string[] {
    const lowerCaseInputStr = inputStr.toLowerCase();

    const folders = this.app.vault.getAllFolders();
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.extension === "md");

    const suggestions: string[] = [];

    folders.forEach((folder) => {
      const folderPath = folder.path;
      if (folderPath.toLowerCase().contains(lowerCaseInputStr)) {
        suggestions.push(`${folderPath}/`);
      }
    });

    files.forEach((file) => {
      const filePath = file.path;
      if (filePath.toLowerCase().contains(lowerCaseInputStr)) {
        suggestions.push(filePath);
      }
    });

    return suggestions;
  }
```

### 5. Build — `build.ts`

Uses Bun's native bundler. Output is CommonJS (required by Obsidian), with `obsidian` and `electron` externalized. Minification is disabled in watch mode.

```bash
sed -n '1,15p' build.ts
```

```output
const watch = process.argv.includes("--watch");

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: ".",
  format: "cjs",
  external: ["obsidian", "electron"],
  minify: !watch,
});

if (!result.success) {
  console.error("Build failed");
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
```

### 6. Tests — `src/changelog.test.ts`

Tests import real code from `changelog.ts` — no mocks or parallel copies. The only setup is providing `window.moment` globally (which Obsidian normally provides at runtime). Test count:

```bash
grep -c 'test(' src/changelog.test.ts
```

```output
18
```

Coverage spans all exported pure functions: `DEFAULT_SETTINGS`, `formatEntry`, `filterAndSort` (including the prefix false-match edge case), `generateChangelog`, and maxRecentFiles input validation.

## Concerns

1. **`window.moment` coupling** — `formatEntry` uses `window.moment`, a global provided by Obsidian at runtime. This works but is an implicit dependency. A future improvement could accept a formatter function parameter, making the dependency explicit and the function fully portable.

2. **No upper bound on `maxRecentFiles`** — The settings UI rejects values below 1 and truncates floats, but doesn't cap the maximum. A user could set 999999, causing `filterAndSort` to process the entire vault. Low risk in practice but worth noting.

3. **Excluded folder remove button uses `addEventListener`** — In `settings.ts:32`, the remove button's click handler uses raw `addEventListener` instead of Obsidian's event registration. Since the settings tab is re-rendered on each display, the elements are replaced, so this doesn't leak — but it's inconsistent with the rest of the plugin's event handling pattern.

