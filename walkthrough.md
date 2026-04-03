# Obsidian Vault Changelog Walkthrough

*2026-04-03T18:40:32Z by Showboat 0.6.1*
<!-- showboat-id: c787c9c7-997e-46a9-af1c-10c5e1d229e2 -->

## Overview

**Obsidian Vault Changelog** is an Obsidian plugin that maintains a changelog of recently edited notes. When a note is modified, renamed, or deleted, the plugin regenerates a markdown file listing the most recently changed files with timestamps.

**Key technologies**: TypeScript, Obsidian Plugin API, Bun (runtime/bundler/test runner), Biome (linter/formatter).

**Source files** (all in `src/`):

| File | Purpose |
|------|---------|
| `main.ts` | Plugin lifecycle, event handling, Obsidian integration |
| `changelog.ts` | Pure logic — filtering, sorting, and generating changelog content |
| `settings.ts` | Settings UI tab, path autocomplete widget |
| `changelog.test.ts` | Unit tests for the pure logic functions |

The plugin registers vault events (modify, delete, rename) and a manual command, then delegates to pure functions that filter files and generate markdown output.

## Architecture

The plugin follows a clean three-file separation:

    src/main.ts          ← Plugin class (orchestrator)
      ├── src/changelog.ts   ← Pure functions (no Obsidian deps)
      └── src/settings.ts    ← Settings UI (Obsidian UI components)

**Data flow**: Vault event → debounced handler → `filterAndSort()` → `generateChangelog()` → write file.

Build tooling lives at the repo root: `build.ts` (Bun bundler), `version-bump.ts` (manifest sync), `biome.json`, `tsconfig.json`.

```bash
cat <<'HEREDOC'
src/
├── changelog.test.ts   (132 lines — unit tests)
├── changelog.ts        (65 lines — core logic)
├── main.ts             (118 lines — plugin class)
└── settings.ts         (239 lines — settings UI)

build.ts                (37 lines — Bun bundler config)
version-bump.ts         (20 lines — version sync script)
biome.json              (23 lines — linter/formatter)
tsconfig.json           (15 lines — TypeScript config)
manifest.json           (10 lines — Obsidian plugin metadata)
versions.json           (10 lines — version compatibility map)
HEREDOC
```

```output
src/
├── changelog.test.ts   (132 lines — unit tests)
├── changelog.ts        (65 lines — core logic)
├── main.ts             (118 lines — plugin class)
└── settings.ts         (239 lines — settings UI)

build.ts                (37 lines — Bun bundler config)
version-bump.ts         (20 lines — version sync script)
biome.json              (23 lines — linter/formatter)
tsconfig.json           (15 lines — TypeScript config)
manifest.json           (10 lines — Obsidian plugin metadata)
versions.json           (10 lines — version compatibility map)
```

## Core Logic — `changelog.ts`

This file contains the pure functions that do the actual work. It has no dependency on the Obsidian API, making it independently testable.

### Types and defaults

The `ChangelogSettings` interface defines the seven user-configurable options. `DEFAULT_SETTINGS` provides safe initial values. `ChangelogFile` is a minimal interface matching the shape of `TFile` — only the fields the logic actually needs.

