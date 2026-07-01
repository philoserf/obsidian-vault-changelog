# Obsidian Vault Changelog Walkthrough

*2026-07-01T17:56:44Z by Showboat 0.6.1*
<!-- showboat-id: c0dcf9c0-fe5d-451d-a786-1f43c5ee96a9 -->

## Overview

**Vault Changelog** is an Obsidian plugin that maintains a changelog file listing recently edited notes. The changelog is **fully overwritten** on every update — no history is preserved, no diffing, just a fresh render of "these are the N most recently modified notes right now."

Built with Bun (bundler + test runner + package manager) and TypeScript, targeting the Obsidian plugin API. Biome handles linting/formatting.

## Architecture

The codebase has an intentional split between pure logic and Obsidian integration:

- `src/changelog.ts` — **pure functions**, no Obsidian imports. Settings shape, validation/normalization, file filtering/sorting, and changelog text generation. Every unit test targets this file.
- `src/main.ts` — `ChangelogPlugin extends Plugin`. Wires up the command palette entry, vault event handlers, debouncing, and file I/O.
- `src/settings.ts` — `ChangelogSettingsTab` (the settings UI) and `PathSuggest` (an autocomplete helper for path-shaped fields).

This split exists so the interesting logic (validation, filtering, formatting) can be unit tested with plain Bun `test`, without mocking Obsidian's `App`/`Vault`/`TFile` machinery. Obsidian-specific behavior (like `normalizePath` or `window.moment`) is injected into the pure functions as callback parameters.

```bash
cat manifest.json
```

```output
{
  "id": "obsidian-vault-changelog",
  "name": "Vault Changelog",
  "version": "1.5.3",
  "minAppVersion": "1.6.6",
  "description": "Maintain a changelog of recently edited notes.",
  "author": "Mark Ayers (originally by Badr Bouslikhin)",
  "authorUrl": "https://github.com/philoserf",
  "fundingUrl": "https://buymeacoffee.com/philoserf",
  "isDesktopOnly": false
}
```

## Settings shape and defaults

`ChangelogSettings` is the single source of truth for the plugin's persisted configuration. `DEFAULT_SETTINGS` doubles as both the initial state and the fallback value for every field-level validation guard described below.

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

## Clamping `maxRecentFiles`

`clampMaxRecentFiles` is the one authoritative rule for this field: coerce to a number, fall back to the default if not finite, then floor and clamp to `[1, MAX_RECENT_FILES]`. Both the settings-load path and the settings UI call this same function, so the rule can't drift between the two call sites.

```bash
sed -n '21,32p' src/changelog.ts
```

```output
export const MAX_RECENT_FILES = 500;

/**
 * The one authoritative clamping rule for maxRecentFiles: floor to an
 * integer and clamp to [1, MAX_RECENT_FILES]; non-finite input falls back
 * to the default. Load-time and the settings UI both call this.
 */
export function clampMaxRecentFiles(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.maxRecentFiles;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}
```

## Normalizing persisted settings

`normalizeLoadedSettings` turns whatever Obsidian's `loadData()` returns (an untyped blob from `data.json`) into a valid, fully-typed `ChangelogSettings`.

It does four things in sequence:

1. **Drop unknown keys.** Only keys present in `DEFAULT_SETTINGS` survive, so a renamed or removed setting from an older version doesn't linger forever.
2. **Type-guard known keys.** A hand-edited or corrupted `data.json` can have the right key with the wrong runtime type (`"datetimeFormat": 123`, `"excludedFolders": null`, `"autoUpdate": "false"`). Every field that later gets dereferenced with a type-specific method (`.trim()`, `.map()`, `Array.isArray`) or rendered as a specific widget (a toggle expects a real boolean) falls back to its default rather than crashing plugin load partway through `onload()`.
3. **Normalize paths.** `changelogPath` and every `excludedFolders` entry go through an injected `normalize` function (Obsidian's `normalizePath` in production), so downstream duplicate-detection and comparisons stay consistent.
4. **Clamp and trim.** `maxRecentFiles` goes through `clampMaxRecentFiles`; `changelogHeading` is trimmed so `generateChangelog`'s `"\n\n"` spacing stays predictable.

`normalize` is injected as a parameter (rather than imported directly) specifically so this function — and the rest of `changelog.ts` — can stay Obsidian-free and unit-testable with a plain identity function in tests.

```bash
sed -n '34,79p' src/changelog.ts
```

```output
/**
 * Turn persisted data into valid settings: drop unknown keys (so renamed
 * or removed settings don't linger), fall back to defaults for known keys
 * whose runtime type doesn't match (guards against hand-edited or corrupt
 * data.json), normalize folder paths so duplicate detection in the
 * settings UI stays consistent, clamp maxRecentFiles, and trim the
 * heading so generateChangelog's "\n\n" spacing stays predictable.
 * `normalize` is injected (Obsidian's normalizePath in production) to
 * keep this module Obsidian-free.
 */
export function normalizeLoadedSettings(
  raw: unknown,
  normalize: (path: string) => string,
): ChangelogSettings {
  const loaded = (raw ?? {}) as Record<string, unknown>;
  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(loaded)) {
    if (knownKeys.has(key)) {
      filtered[key] = loaded[key];
    }
  }
  const settings: ChangelogSettings = {
    ...DEFAULT_SETTINGS,
    ...(filtered as Partial<ChangelogSettings>),
  };
  for (const key of [
    "changelogPath",
    "changelogHeading",
    "datetimeFormat",
  ] as const) {
    if (typeof settings[key] !== "string")
      settings[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ["autoUpdate", "useWikiLinks"] as const) {
    if (typeof settings[key] !== "boolean")
      settings[key] = DEFAULT_SETTINGS[key];
  }
  if (
    !Array.isArray(settings.excludedFolders) ||
    !settings.excludedFolders.every((folder) => typeof folder === "string")
  ) {
    settings.excludedFolders = DEFAULT_SETTINGS.excludedFolders;
  }
  settings.changelogPath = normalize(settings.changelogPath);
  settings.excludedFolders = settings.excludedFolders.map(normalize);
```

## Path and folder validation

Two small, independently testable predicates back the settings UI's input validation:

```bash
sed -n '81,100p' src/changelog.ts
```

```output
  settings.changelogHeading = settings.changelogHeading.trim();
  return settings;
}

/** The changelog must be a markdown file; paths are validated post-normalize. */
export function isValidChangelogPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".md");
}

export type ExcludedFolderVerdict = "ok" | "invalid" | "duplicate";

/**
 * Validate a normalized folder path before adding it to excludedFolders:
 * empty input and the vault root are invalid; an already-listed folder is
 * a duplicate.
 */
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
```

## Filtering and sorting recent files

`filterAndSort` is the core selection logic: exclude the changelog file itself (so it never lists its own last-modified time), exclude anything under an excluded folder, sort newest-first by modification time, then cap to `maxRecentFiles`.

```bash
sed -n '102,125p' src/changelog.ts
```

```output
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}

interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}

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
```

## Generating the changelog text

`generateChangelog` takes the already-filtered/sorted file list and renders it as markdown: an optional heading, then one bullet per file with a formatted timestamp and either a wiki-link or a plain filename. `formatTime` is injected as a `TimeFormatter` callback (backed by `window.moment` in production) so this function needs no Obsidian import either.

```bash
sed -n '127,146p' src/changelog.ts
```

```output
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}

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
```

## Plugin lifecycle: `onload`

`ChangelogPlugin.onload` loads settings, registers the settings tab, adds a command-palette entry, and wires up vault event handlers for `modify`/`delete`/`rename`. Every handler funnels through the same debounced updater — 200ms, via Obsidian's `debounce` helper — so a burst of file changes triggers one regeneration, not one per file. The handler explicitly skips edits to the changelog file itself, which prevents the write in `updateChangelog` from re-triggering its own `modify` event.

```bash
sed -n '1,53p' src/main.ts
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
  normalizeLoadedSettings,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    void this.updateChangelog().catch(() => {
      new Notice("Failed to update changelog");
    });
  }, 200);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: () => {
        this.updateChangelog().catch(() => {
          new Notice("Failed to update changelog");
        });
      },
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

## Regenerating and writing the changelog

`updateChangelog` composes the pure functions from `changelog.ts`: pull all markdown files from the vault, filter/sort them, render the text, then write it out. `writeToFile` tolerates a TOCTOU race — if `vault.create` throws because a concurrent event already created the file, it falls back to `getAbstractFileByPath` instead of surfacing an error.

```bash
sed -n '55,88p' src/main.ts
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

## Settings persistence

`loadSettings` is where `normalizeLoadedSettings` gets its Obsidian dependency injected: `normalizePath` for folder/path normalization. `saveSettingsSafely` wraps the async save in a `.catch()` so a failed write surfaces as a `Notice` instead of an unhandled rejection — the settings UI calls this variant on every field change rather than awaiting `saveSettings` directly.

```bash
sed -n '90,108p' src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }

  onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  saveSettingsSafely(): void {
    this.saveSettings().catch(() => {
      new Notice("Failed to save changelog settings");
    });
  }
}
```

## Path autocomplete: `PathSuggest`

`PathSuggest` extends Obsidian's `AbstractInputSuggest` to offer folder and markdown-file completions for any text input. It lazily builds and caches the full path list on first use (`getPaths`) rather than rescanning the vault on every keystroke — the cache lives for the lifetime of the settings tab render, since `display()` rebuilds the whole tab (and a fresh `PathSuggest`) each time it's opened.

```bash
sed -n '19,59p' src/settings.ts
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
```

## Rendering the excluded-folders list

`renderExcludedFolders` redraws the excluded-folder list into its container div. Each entry gets a remove button; clicking it splices the folder out of `settings.excludedFolders`, saves, and re-renders just this sub-list rather than the whole settings tab. The button carries an `aria-label` — its only visible content is a "✕" glyph, which conveys "remove" to sighted users via context and hover styling but nothing to a screen reader without an explicit label.

```bash
sed -n '69,96p' src/settings.ts
```

```output
  renderExcludedFolders(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.excludedFolders.length === 0) {
      container.createDiv({ text: "No excluded folders" });
      return;
    }

    this.plugin.settings.excludedFolders.forEach((folder) => {
      const folderDiv = container.createDiv("excluded-folder-item");
      folderDiv.createSpan({ text: folder });

      const removeButton = folderDiv.createEl("button", {
        text: "✕",
        cls: "excluded-folder-remove",
        attr: { "aria-label": "Remove excluded folder" },
      });

      removeButton.addEventListener("click", () => {
        const index = this.plugin.settings.excludedFolders.indexOf(folder);
        if (index > -1) {
          this.plugin.settings.excludedFolders.splice(index, 1);
          this.plugin.saveSettingsSafely();
          this.renderExcludedFolders(container);
        }
      });
    });
  }
```

## The settings tab: two validation-timing conventions

`display()` builds the whole settings tab from scratch on every open (`containerEl.empty()` first), so there's no risk of stale listeners accumulating across renders. Text fields in this tab follow one of two conventions, chosen per field based on what the field needs:

- **Validate on `blur`, revert + `Notice` on failure.** Used for `changelogPath` and `maxRecentFiles` — both have a hard validity constraint (must end in `.md`; must be an integer in range) and both need to tolerate the user clearing the field mid-edit without getting fought over every keystroke. `PathSuggest.selectSuggestion` (above) explicitly dispatches a synthetic `blur` event so picking a suggestion commits immediately, exercising the same commit path as manually blurring the field.
- **Validate on every `onChange`.** Used for `datetimeFormat` (drives a live preview that must update per keystroke) and `changelogHeading` (just trims — no invalid state to fight the user over).

```bash
sed -n '113,134p' src/settings.ts
```

```output

    new Setting(containerEl)
      .setName("Changelog path")
      .setDesc("Relative path including filename and extension")
      .addText((text) => {
        text
          .setPlaceholder("Folder/Changelog.md")
          .setValue(settings.changelogPath);

        text.inputEl.addEventListener("blur", () => {
          const normalized = normalizePath(text.getValue());
          if (!isValidChangelogPath(normalized)) {
            text.setValue(settings.changelogPath);
            new Notice("Changelog path must end with .md");
            return;
          }
          settings.changelogPath = normalized;
          this.plugin.saveSettingsSafely();
        });

        new PathSuggest(this.app, text.inputEl);
      });
```

The datetime format field is the `onChange` counterpart — every keystroke updates both the setting and a live preview rendered via `window.moment`:

```bash
sed -n '136,157p' src/settings.ts
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
          .onChange((format) => {
            const nextFormat = format || DEFAULT_SETTINGS.datetimeFormat;
            if (!format) {
              text.setValue(nextFormat);
            }
            settings.datetimeFormat = nextFormat;
            datetimePreview.textContent = `Preview: ${window.moment().format(nextFormat)}`;
            this.plugin.saveSettingsSafely();
          }),
      );

    datetimePreview = datetimeSetting.descEl.createDiv({
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
```

`maxRecentFiles` is the second `blur`-validated field. It used to validate on `onChange`, which fought the user when they cleared the field to retype a new value — `Number("")` is `0`, which failed the `< 1` check on every keystroke of the clear. Moving validation to `blur` (matching `changelogPath`'s convention above) fixes that: the field only gets checked, clamped via `clampMaxRecentFiles`, and saved once the user is done editing.

```bash
sed -n '160,182p' src/settings.ts
```

```output
    new Setting(containerEl)
      .setName("Max recent files")
      .setDesc(
        `Maximum number of recently edited files to include (1\u2013${MAX_RECENT_FILES})`,
      )
      .addText((text) => {
        text.setValue(settings.maxRecentFiles.toString());

        text.inputEl.addEventListener("blur", () => {
          const numValue = Number(text.getValue());
          if (Number.isNaN(numValue) || numValue < 1) {
            text.setValue(settings.maxRecentFiles.toString());
            new Notice(
              `Max recent files must be between 1 and ${MAX_RECENT_FILES}`,
            );
            return;
          }
          const flooredValue = clampMaxRecentFiles(numValue);
          settings.maxRecentFiles = flooredValue;
          text.setValue(flooredValue.toString());
          this.plugin.saveSettingsSafely();
        });
      });
```

The remaining fields are simple toggles and an unconstrained trimmed-text field, plus the "add excluded folder" control that reuses `validateExcludedFolder` from `changelog.ts`:

```bash
sed -n '184,243p' src/settings.ts
```

```output
    new Setting(containerEl)
      .setName("Use wiki-links")
      .setDesc("Format filenames as wiki-links [[note]] instead of plain text")
      .addToggle((toggle) =>
        toggle.setValue(settings.useWikiLinks).onChange((value) => {
          settings.useWikiLinks = value;
          this.plugin.saveSettingsSafely();
        }),
      );

    new Setting(containerEl)
      .setName("Changelog heading")
      .setDesc(
        "Optional heading to prepend to the changelog, written literally (e.g., # Changelog). Leave empty for no heading.",
      )
      .addText((text) =>
        text
          .setPlaceholder("# Changelog")
          .setValue(settings.changelogHeading)
          .onChange((value) => {
            settings.changelogHeading = value.trim();
            this.plugin.saveSettingsSafely();
          }),
      );

    new Setting(containerEl).setName("Excluded folders").setHeading();

    const excludedFoldersList = containerEl.createDiv("excluded-folders-list");
    this.renderExcludedFolders(excludedFoldersList);

    let folderInputEl: HTMLInputElement;

    new Setting(containerEl)
      .setName("Add excluded folder")
      .setDesc("Folders to exclude from the changelog")
      .addText((text) => {
        text.setPlaceholder("folder/path/");
        folderInputEl = text.inputEl;
        new PathSuggest(this.app, folderInputEl);
      })
      .addButton((button) => {
        button.setButtonText("Add").onClick(() => {
          const folder = normalizePath(folderInputEl.value);
          const verdict = validateExcludedFolder(
            folder,
            settings.excludedFolders,
          );
          if (verdict === "invalid") {
            new Notice(
              "Excluded folder path cannot be empty or the vault root",
            );
            return;
          }
          if (verdict === "ok") {
            settings.excludedFolders.push(folder);
            this.plugin.saveSettingsSafely();
            folderInputEl.value = "";
            this.renderExcludedFolders(excludedFoldersList);
          }
        });
```

## Build system

`build.ts` uses Bun's native bundler directly (no webpack/esbuild wrapper): single entry point `src/main.ts` → `main.js`, CommonJS output, `obsidian`/`electron` marked external (Obsidian provides these at runtime — bundling them would bloat the plugin and risk API mismatches). Production builds are minified; watch mode adds inline sourcemaps and skips rebuilding when only test files change.

```bash
cat build.ts
```

```output
const isWatch = process.argv.includes("--watch");

async function build() {
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: ".",
    format: "cjs",
    external: ["obsidian", "electron"],
    minify: !isWatch,
    sourcemap: isWatch ? "linked" : "none",
  });

  if (!result.success) {
    console.error("Build failed");
    for (const message of result.logs) console.error(message);
    if (!isWatch) process.exit(1);
    return;
  }

  console.log(
    `Built main.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`,
  );
}

await build();

if (isWatch) {
  console.log("Watching src/ for changes...");
  const { watch } = await import("node:fs");
  let timeout: ReturnType<typeof setTimeout> | null = null;

  watch("src", { recursive: true }, (_event, filename) => {
    if (!filename?.endsWith(".ts")) return;
    if (filename.includes(".test.")) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log(`\nRebuilding (${filename} changed)...`);
      build().catch((err) => {
        console.error("Rebuild failed:", err);
      });
    }, 100);
  });
}

export {};
```

## Tests

All 30 tests live in `src/changelog.test.ts` and exercise only the pure functions in `changelog.ts` — no Obsidian mocking required. The `normalizeLoadedSettings` suite is the largest, since it now covers both the original normalize/clamp/trim behavior and the type-guard fallback behavior added for malformed persisted settings:

```bash
grep -c 'test(' src/changelog.test.ts
```

```output
30
```

```bash
grep -n 'describe(\|test(' src/changelog.test.ts
```

```output
16:describe("filterAndSort", () => {
29:  test("excludes the changelog file", () => {
34:  test("excludes files in excluded folders", () => {
39:  test("excludes folders saved without trailing slash", () => {
46:  test("sorts by mtime descending", () => {
55:  test("limits to maxRecentFiles", () => {
60:  test("returns all files when maxRecentFiles exceeds file count", () => {
65:  test("does not exclude folders that share a prefix", () => {
85:describe("generateChangelog", () => {
99:  test("generates changelog without heading", () => {
112:  test("generates changelog without wiki-links", () => {
125:  test("generates changelog with heading", () => {
136:  test("generates empty changelog", () => {
148:describe("clampMaxRecentFiles", () => {
149:  test("returns a valid in-range integer as-is", () => {
155:  test("floors floats", () => {
159:  test("clamps below 1 to 1", () => {
165:  test("clamps above the maximum", () => {
169:  test("accepts numeric strings", () => {
173:  test("falls back to the default for non-finite input", () => {
181:describe("normalizeLoadedSettings", () => {
184:  test("returns defaults for null/undefined data", () => {
191:  test("drops unknown keys", () => {
200:  test("normalizes changelogPath and excludedFolders", () => {
213:  test("clamps invalid maxRecentFiles", () => {
227:  test("trims the changelog heading", () => {
235:  test("falls back to defaults when known keys have the wrong type", () => {
251:  test("falls back for excludedFolders when it contains non-string entries", () => {
259:  test("falls back to defaults when boolean keys have the wrong type", () => {
269:describe("isValidChangelogPath", () => {
270:  test("accepts a markdown path", () => {
274:  test("rejects non-markdown paths", () => {
280:describe("validateExcludedFolder", () => {
281:  test("accepts a new folder", () => {
285:  test("rejects empty input and the vault root", () => {
290:  test("flags an already-listed folder as duplicate", () => {
```

## Styling

`styles.css` is scoped to the excluded-folders list: a flex row per entry with a subtle background, and the remove button styled as a muted "✕" that turns red (`--text-error`) on hover — visual cues that pair with the `aria-label` added in `renderExcludedFolders` for non-visual affordance.

```bash
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

## Development commands

```bash
sed -n '/^## Development Commands/I,/^```/p' CLAUDE.md | sed -n '3,13p'
```

````output
```bash
````

```bash
sed -n '14,24p' CLAUDE.md
```

```output
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # typecheck + biome check
bun run typecheck        # tsc --noEmit
bun run lint:fix         # Auto-fix lint and format
bun run version          # Sync package.json version → manifest.json + versions.json
bun test                 # Run all tests
bun test src/changelog.test.ts         # Run a single test file
bun test -t "pattern"                  # Run tests matching a name pattern
bun run deploy           # Copy main.js/manifest.json/styles.css into the local notes vault
```
