# Vault Changelog Walkthrough

*2026-09-09T21:51:49Z by Showboat 0.6.1*
<!-- showboat-id: db6225c6-0bb7-4059-bd76-b52f4be3067d -->

## Overview

**Vault Changelog** is an [Obsidian](https://obsidian.md/) community plugin. It keeps one note
in your vault listing the most recently edited notes, newest first, with a timestamp on each
line.

The single most important thing to know before reading any code: **the changelog note is
regenerated from scratch every time and overwritten wholesale.** Nothing is appended and no
history is kept. The output is a pure function of the vault's current state — which is why
there is no merge logic, no locking, and no retry anywhere in this codebase.

Technologies: TypeScript, bundled with Bun's native bundler, tested with `bun test`, linted and
formatted with Biome. The `obsidian` package is types-only — there is no JavaScript in it — so
nothing here can execute an Obsidian API call outside of Obsidian itself.

The manifest is what Obsidian reads to load the plugin:

```bash
cat manifest.json
```

```output
{
  "id": "obsidian-vault-changelog",
  "name": "Vault Changelog",
  "version": "1.5.4",
  "minAppVersion": "1.6.6",
  "description": "Maintain a changelog of recently edited notes.",
  "author": "Mark Ayers (originally by Badr Bouslikhin)",
  "authorUrl": "https://github.com/philoserf",
  "fundingUrl": "https://buymeacoffee.com/philoserf",
  "isDesktopOnly": false
}
```

## Architecture

Three source files, and the boundary between them is deliberate:

- **`src/changelog.ts`** — the pure core. Zero imports. Every decision the plugin makes about
  *what* the changelog should contain lives here, expressed as functions over plain data.
- **`src/main.ts`** — the plugin shell. Extends Obsidian's `Plugin`, registers the command and
  the vault listeners, and does all the I/O.
- **`src/settings.ts`** — the settings tab and the path autocompleter. All DOM, no decisions.

The pure core is the whole point of the layout: it is the only file the test suite touches, and
it can be tested without Obsidian because the two things it would otherwise need — a clock
formatter and a path normalizer — are passed in as arguments.

```bash
cat <<'TREE'
obsidian-vault-changelog/
├── src/
│   ├── changelog.ts       pure core: filter, sort, render, validate, normalize
│   ├── main.ts            Plugin subclass: lifecycle, command, events, file I/O
│   ├── settings.ts        ChangelogSettingsTab + PathSuggest
│   └── changelog.test.ts  the entire test suite, all of it against changelog.ts
├── build.ts               Bun bundler wrapper (+ watch mode)
├── deploy.ts              local convenience: copy build into a vault
├── version-bump.ts        package.json version -> manifest.json + versions.json
├── main.js                the committed build artifact Obsidian actually loads
├── manifest.json          plugin metadata
├── versions.json          version -> minAppVersion history
└── styles.css             styling for the excluded-folders list
TREE
```

```output
obsidian-vault-changelog/
├── src/
│   ├── changelog.ts       pure core: filter, sort, render, validate, normalize
│   ├── main.ts            Plugin subclass: lifecycle, command, events, file I/O
│   ├── settings.ts        ChangelogSettingsTab + PathSuggest
│   └── changelog.test.ts  the entire test suite, all of it against changelog.ts
├── build.ts               Bun bundler wrapper (+ watch mode)
├── deploy.ts              local convenience: copy build into a vault
├── version-bump.ts        package.json version -> manifest.json + versions.json
├── main.js                the committed build artifact Obsidian actually loads
├── manifest.json          plugin metadata
├── versions.json          version -> minAppVersion history
└── styles.css             styling for the excluded-folders list
```

## 1. The entry point: `ChangelogPlugin`

Obsidian loads `main.js` and instantiates the default export. Everything starts here.

Two things happen at the class body level, before any method runs. `settings` is seeded with
`DEFAULT_SETTINGS` so the object is never `undefined` even if loading fails, and the debounced
vault-change handler is created once as a property rather than per-event — creating it inside
the event handler would make a fresh debouncer for every keystroke and defeat the point.

```bash
sed -n '19,25p' src/main.ts
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

### `onload` — the whole wiring in 27 lines

Settings are loaded first, because everything else reads them. Then the settings tab, then the
command, then three vault listeners.

The `handler` closure is where the plugin's most important safety property lives. It checks
three conditions **before** poking the debouncer:

1. `autoUpdate` is on — otherwise the user only wants the manual command.
2. The subject is a `TFile`, not a folder. Vault events fire for both.
3. The changed file is **not** the changelog itself.

That third check is the loop breaker. Writing the changelog fires a `modify` event for the
changelog; without the guard, the plugin would rewrite the file in response to having just
rewritten it, forever. The guards sit outside the debounced callback on purpose — putting them
inside would let ignorable events still arm the timer.

All three listeners share one handler, so a rename or a delete rebuilds the changelog just as a
modification does. `registerEvent` hands teardown to Obsidian, which is why `onunload` further
down has nothing to do.

```bash
sed -n '27,53p' src/main.ts
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
    this.registerEvent(this.app.vault.on("rename", handler));
  }