```bash
head -27 src/changelog.ts
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

export const MAX_RECENT_FILES = 500;

interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

### `filterAndSort()`

The workhorse filter function. It takes all markdown files, excludes the changelog itself and any files in excluded folders, sorts by modification time (most recent first), and returns the top N files.

Note the folder exclusion logic at line 34: it checks `file.path.startsWith(folder + "/")` — the trailing slash prevents false positives where a folder name is a prefix of another (e.g., `daily/` should not exclude `daily-notes/`).

```bash
tail -n +29 src/changelog.ts | head -18
```

```output
export function filterAndSort(
  files: ChangelogFile[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): ChangelogFile[] {
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

### `generateChangelog()`

Assembles the final markdown string. Each file becomes a bullet with a formatted timestamp and either a wiki-link (`[[name]]`) or plain text basename.

The `TimeFormatter` type alias allows the plugin to inject `window.moment` (Obsidian's bundled Moment.js) at runtime while tests inject a standalone moment import — a clean dependency-injection seam.

```bash
tail -n +48 src/changelog.ts
```

```output
export type TimeFormatter = (mtime: number, format: string) => string;

export function generateChangelog(
  files: ChangelogFile[],
  datetimeFormat: string,
  useWikiLinks: boolean,
  changelogHeading: string,
  formatTime: TimeFormatter,
): string {
  let content = changelogHeading ? `${changelogHeading}\n\n` : "";
  for (const file of files) {
    const time = formatTime(file.stat.mtime, datetimeFormat);
    const name = useWikiLinks ? `[[${file.basename}]]` : file.basename;
    content += `- ${time} · ${name}\n`;
  }
  return content;
}
```

## Plugin Class — `main.ts`

`ChangelogPlugin` extends Obsidian's `Plugin` base class. It wires together settings, event listeners, and the core logic functions.

### Initialization and event registration

`onload()` loads persisted settings, adds the settings tab, registers a manual "Update Changelog" command, and subscribes to vault events (modify, delete, rename) with a debounced handler.

The `debouncedUpdate` property (line 21) is created as a 200ms debounced callback. This prevents the changelog from being rewritten on every keystroke during rapid editing.

```bash
head -50 src/main.ts
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
  MAX_RECENT_FILES,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    void this.updateChangelog().catch((err) => {
      console.error("Changelog update failed:", err);
      new Notice("Failed to update changelog");
    });
  }, 200);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: async () => this.updateChangelog(),
    });

    const handler = (file: TAbstractFile) => {
      if (
        this.settings.autoUpdate &&
        file instanceof TFile &&
        file.path !== this.settings.changelogPath
      ) {
        this.debouncedVaultChange();
      }
    };
    this.registerEvent(this.app.vault.on("modify", handler));
    this.registerEvent(this.app.vault.on("delete", handler));
    this.registerEvent(this.app.vault.on("rename", handler));
  }
```

### `updateChangelog()` and `writeToFile()`

`updateChangelog()` is the main orchestration method. It collects all markdown files from the vault, passes them through `filterAndSort()`, generates the content via `generateChangelog()`, and writes the result.

`writeToFile()` handles the file I/O with a TOCTOU guard: it first tries to read the existing file. If the file has been deleted between the check and the modify, the `catch` block creates it instead.

```bash
tail -n +52 src/main.ts | head -34
```

```output
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
      (mtime, fmt) => window.moment(mtime).format(fmt),
    );
    await this.writeToFile(this.settings.changelogPath, changelog);
  }

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

### `loadSettings()`

Settings loading includes validation and sanitization: it strips unknown keys from persisted data, coerces `maxRecentFiles` to a valid range (1–500), normalizes the changelog path, and ensures `excludedFolders` is always an array of strings.

```bash
tail -n +87 src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    const loadedSettings = (await this.loadData()) ?? {};
    const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(loadedSettings)) {
      if (knownKeys.has(key)) {
        filtered[key] = loadedSettings[key];
      }
    }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(filtered as Partial<ChangelogSettings>),
    };

    // Normalize persisted folder paths so duplicate detection in the
    // settings UI (which also runs normalizePath) stays consistent.
    this.settings.changelogPath = normalizePath(this.settings.changelogPath);
    this.settings.excludedFolders =
      this.settings.excludedFolders.map(normalizePath);
    const raw = Number(this.settings.maxRecentFiles);
    this.settings.maxRecentFiles = Number.isFinite(raw)
      ? Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES))
      : DEFAULT_SETTINGS.maxRecentFiles;
  }

  onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

## Settings UI — `settings.ts`

### `PathSuggest`

