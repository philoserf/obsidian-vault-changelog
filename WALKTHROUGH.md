# Walkthrough

How Vault Changelog works, start to finish. Read it top to bottom; it follows the call chain
rather than the directory listing.

Every snippet is labelled with its **file and symbol** rather than a line range, so a quote
still points at the right thing after an unrelated edit above it. Where a snippet elides a
middle, the gap is marked `...`.

## Overview

The plugin maintains a note listing the vault's most recently edited files. Enable auto-update
and it rewrites that note whenever you edit, rename or delete something; or run the command
yourself from the palette.

The single most important thing to know before reading the code: **the changelog file is
overwritten in full on every update.** Nothing accumulates, nothing is merged, no history is
kept. `renderChangelog` is a pure function of the vault's current state — run it twice against
an unchanged vault and you get the same string both times.

Technologies: TypeScript, bundled by Bun's native bundler into a committed `main.js` that
Obsidian loads directly. Tests run under `bun test`. Formatting and linting are Biome's.

Entry point: `src/main.ts` exports `ChangelogPlugin` as its default export, which Obsidian
instantiates and calls `onload()` on.

## Architecture

Three source files, and the split between them is the design:

| File               | Role                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `src/changelog.ts` | Pure core. Imports nothing from `obsidian`. All 47 tests target this file. |
| `src/main.ts`      | The `Plugin` subclass: lifecycle, command, vault events, file I/O.         |
| `src/settings.ts`  | `ChangelogSettingsTab` and `PathSuggest` — the settings UI.                |

The pure core holds every decision; the shell holds only wiring and I/O. The boundary is
maintained by **injection**: wherever the core needs something only Obsidian can answer, it
takes a function instead of importing one. There are three such injection points, and they are
worth spotting early because they are the reason the core is testable at all.

Data flows one way on each update: a trigger (command or vault event) calls `updateChangelog`,
which asks the vault for its markdown files, hands them plus the settings to `renderChangelog`,
and writes the result back to one file.

## Loading

Obsidian calls `onload`. It reads settings, registers the settings tab, registers one command,
and subscribes to three vault events.

`src/main.ts` — `ChangelogPlugin.onload`

```ts
async onload(): Promise<void> {
  await this.loadSettings();
  this.addSettingTab(new ChangelogSettingsTab(this.app, this));

  this.addCommand({
    id: "update-changelog",
    name: "Update Changelog",
    callback: () => {
      this.runUpdate();
    },
  });
  ...
}
```

Note the command's `name` is `"Update Changelog"`, and Obsidian prefixes the plugin's manifest
name to it — so the palette entry reads **Vault Changelog: Update Changelog**. The `id` is what
user hotkeys bind against.

Settings come off disk through the pure normalizer rather than being trusted as-is:

`src/main.ts` — `ChangelogPlugin.loadSettings`

```ts
async loadSettings(): Promise<void> {
  this.settings = normalizeLoadedSettings(
    await this.loadData(),
    normalizePath,
  );
}
```

That second argument is the first injection point. `normalizeLoadedSettings` needs to normalize
paths but must not import Obsidian, so the normalizer arrives as a parameter. Tests pass
`identity` and can still assert that normalization was applied to the right fields.

## The event handlers

Two of the three vault events share one handler. The third cannot.

`src/main.ts` — `ChangelogPlugin.onload`

