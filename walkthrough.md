# Obsidian Vault Changelog Walkthrough

*2026-05-12T18:26:25Z by Showboat 0.6.1*
<!-- showboat-id: 248137d3-710b-4f04-a2e0-bf03d37fcc10 -->

## Overview

This is an Obsidian community plugin that maintains a markdown changelog of recently
edited notes in the user's vault. The changelog file is **fully overwritten** on every
update — no history is preserved across runs.

Key technologies:
- **TypeScript** strict mode targeting `ESNext` (`tsconfig.json`)
- **Bun** as the runtime, package manager, test runner, and bundler
- **Biome** as the single source of truth for formatting and linting
- **Obsidian API** (`obsidian` package, marked external at build time)

The published artifacts are `main.js`, `manifest.json`, and `styles.css`. Everything
else in the repo exists to produce or verify those three files.

```bash
cat manifest.json
```

```output
{
  "id": "obsidian-vault-changelog",
  "name": "Vault Changelog",
  "version": "1.5.2",
  "minAppVersion": "1.6.6",
  "description": "Maintain a changelog of recently edited notes.",
  "author": "Mark Ayers (originally by Badr Bouslikhin)",
  "authorUrl": "https://github.com/philoserf",
  "fundingUrl": "https://buymeacoffee.com/philoserf",
  "isDesktopOnly": false
}
```

The `manifest.json` is what Obsidian reads to register the plugin. `id` becomes
the plugin folder name; `minAppVersion: 1.6.6` is the floor for the APIs the plugin
uses (`Vault.getAllFolders`, `AbstractInputSuggest`). `isDesktopOnly: false` means
the plugin runs on mobile too, which constrains the APIs used — no Node `fs`, no
`child_process`.

The compatibility gate is enforced via `versions.json` separately from `manifest.json`.
Obsidian's plugin browser reads `versions.json` from the plugin's default branch to
decide which plugin versions to offer to which Obsidian releases:

```bash
cat versions.json
```

```output
{
  "0.1.0": "0.9.7",
  "1.0.0": "1.0.0",
  "1.1.0": "1.0.0",
  "1.2.0": "1.0.0",
  "1.3.0": "1.0.0",
  "1.4.0": "1.0.0",
  "1.5.0": "1.6.6",
  "1.5.1": "1.6.6",
  "1.5.2": "1.6.6"
}
```

The `1.5.0` entry maps to `1.6.6` because PR #166 raised the required APIs;
PR #167 then fixed the previously-stale `versions.json` entry so older Obsidian
clients won't be offered an incompatible plugin update. `version-bump.ts`
appends new entries automatically.

## Architecture

The repo splits the plugin code into three modules under `src/`. The split is
intentional: `changelog.ts` is pure logic with no Obsidian imports so it is easy
to test, and `main.ts` / `settings.ts` handle everything that needs the Obsidian
runtime (vault I/O, the settings UI, debounced events).

```bash
ls -1 src/
```

```output
changelog.test.ts
changelog.ts
main.ts
settings.ts
```

- `changelog.ts` — pure functions (`filterAndSort`, `generateChangelog`) plus the
  `ChangelogSettings` interface and `DEFAULT_SETTINGS`. No `obsidian` import.
- `main.ts` — the `Plugin` subclass: lifecycle hooks, command registration, vault
  event wiring, settings persistence, and the `writeToFile` I/O.
- `settings.ts` — the settings UI (`PluginSettingTab` subclass) plus a `PathSuggest`
  autocomplete helper.
- `changelog.test.ts` — Bun-runtime tests for the pure module.

## Pure logic: `src/changelog.ts`

The settings shape and defaults live here so both the runtime (`main.ts`) and the
UI (`settings.ts`) import them from a module that has no Obsidian dependency.

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

`MAX_RECENT_FILES = 500` is the upper bound enforced both at load time
(`main.ts:loadSettings`) and at the settings UI (`settings.ts`).

### `filterAndSort`

Takes the vault's markdown files and produces the list that becomes the changelog
body. Drops the changelog file itself (so updating it doesn't bring itself to the
top), drops files inside any excluded folder, sorts by `mtime` descending, caps
at `maxRecentFiles`.

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

The ``folder.endsWith("/") ? folder : `${folder}/` `` guard prevents prefix collisions:
excluding `Notes` should not match `Notebook/file.md`. The test
`does not exclude folders that share a prefix` in `changelog.test.ts` pins this
behavior.

### `generateChangelog`

Pure string assembly. Takes the filtered files, a moment-format string, the
wiki-link toggle, an optional heading, and a `formatTime` callback (so tests can
inject `moment` without touching `window.moment`).

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