```

## 2. The update: three steps, no state

Both paths — the command palette and the debounced vault handler — converge on
`updateChangelog`. It reads like a pipeline because it is one: gather, render, write. No
previous output is consulted.

Note the fourth argument to `generateChangelog`: a closure wrapping `window.moment`. Obsidian
installs moment as a global, so the plugin uses it without bundling it. Passing it in as a
function is what keeps `changelog.ts` free of any dependency on Obsidian's environment — the
test suite passes the npm `moment` package through the same parameter.

```bash
sed -n '55,70p' src/main.ts
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

## 3. Step one — `filterAndSort`

We cross into the pure core. First, the type it works against:

```bash
sed -n '106,110p' src/changelog.ts
```

```output
interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

`ChangelogFile` is the narrowest structural subset of Obsidian's `TFile` these functions
actually touch. A real `TFile` satisfies it, so `main.ts` passes `getMarkdownFiles()` straight
through with no adapter; a three-field object literal in a test satisfies it too. Widening this
to `TFile` would drag `obsidian` into the pure module and collapse the arrangement — if you need
another property, add it here instead.

Now the function. Filter, then sort by modification time descending, then truncate:

```bash
sed -n '112,129p' src/changelog.ts
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

The ternary inside the filter deserves a pause, because it looks redundant and is not:
`folder.endsWith("/") ? folder : folder + "/"`.

Both branches are live. Obsidian's `normalizePath` strips trailing slashes, so anything saved
through the settings UI today arrives as `Archive`. But the setting predates that
normalization, so an old `data.json` can still hold `Archive/`. The slash is re-added at match
time rather than migrated at save time.

And the slash *matters*. Matching on the bare prefix `Notes` would also swallow `Notes2/` and
`Notebook/`. Watch the real function do it — excluding `Notes` leaves the two lookalikes alone:

```bash
bun -e '
import { filterAndSort } from "./src/changelog.ts";
const files = [
  { path: "Notes/file.md",    basename: "file",  stat: { mtime: 100 } },
  { path: "Notes2/file.md",   basename: "file2", stat: { mtime: 200 } },
  { path: "Notebook/file.md", basename: "file3", stat: { mtime: 300 } },
];
for (const f of filterAndSort(files, "Changelog.md", ["Notes"], 25)) console.log(f.path);
'
```

```output
Notebook/file.md
Notes2/file.md
```

## 4. Step two — `generateChangelog`

The renderer. Everything variable about the output is a parameter, including the clock:

```bash
sed -n '131,147p' src/changelog.ts
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

Three details carry weight:

- The heading is emitted **only if non-empty**, followed by exactly two newlines. That spacing
  is only predictable because `changelogHeading` is trimmed at both boundaries — on load and on
  change — so a stray trailing newline in the setting cannot smear the layout.
- The heading is written *literally*. Configure `# Changelog` and you get `# Changelog`; the
  plugin does not add a `#` for you.
- With no files, the result is the empty string — heading and all. An empty vault produces an
  empty note, not a header over nothing.

Here is the renderer producing real output, with the npm `moment` standing in for Obsidian's
global exactly as the tests do:

```bash
bun -e '
import { generateChangelog } from "./src/changelog.ts";
import moment from "moment";
const utc = (mtime, f) => moment.utc(mtime).format(f);
const files = [
  { path: "Note B.md", basename: "Note B", stat: { mtime: Date.UTC(2026, 0, 15, 14, 30) } },
  { path: "Note A.md", basename: "Note A", stat: { mtime: Date.UTC(2026, 0, 15, 14, 0) } },
];
process.stdout.write(generateChangelog(files, "YYYY-MM-DD[T]HHmm", true, "# Changelog", utc));
console.log("---- wiki-links off, no heading ----");
process.stdout.write(generateChangelog(files, "YYYY-MM-DD[T]HHmm", false, "", utc));
'
```

