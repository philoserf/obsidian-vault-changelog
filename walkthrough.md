# Vault Changelog Plugin Walkthrough

*2026-04-02T19:59:05Z by Showboat 0.6.1*
<!-- showboat-id: c5b84be4-bb36-4e3d-bae6-aeb805ee2299 -->

## Overview

**Vault Changelog** is an Obsidian plugin that maintains a changelog of recently edited notes. When a file is modified, deleted, or renamed, the plugin regenerates a markdown file listing the most recently changed notes with timestamps.

**Key technologies:** TypeScript, Obsidian Plugin API, Moment.js, Bun (build/test), Biome (lint/format)

**Entry point:** `src/main.ts` — exports `ChangelogPlugin`, which Obsidian loads as a plugin class.

**Source modules:**
- `src/changelog.ts` — Pure functions: filtering, sorting, and changelog generation
- `src/settings.ts` — Settings UI tab with path autocomplete and validation
- `src/main.ts` — Plugin lifecycle, event wiring, file I/O

**Build output:** `main.js` (CommonJS bundle, externals: `obsidian`, `electron`)

## Architecture

The plugin follows a clean three-layer architecture: pure logic, plugin lifecycle, and UI.

```bash
cat <<'HEREDOC'
src/
├── changelog.ts        # Pure functions: types, defaults, filterAndSort, generateChangelog
├── changelog.test.ts   # Unit tests for changelog.ts
├── main.ts             # Plugin class: lifecycle, events, file I/O
└── settings.ts         # ChangelogSettingsTab UI + PathSuggest autocomplete

build.ts                # Bun bundler config + watch mode
version-bump.ts         # Syncs version across package.json, manifest.json, versions.json
HEREDOC
```

```output
src/
├── changelog.ts        # Pure functions: types, defaults, filterAndSort, generateChangelog
├── changelog.test.ts   # Unit tests for changelog.ts
├── main.ts             # Plugin class: lifecycle, events, file I/O
└── settings.ts         # ChangelogSettingsTab UI + PathSuggest autocomplete

build.ts                # Bun bundler config + watch mode
version-bump.ts         # Syncs version across package.json, manifest.json, versions.json
```

Data flows in one direction: vault events → filter/sort → generate markdown → write file. The pure functions in `changelog.ts` have no side effects and accept a `TimeFormatter` callback, keeping Moment.js out of the core logic.

## Core Module: `changelog.ts`

This is the heart of the plugin — 64 lines of pure functions with no Obsidian dependencies. It defines the settings interface, default values, and two core functions.

### Settings Interface and Defaults

The `ChangelogSettings` interface defines all user-configurable options. `DEFAULT_SETTINGS` provides safe starting values. `MAX_RECENT_FILES` (500) caps the upper bound.

```bash
sed -n '1,21p' src/changelog.ts
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
```

### `ChangelogFile` Interface

A minimal interface matching the shape of Obsidian's `TFile`. By defining its own interface rather than importing `TFile`, the module stays decoupled from the Obsidian API — good for testability.

```bash
sed -n '23,27p' src/changelog.ts
```

```output
interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

### `filterAndSort` — File Selection Pipeline

This function chains three operations: filter out the changelog file itself and files in excluded folders, sort by modification time (newest first), and limit to `maxRecentFiles`. The folder exclusion uses a trailing-slash check (`folder/`) to prevent "Notes" from excluding "Notes2" — a subtle but important correctness detail.

```bash
sed -n '29,46p' src/changelog.ts
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

### `generateChangelog` — Markdown Output

Builds the changelog string. Each file becomes a line: `- {timestamp} · {name}`. The `TimeFormatter` type is injected rather than calling Moment.js directly — this is the key design decision that makes the function testable without mocking globals.

