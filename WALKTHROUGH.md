# Walkthrough

How Vault Changelog works, start to finish. It follows the call chain rather than the directory
listing, so read it top to bottom.

Every snippet is labelled with its **file and symbol** rather than a line range, so a quote keeps
pointing at the right thing after an unrelated edit above it. Each one is sliced directly out of
the source and carries a `<!-- prettier-ignore -->` marker: prettier reformats code inside fenced
blocks — it dedents them and rejoins wrapped lines — which rots a quote while leaving it looking
perfectly fine.

## Overview

The plugin maintains a note listing the vault's most recently edited files, newest first, each as
a link. Run it from the command palette, or turn on auto-update and it rewrites that note
whenever you edit, rename or delete something.

One fact governs everything else: **the changelog note is overwritten in full on every update.**
Nothing accumulates, nothing merges, no history is kept. The output is a function of the vault's
current state, so running it twice against an unchanged vault produces the same bytes.

TypeScript, bundled by Bun into a single CommonJS `main.js` that Obsidian loads. That file is
committed to the repository, because the committed file is what ships.

## Architecture

Three source files, and one boundary that matters more than the directory layout.

| File               | Contains                                                           | Tests |
| ------------------ | ------------------------------------------------------------------ | ----- |
| `src/changelog.ts` | Filtering, sorting, formatting, settings normalization, validation | 30    |
| `src/main.ts`      | Plugin lifecycle, vault events, file I/O, persistence              | none  |
| `src/settings.ts`  | The settings tab and its path autocomplete                         | none  |

`src/changelog.ts` has **no imports at all** — not Obsidian, not `moment`. That is what lets the
whole test suite run without a live Obsidian, and it is held by handing the module anything it
would otherwise reach for: a time formatter, and a path normalizer.

`main.ts` and `settings.ts` have no tests by construction. The bargain is that the decisions live
on the pure side, leaving the untested side thin enough to read in one sitting.

## Starting up

`src/main.ts` — `ChangelogPlugin.onload`

<!-- prettier-ignore -->
```ts
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

Settings load first, because the tab and every handler read them. Then the command, then three
vault listeners.

`handler` requires three things before it does anything: auto-update is on, the changed thing is
a file rather than a folder, and it is not the changelog itself. That last test is what keeps the
plugin from retriggering forever — writing the changelog is itself a `modify` event.

All three events share that one handler, **`rename` included**. `rename` is the only vault event
that also receives an `oldPath`, and nothing here takes it. So when the changelog note itself is
moved or renamed, `settings.changelogPath` keeps pointing at where it used to be: the guard above
starts comparing against a stale path, the changelog begins listing itself, and the next write
creates a fresh file back at the old location.

`src/main.ts` — `ChangelogPlugin.loadSettings`

<!-- prettier-ignore -->
```ts
  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }
```

`normalizePath` is passed in rather than imported inside `changelog.ts` — one of the two places
Obsidian is handed to the pure module instead of reached for.

## The debounce

`src/main.ts` — `ChangelogPlugin.debouncedVaultChange`

<!-- prettier-ignore -->
```ts
export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    void this.updateChangelog().catch(() => {
      new Notice("Failed to update changelog");
    });
  }, 200);
```

Obsidian's `debounce` takes a third `resetTimer` argument that defaults to `false`, and it is not
passed here. With that default the function behaves as a **throttle**: it fires 200 ms after the
_first_ event in a burst, then again for the next burst, rather than waiting for the burst to
end. Typing in a vault with autosave on regenerates the whole changelog repeatedly while you
work.

`src/main.ts` — `ChangelogPlugin.onunload`

<!-- prettier-ignore -->
```ts
  onunload(): void {}
```

Nothing to undo — `registerEvent` releases the three listeners on its own. The timer is the one
thing it does not know about, so a debounce already in flight when the plugin is disabled will
still fire, against an instance Obsidian has finished with.

## A single update

Both entry points — the command and the debounced handler — call `updateChangelog`.

`src/main.ts` — `ChangelogPlugin.updateChangelog`

<!-- prettier-ignore -->
```ts
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

Two calls and nine arguments, with an ordering the caller has to honour: `filterAndSort` runs
first, because `generateChangelog` formats whatever list it receives and filters nothing itself.
A new setting that affects output means widening a signature here and at the definition.

The last argument is the second injection point. It closes over Obsidian's globally-installed
moment, so nothing is bundled; the tests pass the npm `moment` package in its place, which is why
`moment` is a devDependency and never ships.

