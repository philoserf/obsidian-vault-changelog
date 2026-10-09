# Walkthrough

This walks through the 2.0.0 code, starting where Obsidian enters the plugin and following each path from start to end: loading, a vault event becoming a written changelog, a settings edit becoming bytes on disk, a rename, a sync reload, and unload. For why the code has this shape, read `THEORY.md`. This document covers how it runs.

## Overview

Vault Changelog keeps one note in an Obsidian vault, by default `Changelog.md`, filled with the most recently modified other notes, newest first:

```markdown
- 2026-10-07T1430 · [[Meeting Notes]]
- 2026-10-07T1425 · [[Plan]]
```

The note is overwritten in full on every update. It is written in TypeScript, bundled by Bun into a single CommonJS `main.js`, and loaded by Obsidian 1.13 or later. That minimum version is set by the declarative settings API the settings tab uses.

There are two entry points, and Obsidian calls both:

- `ChangelogPlugin` (`src/main.ts`), the default export, which Obsidian constructs and calls `onload` on.
- `ChangelogSettingsTab` (`src/settings.ts`), registered during `onload`. Obsidian calls `getSettingDefinitions`, `getControlValue`, `setControlValue` and `hide` on it.

## Architecture

```text
src/changelog.ts         pure: settings rules, loading, event rules, rendering — no imports
src/main.ts              the plugin: events, the queue, the write path, the settings commit path
src/settings.ts          the settings tab: declarative definitions, calls back into main.ts
src/changelog.test.ts    every test; targets changelog.ts only
src/fixtures/1.8.0.json  changelogs 1.8.0 actually wrote, replayed by the tests
version-bump.ts          copies package.json's version into manifest.json and versions.json
```

Data flows in one direction through the pure module. `main.ts` hands it raw `data.json` and gets back settings. It hands it each vault event and gets back what that event means. It hands it the vault's markdown files and gets back the changelog text. It does the I/O itself. `settings.ts` calls the same rules from `changelog.ts` as validators and sends every accepted edit back through `main.ts`. The tests import only `changelog.ts`. `main.ts` and `settings.ts` cannot run outside Obsidian, so the beta checklist in `CONTRIBUTING.md` checks them by hand.

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
        this.runUpdate(true);
      },
    });
```

The `true` marks the update as manual, which matters only to how a failure is reported (section 4).

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
  const savedPath = str(loaded.changelogPath);
  const datetimeFormat = str(loaded.datetimeFormat);
  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath:
      savedPath.trim() === ""
        ? DEFAULT_SETTINGS.changelogPath
        : normalize(savedPath),
    datetimeFormat:
      datetimeFormatError(datetimeFormat) === undefined
        ? datetimeFormat
        : DEFAULT_SETTINGS.datetimeFormat,
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: loadExcludedFolders(loaded.excludedFolders, normalize),
```

`datetimeFormatError` is the same function the settings tab uses as a validator. Here, a non-`undefined` result means "use the default". `clampMaxRecentFiles` parses numbers and numeric strings and falls back to the default for anything else, so `null` does not turn into a changelog one entry long.

`changelogPath` is the one field that does not fall back when its rule fails. A saved path that does not end in `.md` is kept as it is, and the write path refuses it later with a reason (section 4). Its default names a note, `Changelog.md`, and substituting it would mean guessing which note the plugin may overwrite. Only a path that is missing, blank or not a string loads the default, as on a fresh install.

`loadExcludedFolders` replays the settings tab's verdict against the entries kept so far:

`src/changelog.ts` — `loadExcludedFolders`

```ts
  const folders: string[] = [];
  if (!Array.isArray(value)) return folders;
  if (!value.every((entry) => typeof entry === "string")) return folders;
  for (const entry of value) {
    const folder = normalize(entry);
    if (excludedFolderError(folder, folders) === undefined) {
      folders.push(folder);
    }
  }
  return folders;
```

`excludedFolderError` is the single folder rule: not a spelling of the vault root, and not a folder already listed. Transcript of a scratch script I ran against `src/changelog.ts` with a corrupt `data.json`. The stand-in normalizer strips trailing slashes, like `normalizePath`:

```text
input: { maxRecentFiles: null, datetimeFormat: "", changelogPath: "Notes",
         excludedFolders: ["Archive/", "Archive", "/"],
         changelogHeading: "  # Recent  ", legacy: 1 }

{
  autoUpdate: false,
  changelogPath: "Notes",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [ "Archive" ],
  useWikiLinks: true,
  changelogHeading: "  # Recent  ",
}
```

`Archive/` and `Archive` collapse into one entry, `/` is dropped as the vault root, and `legacy` disappears. The invalid path `Notes` survives, so no update will write anywhere until the user fixes it. The heading is stored as typed. It is trimmed only where it is rendered (section 4).

## 2. Wiring the vault events

Four vault events can trigger an update: `modify`, `delete`, `create` and `rename`. All four call one handler. Only `rename` passes it an `oldPath`:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
    this.registerEvent(this.app.vault.on("modify", (file) => handler(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => handler(file)));
...
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.registerEvent(this.app.vault.on("create", (file) => handler(file)));
    });
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => handler(file, oldPath)),
    );
```

`create` is registered only once the layout is ready, because Obsidian fires `create` for every file while the vault loads. Layout-ready can arrive after the plugin has already been unloaded, during a reload at startup, and registering then would attach a listener nothing will release. The `unloaded` check stops that.

The handler does not decide what an event means. It asks the pure core:

`src/changelog.ts` — `vaultEventEffect`

```ts
export function vaultEventEffect(
  path: string,
  oldPath: string | undefined,
  changelogPath: string,
): VaultEventEffect {
  if (oldPath === changelogPath) {
    return changelogPathError(path) === undefined
      ? { follow: path }
      : { cannotFollow: path };
  }
  if (path === changelogPath) return "ignore";
  if (path.endsWith(".md") || oldPath?.endsWith(".md")) return "refresh";
  return "ignore";
}
```

The order of the tests matters. A rename _from_ the changelog path is the changelog moving, and it is checked first. Any other event on the changelog path is ignored, which is what stops the plugin reacting to its own writes: writing the changelog fires `modify`, or `create` the first time, on that path. Everything else refreshes only if a markdown file is involved, under either name. Transcript of a scratch script I ran against `src/changelog.ts`, with the changelog at `Changelog.md`:

```text
["Plan.md",null]                        -> "refresh"
["Changelog.md",null]                   -> "ignore"
["Logs/Changelog.md","Changelog.md"]    -> {"follow":"Logs/Changelog.md"}
["Changelog.txt","Changelog.md"]        -> {"cannotFollow":"Changelog.txt"}
["Plan.txt","Plan.md"]                  -> "refresh"
["image.png",null]                      -> "ignore"
["Plan.md","Draft.md"]                  -> "refresh"
```

`Plan.md` renamed to `Plan.txt` refreshes, because a row has left the list. The two rename outcomes for the changelog itself are covered in section 6.

The handler acts on the answer. A folder never reaches the core, because the first line drops anything that is not a `TFile`:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
    const handler = (file: TAbstractFile, oldPath?: string) => {
      if (!(file instanceof TFile)) return;
      const effect = vaultEventEffect(
        file.path,
        oldPath,
        this.settings.changelogPath,
      );
      if (effect === "ignore") return;
      if (effect === "refresh") {
        if (this.settings.autoUpdate) this.scheduleUpdate();
        return;
      }
```

## 3. Scheduling an update

Every event that asks for a refresh arrives at `scheduleUpdate`, which drives one debounced function:

`src/main.ts` — `ChangelogPlugin.debouncedVaultChange`

```ts
  private debouncedVaultChange = debounce(
    () => {
      this.burstStart = undefined;
      this.runUpdate();
    },
    200,
    true,
  );
```

The third argument, `resetTimer = true`, makes it trailing-edge. Each event restarts the 200 ms timer, so a burst of autosaves produces one update after the burst ends. On its own that has a cost: a stream of events with no 200 ms gap, such as Sync downloading a vault or another plugin writing in a loop, would postpone the update for as long as the stream lasts. `scheduleUpdate` caps the wait:

`src/main.ts` — `ChangelogPlugin.scheduleUpdate`

```ts
  private scheduleUpdate(): void {
    const now = Date.now();
    this.burstStart ??= now;
    this.debouncedVaultChange();
    if (now - this.burstStart >= 2000) this.debouncedVaultChange.run();
  }
```

`burstStart` records when the pending update started waiting. Once an event arrives two seconds or more after that, `run()` fires the pending call immediately, and the callback clears `burstStart` so the next event starts a new burst. A steady stream therefore gets an update about every two seconds, and a trailing one when it ends. Two seconds is well above the spacing of Obsidian's autosaves, so ordinary typing still produces a single update after it stops.

`cancelUpdate` is the other half. It drops the pending call and the burst it was waiting out, and it is used where a pending update would run against a path about to change (section 6) and at unload (section 8).

## 4. An update, from trigger to disk

The command and the debounce both call `runUpdate`. It is the only place an update failure turns into something the user sees:

`src/main.ts` — `ChangelogPlugin.runUpdate`

```ts
  private runUpdate(manual = false): void {
    // Queued, so an update never runs beside a settings save or reload. An
    // update scheduled while a renamed changelog's new path is being saved
    // runs after it, against the new path (#300).
    this.enqueue(() => this.updateChangelog()).then(
      () => {
        this.lastFailure = undefined;
      },
      (err: unknown) => {
        console.error("Vault Changelog: update failed", err);
        const message = `Failed to update changelog: ${err instanceof Error ? err.message : String(err)}`;
        if (!manual && message === this.lastFailure) return;
        this.lastFailure = message;
        new Notice(message);
      },
    );
  }
```

Every failure goes to the console. The Notice is shown once per distinct failure for automatic updates, so a failure that persists, such as an invalid saved path, does not pop up after every pause in typing. The command always shows it, and any success clears the memory.

### The queue

The update does not run directly. It goes through `enqueue`, the one queue for everything that reads settings to decide something or writes them: changelog updates, settings commits (section 5) and the sync reload (section 7).

`src/main.ts` — `ChangelogPlugin.enqueue`

```ts
  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.unloaded ? undefined : op()));
    // The next operation waits for this one, whether or not it failed. The
    // caller still sees the failure through `run`.
    this.queue = run.catch(() => undefined);
    return run;
  }
```

Operations run one at a time in the order they were queued. The tail is `run` with its failure swallowed, so one failed operation does not stop the ones behind it, while the caller still gets `run` and sees the rejection. Once `onunload` has set `unloaded`, every queued operation is skipped. The one rule for code inside the queue is that a queued operation must never await the queue, which would deadlock. Scheduling the debounce from inside one is fine, because the update it leads to is queued later, when the timer fires.

### Refusing a bad path

`updateChangelog` checks the path before it does anything else. This is where an invalid saved path, kept by the loader, is refused:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
    const path = this.settings.changelogPath;
    // The loader keeps an invalid saved path rather than guess another note
    // to write (#298). This is where it is refused, with the reason.
    if (changelogPathError(path) !== undefined) {
      throw new Error(
        `the changelog path ${path} is not a markdown note. Choose one ending in .md in settings`,
      );
    }
```

### Rendering

Then it renders. It passes the vault's markdown files and two closures to the pure renderer. The first formats a time with Obsidian's bundled moment. The second asks the metadata cache for each file's link text:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
    const content = renderChangelog(
      this.app.vault.getMarkdownFiles(),
      this.settings,
      (mtime, fmt) => window.moment(mtime).format(fmt),
      (file) => this.app.metadataCache.fileToLinktext(file, path),
    );
```

`renderChangelog` is the single place files become text. It calls `filterAndSort` before it formats, so no caller can format an unfiltered list:

`src/changelog.ts` — `filterAndSort`

```ts
  return files
    .filter((file) => {
      if (file.path === changelogPath) return false;
      for (const folder of excludedFolders) {
        if (file.path.startsWith(`${folder}/`)) return false;
      }
      return true;
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
```