The empty-files case returns `""` (no heading either) — `generateChangelog([], ...)`
does not emit the heading on its own. Tests in `changelog.test.ts` cover both the
heading and no-heading shapes.

## Plugin entry: `src/main.ts`

The exported default class extends Obsidian's `Plugin`. State on the instance:
the `settings` (initialized to `DEFAULT_SETTINGS` so the type is non-optional)
and a `debouncedVaultChange` function created via Obsidian's `debounce` helper.

```bash
sed -n '19,26p' src/main.ts
```

```output
export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    void this.updateChangelog().catch(() => {
      new Notice("Failed to update changelog");
    });
  }, 200);

```

The 200ms `debounce` collapses bursts of vault events. The arrow form means `this`
binds to the instance once, at field-init time, so the callback can reach
`this.updateChangelog`. The `.catch()` (PR #167) catches rejections from the
async update and surfaces a user-facing `Notice` instead of leaking an unhandled
promise rejection.

### `onload`: wiring up the plugin

`onload` runs once when Obsidian enables the plugin. It loads settings, registers
the settings tab, registers a single command, and subscribes to three vault events.

```bash
sed -n '27,51p' src/main.ts
```

```output
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
```

The command callback (PR #167) returns void and routes rejections through the same
`Notice` path the debounced updater uses — PR #166 originally rewrote this from
`async () => ...` to `void this.updateChangelog()` to satisfy the Obsidian plugin
checker, but `void` doesn't suppress rejections, so #167 added the `.catch()`.

Three guards on the auto-update path:

1. `autoUpdate` must be enabled in settings (toggle in the UI).
2. The event must be for a `TFile` (excludes folders, which also fire `rename`).
3. The file must not be the changelog itself — without this, every changelog
   write would re-trigger the update via `modify`, an infinite loop.

The events are registered through `this.registerEvent(...)` so Obsidian unbinds
them automatically on plugin disable.

### `updateChangelog`: the main pipeline

Called from both the command and the debounced event. Runs the pure pipeline
(`filterAndSort` → `generateChangelog`) and writes the result.

```bash
sed -n '54,70p' src/main.ts
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
```

This is the only place `window.moment` is referenced. Obsidian provides moment as a
global at runtime, so the plugin can format times without bundling moment itself.
The pure module receives moment via the callback parameter — tests pass in their
own.

### `writeToFile`: TOCTOU-safe creation

The changelog file may not exist yet on first run. The naive flow is "check if
exists → create if missing → write". Between the check and the create, another
event handler could create the file, causing `vault.create` to throw. The fallback
re-fetches the file before giving up.

```bash
sed -n '72,88p' src/main.ts
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

The `instanceof TFile` final guard handles the case where the configured path
points to a folder (returned as a `TFolder`, not `TFile`) — instead of throwing,
the user sees a `Notice`.

### `loadSettings`: defensive deserialization

The most carefully-written method in the plugin. It defends against three
classes of bad persisted data: **stale keys** (settings that existed in older
versions but have since been removed/renamed), **un-normalized paths** (which
would break duplicate detection in the UI), and **out-of-range numbers**.

```bash
sed -n '90,113p' src/main.ts
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
```

Three defensive steps:

1. **Strip unknown keys.** `Object.keys(DEFAULT_SETTINGS)` is the schema. Anything
   in `loadedSettings` not in that set is dropped before merging.
2. **Normalize paths.** `normalizePath` collapses backslashes, multiple slashes,
   trims `.`/`..` segments — so `Archive/` and `archive` and `Archive//` all
   reach the same canonical form. Without this, the UI's duplicate-add check
   would let the same folder appear twice.
3. **Clamp the file count.** `maxRecentFiles` is coerced to a finite number,
   floored, and clamped to `[1, 500]`. A bad value falls back to the default.

Issues #165 and #147 track extracting this normalization into a testable function
and adding direct coverage.

### `saveSettings` and `saveSettingsSafely`

Two persistence entry points. `saveSettings` writes through Obsidian's `saveData`
and surfaces failures by rejecting the returned promise. `saveSettingsSafely`
(added in PR #167) is the fire-and-forget wrapper used by all settings-UI
callbacks — it catches rejections and surfaces a `Notice` so failed saves don't
become unhandled promise rejections.

```bash
sed -n '115,126p' src/main.ts
```

```output
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

The empty `onunload()` is correct — `registerEvent`, `addCommand`, and
`addSettingTab` all auto-clean on disable, so there's nothing for the plugin
to release manually.

## Settings UI: `src/settings.ts`

Two classes: `PathSuggest` (autocomplete dropdown over vault paths) and
`ChangelogSettingsTab` (the actual settings panel rendered by Obsidian).

### `PathSuggest`: cached autocomplete

Subclasses Obsidian's `AbstractInputSuggest`. Caches the path list on first use
because rebuilding it on every keystroke is expensive in large vaults
(commit `b50d8d5`).

```bash
sed -n '13,53p' src/settings.ts
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

The cache is per-instance and is never invalidated. Each call to `display()`
constructs new `PathSuggest` instances, which is a coarse but effective
invalidation strategy: open settings and you get a fresh path list.
`selectSuggestion` triggers both `input` and `blur` events so the surrounding
`Setting`'s blur handler fires (the changelog-path field validates on blur).

`Vault.getAllFolders()` and `AbstractInputSuggest` are the two APIs that pushed
`minAppVersion` to 1.6.6 in PR #166.

### `ChangelogSettingsTab.display`: rendering the panel

Obsidian calls `display()` whenever the settings tab opens. Each `Setting` is
constructed and pushed into `containerEl`. The save path is the
`saveSettingsSafely()` helper described above — PR #166 rewrote these as
sync callbacks (to satisfy the Obsidian plugin checker's "promise returned
in function argument where a void return was expected" warning), and PR #167
routed them through the helper so save failures surface a `Notice` instead
of becoming unhandled promise rejections.

The path-input setting validates on blur — the value must end in `.md`, otherwise
the input is reverted and a `Notice` is shown.

```bash
sed -n '107,127p' src/settings.ts
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
          if (!normalized.endsWith(".md")) {
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

The `maxRecentFiles` field repeats the same clamp logic that `loadSettings`
applies — `Math.min(Math.floor(numValue), MAX_RECENT_FILES)`. Issue #161 tracks
consolidating that into a single pure function.

### Excluded folders

Excluded folders use a bespoke add/remove UI (Obsidian's `Setting` doesn't have a
list primitive). `renderExcludedFolders` re-renders the list on every change.

```bash
sed -n '207,232p' src/settings.ts
```

```output
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
          if (!folder || folder === ".") {
            new Notice(
              "Excluded folder path cannot be empty or the vault root",
            );
            return;
          }
          if (!settings.excludedFolders.includes(folder)) {
            settings.excludedFolders.push(folder);
            this.plugin.saveSettingsSafely();
            folderInputEl.value = "";
            this.renderExcludedFolders(excludedFoldersList);
          }
        });
      });
  }