`src/main.ts` — `ChangelogPlugin.writeToFile`

<!-- prettier-ignore -->
```ts
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

The `catch` is a genuine race rather than defensive habit. Between `getAbstractFileByPath`
returning nothing and `create` running, a concurrent vault event can create the file; `create`
then throws on something that now exists, and looking it up a second time is the recovery.

**Nothing here examines what it is about to replace.** `changelogPath` is free text that can name
any note in the vault, the only check anywhere is that it ends in `.md` — which every note does —
and `vault.modify` then writes over the whole file. The path autocomplete in the settings tab
offers existing notes as completions, so selecting one is a single click.

Both failure paths also report the same four words: each caller wraps this in
`.catch(() => new Notice("Failed to update changelog"))`, discarding the error, so the message
below that names the failing path is constructed and never seen.

## The pure core

### Choosing and ordering

`src/changelog.ts` — `filterAndSort`

<!-- prettier-ignore -->
```ts
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

Three decisions in one pass: the changelog never lists itself, excluded folders are prefix
matches, and what survives is sorted newest-first and truncated.

The `folder.endsWith("/")` ternary earns its place. Without appending the separator, excluding
`Notes` would also exclude `Notes2/` and `Notebook/`, because both paths start with `Notes`. The
suite pins exactly that case.

Matching is exact and case-sensitive, so on a case-insensitive filesystem a user who types
`archive` for a folder named `Archive` gets a settings row that looks like a rule and excludes
nothing.

### Formatting

`src/changelog.ts` — `generateChangelog`

<!-- prettier-ignore -->
```ts
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

It receives an already-filtered list and four more positional parameters.

`file.basename` is used directly, which is where two notes sharing a filename become one row
repeated: `Projects/Meeting Notes.md` and `Archive/Meeting Notes.md` both render as
`[[Meeting Notes]]`, and both links resolve to whichever the vault picks.

### Settings coming off disk

`src/changelog.ts` — `clampMaxRecentFiles`

<!-- prettier-ignore -->
```ts
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

Documented as the one authoritative rule for this field, and called by both the loader and the
settings tab — the only field where that is true.

Read the order carefully. `Number()` runs _before_ the finiteness test, and `Number()` maps
`null`, `""`, `[]` and `false` to a perfectly finite `0`, which the clamp then lifts to `1`. A
`data.json` holding any of those produces a changelog exactly one entry long rather than the
documented fallback to 25.

`src/changelog.ts` — `normalizeLoadedSettings`

<!-- prettier-ignore -->
```ts
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
  settings.maxRecentFiles = clampMaxRecentFiles(settings.maxRecentFiles);
  settings.changelogHeading = settings.changelogHeading.trim();
  return settings;
}
```

Persisted data is treated as hostile, and rightly — it is hand-editable, sync-corruptible, and
may have been written by an older version.

The function copies known keys into a fresh object, spreads that over the defaults, then walks
the result three more times restoring defaults wherever the runtime type is wrong: a string-key
tuple, a boolean-key tuple, and a special case for the array. The `knownKeys` filter is what
keeps a renamed or removed setting from lingering, and running it before the spread is also what
keeps a `__proto__` key in the JSON from reaching the result.

The two `as const` tuples are maintained by hand. Add an eighth setting, forget to list it in the
matching tuple, and nothing fails.

### Validating what the user types

`src/changelog.ts` — `isValidChangelogPath`

<!-- prettier-ignore -->
```ts
/** The changelog must be a markdown file; paths are validated post-normalize. */
export function isValidChangelogPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".md");
}
```

The whole of the path validation. Every note in the vault ends in `.md`, so this accepts every
note in the vault.

`src/changelog.ts` — `validateExcludedFolder`

<!-- prettier-ignore -->
```ts
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
  if (!normalizedFolder || normalizedFolder === ".") return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}
```

Three-valued, so a caller can distinguish the two failure modes. Note that the guards test raw
shapes — empty string, `"."` — while the parameter is named `normalizedFolder` and the only
caller normalizes first. Whatever `normalizePath` returns for empty input, unless it is exactly
`"."`, passes as valid.

## The settings tab

`src/settings.ts` — `PathSuggest.getPaths`

<!-- prettier-ignore -->
```ts
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

The suggester collects folders **and every markdown file in the vault**, and the same class
serves both the excluded-folder field and the changelog-path field. For the changelog path that
means your existing notes appear as completions for a setting whose file gets overwritten in
full.

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
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

The changelog-path field commits on `blur` rather than per keystroke, which is the right choice:
a half-typed path is not a wrong path.

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
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
    });
```

