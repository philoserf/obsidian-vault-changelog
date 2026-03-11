# Obsidian Vault Changelog — Code Walkthrough

*2026-03-09T04:27:48Z by Showboat 0.6.1*
<!-- showboat-id: 04e2bb31-3283-4b21-917a-e4f5cc077c2c -->

## Overview

This is an Obsidian plugin that tracks recently edited markdown files and maintains a chronological changelog. When files are created, modified, deleted, or renamed, the plugin regenerates a changelog file listing the most recent changes with timestamps.

The plugin is ~400 lines of TypeScript across three source files, built with Bun, and follows the standard Obsidian plugin architecture.

### Project Structure

```sh
find . -type f \( -name "*.ts" -o -name "*.json" -o -name "*.css" -o -name "*.yml" \) \! -path "./node_modules/*" \! -path "./.claude/*" \! -path "./test-vault/*" \! -path "./bun.lock" | sort
```

```output
./.github/dependabot.yml
./.github/settings.yml
./.github/workflows/main.yml
./.github/workflows/release.yml
./biome.json
./build.ts
./manifest.json
./package.json
./scripts/validate-plugin.ts
./src/main.test.ts
./src/main.ts
./src/settings.ts
./src/suggest.ts
./styles.css
./tsconfig.json
./version-bump.ts
./versions.json
```

The source lives in `src/` with three production files and one test file. Supporting scripts handle builds, version bumps, and validation. Configuration spans `package.json`, `tsconfig.json`, `biome.json`, and `manifest.json`.

---

## 1. Entry Point — Plugin Lifecycle (`src/main.ts`)

The plugin class extends Obsidian's `Plugin` base class. Everything starts in `onload()`, which Obsidian calls when the plugin is activated.

```sh
sed -n '1,28p' src/main.ts
```

```output
import { debounce, Notice, Plugin, type TAbstractFile, TFile } from "obsidian";

import {
  type ChangelogSettings,
  ChangelogSettingsTab,
  DEFAULT_SETTINGS,
} from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: () => this.updateChangelog(),
    });

    this.loadStyles();

    this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);
    this.enableAutoUpdate();
  }

  onunload(): void {}
```

`onload()` does five things in sequence:

1. **Loads persisted settings** from Obsidian's data store, merging with defaults
2. **Registers the settings tab** in Obsidian's preferences UI
3. **Adds the "Update Changelog" command** to the command palette
4. **Loads styles** manually from `styles.css` (more on this below)
5. **Wraps `onVaultChange` in a 200ms debounce** and enables auto-update listeners

The debounce on line 24 is important — vault events fire rapidly (e.g., during bulk operations), and the debounce collapses them into a single changelog update.

`onunload()` is empty. Obsidian automatically cleans up anything registered via `registerEvent()` and `register()`, so no manual teardown is needed.

### Style Loading

```sh
sed -n '30,42p' src/main.ts
```

```output
  async loadStyles(): Promise<void> {
    const cssFile = await this.app.vault.adapter.read(
      `${this.manifest.dir}/styles.css`,
    );
    this.registerStyles(cssFile);
  }

  registerStyles(cssText: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    this.register(() => styleEl.remove());
    document.head.appendChild(styleEl);
  }
```