```output
# Changelog

- 2026-01-15T1430 · [[Note B]]
- 2026-01-15T1400 · [[Note A]]
---- wiki-links off, no heading ----
- 2026-01-15T1430 · Note B
- 2026-01-15T1400 · Note A
```

## 5. Step three — `writeToFile`

Back in the shell. This is the only place the plugin mutates the vault:

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

Read the `catch` carefully — it is doing something unusual on purpose. `vault.create` can throw
because the file already exists, and between the `getAbstractFileByPath` check above and the
`create` call, a concurrent vault event may have created it. Rather than treat the throw as
failure, the code re-fetches by path and carries on. Only if the second lookup *also* comes up
empty does it give up.

That tolerance is safe precisely because the changelog is derived: whoever won the race was
going to write the same content this call is about to write. This is the TOCTOU handling
`CLAUDE.md` asks you to preserve.

The final `else` covers the case where the path resolves to a folder rather than a file — you
cannot `modify` a folder, so the user gets a `Notice` instead of an exception.

`vault.modify` replaces the entire file. There is no append and no merge. Whatever was in that
note is gone.

```bash
sed -n '90,107p' src/main.ts
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
```

The tail of the class. `loadSettings` hands the raw persisted blob straight to
`normalizeLoadedSettings` along with Obsidian's `normalizePath` — that injection is the whole
reason the pure core can validate paths without importing Obsidian.

`onunload` is empty because there is nothing to undo: every listener went through
`registerEvent`, which Obsidian tears down itself.

`saveSettingsSafely` exists because the settings UI calls save from synchronous event handlers
that cannot `await`. Without it, a rejected save becomes an unhandled promise rejection; with
it, the user sees a `Notice`.

## 6. The settings model

Seven settings, and the defaults are chosen conservatively: auto-update is **off**, so a fresh
install never writes to the vault until asked.

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

### `normalizeLoadedSettings` — treating `data.json` as hostile

Obsidian persists settings as JSON in the vault, where a user can hand-edit it and a failed
write can truncate it. This function is the single gate between that file and the running
plugin, and it is deliberately paranoid:

```bash
sed -n '44,83p' src/changelog.ts
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

Five passes, in order:

1. **Drop unknown keys.** A setting you rename or remove does not linger in `data.json`
   forever.
2. **Type-check the known keys.** Strings, then booleans, each falling back to its default when
   the runtime type is wrong. `excludedFolders` is checked as a whole — one non-string element
   discards the entire array rather than leaving a mixed one.
3. **Normalize paths**, via the injected normalizer, so the settings UI's duplicate detection
   compares like with like.
4. **Clamp `maxRecentFiles`.**
5. **Trim the heading**, which is what makes `generateChangelog`'s two-newline spacing
   predictable.

**If you add a setting, add it to `DEFAULT_SETTINGS` *and* to the matching type-guard loop.**
Doing only the first compiles, passes the tests, and ships a setting that corrupt persisted data
can turn into `undefined` at runtime.

Watch it discard junk and rebuild a valid object:

```bash
bun -e '
import { normalizeLoadedSettings } from "./src/changelog.ts";
const hostile = {
  autoUpdate: "yes please",
  maxRecentFiles: 9999,
  changelogHeading: "   # Changelog  ",
  excludedFolders: ["Archive/", 42],
  legacySetting: "left over from v1.2",
};
console.log(JSON.stringify(normalizeLoadedSettings(hostile, (p) => p.replace(/\/+$/, "")), null, 2));
'
```

```output
{
  "autoUpdate": false,
  "changelogPath": "Changelog.md",
  "datetimeFormat": "YYYY-MM-DD[T]HHmm",
  "maxRecentFiles": 500,
  "excludedFolders": [],
  "useWikiLinks": true,
  "changelogHeading": "# Changelog"
}
```

Every hostile field was neutralised: `"yes please"` reverted to `false`, `9999` clamped to the
cap, the mixed `excludedFolders` array discarded whole because of the `42` in it, the heading
trimmed, and `legacySetting` dropped.

### `clampMaxRecentFiles` — one rule, two callers

Load-time and the settings UI both call this, and the comment says so. That single-authority
rule is not decoration: the two paths once disagreed about floats and about the upper bound, and
reconciling them was the point of release 1.5.3. Do not re-derive the rule at a third call site.

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

```bash
bun -e '
import { clampMaxRecentFiles as clamp } from "./src/changelog.ts";
const cases = [
  ["25", 25], ["25.9", 25.9], ["0", 0], ["-5", -5], ["1000", 1000],
  ["\"42\"", "42"], ["\"abc\"", "abc"], ["NaN", Number.NaN],
  ["undefined", undefined], ["Infinity", Number.POSITIVE_INFINITY],
];
for (const [label, value] of cases) process.stdout.write(label.padEnd(12) + "-> " + String(clamp(value)) + "\n");
'
```

```output
25          -> 25
25.9        -> 25
0           -> 1
-5          -> 1
1000        -> 500
"42"        -> 42
"abc"       -> 25
NaN         -> 25
undefined   -> 25
Infinity    -> 25
```

Non-finite input falls back to the default rather than clamping, which is the right call: `NaN`
means "this data is garbage", not "this data is small".

### The two validators

Both are called from the settings UI, on already-normalized input:

```bash
sed -n '85,104p' src/changelog.ts
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