```

The input is normalized before the duplicate check, but `filterAndSort` appends
the trailing `/` itself when matching — so excluded folders saved without a
trailing slash still work. Issue #162 tracks a regression test for this.

## Tests: `src/changelog.test.ts`

Tests use Bun's built-in test runner. They cover only the pure module; the plugin
class and the settings UI are untested (issue #147).

```bash
grep -c '^  test(' src/changelog.test.ts
```

```output
10
```

Ten test cases split across `filterAndSort` and `generateChangelog`. The shared
formatter — `(mtime, fmt) => moment(mtime).format(fmt)` — wraps `moment` so the
pure module never sees Obsidian's global.

## Build pipeline: `build.ts`

Bun's native bundler produces a single CommonJS `main.js` from `src/main.ts`.
Obsidian and electron are externals — they are provided by the host at runtime.

```bash
sed -n '3,23p' build.ts
```

```output
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
```

Watch mode disables `minify`, enables `linked` sourcemaps for debugging, and keeps
the process alive instead of `process.exit(1)` on a build failure.

### Watch mode: lazy `node:fs` import

PR #166 moved `node:fs` from a top-level import to a dynamic import inside the
`isWatch` branch. The plugin checker forbids unconditional Node-only imports —
they break on mobile — but `build.ts` is a desktop-only build script, so the
fix is to load `node:fs` only when actually watching. PR #167 then fixed the
`setTimeout` callback so it returns void and logs `build()` rejections instead
of dropping them.

```bash
sed -n '27,43p' build.ts
```

```output
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
```

The trailing `export {}` (line 43) keeps the file an ES module after the only
static import was removed, so top-level `await` still works without TypeScript
complaining.

## Version sync: `version-bump.ts`

Triggered by `bun run version`. After `npm version` or equivalent updates
`package.json`, this script propagates the new version to `manifest.json` and
appends an entry to `versions.json`.

```bash
cat version-bump.ts
```

```output
const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("No version found in package.json");
}