```bash
sed -n '48,64p' src/changelog.ts
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

## Plugin Lifecycle: `main.ts`

`ChangelogPlugin` extends Obsidian's `Plugin` class and orchestrates everything: loading settings, registering vault events, wiring up the command palette, and writing the changelog file.

### `onload` — Initialization

On load, the plugin: (1) loads and validates persisted settings, (2) registers the settings tab, (3) adds a manual "Update Changelog" command, (4) wraps `onVaultChange` with a 200ms debounce, and (5) registers event handlers for modify/delete/rename. The handler checks three guards before triggering: autoUpdate must be on, the changed item must be a `TFile` (not a folder), and it must not be the changelog file itself.

```bash
sed -n '19,46p' src/main.ts
```

```output
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
```

### `onVaultChange` and `updateChangelog` — The Core Workflow

`onVaultChange` is the debounced entry point from vault events. It calls `updateChangelog` and catches errors, showing a Notice to the user on failure.

`updateChangelog` is the main pipeline: get all markdown files → filter and sort → generate changelog text → write to file. The Moment.js formatter is injected here as `window.moment` — Obsidian bundles Moment.js globally.

```bash
sed -n '48,70p' src/main.ts
```

```output
    this.registerEvent(this.app.vault.on("delete", handler));
    this.registerEvent(this.app.vault.on("rename", handler));
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
      (mtime, fmt) => window.moment(mtime).format(fmt),
    );
    await this.writeToFile(this.settings.changelogPath, changelog);
  }

  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
```

### `writeToFile` — File I/O with TOCTOU Handling

Creates the changelog file if it doesn't exist, then writes content. The `catch` block handles a TOCTOU race condition: if two concurrent events both see the file as missing and try to create it, the second `vault.create` will fail. The catch re-checks for the file, recovering gracefully.

```bash
sed -n '72,88p' src/main.ts
```

```output
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

  async loadSettings(): Promise<void> {
    const loadedSettings = (await this.loadData()) ?? {};
```

### `loadSettings` — Defensive Deserialization

Settings are loaded from Obsidian's persistent storage and merged with defaults (so new settings added in future versions get safe values). Three normalizations follow: changelog path and excluded folders are run through `normalizePath` for consistent slash handling, and `maxRecentFiles` is validated against NaN, clamped to 1–500, and floored to an integer. This guards against corrupted `data.json`.

```bash
sed -n '90,111p' src/main.ts
```

```output
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

```

## Settings UI: `settings.ts`

The settings tab is the largest file (242 lines) — UI code tends to be verbose. It contains two classes: `PathSuggest` for autocomplete and `ChangelogSettingsTab` for the settings form.

### `PathSuggest` — Path Autocomplete

Extends Obsidian's `AbstractInputSuggest` to provide fuzzy matching against vault folders and markdown files. Used for both the changelog path and excluded folder inputs.

```bash
sed -n '13,57p' src/settings.ts
```

```output
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

export class ChangelogSettingsTab extends PluginSettingTab {
  plugin: ChangelogPlugin;

```

### `ChangelogSettingsTab.display` — Settings Form

The `display` method builds seven settings controls. Notable validation behaviors:

- **Changelog path** validates on `blur` (not `onChange`) to avoid rejecting partial input. Path must end with `.md`; invalid values revert to the previous path with a Notice.
- **Datetime format** shows a live preview below the input, updating on each keystroke. Empty input reverts to the default format.
- **Max recent files** rejects NaN and values below 1 with a Notice, floors decimals, and clamps to `MAX_RECENT_FILES`.
- **Excluded folders** are managed as a dynamic list with add/remove. Validation rejects empty strings and `"."` (vault root). Duplicates are silently ignored.

```bash
sed -n '112,132p' src/settings.ts
```

```output
          .setPlaceholder("Folder/Changelog.md")
          .setValue(settings.changelogPath);

        text.inputEl.addEventListener("blur", async () => {
          const normalized = normalizePath(text.getValue());
          if (!normalized.endsWith(".md")) {
            text.setValue(settings.changelogPath);
            new Notice("Changelog path must end with .md");
            return;
          }
          settings.changelogPath = normalized;
          await this.plugin.saveSettings();
        });

        new PathSuggest(this.app, text.inputEl);
      });

    let datetimePreview: HTMLElement;

    const datetimeSetting = new Setting(containerEl)
      .setName("Datetime format")
```

### Excluded Folders Management

The `renderExcludedFolders` method dynamically renders the folder list with remove buttons. The add flow validates, normalizes, deduplicates, and re-renders.

```bash
sed -n '68,94p' src/settings.ts
```

```output
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

  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;