`validateExcludedFolder` returns a three-valued verdict rather than a boolean, so the UI can say
something different about a rejected path than about one already in the list. Hold on to that —
it comes back in the findings below.

## 7. The settings tab

`src/settings.ts` builds the UI. It is the largest file and the least interesting, because it
holds no decisions — every judgement it needs it imports from `changelog.ts`.

### `PathSuggest`

A subclass of Obsidian's `AbstractInputSuggest`, shared by both path fields:

```bash
sed -n '28,47p' src/settings.ts
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

  getSuggestions(inputStr: string): string[] {
    const lowerInput = inputStr.toLowerCase();
    return this.getPaths().filter((p) => p.toLowerCase().contains(lowerInput));
  }
```

Every folder (slash-suffixed) and every markdown file, in one flat list, cached on first use.
The cache is never invalidated — but `display()` rebuilds the tab's DOM and constructs fresh
suggesters each time the settings tab is opened, so in practice it is stale only for files
created while the tab sits open. That trade was made deliberately in 1.5.0 to stop the vault
being rescanned on every keystroke.

Note that one list serves both fields: the changelog-path field wants a file and the
excluded-folder field wants a folder, and neither gets a filtered view. That comes back in the
findings too.

`selectSuggestion` does something worth knowing about — it dispatches a synthetic `blur` event:

```bash
sed -n '53,58p' src/settings.ts
```

```output
  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    this.inputEl.trigger("input");
    this.inputEl.dispatchEvent(new Event("blur"));
    this.close();
  }
```

Both path fields save on `blur` rather than on `change`, so that a half-typed path is never
persisted mid-keystroke. Picking a suggestion with the mouse would otherwise never fire `blur`
and the choice would be silently dropped, so the suggester fires it by hand.

### The changelog-path field

The one setting that can destroy data, and the whole of its validation:

```bash
sed -n '114,134p' src/settings.ts
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

Normalize, check it ends in `.md`, save — or revert the field and explain why. That `.md` check
is the *entire* guard standing between a user's typo and `vault.modify` overwriting a real note.

### The excluded-folders list

Rendering is a straightforward rebuild-in-place: empty the container, print a placeholder if the
list is empty, otherwise one row per folder with a remove button. Removing splices the array,
saves, and re-renders itself.

Adding is where the verdict from §6 is consumed:

```bash
sed -n '224,244p' src/settings.ts
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

Two arms for three verdicts. `"invalid"` raises a `Notice`; `"ok"` appends, saves, clears the
input and re-renders; `"duplicate"` falls off the end of the handler and does nothing at all —
no message, no cleared input, no redraw. This is the point where the linear reading of the code
breaks down: the pure core computes a distinction that the shell discards, and you have to hold
both files in mind to notice it. Filed below.

### Live preview for the datetime format

There is no validation of the moment.js format string, and that is a deliberate substitution —
release 1.3.0 replaced a no-op validator with a preview that renders the user's format as they
type. Showing the answer beats guessing at which format strings are legal.

```bash
sed -n '136,158p' src/settings.ts
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
    });
```

`datetimePreview` is declared before the `Setting` and assigned after it, because the preview
element has to be created inside the setting's description element, which does not exist until
the setting is built. The closure at line 151 reads a variable assigned at line 156 — safe only
because `onChange` cannot fire until `display()` has returned. Filed below.

## 8. The tests

One test file, and it imports only from `changelog.ts`. That is not a coverage gap — it is the
boundary the pure/shell split exists to create. `obsidian` ships type declarations and no
JavaScript, so `main.ts` and `settings.ts` are untestable outside Obsidian by construction,
which is the argument for keeping them as thin as they are.

```bash
grep -h 'describe(' src/changelog.test.ts
```

