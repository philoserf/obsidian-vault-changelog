# Walkthrough

How Vault Changelog works, start to finish. Read it top to bottom; it follows the call chain
rather than the directory listing.

Every snippet is labelled with its **file and symbol** rather than a line range, so a quote still
points at the right thing after an unrelated edit above it. Snippets are sliced directly out of
the source and carry a `<!-- prettier-ignore -->` marker, because prettier reformats code inside
fenced blocks — it dedents them and rejoins wrapped lines — and that silently rots quotes while
leaving them looking correct.

**This document describes 1.5.4.** The 1.6.0 and 1.7.0 releases were withdrawn and their code
reverted off `main`, so anything you may have read about an ownership guard, per-field settings
rules, or a single settings commit path describes code that is no longer here. Several rough
edges below were fixed in those releases and are, as of this document, unfixed again.

## Overview

The plugin maintains a note listing the vault's most recently edited files. Enable auto-update
and it rewrites that note whenever you edit, rename or delete something; or run the command
yourself from the palette.

The single most important thing to know before reading the code: **the changelog file is
overwritten in full on every update.** Nothing accumulates, nothing is merged, no history is
kept. Run it twice against an unchanged vault and you get the same string both times.

TypeScript, built with Bun's native bundler into a single CommonJS `main.js` that Obsidian loads.
`main.js` is committed, because that committed file is what ships.

## Architecture

Three source files, and the split between the first and the other two is the one that matters.

| File               | Role                                                               | Tested                  |
| ------------------ | ------------------------------------------------------------------ | ----------------------- |
| `src/changelog.ts` | Filtering, sorting, formatting, settings normalization, validation | Exhaustively — 30 tests |
| `src/main.ts`      | The Obsidian plugin: lifecycle, events, file I/O                   | Not at all              |
| `src/settings.ts`  | The settings tab and its path autocomplete                         | Not at all              |

`src/changelog.ts` imports nothing — not Obsidian, not `moment`. That is what makes it testable
without a running Obsidian, and the rule is held by injecting anything it would otherwise need:
a `TimeFormatter` callback for time formatting, and a `normalize` function for path handling.

`main.ts` and `settings.ts` are untested **by construction**. That is the deal: keep the
decisions on the pure side and the untested side stays thin enough to read.

## Loading

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

Settings load first, because the settings tab and every handler read them. Then the command, then
three vault listeners.

`handler` guards on three things: auto-update is on, the changed thing is a file rather than a
folder, and it is not the changelog itself. That last check is what stops the plugin triggering
itself in a loop — writing the changelog is a `modify` event.

**Note that all three events share one handler, `rename` included.** `rename` is the only event
that also carries an `oldPath` argument, and this code does not take it. The consequence is worth
understanding: if you move or rename the changelog note itself, `settings.changelogPath` still
points at the old location. The guard then compares the renamed file against a stale path, the
changelog begins listing itself, and the next write recreates a file at the old name.

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

`normalizePath` is passed in rather than imported by `changelog.ts`, which is one of the two
injection points keeping the pure module Obsidian-free.

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

Obsidian's `debounce` takes a third `resetTimer` parameter which **defaults to `false`**, and it
is not passed here. With that default the function is a _throttle_ rather than a debounce: it
fires 200 ms after the **first** event of a burst, then again for the next burst. During
sustained typing with Obsidian autosaving, that regenerates the whole changelog repeatedly rather
than once when editing stops.

`src/main.ts` — `ChangelogPlugin.onunload`

<!-- prettier-ignore -->
```ts
  onunload(): void {}
```

`onunload` is empty. `registerEvent` releases the listeners automatically, but the debounce timer
is not something it knows about — so a pending timer can still fire after the plugin has been
disabled, against a torn-down instance.

## One update, end to end

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

Two calls, nine arguments between them, and the ordering is a contract the caller has to keep:
`filterAndSort` must run first, because `generateChangelog` formats whatever list it is handed
without filtering anything itself. Adding a setting that affects output means widening a
signature and this call site.

The last argument is the second injection point. The formatter wraps Obsidian's
globally-installed moment, so nothing is bundled; tests pass the npm `moment` package instead,
which is why `moment` is a devDependency and never ships.

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

The `catch` is a TOCTOU race, not defensive padding. Between `getAbstractFileByPath` returning
nothing and `create` running, a concurrent vault event can create the file; `create` then throws
on a file that now exists, and looking it up again is the recovery.

**What this method does not do is check what it is about to destroy.** `changelogPath` is free
text and can name any note in the vault; the only validation anywhere is that it ends in `.md`,
which every note satisfies. `vault.modify` then replaces that note's entire contents. Pointing
the setting at an existing note — which the path autocomplete below makes easy — loses it.

Note also that both failure paths report the same four words. `updateChangelog`'s two callers
each `.catch()` with `new Notice("Failed to update changelog")`, discarding the error, so the
message here naming the failing path is built and never read.

## The pure core

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

Three filters in one pass: the changelog never lists itself, excluded folders are prefix matches,
and the rest sort newest-first and truncate. The `folder.endsWith("/")` ternary is not cosmetic —
without the appended separator, excluding `Arch` would also exclude `Archive/`, because
`"Archive/x.md".startsWith("Arch")` is true.

