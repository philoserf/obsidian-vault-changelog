# Obsidian Vault Changelog Walkthrough

*2026-06-12T16:25:54Z by Showboat 0.6.1*
<!-- showboat-id: d0b53c77-1f5d-441b-bb9f-446067df7a7c -->

## Overview

This plugin maintains a changelog of recently edited notes in an Obsidian vault. On every update it **fully overwrites** the changelog file — no history is preserved. It can update on demand (a command palette entry) or automatically on vault changes.

The codebase is small and deliberately split: all decision-making logic is pure and unit-tested; the Obsidian API surface is confined to a thin wiring layer.

## File layout

Four source files, one job each.

```bash
wc -l src/*.ts | sort -n
```

```output
     108 src/main.ts
     127 src/changelog.ts
     243 src/settings.ts
     260 src/changelog.test.ts
     738 total
```

## Architecture

The split is the core design decision:

- `src/changelog.ts` — **pure functions**, no Obsidian imports. Settings shape, load-time normalization, clamping, validation, filtering, and rendering all live here. Every unit test targets this file. Anything environment-specific is injected: a `TimeFormatter` callback so tests don't need `window.moment`, and a path normalizer so tests don't need Obsidian's `normalizePath`.
- `src/main.ts` — `ChangelogPlugin extends Plugin`. Wires the command, vault event handlers, and file I/O. Pure glue.
- `src/settings.ts` — the settings tab UI plus a path-suggestion widget. Its callbacks delegate validation to the pure module rather than re-implementing rules.

## The pure module: settings shape

`changelog.ts` opens with the settings interface and defaults. Note `MAX_RECENT_FILES = 500` exported as a constant — the UI uses it for its description text, and the clamp uses it as the ceiling, so there is exactly one source of truth.

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

## Clamping: one authority

`clampMaxRecentFiles` is the single clamping rule for `maxRecentFiles`. Both load-time normalization and the settings UI call it, so the floor-to-integer / clamp-to-`[1, 500]` / default-on-garbage behavior can never drift between the two paths. It accepts `unknown` deliberately — persisted data and text-input values both pass through it.

```bash
sed -n '23,32p' src/changelog.ts
```

```output
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

## Load-time normalization

`normalizeLoadedSettings` turns whatever was persisted on disk into valid settings. It enforces four invariants (keep them when adding settings):

1. **Unknown keys are dropped** — renamed or removed settings don't linger in `data.json`.
2. **Paths are normalized** — `changelogPath` and every `excludedFolders` entry, so duplicate detection in the settings UI stays consistent.
3. **`maxRecentFiles` is clamped** via `clampMaxRecentFiles`.
4. **`changelogHeading` is trimmed** — so `generateChangelog`'s `"\n\n"` spacing stays predictable.

The `normalize` function is injected (Obsidian's `normalizePath` in production, an identity or stub in tests) to keep this module Obsidian-free.

```bash
sed -n '42,63p' src/changelog.ts
```

```output
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
  settings.changelogPath = normalize(settings.changelogPath);
  settings.excludedFolders = settings.excludedFolders.map(normalize);
  settings.maxRecentFiles = clampMaxRecentFiles(settings.maxRecentFiles);
  settings.changelogHeading = settings.changelogHeading.trim();
  return settings;
}
```

## Validators

Two small validators keep input rules out of the UI layer. Both operate on **already-normalized** paths — the caller runs `normalizePath` first, then asks.

`isValidChangelogPath` is just "must be a markdown file". `validateExcludedFolder` returns a three-way verdict (`"ok" | "invalid" | "duplicate"`) so the UI can pick the right notice; the `.` check matters because `normalizePath("")` and `normalizePath("/")` both yield `"."` (the vault root), which would exclude everything.

```bash
sed -n '65,84p' src/changelog.ts
```

```output
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
  if (!normalizedFolder || normalizedFolder === ".") return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}
```

## Selecting files: filterAndSort

The core pipeline: drop the changelog itself (no self-listing), drop anything under an excluded folder, sort by modification time descending, truncate to `maxRecentFiles`.

The structural typing matters here — `ChangelogFile` is a local interface with just `path`, `basename`, and `stat.mtime`. Obsidian's `TFile` satisfies it, but tests can pass plain object literals.

The trailing-slash handling on line 102 is a real edge case: `normalizePath` strips trailing slashes, so persisted folders look like `"Archive"`, and the `${folder}/` suffix prevents `"Notes"` from accidentally excluding `"Notes2/"` or `"Notebook/"`.

```bash
sed -n '86,109p' src/changelog.ts
```

```output
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
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}
```

## Rendering: generateChangelog

Rendering is a string fold: optional heading plus `"\n\n"`, then one bullet per file. The `TimeFormatter` callback is the dependency-injection seam — production passes a `window.moment` wrapper, tests pass a plain `moment` wrapper. The trimmed-heading invariant from `normalizeLoadedSettings` is what guarantees the heading spacing is exactly one blank line.

```bash
sed -n '111,127p' src/changelog.ts
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