```ts
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

Three guards, and the third is the loop breaker: writing the changelog fires a `modify` event
for the changelog, so without `file.path !== changelogPath` the plugin would rewrite the file in
response to having rewritten the file. The guards sit _before_ the debouncer rather than inside
its callback, so ignorable events never even set the pending timer.

`rename` gets its own subscription, because it is the only event that carries the information
the shared handler needs:

`src/main.ts` — `ChangelogPlugin.onload`

```ts
this.registerEvent(
  this.app.vault.on("rename", (file, oldPath) => {
    if (oldPath === this.settings.changelogPath && file instanceof TFile) {
      this.settings.changelogPath = file.path;
      this.saveSettingsSafely();
      return; // the changelog moved; nothing to regenerate
    }
    handler(file);
  }),
);
```

`oldPath` is the only value that can say the renamed file _was_ the changelog — `file.path` is
already the new name, so the shared guard would compare it against a stale setting, decide it
was some other note, and regenerate. The result used to be that the changelog listed itself and
a ghost copy reappeared at the old path. Keeping the setting truthful is the whole fix.

Deletion needs no equivalent: a deleted changelog arrives with `file.path` still equal to
`changelogPath`, so the existing guard already rejects it.

## Debouncing

`src/main.ts` — `ChangelogPlugin.debouncedVaultChange`

```ts
// Third argument is resetTimer, and it defaults to false -- which makes
// `debounce` fire 200ms after the *first* event of a burst, i.e. a throttle.
// Sustained editing with Obsidian autosaving would then regenerate the whole
// changelog several times a second. `true` is the trailing edge the name
// implies: wait until editing goes quiet, then write once.
private debouncedVaultChange = debounce(
  () => {
    this.runUpdate();
  },
  200,
  true,
);
```

The third argument is the point. Obsidian's `debounce(cb, timeout?, resetTimer?)` defaults
`resetTimer` to `false`, which is a leading-window throttle, not a debounce. Passing `true`
explicitly means the call site states which semantics it wants rather than inheriting them.

The timer has to be cancelled by hand at teardown:

`src/main.ts` — `ChangelogPlugin.onunload`

```ts
onunload(): void {
  // Event listeners registered via registerEvent are cleaned up
  // automatically; the debounce timer is not. ...
  this.debouncedVaultChange.cancel();
}
```

`registerEvent` unsubscribes the listeners, but it does not touch a timer a listener already
started. Without the `cancel()`, disabling the plugin inside the 200 ms window still fires an
update against an instance Obsidian considers gone — and during a plugin _update_ the
replacement instance has already loaded, so two of them would write the same file.

## One update, end to end

Both triggers go through one reporter, so a failure is reported in exactly one place:

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

Then the work itself. This is the longest function in the codebase and the only one doing I/O,
so it is worth reading in two halves. First, render:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
const { changelogPath } = this.settings;
const content = renderChangelog(
  this.app.vault.getMarkdownFiles(),
  this.settings,
  (mtime, fmt) => window.moment(mtime).format(fmt),
  (file) => this.app.metadataCache.fileToLinktext(file as TFile, changelogPath),
);
```

Those last two arguments are the other two injection points. The formatter wraps Obsidian's
globally-installed moment, so nothing is bundled; tests pass the npm `moment` package instead,
which is why `moment` is a devDependency and never ships. The link resolver wraps
`metadataCache.fileToLinktext`, documented as "if file name is unique, use the filename; if not
unique, use full path" — a rule that needs the whole vault's link graph, which is exactly the
knowledge the pure core must not have.