Matching is exact and case-sensitive. On a case-insensitive filesystem a user who types
`archive` for a folder named `Archive` gets a row that looks like a working rule and excludes
nothing.

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

It takes an already-filtered list — see the ordering contract above — and five positional
parameters.

`file.basename` is used directly, which is where two notes sharing a filename become
indistinguishable: `Projects/Meeting Notes.md` and `Archive/Meeting Notes.md` both render as
`[[Meeting Notes]]`, and both links resolve to whichever note the vault picks.

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

Documented as the one authoritative clamping rule, called from both load-time and the settings
UI. Worth reading carefully: `Number()` runs **before** the finiteness test, and `Number()` maps
`null`, `""`, `[]` and `false` to a perfectly finite `0` — which the clamp then raises to `1`. A
`data.json` carrying any of those shapes yields a changelog exactly one entry long, rather than
the documented fallback to the default.

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

Persisted data is not trusted. The function copies known keys into a fresh object, spreads that
over the defaults, then walks the result three more times — a string-key tuple, a boolean-key
tuple, and an array special case — restoring defaults wherever the runtime type is wrong. The
`knownKeys` filter is what stops a renamed or removed setting lingering in `data.json`, and
running it before the spread is also what keeps a `__proto__` key out of the result.

The two `as const` key tuples have to be kept in sync with `ChangelogSettings` by hand. Nothing
fails if you add an eighth setting and forget.

`src/changelog.ts` — `isValidChangelogPath`

<!-- prettier-ignore -->
```ts
/** The changelog must be a markdown file; paths are validated post-normalize. */
export function isValidChangelogPath(normalizedPath: string): boolean {
  return normalizedPath.endsWith(".md");
}
```

The entire path validation. Every note in the vault ends in `.md`, so this accepts every note in
the vault.

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

Three-valued, so the caller can tell the two failure modes apart. Note the guards are written
against raw input — empty string, `"."` — while the parameter is named `normalizedFolder` and the
only caller normalizes first. Whichever marker `normalizePath` returns for empty input, if it is
not exactly `"."` it passes as valid.

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

The suggester offers folders **and every markdown file in the vault**, and it serves both the
excluded-folder field and the changelog-path field. For the changelog path that means existing
notes are offered as completions, and selecting one is a single click — combined with
`writeToFile`'s lack of an ownership check, that is the fastest route to overwriting a note.

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

The changelog-path field validates on `blur` rather than per keystroke, which is right: a
half-typed path is not a wrong path.

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

The datetime field does not. `onChange` fires per keystroke and does three things — substitutes
the default for an empty field, writes it back into the input with `setValue`, and saves. Select
all and delete before retyping, which is the ordinary way to replace a value, and the default is
stuffed into the field and persisted over the user's format before the first character of the
replacement is typed.

`datetimePreview` is also declared here without an initializer and read inside that closure
twenty lines before it is assigned. The ordering is forced — `descEl` does not exist until the
`Setting` is constructed — and it is safe only because `onChange` cannot fire until `display()`
has returned. TypeScript's definite-assignment analysis does not reach into closures, so nothing
checks that.

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

The range rule is implemented twice and the halves disagree. This pre-check rejects `0` and `abc`
by reverting with a notice; anything above the maximum, or a fraction, falls through to
`clampMaxRecentFiles` and is rewritten silently. The notice names a range — 1 to 500 — that the
handler only enforces at the low end.

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

`validateExcludedFolder` returns three verdicts and this handler uses two. `"duplicate"` falls
off the end: no notice, the input is not cleared, the list is not re-rendered. Adding a folder
that is already listed is indistinguishable from a dead button.

Note also the shape shared by all seven fields — assign directly into the plugin's settings
object, then call `saveSettingsSafely()`:

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

The assignment has already happened when the persist fails, and nothing rolls it back. The user
gets a notice; the plugin keeps running on the value; the next restart silently reverts it.

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

`obsidian` and `electron` are marked external and must never be bundled — Obsidian provides both
at runtime. Minification is on except in watch mode, where a linked sourcemap is more useful.

CI runs `bun run build` and then `git diff --exit-code main.js`. Since the committed bundle is
what ships, any change to `src/` or to a dependency that is not followed by a rebuild fails the
PR. Bun is deliberately unpinned, so a bundler-output shift trips the same check; the fix is the
same either way.

Releases go through the `release-gate` skill and then `release-ship`, which is user-invoked. Tags
are bare `X.Y.Z` and point at the merged commit of a `release/<version>` prep PR;
`release.yml` triggers on that tag and creates the GitHub release. Nobody pushes a tag by hand.

## Findings

This walkthrough describes reverted code, so the rough edges above are not new discoveries — they
are the defects 1.6.0 and 1.7.0 fixed, now present again. They are recorded in the closed issues
of that milestone rather than re-filed here.

| Finding                                                                                             | Where       | Status                                                                       |
| --------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| Thirteen defects fixed in 1.6.0/1.7.0 are present again on `main`, while their issues remain closed | `src/`      | see [#247](https://github.com/philoserf/obsidian-vault-changelog/issues/247) |
| README has no troubleshooting for failed installs and updates on Windows                            | `README.md` | [#244](https://github.com/philoserf/obsidian-vault-changelog/issues/244)     |