```

## Tests: `changelog.test.ts`

Tests cover the two pure functions in `changelog.ts` using Bun's built-in test runner. A real Moment.js formatter is used (not a mock) since the function accepts a `TimeFormatter` callback — the dependency injection makes this straightforward.

### `filterAndSort` Tests

Six tests cover: changelog self-exclusion, folder exclusion, descending sort order, the `maxRecentFiles` limit, the case where the limit exceeds file count, and the important prefix-safety test (excluding "Notes" must not exclude "Notes2").

```bash
sed -n '1,6p' src/changelog.test.ts
```

```output
import { describe, expect, test } from "bun:test";
import moment from "moment";

import { filterAndSort, generateChangelog } from "./changelog";

const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);
```

```bash
sed -n '50,67p' src/changelog.test.ts
```

```output
  test("does not exclude folders that share a prefix", () => {
    const filesWithPrefix = [
      { path: "Notes/file.md", basename: "file", stat: { mtime: 100 } },
      { path: "Notes2/file.md", basename: "file2", stat: { mtime: 200 } },
      { path: "Notebook/file.md", basename: "file3", stat: { mtime: 300 } },
    ];
    const result = filterAndSort(
      filesWithPrefix,
      "Changelog.md",
      ["Notes"],
      25,
    );
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      "Notebook/file.md",
      "Notes2/file.md",
    ]);
  });
```

### `generateChangelog` Tests

Four tests cover: default output with wiki-links, plain text output, heading prepended, and empty file list producing an empty string.

```bash
sed -n '84,95p' src/changelog.test.ts
```

```output
  test("generates changelog without heading", () => {
    const result = generateChangelog(
      files,
      "YYYY-MM-DD[T]HHmm",
      true,
      "",
      formatter,
    );
    expect(result).toBe(
      "- 2026-01-15T1430 \u00b7 [[Note B]]\n- 2026-01-15T1400 \u00b7 [[Note A]]\n",
    );
  });
```

### Test Results

```bash
bun test 2>&1 | sed 's/\[.*\]/[...]/' | tail -3
```

```output
 0 fail
 11 expect() calls
Ran 10 tests across 1 file. [...]
```

## Build System: `build.ts`

A compact 35-line build script using Bun's native bundler. Compiles `src/main.ts` to `main.js` in CommonJS format (Obsidian requires CJS). `obsidian` and `electron` are externalized — they're provided by the host app at runtime.

In watch mode (`--watch`), it monitors `src/` recursively with a 100ms debounce. Production builds minify; watch builds don't (for readability during development).

```bash
sed -n '1,35p' build.ts
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
```

## Concerns

### Code Quality

1. **No test coverage for `settings.ts` or `main.ts`.** The settings tab has complex validation logic (blur handlers, NaN checks, path normalization, duplicate detection) that is only tested by manual interaction. The `writeToFile` TOCTOU handling is also untested. The pure functions in `changelog.ts` are well-tested, but the integration layer has zero automated coverage.

2. **`PathSuggest.getSuggestions` scans the entire vault on every keystroke.** No caching, no debounce, no result limit. In a vault with thousands of files, this could produce noticeable lag in the settings UI. The Obsidian `AbstractInputSuggest` base class handles rendering, but the data fetching is unbounded.

3. **Settings mutations are scattered.** Each setting's `onChange` handler directly mutates `this.plugin.settings` and calls `saveSettings()`. This works but means validation logic is spread across 7 different callback closures in `display()`. A single `updateSetting(key, value)` method with centralized validation would reduce surface area for bugs.

### Community Standards

4. **No `onunload` method.** While Obsidian's `registerEvent` handles cleanup for registered events, the lack of an explicit `onunload` signals to plugin reviewers that cleanup was not considered. Adding an empty `onunload` or a comment noting that `registerEvent` handles teardown would satisfy reviewers.

5. **`version-bump.ts` uses synchronous `readFileSync`/`writeFileSync`.** Not a runtime concern (it's a dev script), but inconsistent with the async patterns used everywhere else in the codebase.

### Architecture

6. **The debounce wrapper replaces `onVaultChange` on the instance at runtime** (line 32 of `main.ts`). This works but is subtle — the method signature on the class says `void` but the debounced version returns `void` too, so types align by coincidence. A dedicated debounced property would be more explicit.

7. **`generateChangelog` builds strings with `+=` in a loop.** Fine for the capped maximum of 500 files, but an array with a final `.join("\n")` would be more idiomatic and slightly more efficient.

Overall, this is a clean, well-structured plugin with good separation of concerns. The core logic is pure, testable, and tested. The main improvement opportunities are in expanding test coverage to the integration and UI layers.