Second, write:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
let file = this.app.vault.getAbstractFileByPath(changelogPath);
if (!file) {
  try {
    file = await this.app.vault.create(changelogPath, "");
  } catch (createErr) {
    // File may have been created by a concurrent event (TOCTOU race)
    file = this.app.vault.getAbstractFileByPath(changelogPath);
    if (!file)
      throw new Error(`Failed to create changelog at: ${changelogPath}`, {
        cause: createErr,
      });
  }
}
```

The `catch` is deliberately tolerant rather than careful: if `create` throws, it assumes a
concurrent event won the race and re-fetches by path. That is only safe because whoever won was
going to write the same content — a consequence of the file being derived rather than owned
data. The original error is attached as `cause` so it survives to the console.

Then the guard, which is the newest and most consequential part of this function:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

```ts
if (file instanceof TFile) {
  // The plugin owns the file at changelogPath and replaces it wholesale,
  // so confirm this is a file the plugin wrote before destroying it. The
  // path can be typed to any note in the vault.
  const existing = await this.app.vault.read(file);
  if (!isPluginGeneratedChangelog(existing, this.settings.changelogHeading)) {
    throw new Error(
      `Refusing to overwrite ${changelogPath}: it does not look like a changelog this plugin generated. Point "Changelog path" at a new or empty note, or clear that file first.`,
    );
  }
  await this.app.vault.modify(file, content);
} else {
  new Notice(`Could not update changelog at path: ${changelogPath}`);
}
```

Note the shape of the split: the _decision_ is a pure predicate in `changelog.ts`; only the
`vault.read` that feeds it lives here. Had the predicate been written inline where the content
already was, it would have been untestable by construction.

## The pure core

Now the other side of the boundary, in the order the update path reaches it.

### Filtering and sorting

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

Both halves of that ternary are live. `normalizePath` strips trailing slashes, so a folder saved
through the settings UI arrives as `Archive` — but the setting predates that normalization, so a
long-lived `data.json` can still hold `Archive/`. The slash is re-added at match time rather than
migrating stored data. And the slash matters: without it, excluding `Notes` would also exclude
`Notes2/` and `Notebook/`. There is a test named exactly `does not exclude folders that share a
prefix`, which is the tell that someone was burned by it.

The input type is the narrowest structural subset of Obsidian's `TFile` these functions touch:

`src/changelog.ts` — `ChangelogFile`

```ts
export interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

A real `TFile` satisfies it, so `main.ts` passes `getMarkdownFiles()` straight through with no
adapter; a three-field object literal in a test satisfies it too. The temptation when you need
one more property is to widen this to `TFile` — that single edit would drag `obsidian` into the
pure module and collapse the arrangement. Add the field here instead.

### Rendering

`src/changelog.ts` — `renderChangelog`

```ts
const recent = filterAndSort(
  files,
  settings.changelogPath,
  settings.excludedFolders,
  settings.maxRecentFiles,
);
let content = settings.changelogHeading
  ? `${settings.changelogHeading}\n\n`
  : "";
for (const file of recent) {
  const time = formatTime(file.stat.mtime, settings.datetimeFormat);
  // Resolved for both modes: a bare basename is ambiguous in plain text for
  // exactly the same reason it is ambiguous as a wiki-link.
  const name = resolveLinkText(file);
  content += `- ${time} · ${settings.useWikiLinks ? `[[${name}]]` : name}\n`;
}
return content;
```

This is the module's one render entry point: it takes the whole `ChangelogSettings` rather than
six of its fields spelled out positionally, and calls `filterAndSort` itself. The earlier shape
passed nine positional arguments across two calls, two of them same-typed strings that could be
transposed without the compiler noticing.

`formatTime` stays a separate parameter rather than joining the settings object — it is an
injection point, not a setting. So does `resolveLinkText`.

The heading emits `heading + "\n\n"` when non-empty and nothing at all when empty. That spacing
is only predictable if the heading carries no stray whitespace, which is why it is trimmed both
on load and on change.

### The ownership guard

`src/changelog.ts` — `isPluginGeneratedChangelog`

```ts
const lines = content
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "");

// Empty: updateChangelog's create path lays down "" before the first modify.
if (lines.length === 0) return true;

// A heading and nothing else -- a configured heading over an empty vault.
const heading = changelogHeading.trim();
if (lines.length === 1 && heading !== "" && lines[0] === heading) return true;

// Otherwise: entries, optionally under one leading heading line.
const body = ENTRY_LINE.test(lines[0]) ? lines : lines.slice(1);
return body.length > 0 && body.every((line) => ENTRY_LINE.test(line));
```

The interesting property is its **tolerance**, not its strictness. The heading slot accepts
whatever heading is currently in the file, recognised or not. Had it compared against the
configured `changelogHeading`, changing that setting would make the user's own changelog foreign
and the plugin would refuse to update the very file it wrote. The guard exists to refuse _other
people's notes_.

`ENTRY_LINE` is the shape the renderer emits, and the two must stay in step:

`src/changelog.ts` — `ENTRY_LINE`

```ts
/** An entry line in the shape renderChangelog emits: "- <time> · <name>". */
const ENTRY_LINE = /^- .+ · .+$/;
```

Because the renderer and the guard are two expressions of one format, the suite pins the
round-trip directly — seven cases asserting the guard never refuses `renderChangelog`'s own
output, across heading, link-mode and duplicate-basename combinations. A guard that rejected
what the renderer produced would brick auto-update entirely, and no other test would catch it.

### Settings normalization

`data.json` is treated as hostile input: a user can hand-edit it, a failed write can truncate it,
and a sync conflict can merge it badly.

`src/changelog.ts` — `normalizeLoadedSettings`

```ts
const loaded = (raw ?? {}) as Record<string, unknown>;
const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));
...
for (const key of [
  "changelogPath",
  "changelogHeading",
  "datetimeFormat",
] as const) {
  if (typeof settings[key] !== "string")
    settings[key] = DEFAULT_SETTINGS[key];
}
...
settings.changelogPath = normalize(settings.changelogPath);
settings.excludedFolders = settings.excludedFolders.map(normalize);
settings.maxRecentFiles = clampMaxRecentFiles(settings.maxRecentFiles);
settings.changelogHeading = settings.changelogHeading.trim();
```

It drops keys it does not recognise, so a renamed setting does not leave its predecessor behind;
replaces any known key whose runtime type is wrong; then normalizes, clamps and trims.

**When you add a setting, add it to `DEFAULT_SETTINGS` _and_ to the matching type-guard loop.**
Adding only the first compiles, passes the tests, and ships a setting a corrupt `data.json` can
turn into `undefined` at runtime. This is the likeliest way to damage the plugin while believing
you followed the pattern.

`src/changelog.ts` — `clampMaxRecentFiles`

```ts
export function clampMaxRecentFiles(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.maxRecentFiles;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}
```

Its doc comment calls it "the one authoritative clamping rule", and both the load path and the
settings UI call it. Do not re-implement the rule at a third site.

## The settings tab

`src/settings.ts` — `ChangelogSettingsTab.display` builds the whole tab each time it opens. Every
field follows the same two-step: assign into the live settings object, then persist.

`src/settings.ts` — `ChangelogSettingsTab.display`

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

Note this validates on `blur`, not per keystroke — clearing the field to retype would otherwise
fight the user mid-edit. The "Max recent files" field uses `blur` for the same reason. "Datetime
format" and "Changelog heading" still validate on `onChange`.

### The suggester

`src/settings.ts` — `PathSuggest.getPaths`

```ts
// Folders only. This suggester serves both the changelog-path field and
// the excluded-folder field, and neither wants an existing note: the
// changelog path is overwritten wholesale, so completing to a note is
// the fast way to lose it, and an excluded *folder* is never a file.
const paths: string[] = [];
for (const folder of this.app.vault.getAllFolders()) {
  paths.push(`${folder.path}/`);
}
this.cachedPaths = paths;
return paths;
```

This used to enumerate every markdown file too, which — combined with `selectSuggestion`
dispatching a `blur` that commits the value — made autocompleting onto one of your own notes a
single click. Folders only closes that path.

`cachedPaths` is populated once per suggester instance and never invalidated. Because `display()`
constructs fresh suggesters each time the tab opens, the cache is effectively per-visit; it is
stale only for files created while the tab sits open. That is a deliberate trade against
per-keystroke vault scanning.

### Excluded folders

`src/changelog.ts` — `validateExcludedFolder`

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

"Verdict" here means a three-valued answer, not a boolean — the type exists so the caller can say
something different about each failure. **The caller currently handles only two of the three.**
The Add button branches on `"invalid"` and `"ok"`; `"duplicate"` falls off the end, so adding an
already-listed folder does nothing visible and reads as a dead button. That is drift between the
pure layer and the shell, filed below.

## Build and release

`build.ts` wraps Bun's bundler. `obsidian` and `electron` are external and must never be bundled.