> **Concern (Issue #99):** Obsidian automatically loads `styles.css` from the plugin directory. This manual loading creates a duplicate `<style>` element in the DOM. The `register()` cleanup callback ensures the manual copy is removed on unload, but while active the styles are applied twice. The entire `loadStyles()`/`registerStyles()` pair can be deleted.

### Auto-Update Event Listeners

```sh
sed -n '44,76p' src/main.ts
```

```output
  enableAutoUpdate(): void {
    if (this.settings.autoUpdate) {
      this.registerEvent(
        this.app.vault.on("modify", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("delete", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("rename", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );
    }
  }

  onVaultChange(file: TFile): void {
    if (file.path !== this.settings.changelogPath) {
      this.updateChangelog();
    }
  }
```

Three vault events trigger changelog updates: `modify`, `delete`, and `rename`. Each listener checks that the event target is a `TFile` (not a folder) and delegates to the debounced `onVaultChange`.

`onVaultChange` has one guard: it skips changes to the changelog file itself to prevent infinite recursion (editing the changelog would trigger another update, which would edit the changelog again…).

> **Concern (Issue #97):** `enableAutoUpdate()` calls `registerEvent()` which binds listeners for the plugin's lifetime. If a user toggles auto-update off and on in settings, the old listeners are never removed — only new ones are added. Each toggle-on accumulates another set of three listeners. The setting change takes effect only on plugin reload.

### Core Logic — Changelog Generation

```sh
sed -n '78,104p' src/main.ts
```

```output
  async updateChangelog(): Promise<void> {
    const changelog = await this.generateChangelog();
    await this.writeToFile(this.settings.changelogPath, changelog);
  }

  async generateChangelog(): Promise<string> {
    const recentFiles = this.getRecentlyEditedFiles();

    let changelogContent = "";

    if (this.settings.changelogHeading) {
      changelogContent += `${this.settings.changelogHeading}\n\n`;
    }

    recentFiles.forEach((file) => {
      const m = window.moment(file.stat.mtime);
      const formattedTime = m.format(this.settings.datetimeFormat);

      const fileName = this.settings.useWikiLinks
        ? `[[${file.basename}]]`
        : file.basename;

      changelogContent += `- ${formattedTime} · ${fileName}\n`;
    });

    return changelogContent;
  }
```

`updateChangelog()` is the two-step pipeline: generate content, then write to file. The changelog is **entirely overwritten** each time — it's not appended to.

`generateChangelog()` builds a markdown list. Each line has the format `- 2026-01-15T1430 · [[Note Name]]`.

Key details:
- Timestamps come from `window.moment` (Obsidian provides Moment.js globally at runtime — never import it directly)
- Wiki-links (`[[…]]`) are optional, controlled by the `useWikiLinks` setting
- An optional heading is prepended if configured

### File Filtering and Sorting

```sh
sed -n '106,124p' src/main.ts
```

```output
  getRecentlyEditedFiles(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (file.path === this.settings.changelogPath) {
          return false;
        }

        for (const folder of this.settings.excludedFolders) {
          if (file.path.startsWith(folder)) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, this.settings.maxRecentFiles);
  }
```

This is the filtering pipeline:

1. **Get all markdown files** from the vault
2. **Exclude the changelog itself** (prevents recursion)
3. **Exclude files in excluded folders** via `startsWith()` path matching
4. **Sort by modification time** (newest first)
5. **Limit** to `maxRecentFiles` entries

> **Concern (Issue #101):** The `startsWith(folder)` check on line 115 has no path delimiter enforcement. An excluded folder of `"Archive"` would also match `"Archives/"`, `"Archived/"`, or any path beginning with that string. The fix is to ensure excluded folder strings always end with `/` before comparison.

> **Concern (Issue #100):** Excluded folder paths are saved raw from user input. The changelog path uses `normalizePath()` but excluded folders do not, leading to inconsistent behavior with trailing slashes, double slashes, etc.

### File Writing

```sh
sed -n '126,136p' src/main.ts
```

```output
  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      file = await this.app.vault.create(path, "");
    }
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      new Notice(`Could not update changelog at path: ${path}`);
    }
  }
```

The write strategy: check if the file exists, create it if not, then modify with the new content. If the path resolves to a folder instead of a file, the user gets a `Notice` (Obsidian's toast notification).

> **Concern (Issue #110):** There's a TOCTOU (time-of-check-time-of-use) gap between `getAbstractFileByPath()` and `create()`. Two rapid events could both see "no file" and attempt creation simultaneously. The 200ms debounce makes this unlikely in practice, but a try/catch around `create()` would be more robust.

### Settings Persistence

```sh
sed -n '138,149p' src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

Settings are loaded by spreading saved data over defaults. This is the standard Obsidian pattern — it ensures new settings added in future versions get their default values even when loading old saved data.

---

## 2. Settings UI (`src/settings.ts`)

The settings tab renders Obsidian's native settings UI components.

```sh
sed -n '1,30p' src/settings.ts
```

```output
import {
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";

import type ChangelogPlugin from "./main";
import { PathSuggest } from "./suggest";

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

Seven settings with sensible defaults:

| Setting | Default | Purpose |
|---------|---------|---------|
| `autoUpdate` | `false` | Listen for vault events |
| `changelogPath` | `"Changelog.md"` | Output file location |
| `datetimeFormat` | `"YYYY-MM-DD[T]HHmm"` | Moment.js format string |
| `maxRecentFiles` | `25` | Cap on entries |
| `excludedFolders` | `[]` | Paths to skip |
| `useWikiLinks` | `true` | `[[links]]` vs plain text |
| `changelogHeading` | `""` | Optional heading line |

### Settings UI — Validation Logic

```sh
sed -n '68,139p' src/settings.ts
```

```output
  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Auto update")
      .setDesc("Automatically update changelog on vault changes")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoUpdate).onChange(async (value) => {
          settings.autoUpdate = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.enableAutoUpdate();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Changelog path")
      .setDesc("Relative path including filename and extension")
      .addText((text) => {
        text
          .setPlaceholder("Folder/Changelog.md")
          .setValue(settings.changelogPath)
          .onChange(async (path) => {
            settings.changelogPath = normalizePath(path);
            await this.plugin.saveSettings();
          });

        new PathSuggest(this.app, text.inputEl);
      });

    new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js datetime format string")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          .onChange(async (format) => {
            const m = window.moment();
            const isValid = m.format(format) !== "Invalid date";

            if (!isValid) {
              text.setValue(settings.datetimeFormat);
              new Notice("Invalid datetime format");
              return;
            }

            settings.datetimeFormat = format;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max recent files")
      .setDesc("Maximum number of recently edited files to include")
      .addText((text) =>
        text
          .setValue(settings.maxRecentFiles.toString())
          .onChange(async (value) => {
            const numValue = Number(value);
            if (Number.isNaN(numValue) || numValue < 1) {
              text.setValue(settings.maxRecentFiles.toString());
              return;
            }
            settings.maxRecentFiles = numValue;
            await this.plugin.saveSettings();
          }),
      );
```

Several validation patterns here:

- **Changelog path** (line 95): Normalized via Obsidian's `normalizePath()` before saving. Good.
- **Max recent files** (lines 131-135): Rejects `NaN` and values below 1, reverting to the current value. Good.
- **Datetime format** (lines 110-111): This is the broken validation.

> **Concern (Issue #98):** `moment().format("garbage")` returns `"garbage"` — Moment.js passes through any string it doesn't recognize as a format token. It never returns `"Invalid date"` for format strings. The `isValid` check on line 111 is a no-op; every format string passes. A real validation would need to verify that the format contains at least one recognized Moment.js date/time token.

### Excluded Folders Management

```sh
sed -n '40,66p' src/settings.ts
```

```output
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

```sh
sed -n '166,192p' src/settings.ts
```

```output
    containerEl.createEl("h3", { text: "Excluded folders" });

    const excludedFoldersList = containerEl.createDiv("excluded-folders-list");
    this.renderExcludedFolders(excludedFoldersList);

    new Setting(containerEl)
      .setName("Add excluded folder")
      .setDesc("Folders to exclude from the changelog")
      .addText((text) => {
        text.setPlaceholder("folder/path/");
        new PathSuggest(this.app, text.inputEl);
      })
      .addButton((button) => {
        button.setButtonText("Add").onClick(async () => {
          const input = button.buttonEl.parentElement?.querySelector("input");
          if (input) {
            const folderPath = input.value;
            if (folderPath && !settings.excludedFolders.includes(folderPath)) {
              settings.excludedFolders.push(folderPath);
              await this.plugin.saveSettings();
              input.value = "";
              this.renderExcludedFolders(excludedFoldersList);
            }
          }
        });
      });
  }
```

The excluded folders UI is a custom list with add/remove buttons. Each folder renders as a row with a "✕" remove button. The `renderExcludedFolders` method re-renders the entire list on any change — simple and effective for a small list.

Note that the remove button uses `addEventListener("click", ...)` directly (line 57) rather than Obsidian's event registration. Since `renderExcludedFolders` calls `container.empty()` first (which removes old DOM elements and their listeners), this doesn't leak in practice.

The add button on line 180 queries the DOM for the input element via `parentElement?.querySelector("input")` — a fragile coupling to Obsidian's internal DOM structure, but standard practice in the plugin ecosystem.

---

## 3. Path Autocomplete (`src/suggest.ts`)

```sh
cat src/suggest.ts
```

```output
import { AbstractInputSuggest, type App } from "obsidian";

export class PathSuggest extends AbstractInputSuggest<string> {
  inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

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

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    this.inputEl.trigger("input");
    this.close();
  }
}
```

The smallest file in the project — a clean implementation of Obsidian's `AbstractInputSuggest` pattern.

`getSuggestions()` searches all vault folders (with trailing `/` appended) and markdown files, doing case-insensitive substring matching against the user's input. `selectSuggestion()` sets the input value and triggers an `input` event to notify the onChange handler.

This is used in two places: the changelog path input and the excluded folders input.

---

## 4. Styling (`styles.css`)

```sh
cat styles.css
```

```output
.excluded-folders-list {
	margin-bottom: 1em;
}

.excluded-folder-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	background-color: var(--background-secondary);
	border-radius: 4px;
	padding: 4px 8px;
	margin-bottom: 6px;
}

.excluded-folder-remove {
	cursor: pointer;
	border: none;
	background: transparent;
	color: var(--text-muted);
	padding: 0 4px;
	font-size: 14px;
}

.excluded-folder-remove:hover {
	color: var(--text-error);
}
```

Styles only apply to the excluded folders list in the settings tab. Good practice throughout:

- Uses Obsidian CSS custom properties (`--background-secondary`, `--text-muted`, `--text-error`) instead of hardcoded colors — respects light/dark themes automatically
- Minimal, focused styles — no global selectors that could conflict with other plugins

---

## 5. Build System (`build.ts`)

```sh
cat build.ts
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

if (watch) console.log("Watching for changes...");

export {};
```

A concise build script using Bun's native bundler. Key decisions:

- **CommonJS output** (`format: "cjs"`) — required by Obsidian's plugin loader
- **`obsidian` and `electron` marked external** — these are provided by Obsidian at runtime, not bundled
- **Minification** only in production (when `--watch` is not passed)
- The `export {}` on the last line makes this a proper ES module (required by `"type": "module"` in package.json)

The build outputs `main.js` to the project root. In development, `bun run dev` invokes this with `--watch` for auto-rebuilding.

Note the `package.json` `build` script runs `check` first (typecheck + lint), so a production build cannot succeed with type errors or lint violations.

---

## 6. Configuration Files

```sh
cat tsconfig.json
```

```output
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["DOM", "ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "build.ts", "version-bump.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

TypeScript is used for type-checking only (`noEmit: true`) — Bun handles the actual compilation and bundling. `strict: true` enables all strict checks (null safety, implicit any, etc.). `skipLibCheck: true` avoids checking `.d.ts` files from dependencies, which speeds up type-checking and avoids issues with conflicting type declarations.

```sh
cat biome.json
```

```output
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": [
      "src/**/*.ts",
      "src/**/*.js",
      "*.json",
      "scripts/**/*.ts",
      "version-bump.ts",
      "build.ts"
    ],
    "ignoreUnknown": true
  },
  "formatter": {
    "indentStyle": "space"
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Biome handles both linting and formatting. VCS integration means it respects `.gitignore`. Import organization is enabled. The `includes` list is explicit — only source files and config JSON are checked.

---

## 7. Release & CI

```sh
cat .github/workflows/main.yml
```

```output
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun audit --audit-level=critical
      - run: bun run check
      - run: bun test
```

CI runs on every push to `main` and on PRs. It runs `bun run check`, which is `tsc --noEmit && biome check .` — type-checking and linting.

> **Concern (Issue #109):** The CI workflow does not run `bun test`. Tests exist and cover core logic, but regressions won't be caught until someone runs tests locally.

```sh
cat .github/workflows/release.yml
```

```output
name: Release

on:
  push:
    tags:
      - "*"

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: |
          bun install
          bun run build

      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            main.js
            styles.css
            manifest.json
          fail_on_unmatched_files: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Releases are tag-triggered. Push any tag and the workflow builds the plugin and creates a GitHub release with the three files Obsidian needs: `main.js`, `manifest.json`, and `styles.css`. The `fail_on_unmatched_files: true` flag ensures the release fails if any artifact is missing.

The release process:
1. Bump version in `package.json`
2. Run `bun run version` to sync `manifest.json` and `versions.json`
3. Commit and tag
4. Push the tag — GitHub Actions handles the rest

---

## 8. Version Management (`version-bump.ts`)

```sh
cat version-bump.ts
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

Invoked via `bun run version` (which sets `npm_package_version` from `package.json`). It keeps three files in sync:

- `package.json` — source of truth (edited manually)
- `manifest.json` — Obsidian reads this at runtime
- `versions.json` — maps plugin versions to minimum Obsidian versions (used by Obsidian's plugin installer)

---

## 9. Plugin Validation (`scripts/validate-plugin.ts`)

```sh
cat scripts/validate-plugin.ts
```

```output
#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { $ } from "bun";

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
console.log(`🔍 Validating ${manifest.name || "plugin"}...\n`);

let errors = 0;

// Check manifest.json
if (!manifest.id || !manifest.name || !manifest.version) {
  console.error("✗ manifest.json missing required fields");
  errors++;
} else {
  console.log(`✓ manifest.json — ${manifest.name} v${manifest.version}`);
}

// Check package.json version matches manifest
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  if (pkg.version !== manifest.version) {
    console.error(
      `✗ Version mismatch: package.json (${pkg.version}) != manifest.json (${manifest.version})`,
    );
    errors++;
  } else {
    console.log("✓ Version numbers match");
  }
} catch (error) {
  console.error("✗ Version check failed:", error);
  errors++;
}

// Run checks
console.log("\n🔧 Checking code quality...");
const checkResult = await $`bun run check`.nothrow();
if (checkResult.exitCode === 0) {
  console.log("✓ Code quality checks passed");
} else {
  console.error("✗ Code quality checks failed");
  errors++;
}

// Build the plugin
console.log("\n📦 Building plugin...");
const buildResult = await $`bun run build.ts`.nothrow();
if (buildResult.exitCode === 0) {
  console.log("✓ Build successful");

  const mainFile = Bun.file("main.js");
  if (await mainFile.exists()) {
    const size = mainFile.size / 1024;
    console.log(`  Output: main.js (${size.toFixed(2)} KB)`);
  } else {
    console.error("✗ main.js not found after build");
    errors++;
  }
} else {
  console.error("✗ Build failed");
  errors++;
}

// Summary
console.log(`\n${"=".repeat(50)}`);
if (errors === 0) {
  console.log("✅ All validations passed! Plugin is ready.");
  process.exit(0);
} else {
  console.log(`❌ Validation failed with ${errors} error(s).`);
  process.exit(1);
}
```

A pre-release sanity check that verifies:
1. `manifest.json` has required fields (`id`, `name`, `version`)
2. Version numbers match between `package.json` and `manifest.json`
3. Code quality checks pass (`tsc` + Biome)
4. The build produces a `main.js` file

Uses Bun's `$` shell API with `.nothrow()` to capture exit codes without throwing on failure.

---

## 10. Test Suite (`src/main.test.ts`)

```sh
sed -n '1,17p' src/main.test.ts
```

```output
import { describe, expect, test } from "bun:test";
import moment from "moment";

// Provide window.moment for code that uses it
// @ts-expect-error global mock
globalThis.window = { moment };

// Inline defaults to avoid importing obsidian via settings.ts
const DEFAULT_SETTINGS = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [] as string[],
  useWikiLinks: true,
  changelogHeading: "",
};
```

The test file can't import from `settings.ts` because that imports from the `obsidian` module, which isn't available outside Obsidian. So it:

1. Mocks `window.moment` by assigning to `globalThis.window`
2. Duplicates `DEFAULT_SETTINGS` inline
3. Re-implements the pure logic functions (`formatChangelogEntry`, `filterAndSortFiles`, `generateChangelog`)

> **Concern (Issue #111):** The duplicated `DEFAULT_SETTINGS` can drift from the real defaults. If a setting is added or a default changes in `settings.ts`, the test copy won't know.

> **Concern (Issue #113):** The tests re-implement the core logic rather than testing the actual code. `formatChangelogEntry` in the test file is a copy of the logic in `ChangelogPlugin.generateChangelog()`, not a call to it. This means the tests verify the test's own implementation, not the plugin's. Extracting the pure functions to a shared module would fix both issues.

Let's verify the tests pass:

```sh
bun test 2>&1 | grep -E '^\s+\d+ (pass|fail)'
```

```output
 18 pass
 0 fail
```

18 tests, all passing. Coverage spans:

- Default settings values
- Changelog entry formatting (wiki-links, plain text, custom formats)
- File filtering (changelog exclusion, folder exclusion, sorting, limits)
- Changelog generation (with/without heading, empty list)
- Datetime validation (valid formats)
- Max files validation (NaN, zero, negative, positive)

**Missing test coverage:**
- `writeToFile()` (create vs modify paths)
- `loadSettings()` (merge behavior with partial saved data)
- The debounce + event listener pipeline
- Invalid datetime format rejection (which would actually reveal Issue #98)

---

## 11. Data Flow Summary

Here's how everything connects end-to-end:

1. **Plugin loads** → `onload()` sets up command, settings tab, styles, debounce, and event listeners
2. **Vault event fires** (modify/delete/rename) → debounced `onVaultChange()` checks it's not the changelog file
3. **`updateChangelog()`** → calls `getRecentlyEditedFiles()` to filter and sort, then `generateChangelog()` to format
4. **`writeToFile()`** → creates or overwrites the changelog at the configured path
5. **Settings changes** → saved immediately via `saveSettings()`, some validated (path normalized, number range-checked, datetime format "validated")

The manual command ("Update Changelog") bypasses the event system and calls `updateChangelog()` directly.

---

## 12. Adherence to Community Standards

### What's done well

- **Standard plugin structure**: `manifest.json`, `main.js`, `styles.css` — the three files Obsidian expects
- **`registerEvent()` for vault listeners**: Obsidian auto-cleans these on unload
- **`normalizePath()` for the changelog path**: Uses Obsidian's built-in path normalization
- **CSS custom properties**: Respects Obsidian themes
- **`window.moment`**: Correctly uses Obsidian's global Moment.js rather than importing it
- **Settings spread pattern**: `{ ...DEFAULT_SETTINGS, ...loadedSettings }` is the community-standard approach
- **Tag-triggered releases**: Follows the Obsidian community plugin release convention
- **`versions.json`**: Maintained for Obsidian's plugin compatibility checker
- **Strict TypeScript**: `strict: true` catches common mistakes

### What needs attention

| Issue | Severity | Standard violated |
|-------|----------|-------------------|
| #97 — Listener leak on toggle | HIGH | Obsidian expects `registerEvent` to be called once in `onload`, not repeatedly from settings |
| #98 — Datetime validation no-op | HIGH | User input should be validated at system boundaries |
| #99 — Duplicate style loading | MEDIUM | Obsidian auto-loads `styles.css`; manual loading is redundant |
| #100 — Excluded paths not normalized | MEDIUM | Inconsistent with changelog path handling |
| #101 — Folder matching lacks delimiter | MEDIUM | `startsWith` without `/` is a known pattern bug |
| #109 — Tests not in CI | HIGH | Community norm is to run tests in CI |
| #113 — Tests don't test real code | MEDIUM | Test doubles should exercise production paths |