// Update manifest.json
const manifest = await Bun.file("manifest.json").json();
const { minAppVersion } = manifest;
manifest.version = targetVersion;
await Bun.write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Update versions.json
const versions = await Bun.file("versions.json").json();
versions[targetVersion] = minAppVersion;
await Bun.write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Updated to version ${targetVersion}`);

export {};
```

The trailing `export {}` makes the file a module so `await` at top level works.
Bun-native `Bun.file` / `Bun.write` replaced the older `node:fs` calls. Note
that the new `versions.json` entry uses whatever `minAppVersion` is currently
in `manifest.json` — so bumping `minAppVersion` and bumping plugin version
should happen in the same step.

## Deploy: `deploy.ts`

Copies the three published artifacts into a local Obsidian plugins folder for
manual testing. The destination is read from `OBSIDIAN_DEPLOY_DEST` (set in
`.env.local`, which is gitignored) so the path isn't hardcoded into the repo.

```bash
cat deploy.ts
```

```output
import { $ } from "bun";

const dest = process.env.OBSIDIAN_DEPLOY_DEST;
if (!dest) {
  console.error("OBSIDIAN_DEPLOY_DEST not set — see .env.local");
  process.exit(1);
}

await $`cp main.js manifest.json styles.css ${dest}`;
console.log(`Deployed to ${dest}`);
```

`bun $` quotes the interpolated `${dest}` automatically, so a destination with
spaces is safe. There is no `mkdir` — the destination is expected to exist already.

## Toolchain configuration

### `tsconfig.json`

Strict mode, `noEmit` (Bun does the actual emit), bundler module resolution, and
`bun + node` types. Tests are excluded from `tsc --noEmit` because they import
from `bun:test` which the editor surfaces via `@types/bun`.

```bash
cat tsconfig.json
```

```output
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["DOM", "ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun", "node"],
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "build.ts", "deploy.ts", "version-bump.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

### `biome.json`

Biome handles formatting *and* linting, with `useIgnoreFile` so `.gitignore`
patterns are respected. Files are listed explicitly rather than glob-everything-
except-built-output so generated files (`main.js`, `bun.lock`) aren't checked.

```bash
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
      "build.ts",
      "deploy.ts"
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

The `scripts/**/*.ts` entry is forward-looking — there is no `scripts/` folder
today.

## Concerns

### Test coverage gap

Only `changelog.ts` is tested. `loadSettings` (key stripping, normalization,
`maxRecentFiles` clamp) is the most behavior-rich method in `main.ts` and has
no direct coverage. The `writeToFile` TOCTOU fallback is also untested. Issues
#147 and #165 are open against this.

### Implicit dependency on `window.moment`

The plugin uses `window.moment` at runtime but lists `moment` only in
`devDependencies` (for tests). This is the correct convention for Obsidian
plugins, but it relies on an implicit global from the host. There is no
guard rail if a future Obsidian release stops providing `moment`.

### Duplicated clamp logic

`loadSettings` and the "Max recent files" UI setting both compute the same
`Math.min(Math.floor(value), MAX_RECENT_FILES)` clamp. Issue #161 tracks
extracting a single `clampMaxRecentFiles` function in `changelog.ts`.

### Unsanitized `changelogHeading`

The heading is concatenated into the changelog content verbatim. A user could
type anything — including markdown that breaks the document or HTML/script tags
(which Obsidian renders). Issue #164 tracks this.

### `PathSuggest` cache is per-instance, never invalidated

A `PathSuggest` built when the settings tab opens will not see folders or notes
created afterward in the same session. Closing and reopening settings constructs
fresh instances, so the staleness window is bounded by how long the user keeps
the panel open. Acceptable for now (commit `b50d8d5` traded freshness for
keystroke performance), but worth noting.

### `ChangelogSettings` interface lives in the pure module

`ChangelogSettings` and `DEFAULT_SETTINGS` are exported from `changelog.ts`, but
neither pure function consumes the interface — only the plugin code does. Issue
#163 considers relocating it. The current placement avoids a circular import
between `main.ts` and `settings.ts`, which is the more important constraint.

### No collision guard on `changelogPath`

If a user points the changelog path at a real note they care about, the plugin
silently overwrites it on the next update. The `.md` blur-validation prevents
typos, but not collisions.

### Save-error feedback is non-blocking

`saveSettingsSafely` (PR #167) surfaces save failures via `Notice`, but the UI
state mutation already happened — so a failed save leaves the in-memory state
diverged from disk until the next successful save. Acceptable for `saveData`
backed by local disk; would be worse for a remote-backed store.

### Excluded folders use a Unicode glyph for the remove button

`renderExcludedFolders` uses `"✕"` text. Obsidian's UI convention is
`setIcon(button, "x")` (Lucide), which respects theme styling.