`build.ts` — `build`

```ts
const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: ".",
  format: "cjs",
  external: ["obsidian", "electron"],
  minify: !isWatch,
  sourcemap: isWatch ? "linked" : "none",
});
```

There is no `if (!result.success)` branch, and that is deliberate: `Bun.build` rejects with an
`AggregateError` rather than resolving with `success: false`, so such a branch was unreachable.
The rejection propagates, exits non-zero in CI, and in watch mode is caught by the handler that
keeps the watcher alive.

**`main.js` is committed.** Obsidian ships the committed bundle, so it is a tracked build
artifact rather than build output. CI runs `bun run build` and then `git diff --exit-code
main.js`, failing the PR if the two diverge:

`.github/workflows/main.yml` — `check` job

```yaml
- run: bun run build
- run: git diff --exit-code main.js
- run: bun test
```

Bun is deliberately unpinned there, so a bundler-output change trips the same wire. Either way
the fix is the same: rebuild and commit `main.js`.

The release seam is a triple that moves together — `package.json` version, `manifest.json`
version, and a `versions.json` entry mapping the new version to the current `minAppVersion`.

`version-bump.ts`

```ts
const manifest = await Bun.file("manifest.json").json();
const { minAppVersion } = manifest;
manifest.version = targetVersion;
```

The subtle part is that `minAppVersion` is read _before_ the version field is overwritten.
`release.yml` triggers on a bare `X.Y.Z` tag and creates the GitHub release itself, with build
provenance attestation — so pushing the tag is the publish step.

## The test suite

47 tests, all in `src/changelog.test.ts`, all against `changelog.ts`. `main.ts` and `settings.ts`
have no coverage — `obsidian` is a types-only package with no JavaScript, so nothing in this
repository can execute an Obsidian function. That is not a gap someone forgot to fill; it is the
boundary the pure/shell split exists to create, and it is the argument for keeping the shell thin.

`tsconfig.json` includes the test file, so `tsc --noEmit` typechecks the fixtures. That matters
because `ChangelogFile` is structural: a fixture drifting from the real shape is exactly the error
only the compiler would catch.

## Where the narrative had to jump

Two places, both worth knowing about:

- **`updateChangelog` reads bottom-up.** The rendered content is computed first but written last,
  and between them sits the create-or-fetch dance plus the ownership guard. Explaining it
  linearly means describing the output before the thing that decides whether the output is
  allowed to land.
- **`datetimePreview` in `src/settings.ts` is read before it is assigned.** The `onChange` closure
  references it about twenty lines above the `createDiv` that assigns it. The ordering is forced —
  the preview element must live inside the `Setting`'s `descEl`, which does not exist until the
  `Setting` is constructed — and it is safe only because `onChange` cannot fire until `display()`
  has returned. TypeScript's definite-assignment analysis does not reach into closures, so
  nothing checks that.

## Index

Findings from this pass, and open findings this walkthrough touches:

| #   | Severity | Issue                                                     | Primary location                              | GitHub |
| --- | -------- | --------------------------------------------------------- | --------------------------------------------- | ------ |
| 1   | medium   | `duplicate-excluded-folder-verdict-is-silently-discarded` | `src/settings.ts` — Add-folder button         | #203   |
| 2   | medium   | `excluded-folder-guard-is-written-for-unnormalized-input` | `src/changelog.ts` — `validateExcludedFolder` | #204   |
| 3   | low      | `datetime-preview-is-read-before-assignment`              | `src/settings.ts` — `display`                 | #200   |

**Total: 3 open issues (0 critical, 0 high, 2 medium, 1 low)** — all three already filed and
scheduled in milestone 1.7.0.

This pass filed no new findings. Two stale code comments found while tracing — `ENTRY_LINE`
naming `generateChangelog`, and `isPluginGeneratedChangelog` naming `writeToFile`, both renamed
in 1.6.0 — were small enough to fix in the same commit as this document rather than file.
