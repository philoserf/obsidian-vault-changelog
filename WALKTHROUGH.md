# Walkthrough

This walks through the 2.0.0 code on the `v2` branch, starting where Obsidian enters the plugin and following each path from start to end: loading, a vault event becoming a written changelog, a settings edit becoming bytes on disk, a rename, a sync reload, and unload. For why the code has this shape, read `THEORY.md`. This document covers how it runs.

## Overview

Vault Changelog keeps one note in an Obsidian vault, by default `Changelog.md`, filled with the most recently modified other notes, newest first:

```markdown
- 2026-10-07T1430 · [[Meeting Notes]]
- 2026-10-07T1425 · [[Plan]]
```

The note is overwritten in full on every update. It is written in TypeScript, bundled by Bun into a single CommonJS `main.js`, and loaded by Obsidian 1.13 or later. That minimum version is set by the declarative settings API the settings tab uses.

There are two entry points, and Obsidian calls both:

- `ChangelogPlugin` (`src/main.ts`), the default export, which Obsidian constructs and calls `onload` on.
- `ChangelogSettingsTab` (`src/settings.ts`), registered during `onload`. Obsidian calls `getSettingDefinitions`, `getControlValue` and `setControlValue` on it.

## Architecture

```text
src/changelog.ts       pure: settings rules, loading, filtering, rendering — no imports
src/main.ts            the plugin: events, the write path, the settings commit path
src/settings.ts        the settings tab: declarative definitions, calls back into main.ts
src/changelog.test.ts  every test; targets changelog.ts only
src/fixtures/1.8.0.json  changelogs 1.8.0 actually wrote, replayed by the tests
```

Data flows in one direction through the pure module. `main.ts` hands it raw `data.json` and gets back valid settings. It hands it the vault's markdown files and gets back the changelog text. It does the I/O itself. `settings.ts` calls the same rules from `changelog.ts` as validators and sends every accepted edit back through `main.ts`. The tests import only `changelog.ts`. `main.ts` and `settings.ts` cannot run outside Obsidian, so the beta checklist in `CONTRIBUTING.md` checks them by hand.

## 1. Loading

`onload` loads settings first, then registers the settings tab, the command, and the vault listeners.

`src/main.ts` — `ChangelogPlugin.onload`

```ts
  override async onload(): Promise<void> {
    await this.loadSettings();
    this.settingTab = new ChangelogSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.addCommand({
      id: "update-changelog",
      name: "Update changelog",
      callback: () => {
        this.runUpdate();
      },
    });
```

`loadSettings` passes whatever `loadData` returns, which may be `null`, a corrupt object, or another version's shape, to the pure loader along with Obsidian's `normalizePath`:

`src/main.ts` — `ChangelogPlugin.loadSettings`

```ts
  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }
```

`normalizeLoadedSettings` builds the result one field at a time. It never spreads the input, so unknown keys and `__proto__` never get into the result. Each field goes through its rule's _load form_, which can only coerce:

`src/changelog.ts` — `normalizeLoadedSettings`

```ts
  const changelogPath = normalize(str(loaded.changelogPath));
  const datetimeFormat = str(loaded.datetimeFormat);
  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath:
      changelogPathError(changelogPath) === undefined
        ? changelogPath
        : DEFAULT_SETTINGS.changelogPath,
    datetimeFormat:
      datetimeFormatError(datetimeFormat) === undefined
        ? datetimeFormat
        : DEFAULT_SETTINGS.datetimeFormat,
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: loadExcludedFolders(loaded.excludedFolders, normalize),
```

`changelogPathError` and `datetimeFormatError` are the same functions the settings tab uses as validators. Here, a non-`undefined` result means "use the default". `clampMaxRecentFiles` parses numbers and numeric strings and falls back to the default for anything else, so `null` does not turn into a changelog one entry long. `loadExcludedFolders` replays the Add button's verdict against the entries kept so far:

`src/changelog.ts` — `loadExcludedFolders`

```ts
  const folders: string[] = [];
  if (!Array.isArray(value)) return folders;
  if (!value.every((entry) => typeof entry === "string")) return folders;
  for (const entry of value) {
    const folder = normalize(entry);
    if (validateExcludedFolder(folder, folders) === "ok") folders.push(folder);
  }
  return folders;
```

Transcript of a scratch script I ran against `src/changelog.ts` with a corrupt `data.json`. The stand-in normalizer strips trailing slashes, like `normalizePath`:

```text
input: { maxRecentFiles: null, datetimeFormat: "", changelogPath: "Notes",
         excludedFolders: ["Archive/", "Archive", "/"], legacy: 1 }

{
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [ "Archive" ],
  useWikiLinks: true,
  changelogHeading: "",
}
```

`Archive/` and `Archive` collapse into one entry, `/` is dropped as the vault root, and `legacy` disappears. The output also shows #298. The invalid path `Notes` becomes `Changelog.md` at the vault root, which may be someone's own note.

## 2. Wiring the vault events

Four vault events can trigger an update. `modify` and `delete` share one handler. `create` uses the same handler but is registered only once the layout is ready, because Obsidian fires `create` for every file while the vault loads:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
    const handler = (file: TAbstractFile) => {
      if (
        this.settings.autoUpdate &&
        file instanceof TFile &&
        file.extension === "md" &&
        file.path !== this.settings.changelogPath
      ) {
        this.debouncedVaultChange();
      }
    };
    this.registerEvent(this.app.vault.on("modify", handler));
    this.registerEvent(this.app.vault.on("delete", handler));
```

The last condition stops the plugin from triggering itself. Writing the changelog fires `modify`, or `create` the first time, on the changelog's path, and that comparison is what makes the plugin ignore it.

`rename` gets its own branch, covered in section 5. Every event that gets past the handler arrives at one debounced function:

`src/main.ts` — `ChangelogPlugin.debouncedVaultChange`

```ts
  private debouncedVaultChange = debounce(
    () => {
      this.runUpdate();
    },
    200,
    true,
  );