A reusable autocomplete widget that suggests vault folders and markdown files as the user types. It caches the path list in `cachedPaths` to avoid scanning the vault on every keystroke.

```bash
head -53 src/settings.ts
```

```output
import {
  AbstractInputSuggest,
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";

import { DEFAULT_SETTINGS, MAX_RECENT_FILES } from "./changelog";
import type ChangelogPlugin from "./main";

class PathSuggest extends AbstractInputSuggest<string> {
  inputEl: HTMLInputElement;
  private cachedPaths: string[] | null = null;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  private getPaths(): string[] {
    if (this.cachedPaths) return this.cachedPaths;

    const paths: string[] = [];
    for (const folder of this.app.vault.getAllFolders()) {
      paths.push(`${folder.path}/`);
    }
    for (const file of this.app.vault.getFiles()) {
      if (file.extension === "md") {
        paths.push(file.path);
      }
    }
    this.cachedPaths = paths;
    return paths;
  }

  getSuggestions(inputStr: string): string[] {
    const lowerInput = inputStr.toLowerCase();
    return this.getPaths().filter((p) => p.toLowerCase().contains(lowerInput));
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    this.inputEl.trigger("input");
    this.inputEl.dispatchEvent(new Event("blur"));
    this.close();
  }
}
```

### `ChangelogSettingsTab`

The settings tab renders seven configurable fields. Each calls `plugin.saveSettings()` on change, and several include inline validation or preview rendering.

Key highlights from `display()`:
- **Changelog path** (line 107): Uses `PathSuggest` for autocomplete and appends `.md` if missing.
- **Datetime format** (line 129): Renders a live preview below the input showing the current format applied to `Date.now()`.
- **Max recent files** (line 153): Clamps to 1–500 range, rejecting non-numeric input.
- **Excluded folders** (line 205): Manages a dynamic list with add/remove UI. Validates uniqueness and normalizes paths.

```bash
tail -n +55 src/settings.ts | head -35
```

```output
export class ChangelogSettingsTab extends PluginSettingTab {
  plugin: ChangelogPlugin;

  constructor(app: App, plugin: ChangelogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  renderExcludedFolders(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.excludedFolders.length === 0) {
      container.createEl("div", { text: "No excluded folders" });
      return;
    }

    this.plugin.settings.excludedFolders.forEach((folder) => {
      const folderDiv = container.createDiv("excluded-folder-item");
      folderDiv.createSpan({ text: folder });

      const removeButton = folderDiv.createEl("button", {
        text: "✕",
        cls: "excluded-folder-remove",
      });

      removeButton.addEventListener("click", async () => {
        const index = this.plugin.settings.excludedFolders.indexOf(folder);
        if (index > -1) {
          this.plugin.settings.excludedFolders.splice(index, 1);
          await this.plugin.saveSettings();
          this.renderExcludedFolders(container);
        }
      });
    });
  }
```

The `display()` method creates all seven settings. Here's a representative sample showing the datetime format setting with its live preview — the most complex single setting in the UI:

```bash
tail -n +129 src/settings.ts | head -23
```

```output
    let datetimePreview: HTMLElement;

    const datetimeSetting = new Setting(containerEl)
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

    datetimePreview = datetimeSetting.descEl.createEl("div", {
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
    });
```

## Tests — `changelog.test.ts`

Tests cover only the pure functions in `changelog.ts` using Bun's test runner. The settings tab and plugin class (which depend on the Obsidian API) are untested — this is tracked in issue #147.

Tests use a standalone `moment` import as the `TimeFormatter`, demonstrating the dependency-injection seam in `generateChangelog()`.

```bash
head -20 src/changelog.test.ts
```