Appending `/` before the prefix test is what stops `Notes` from also excluding `Notes2/`. Excluded folders reach this point in exactly one form, normalized and without a trailing slash, because both the loader and the tab pass them through `normalizePath`.

With the rows chosen, the renderer collects the basenames that appear more than once among them, trims the heading, then writes one line per row:

`src/changelog.ts` — `renderChangelog`

```ts
  const heading = settings.changelogHeading.trim();
  let content = heading ? `${heading}\n\n` : "";
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

The heading's one rule lives here: surrounding whitespace is dropped, so a heading of only spaces is no heading. The loader and the tab both store what was typed.

Notes that share a basename are handled differently in the two modes. With wiki-links on, the name comes from `fileToLinktext`. That returns the bare name when it is unique across the whole vault and a path when it is not. In plain text, the rows' own `repeated` set decides. Transcript of a scratch script I ran, with plain text, `Archive` excluded, a heading of `"  # Recent  "`, and three notes named `Meeting Notes`, one of them under `Archive`:

```text
# Recent

- 2026-10-07T1430 · Projects/Meeting Notes.md
- 2026-10-07T1410 · Notes/Meeting Notes.md
- 2026-10-07T1400 · Solo
```

Everywhere else the bytes must match 1.8.0. The tests enforce this in two ways. `render180` is 1.8.0's renderer copied verbatim and run over a matrix of settings. `src/fixtures/1.8.0.json` holds eight scenarios captured from a real vault, each with the changelog 1.8.0 actually wrote, and they are replayed line by line. A line naming an ambiguous note must differ from 1.8.0's and name the note's path. Every other line must match exactly.

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

A failed `create` checks again before giving up, in case something outside the plugin, such as Sync, created the file in between. If the file still is not there, the error is rethrown with its reason and its `cause`, and `runUpdate` reports it. Otherwise execution continues to the existing-file path. A folder at that path is an error. A note is written only if its bytes differ:

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

## 5. Editing a setting

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

Obsidian reads each control's value through `getControlValue` and sends each accepted change to `setControlValue`. Toggles and the number go straight through as `updateSettings({ [key]: value })`. The other rows differ in when, or how, they commit.

### Text that commits after a pause

The datetime format and the heading are declarative text controls, which report every keystroke. Committing each one would write `data.json` per keystroke and, with auto-update on, render half-typed formats and headings into the changelog. So `setControlValue` holds them back:

`src/settings.ts` — `ChangelogSettingsTab.setControlValue`

```ts
    // The declarative text controls: their commits wait for a pause in typing.
    if (key === "datetimeFormat" || key === "changelogHeading") {
      this.pendingText[key] = String(value);
      this.commitText();
      return;
    }
```

`commitText` is a trailing-edge debounce of 500 ms. When typing pauses, it hands everything collected in `pendingText` to `updateSettings` as one patch. The field keeps showing what the user typed in the meantime, because Obsidian does not redraw it from the saved value mid-edit. Closing the settings does not wait for the pause:

`src/settings.ts` — `ChangelogSettingsTab.hide`

```ts
  override hide(): void {
    this.commitText.run();
    super.hide();
  }
```

### The changelog path

The changelog path is a hand-built text input that commits on blur, so a half-typed `Notes.md` on the way to `Notes.md/Changelog.md` is never saved and written to. After a successful change it tells the user the old changelog is now an ordinary note:

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

`noticeOldChangelog` checks whether the save took effect by seeing whether the path actually changed. A failed save leaves it unchanged, and then nothing is said. It never deletes or rewrites the old file.

### Excluded folders

The excluded folders are a declarative `list` with one `folder` control per row, keyed `excludedFolders.<index>`, plus an optional empty draft row added by the "Add excluded folder" action. Each row validates with `excludedFolderError` against the other rows, then adds the tab's own check that the folder exists. The loader must not make that check, because a folder missing on this device may still arrive through Sync.

The row keys are positions in the list as it was drawn, and the list may have changed by the time a save runs. So `getSettingDefinitions` keeps the list it drew from in `drawnFolders`, and `setControlValue` turns the key back into the value that row showed before anything is queued:

`src/settings.ts` — `ChangelogSettingsTab.setControlValue`

```ts
    const row = FOLDER_KEY.exec(key);
    if (row) {
      // undefined for the new row, which has no value yet.
      const previous = this.drawnFolders[Number(row[1])];
      const folder = normalizePath(String(value));
      await this.plugin.updateSettings((current) => ({
        excludedFolders: withExcludedFolder(
          current.excludedFolders,
          previous,
          folder,
        ),
      }));
      if (previous === undefined) this.draftFolderRow = false;
      this.update();
      return;
    }