```

The third argument, `resetTimer = true`, makes it trailing-edge. Each event restarts the 200 ms timer, so a burst of autosaves produces one update after the burst ends. The cost is that a stream of events with no 200 ms gap never fires (#304).

## 3. An update, from trigger to disk

The command and the debounce both call `runUpdate`. It is the only place an update failure turns into something the user sees:

`src/main.ts` — `ChangelogPlugin.runUpdate`

```ts
  private runUpdate(): void {
    this.updateChangelog().catch((err: unknown) => {
      console.error("Vault Changelog: update failed", err);
      new Notice(
        `Failed to update changelog: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
```

`updateChangelog` renders first, then works out how to write. It passes the vault's markdown files and two closures to the pure renderer. The first formats a time with Obsidian's bundled moment. The second asks the metadata cache for each file's link text:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
    const path = this.settings.changelogPath;
    const content = renderChangelog(
      this.app.vault.getMarkdownFiles(),
      this.settings,
      (mtime, fmt) => window.moment(mtime).format(fmt),
      (file) => this.app.metadataCache.fileToLinktext(file, path),
    );
```

### Rendering

`renderChangelog` is the single place files become text. It filters before it formats, so no caller can format an unfiltered list:

`src/changelog.ts` — `filterAndSort`

```ts
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
```

Appending `/` before the prefix test is what stops `Notes` from also excluding `Notes2/`. Loaded folders never end in `/`, so the `folder.endsWith("/")` branch only runs when a test passes one in (#307).

With the rows chosen, the renderer first collects the basenames that appear more than once among them, then writes one line per row:

`src/changelog.ts` — `renderChangelog`

```ts
  let content = settings.changelogHeading
    ? `${settings.changelogHeading}\n\n`
    : "";
  for (const file of rows) {
    const time = formatTime(file.stat.mtime, settings.datetimeFormat);
    const name = settings.useWikiLinks
      ? `[[${linkText(file)}]]`
      : repeated.has(file.basename)
        ? file.path
        : file.basename;
    content += `- ${time} · ${name}\n`;
  }
  return content;
```

Notes that share a basename are handled differently in the two modes. With wiki-links on, the name comes from `fileToLinktext`. That returns the bare name when it is unique across the whole vault and a path when it is not. In plain text, the row's own `repeated` set decides. Transcript of a scratch script I ran, with plain text, `Archive` excluded, and three notes named `Meeting Notes`, one of them under `Archive`:

```text
- 2026-10-07T1430 · Projects/Meeting Notes.md
- 2026-10-07T1410 · Notes/Meeting Notes.md
- 2026-10-07T1400 · Solo
```

Everywhere else the bytes must match 1.8.0. The tests enforce this in two ways. `render180` is 1.8.0's renderer copied verbatim and run over a matrix of settings. `src/fixtures/1.8.0.json` holds eight scenarios captured from a real vault, each with the changelog 1.8.0 actually wrote, and they are replayed line by line.

### Writing

If no file exists at the path, `updateChangelog` creates its parent folder, then the file:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        // vault.create does not make parent folders, so a path inside a
        // missing folder would fail on every update (#287).
        const folder = path.split("/").slice(0, -1).join("/");
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder).catch(() => {
            // A concurrent create made it first; create below still decides.
          });
        }
        await this.app.vault.create(path, content);
        return;
      } catch (createErr) {
        // File may have been created by a concurrent event (TOCTOU race)
        file = this.app.vault.getAbstractFileByPath(path);
```

A failed `create` checks again before giving up, because the command and the debounce can run concurrently and both try to create the file. If the file still is not there, the error is rethrown with its reason and its `cause`, and `runUpdate` reports it. Otherwise execution continues to the existing-file path. A folder at that path is an error. A note is written only if its bytes differ:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
    if (!(file instanceof TFile)) {
      throw new Error(`${path} is a folder, not a note`);
    }
...
    if ((await this.app.vault.read(file)) === content) return;
    await this.app.vault.modify(file, content);
```

Most events do not change the output: an edit outside the top N, an edit in an excluded folder, a second save within the same minute. In each case the write is skipped. The changelog's mtime stays put, and Sync has nothing to upload. It uses `read` rather than `cachedRead` so that a stale cache cannot hide a write that was needed.

## 4. Editing a setting

Obsidian builds the settings tab from `getSettingDefinitions`. Most rows are declarative controls bound to a key, and each `validate` is the field's rule from `changelog.ts`:

`src/settings.ts` — `ChangelogSettingsTab.getSettingDefinitions`

```ts
        control: {
          type: "number",
          key: "maxRecentFiles",
          min: 1,
          max: MAX_RECENT_FILES,
          step: 1,
          validate: (value) => maxRecentFilesError(value),
        },
```

Two rows break the pattern. The changelog path is a hand-built text input that commits on blur, so a half-typed `Notes.md` on the way to `Notes.md/Changelog.md` is never saved and written to. After a successful change it tells the user the old changelog is now an ordinary note:

`src/settings.ts` — `ChangelogSettingsTab.getSettingDefinitions`

```ts
            text.inputEl.addEventListener("blur", () => {
              const next = normalizePath(text.getValue());
              const error = changelogPathError(next);
              if (error) {
                text.setValue(this.plugin.settings.changelogPath);
                new Notice(error);
                return;
              }
              const previous = this.plugin.settings.changelogPath;
              if (next === previous) return;
              void this.plugin
                .updateSettings({ changelogPath: next })
                .then(() => this.noticeOldChangelog(previous));
            });
```

`noticeOldChangelog` checks whether the save took effect by seeing whether the path actually changed. A failed save leaves it unchanged, and then nothing is said.

The excluded folders are a declarative `list` with one `folder` control per row, keyed `excludedFolders.<index>`, plus an optional empty draft row added by the "Add excluded folder" action. Those keys are not real settings fields, so the tab overrides how values are read and written:

`src/settings.ts` — `ChangelogSettingsTab.setControlValue`

```ts
  override async setControlValue(key: string, value: unknown): Promise<void> {
    const row = FOLDER_KEY.exec(key);
    if (row) {
      const index = Number(row[1]);
      const folder = normalizePath(String(value));
      const savingDraft = index >= this.plugin.settings.excludedFolders.length;
      await this.plugin.updateSettings((current) => {
        const excludedFolders = [...current.excludedFolders];
        excludedFolders[index] = folder;
        return { excludedFolders };
      });
```

The row index is captured when the tab draws. The write runs later, against whatever the list holds by then. #295 and #296 cover what goes wrong when the list changes in between. Every other key goes straight through as `updateSettings({ [key]: value })`. The exception is `changelogHeading`, which is trimmed first.

### The commit path

Every change goes through `updateSettings`: the tab's controls, the path field, row deletes, and the rename handler.

`src/main.ts` — `ChangelogPlugin.updateSettings`

```ts
    const run = this.saveQueue.then(async () => {
      const patch =
        typeof change === "function" ? change(this.settings) : change;
      const next = { ...this.settings, ...patch };
      await this.saveData(next);
...
      const dataPath = `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/data.json`;
      const onDisk: unknown = JSON.parse(
        await this.app.vault.adapter.read(dataPath),
      );
      if (JSON.stringify(onDisk) !== JSON.stringify(next)) {
        throw new Error(`could not write ${dataPath}`);
      }
      this.settings = next;
      if (next.autoUpdate) this.debouncedVaultChange();
    });
```

Read it in order:

1. **Queued.** Each write chains onto the previous one. The patch is computed inside the chain, so a function patch sees the last _persisted_ settings, not the settings from when the edit was made.
2. **Persisted.** `saveData` writes `data.json`.
3. **Verified.** `saveData` resolves even when the write fails. Beta 3 hit this with a read-only `data.json`. So the file is read back and compared.
4. **Assigned.** Only then does `this.settings` change. If any step fails, memory still holds the old value, so there is nothing to roll back.
5. **Refreshed.** With auto-update on, any change schedules an update, so changing a setting that affects the output is visible without editing a note.

The failure branch is attached separately, and it becomes the new tail of the queue:

`src/main.ts` — `ChangelogPlugin.updateSettings`

```ts
    const reported = run.catch((err: unknown) => {
      console.error("Vault Changelog: failed to save settings", err);
      new Notice(
        `Failed to save changelog settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.saveQueue = reported;
    return reported;
```

Because the tail is `reported` and not `run`, a failed write does not reject the queue, so later edits still run. Callers never see a rejection either, which is why the tab can chain `.then(() => this.update())` without its own error handling.

## 5. Renaming the changelog

`rename` is the only event that carries `oldPath`, so it is the only event that can tell the plugin its own note has moved:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
      this.app.vault.on("rename", (file, oldPath) => {
        if (
          file instanceof TFile &&
          oldPath === this.settings.changelogPath &&
          changelogPathError(file.path) === undefined
        ) {
          // The new path is assigned only once it is saved. An update
          // already pending would run in that gap against the old path, so
          // cancel it. updateSettings schedules a fresh one after the
          // assignment when auto-update is on.
          this.debouncedVaultChange.cancel();
          void this.updateSettings({ changelogPath: file.path });
          return;
        }
        handler(file);
      }),
```

When the changelog moves to another `.md` path, the setting follows it through the commit path from section 4. This happens even with auto-update off, because the setting would otherwise be stale either way. Any other rename goes to the shared handler, which judges the file by its _new_ extension. That means a rename away from `.md` is ignored (#299).

## 6. Settings changed elsewhere

When `data.json` changes on disk from Sync, git or another device, Obsidian calls `onExternalSettingsChange`:

`src/main.ts` — `ChangelogPlugin.onExternalSettingsChange`

```ts
  override async onExternalSettingsChange(): Promise<void> {
    await this.saveQueue;
    await this.loadSettings();
    this.settingTab?.update();
    if (this.settings.autoUpdate) this.debouncedVaultChange();
  }
```

It waits for any queued writes, reloads through the same loader as startup, redraws the tab, and schedules a refresh. It never saves. A reload that saved would bounce `data.json` back and forth between devices. Note that the reload itself runs outside the queue, so an edit made while it is reading can interleave with it (#297).

## 7. Unload

`src/main.ts` — `ChangelogPlugin.onunload`

```ts
  override onunload(): void {
    // registerEvent releases the vault listeners; the pending timer is ours to
    // cancel, or a disabled or replaced plugin still writes (#201).
    this.debouncedVaultChange.cancel();
  }
```

`registerEvent` handles the listeners. The plugin cancels its own pending timer, so disabling it within 200 ms of an edit does not cause one more write. A settings save still in flight is not cancelled, and if it finishes after unload it still schedules an update (#301).

## 8. Build and release

`bun run build` runs the type check, Biome and the Prettier markdown check, then bundles `src/main.ts` into `main.js` with `obsidian` and `electron` marked external. `main.js` is committed because Obsidian ships the committed file. CI, the beta workflow and the release workflow all rebuild and fail on `git diff --exit-code main.js`. A release is a bare-semver tag. `release.yml` checks it against `package.json`, `manifest.json` and `versions.json`, then publishes `main.js`, `manifest.json` and `styles.css` with build provenance. A beta comes from the manually triggered `beta.yml` on `v2`. It stamps a version like `2.0.0-beta.5` into `manifest.json` for that run only and publishes a GitHub prerelease for BRAT.