```output
import { describe, expect, test } from "bun:test";
import moment from "moment";

import { filterAndSort, generateChangelog } from "./changelog";

const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);

describe("filterAndSort", () => {
  const files = [
    { path: "Note A.md", basename: "Note A", stat: { mtime: 100 } },
    { path: "Note B.md", basename: "Note B", stat: { mtime: 300 } },
    { path: "Note C.md", basename: "Note C", stat: { mtime: 200 } },
    { path: "Changelog.md", basename: "Changelog", stat: { mtime: 400 } },
    {
      path: "Archive/Old Note.md",
      basename: "Old Note",
      stat: { mtime: 500 },
    },
  ];

```

```bash
wc -l < src/changelog.test.ts
```

```output
     131
```

The test file contains 10 tests across two `describe` blocks:

- **`filterAndSort`** (6 tests): excludes changelog file, excludes files in excluded folders, sorts by mtime descending, limits to maxRecentFiles, handles excess maxRecentFiles, and avoids false-positive folder prefix matches.
- **`generateChangelog`** (4 tests): output without heading, without wiki-links, with heading, and with an empty file list.

## Build System — `build.ts`

The build script uses Bun's native bundler. In watch mode, it debounces rebuilds (100ms) and skips test files. In production mode, it minifies the output and exits with code 1 on failure.

```bash
head -37 build.ts
```

```output
import { watch } from "node:fs";

const isWatch = process.argv.includes("--watch");

async function build(): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: ".",
    format: "cjs",
    external: ["obsidian", "electron"],
    minify: !isWatch,
  });

  if (!result.success) {
    console.error("Build failed");
    for (const message of result.logs) console.error(message);
    return false;
  }
  return true;
}

const ok = await build();
if (!ok && !isWatch) process.exit(1);

if (isWatch) {
  console.log("Watching src/ for changes...");
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch("src", { recursive: true }, (_event, filename) => {
    if (typeof filename === "string" && filename.includes(".test.")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      console.log("Rebuilding...");
      await build();
    }, 100);
  });
}
```

## Version Management — `version-bump.ts`

Keeps `manifest.json` and `versions.json` in sync with `package.json`. Run via `bun run version` (typically before tagging a release).

```bash
head -20 version-bump.ts
```

```output
import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("No version found in package.json");
}

// Update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Update versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Updated to version ${targetVersion}`);
```

## Concerns

### Test coverage gap
Only `changelog.ts` has tests. The plugin class (`main.ts`) and settings UI (`settings.ts`) are untested. This is tracked in issue #147. The `loadSettings()` validation logic — key stripping, range clamping, path normalization — is particularly worth testing since it defends against corrupted persisted data.

### `moment` is a devDependency, not a runtime dependency
The plugin relies on `window.moment` (provided by Obsidian at runtime) for production formatting but lists `moment` only in `devDependencies` for tests. This is correct for an Obsidian plugin — but the implicit dependency on a global could surprise contributors. A comment in `main.ts` at the `window.moment` call site would help.

### `onunload()` is empty
The empty `onunload()` method (line 112) exists to satisfy the Obsidian plugin contract. Obsidian's `Plugin` base class handles cleanup of registered events and commands automatically, so this is correct but could benefit from a brief comment explaining why.

### `PathSuggest` cache is never invalidated
The cached paths in `PathSuggest` (line 15) are populated on first use and never refreshed. If a user creates a new folder and then opens settings, the new folder won't appear in autocomplete until the settings tab is closed and reopened (which creates a new `PathSuggest` instance via `display()`). This is an acceptable trade-off documented in commit `b50d8d5`.

### `excludedFolders` UI uses emoji for button text
The remove button in `renderExcludedFolders()` uses `"✕"` (Unicode multiplication sign). Obsidian's own UI conventions use Lucide icons via `setIcon()`. Switching to `setIcon(removeButton, "x")` would be more consistent with the ecosystem.

### No changelog path collision guard
If a user sets the changelog path to an existing note they care about, the plugin will silently overwrite its contents. A confirmation prompt or a check for pre-existing content on first write would prevent accidental data loss.