## Plugin wiring: events and debounce

`main.ts` is where Obsidian begins. The class holds a 200ms-debounced updater, and `onload` registers one shared handler on three vault events (`modify`, `delete`, `rename`).

Two guards in the handler prevent pathological behavior:

- `file.path !== this.settings.changelogPath` — writing the changelog fires a `modify` event for the changelog itself; without this check, auto-update would re-trigger itself in a loop.
- The 200ms `debounce` collapses bursts (a sync run, a bulk rename) into a single regeneration.

Errors surface as a `Notice` rather than an unhandled rejection.

```bash
sed -n '19,53p' src/main.ts
```

```output
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

## updateChangelog and the TOCTOU-tolerant write

`updateChangelog` is the whole pipeline in one glance: vault files → `filterAndSort` → `generateChangelog` → `writeToFile`. The moment wrapper passed as the formatter is the only place `window.moment` appears.

`writeToFile` tolerates a time-of-check/time-of-use race: between `getAbstractFileByPath` returning null and `vault.create` running, a concurrent event (sync, another debounce flush) may have created the file. Instead of erroring, the catch re-fetches the file and proceeds; only if it is *still* missing does it throw. Preserve this behavior when editing.

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

## loadSettings is a two-liner

After the refactor, all load-time policy lives in the pure module; `loadSettings` just feeds persisted data plus Obsidian's `normalizePath` into `normalizeLoadedSettings`. There is nothing left in the plugin class to unit-test about settings hygiene.

```bash
sed -n '90,95p' src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }
```

## Settings UI: callbacks delegate to the pure validators

`settings.ts` builds the tab with Obsidian's `Setting` builder. The pattern throughout: normalize the raw input with `normalizePath`, then ask the pure module whether it is acceptable, and only mutate + save on a clean verdict.

The changelog-path field validates on blur via `isValidChangelogPath`, reverting the field and showing a notice on failure.

```bash
sed -n '121,130p' src/settings.ts
```

```output
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
```

The max-recent-files field rejects obviously bad input with a notice, then defers the actual flooring and ceiling to `clampMaxRecentFiles` — the same function load-time uses, so the UI cannot invent a different rule.

```bash
sed -n '164,179p' src/settings.ts
```

```output
      .addText((text) =>
        text.setValue(settings.maxRecentFiles.toString()).onChange((value) => {
          const numValue = Number(value);
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
        }),
      );
```

Adding an excluded folder is the three-way-verdict consumer. `"invalid"` gets a notice, `"duplicate"` is silently ignored (the folder is already in the list, nothing to do), `"ok"` appends, saves, clears the input, and re-renders the list.

```bash
sed -n '221,241p' src/settings.ts
```

```output
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
      });
```

## PathSuggest: cached vault listings

Both path inputs get autocomplete from `PathSuggest`. The one wrinkle worth knowing: it caches the vault's folder and markdown-file listing on first use (`cachedPaths`) so suggestions don't re-scan the whole vault on every keystroke. The cache lives for the life of the suggest widget, which lives for the life of the settings tab render — fresh enough in practice.

```bash
sed -n '28,42p' src/settings.ts
```

```output
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
```

## Testing approach

All tests live in `src/changelog.test.ts` and target only the pure module — `main.ts` and `settings.ts` have no tests because they contain no decisions, only wiring. The injection seams make this work: tests pass plain `moment` as the `TimeFormatter` (no `window`), and identity or stub functions as the path normalizer (no Obsidian).

Every exported pure function has its own `describe` block, including edge cases like prefix-sharing folder names, trailing-slash-stripped persisted folders, and non-finite clamp inputs.

```bash
grep -c 'test(' src/changelog.test.ts && grep 'describe(' src/changelog.test.ts
```

```output
27
describe("filterAndSort", () => {
describe("generateChangelog", () => {
describe("clampMaxRecentFiles", () => {
describe("normalizeLoadedSettings", () => {
describe("isValidChangelogPath", () => {
describe("validateExcludedFolder", () => {
```

27 tests across six describe blocks, one per exported function.

## Where to go next

- `build.ts` — Bun-native bundler; `obsidian` and `electron` stay external, never bundled. Watch mode skips rebuilds when only test files change.
- `CLAUDE.md` — development commands (`bun run check`, `bun test`, `bun run deploy`) and the release process (always tag the merged commit on `main`).