```

The edit is a function of the current settings, applied inside the queue, by value:

`src/changelog.ts` — `withExcludedFolder`

```ts
  const at = previous === undefined ? -1 : folders.indexOf(previous);
  const others = folders.filter((_, index) => index !== at);
  if (excludedFolderError(next, others) !== undefined) return folders;
  if (at === -1) return [...folders, next];
  return folders.map((folder, index) => (index === at ? next : folder));
```

The row's old value is replaced where it now is. If it has gone from the list, or the row is the draft, the new value is appended. The rule is checked again against the list as it is by then, and a value that breaks it leaves the list unchanged. Transcript of a scratch script I ran:

```text
withExcludedFolder(["Archive", "Inbox"], "Archive", "Old")  -> [ "Old", "Inbox" ]
withExcludedFolder(["Inbox"], "Archive", "Old")             -> [ "Inbox", "Old" ]
withExcludedFolder(["Archive", "Inbox"], undefined, "Inbox") -> [ "Archive", "Inbox" ]
```

A row delete works the same way: `onDelete` reads the folder the row was drawn with and queues a filter that removes that value.

### The commit path

Every change goes through `updateSettings`: the tab's controls, the pending text, the path field, row edits and deletes, and the rename handler.

`src/main.ts` — `ChangelogPlugin.updateSettings`

```ts
    return this.enqueue(async () => {
      const patch =
        typeof change === "function" ? change(this.settings) : change;
      const next = { ...this.settings, ...patch };
      await this.saveData(next);
...
      if (this.manifest.dir !== undefined) {
        const dataPath = `${this.manifest.dir}/data.json`;
        const onDisk: unknown = JSON.parse(
          await this.app.vault.adapter.read(dataPath),
        );
        if (JSON.stringify(onDisk) !== JSON.stringify(next)) {
          throw new Error(`could not write ${dataPath}`);
        }
      }
      this.settings = next;
      if (next.autoUpdate) this.scheduleUpdate();
    }).catch((err: unknown) => {
      console.error("Vault Changelog: failed to save settings", err);
      new Notice(
        `Failed to save changelog settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
```

Read it in order:

1. **Queued.** Each write runs on the queue from section 4. The patch is computed inside it, so a function patch sees the last _persisted_ settings, not the settings from when the edit was made.
2. **Persisted.** `saveData` writes `data.json`.
3. **Verified.** `saveData` resolves even when the write fails, because Obsidian swallows the error. This was seen with a read-only `data.json` on Obsidian 1.14.4. So the file is read back and compared. The check runs only when `manifest.dir` is set, which Obsidian does for every installed plugin. Without it there is no known path, and a guessed one would report saves that worked as failed.
4. **Assigned.** Only then does `this.settings` change. If any step fails, memory still holds the old value, so there is nothing to roll back.
5. **Refreshed.** With auto-update on, any change schedules an update, so changing a setting that affects the output is visible without editing a note.

The `.catch` is attached to the value `updateSettings` returns, not to the queue. The queue's own tail already absorbs the failure, so later edits still run. The caller gets a promise that always resolves, which is why the tab can chain `.then(() => this.update())` without its own error handling.

## 6. Renaming the changelog

A rename whose `oldPath` is the changelog path comes back from `vaultEventEffect` as `follow` or `cannotFollow`. The handler's last two branches deal with them:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
      if ("cannotFollow" in effect) {
        // The renamed file is now the user's, and is left alone. The setting
        // keeps its path, and the next update writes a changelog there. Say
        // so instead of letting a new file appear unexplained (#299).
        new Notice(
          `The changelog was renamed to ${effect.cannotFollow}, which is not a markdown note, so it is now an ordinary file. Vault Changelog keeps writing to ${this.settings.changelogPath}.`,
        );
        if (this.settings.autoUpdate) this.scheduleUpdate();
        return;
      }
      // The new path is assigned only once it is saved. An update already
      // pending would run in that gap against the old path, so cancel it.
      // updateSettings schedules a fresh one after the assignment when
      // auto-update is on.
      this.cancelUpdate();
      void this.updateSettings({ changelogPath: effect.follow });
```

When the changelog moves to another `.md` path, the setting follows it through the commit path from section 5. This happens even with auto-update off, because the setting would otherwise be stale either way. An update scheduled while that save is in flight is queued behind it, so it runs against the new path.

When the changelog is renamed to something that is not a markdown note, the setting stays where it was. The renamed file now belongs to the user and is left alone. The Notice explains why a fresh changelog will appear at the old path, and with auto-update on one is scheduled.

## 7. Settings changed elsewhere

When `data.json` changes on disk from Sync, git or another device, Obsidian calls `onExternalSettingsChange`:

`src/main.ts` — `ChangelogPlugin.onExternalSettingsChange`

```ts
  override async onExternalSettingsChange(): Promise<void> {
    await this.enqueue(async () => {
      await this.loadSettings();
      this.settingTab?.update();
      if (this.settings.autoUpdate) this.scheduleUpdate();
    });
  }
```

The reload is queued like a write. It runs after any saves already queued, and a settings edit made while it reads then builds on the synced settings rather than on the copy being replaced. It reloads through the same loader as startup, redraws the tab, and schedules a refresh. It never saves. A reload that saved would bounce `data.json` back and forth between devices.

## 8. Unload

`src/main.ts` — `ChangelogPlugin.onunload`

```ts
  override onunload(): void {
    // registerEvent releases the vault listeners. The pending timer and the
    // queue are ours: cancel the one and stop the other, or a disabled or
    // replaced plugin still writes (#201, #301).
    this.unloaded = true;
    this.cancelUpdate();
  }
```

`registerEvent` handles the listeners. The plugin cancels its own pending timer, so disabling it within 200 ms of an edit does not cause one more write. Setting `unloaded` makes `enqueue` skip everything still queued or queued later, so a settings save or reload that finishes after unload cannot lead to a write, and the layout-ready callback from section 2 registers nothing.

## 9. Build, tests and release

`bun run build` runs `check` — the type check, Biome, and the Prettier check over every markdown file — then bundles `src/main.ts` into `main.js` with `obsidian` and `electron` marked external. `main.js` is committed because Obsidian ships the committed file. CI, the beta workflow and the release workflow all rebuild and fail on `git diff --exit-code main.js`, then run `bun test`.

The tests run under Bun and take `env` and `file` from the `bun` module. They load the npm `moment` package, a devDependency standing in for Obsidian's `window.moment`, with a dynamic `import()`. The community lint forbids a static import of it, which in shipped code would bundle a second copy of moment into the plugin. The tests are never bundled, so the dynamic import costs nothing. `version-bump.ts`, run by `bun run version` after `package.json` is bumped, also uses Bun's `file` and `write`. It copies the version into `manifest.json` and adds a `versions.json` row, and it refuses to run if `manifest.json` has no `minAppVersion`.

A release is a bare-semver tag. `release.yml` checks it against `package.json`, `manifest.json` and `versions.json`, then publishes `main.js` and `manifest.json` with build provenance. The plugin has no stylesheet, so there is no `styles.css` to ship. A beta comes from the manually triggered `beta.yml`, which refuses to run from any branch but `v2`. It stamps a version like `2.0.0-beta.1` into `manifest.json` for that run only and publishes the same two files as a GitHub prerelease for BRAT.