The datetime field does not. `onChange` fires on every keystroke and does three things at once —
substitutes the default when the field is empty, writes that back into the input with
`setValue`, and saves. Selecting all and deleting before retyping, which is how anyone replaces a
value, therefore puts the default into the box and into `data.json` before the first character of
the replacement is typed.

`datetimePreview` is declared just above without an initializer and read inside that closure,
twenty lines before the assignment below it. The ordering is forced, since `descEl` does not
exist until the `Setting` has been constructed, and it is safe only because `onChange` cannot
fire until `display()` has returned. TypeScript's definite-assignment analysis does not follow
closures, so nothing checks that reasoning still holds after an edit.

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
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
```

The range rule is written twice here and the two halves disagree. This pre-check rejects `0` and
`abc` by reverting with a notice; `1000` and `25.9` fall through to `clampMaxRecentFiles` and are
rewritten silently. The notice names a range the handler only enforces at one end.

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
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

`validateExcludedFolder` returns three verdicts and this handler acts on two. `"duplicate"`
falls off the end: no notice, the input is not cleared, the list is not redrawn. Adding a folder
already in the list is indistinguishable from a dead button.

## Saving

Every field above follows the same two steps — assign into the plugin's settings object, then
call `saveSettingsSafely()`. There are eight such pairs.

`src/main.ts` — `ChangelogPlugin.saveSettings`

<!-- prettier-ignore -->
```ts
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  saveSettingsSafely(): void {
    this.saveSettings().catch(() => {
      new Notice("Failed to save changelog settings");
    });
  }
```

The assignment has already happened by the time the write is attempted, and nothing restores it
if the write rejects. The user sees a notice, the plugin carries on using the new value, and the
next restart silently reverts to what was actually on disk.

## Tests

The suite covers `changelog.ts` only, and injection is what makes that possible.

`src/changelog.test.ts` — `formatter`

<!-- prettier-ignore -->
```ts
const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);
```

Time formatting arrives as a function, so the tests supply the npm `moment` package where
production supplies Obsidian's global. The normalizer is substituted the same way — `identity`
where normalization is irrelevant to the case, and a trailing-slash stripper where it is not.

Fixtures are plain object literals. `ChangelogFile` is a structural interface of the three fields
the core reads — `path`, `basename`, `stat.mtime` — so a real `TFile` satisfies it and so does
`{ path, basename, stat: { mtime } }`. There is no mocking anywhere.

## Build and release

`build.ts` — `build`

<!-- prettier-ignore -->
```ts
async function build() {
  const result = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: ".",
    format: "cjs",
    external: ["obsidian", "electron"],
    minify: !isWatch,
    sourcemap: isWatch ? "linked" : "none",
  });

  console.log(
    `Built main.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`,
  );
}
```

`obsidian` and `electron` are marked external and must never be bundled; Obsidian supplies both
at runtime. Minification is on except in watch mode, where a linked sourcemap is more use.

CI runs `bun run build` and then `git diff --exit-code main.js`. Because the committed bundle is
what ships, any change to `src/` or to a dependency that is not followed by a rebuild fails the
PR. Bun is deliberately unpinned, so a bundler release that shifts output — different minified
identifier names are enough — trips the same check, and the fix is the same: rebuild and commit.

`version-bump.ts` — `version-bump`

<!-- prettier-ignore -->
```ts
const manifest = await Bun.file("manifest.json").json();
const { minAppVersion } = manifest;
manifest.version = targetVersion;
await Bun.write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
```

`minAppVersion` is read _before_ the version field is overwritten, which is the subtle part.
Releases go through the `release-gate` skill and then `release-ship`, which is user-invoked; tags
are bare `X.Y.Z` and point at the merged commit of a `release/<version>` prep PR, and
`release.yml` turns that tag into the GitHub release. Nobody pushes a tag by hand.

## Findings

| Finding                                                                                                                                                                                                                                                                     | Where                                                            | Status                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The plugin overwrites the note at `changelogPath` with no check that it wrote it, and the path autocomplete offers existing notes as completions. A guard was attempted and failed in both directions; its failure modes are recorded so it is not reattempted the same way | `src/main.ts` — `writeToFile`, `src/settings.ts` — `PathSuggest` | [#250](https://github.com/philoserf/obsidian-vault-changelog/issues/250) |