```output
describe("filterAndSort", () => {
describe("generateChangelog", () => {
describe("clampMaxRecentFiles", () => {
describe("normalizeLoadedSettings", () => {
describe("isValidChangelogPath", () => {
describe("validateExcludedFolder", () => {
```

The two most instructive tests are the ones that encode a lesson learned. This one names the
storage-format asymmetry from §3 directly in a comment:

```bash
sed -n '39,44p' src/changelog.test.ts
```

```output
  test("excludes folders saved without trailing slash", () => {
    // normalizePath strips trailing slashes, so "Archive" is the shape
    // the settings layer actually persists.
    const result = filterAndSort(files, "Changelog.md", ["Archive"], 25);
    expect(result.find((f) => f.path.startsWith("Archive/"))).toBeUndefined();
  });
```

And this one is the regression guard for the trailing slash:

```bash
sed -n '65,82p' src/changelog.test.ts
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

## 9. Build, check, release

`build.ts` is a thin wrapper over Bun's bundler:

```bash
sed -n '1,14p' build.ts
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
```

`obsidian` and `electron` are external and must never be bundled — Obsidian provides both at
runtime. Output is CommonJS, minified in production, with a linked sourcemap only in watch mode.
Watch mode additionally debounces its own rebuilds by 100 ms and ignores `.test.` files.

The one non-obvious thing about this repository is that **`main.js` is committed**, because
Obsidian ships the built bundle rather than building from source. That makes a stale artifact a
real hazard: a dependency bump that skips the rebuild would ship old code. CI closes it:

```bash
sed -n '15,25p' .github/workflows/main.yml
```

```output
        with:
          bun-version: latest
      - run: bun install
      - run: bun audit --audit-level=critical
      # `build` is check + bundle. The diff then fails the PR when the committed
      # main.js does not match a fresh build — Obsidian ships the committed
      # bundle, so a dependency bump that skips the rebuild must not merge.
      # bun is deliberately unpinned, so a bun release that shifts bundler
      # output trips this too. The fix is the same either way: rebuild and
      # commit main.js.
      - run: bun run build
```

`bun run build` runs `check` (typecheck + Biome) and then bundles; `git diff --exit-code main.js`
then fails the pull request if the freshly built bundle differs from the committed one. The
workflow comment notes that `bun` is deliberately left unpinned so that a bundler-output change
trips the same wire, and the fix is the same either way — rebuild and commit `main.js`.

Releasing is a version triple that must move together. `version-bump.ts` drives it from
`package.json`:

```bash
sed -n '1,14p' version-bump.ts
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
```

The subtlety is the ordering: `minAppVersion` is read out of the manifest *before* the version
field is overwritten, then recorded in `versions.json` against the new version. That map is how
Obsidian's plugin browser decides which release to offer an older client — get it wrong and
users on an unsupported Obsidian are offered a build that will not run.

Pushing a semver tag then triggers `release.yml`, which reinstalls, tests, builds, attests build
provenance for `main.js`/`manifest.json`/`styles.css`, and attaches those three files to a
GitHub release. `CLAUDE.md` directs you to the `obsidian-release-gate` and
`obsidian-release-ship` skills rather than tagging by hand.

## Recap

The whole plugin is one line of pseudocode —
`write(changelogPath, render(sort(filter(allMarkdownFiles))))` — and everything else is
protecting it: guards so it does not trigger itself, normalization so its inputs are always
well-formed, a debouncer so it does not run on every keystroke, and a committed-artifact check
so the version that ships is the version that was reviewed.

## Findings

Two things surfaced while tracing the code linearly that a reader of this document should not
have to rediscover. Both are filed in full under `.issues/`.

**Related existing findings.** A `code-theory` pass over the same code filed six findings before
this one, and three of them are things the narrative above also had to point at: the
`"duplicate"` verdict the settings UI discards (§7), the fact that nothing but an `.md` check
stands between `changelogPath` and an existing note (§5, §7), and the shared `PathSuggest` list
that offers every note in the vault to both fields (§7). They are not re-filed here. See
`THEORY.md` for that pass's index.

| #   | Severity | Issue                                                       | Primary location                            |
| --- | -------- | ----------------------------------------------------------- | ------------------------------------------- |
| 1   | medium   | `write-failure-detail-is-discarded-before-the-user-sees-it` | `src/main.ts:22-24`, `35-37`, `77-80`       |
| 2   | low      | `datetime-preview-closure-reads-a-variable-assigned-after-it` | `src/settings.ts:136`, `151`, `156-158`   |

**Total: 2 issues (0 critical, 0 high, 1 medium, 1 low)**

