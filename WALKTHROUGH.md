# Walkthrough

How Vault Changelog works, start to finish. Read it top to bottom; it follows the call chain
rather than the directory listing.

Every snippet is labelled with its **file and symbol** rather than a line range, so a quote still
points at the right thing after an unrelated edit above it. Snippets are sliced directly out of
the source and carry a `<!-- prettier-ignore -->` marker, because prettier reformats code inside
fenced blocks — it dedents and rejoins wrapped lines — and that is what let the previous edition
of this document drift out of agreement with the source while looking fine.

## Overview

The plugin maintains a note listing the vault's most recently edited files. Enable auto-update
and it rewrites that note whenever you edit, rename or delete something; or run the command
yourself from the palette.

The single most important thing to know before reading the code: **the changelog file is
overwritten in full on every update.** Nothing accumulates, nothing is merged, no history is
kept. `renderChangelog` is a pure function of the vault's current state — run it twice against
an unchanged vault and you get the same string both times. Everything else in the design follows
from that, including the parts that look defensive.

TypeScript, built with Bun's native bundler into a single CommonJS `main.js` that Obsidian loads.
`main.js` is committed to the repository, because that committed file is what ships.

## Architecture

Three source files, and the split between the first and the other two is the one that matters.

| File               | Role                                                                                   | Tested       |
| ------------------ | -------------------------------------------------------------------------------------- | ------------ |
| `src/changelog.ts` | Every decision: filtering, sorting, rendering, the settings rules, the ownership guard | Exhaustively |
| `src/main.ts`      | The Obsidian plugin: lifecycle, events, file I/O, the settings commit path             | Not at all   |
| `src/settings.ts`  | The settings tab and its path autocomplete                                             | Not at all   |

`changelog.ts` imports nothing — not Obsidian, not `moment`. That is what makes it testable
without a running Obsidian, and the rule is held by injecting anything it would otherwise need.
`main.ts` and `settings.ts` are untested **by construction**, which is the deal: keep the
decisions on the pure side and the untested side stays thin enough to read.

Data flows in one direction on each pass:

```
data.json ──> normalizeLoadedSettings ──> plugin.settings
                                              │
vault files ──────────────────────────────────┴──> renderChangelog ──> vault.modify
```

and settings changes flow back the other way through a single method, `updateSettings`.

## Loading

`onload` wires everything and is the only place event handlers are registered.

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
        this.runUpdate();
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
    // `rename` is the one event whose identity check `handler` cannot make:
    // it alone carries `oldPath`, and that is the only value that can say the
    // renamed file *was* the changelog. Without it the guard compares against
    // a stale path, the changelog lists itself, and the next write recreates
    // a ghost at the old name.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (oldPath === this.settings.changelogPath && file instanceof TFile) {
          this.updateSettings({ changelogPath: file.path });
          return; // the changelog moved; nothing to regenerate
        }
        handler(file);
      }),
    );
  }
```

Three things are happening here, and the third is the subtle one.

Settings load first, because the settings tab and every handler read them. The command is
registered next — note the callback wraps `runUpdate()` rather than being `runUpdate` itself,
which keeps `this` bound and keeps the return value discarded deliberately rather than by
accident.

Then the vault listeners. `handler` guards on three things: auto-update is on, the changed thing
is a file rather than a folder, and **it is not the changelog itself**. That last check is what
stops the plugin triggering itself in a loop — writing the changelog is a `modify` event.

`rename` cannot use that handler, and the comment explains why: it is the only event that carries
`oldPath`, and `oldPath` is the only value that can tell you the renamed file _was_ the changelog.
Without the special case, the setting goes stale, the changelog starts listing itself, and the
next write recreates a ghost file at the old name. When the changelog is what moved, the plugin
follows it and returns without regenerating — there is nothing to regenerate, the content is
unchanged.

Settings come off disk through one call:

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

`normalizePath` is passed in rather than imported by `changelog.ts`, which is the first of three
injection points that keep the pure module Obsidian-free.

## The debounce, and why its third argument is spelled out

`src/main.ts` — `ChangelogPlugin.debouncedVaultChange`

<!-- prettier-ignore -->
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

This is a five-line field with a five-line comment, and the comment is doing real work.
Obsidian's `debounce` takes `resetTimer` as its third parameter and **defaults it to `false`**,
which makes the function a throttle rather than a debounce: it fires 200 ms after the _first_
event of a burst and then again for the next burst. With Obsidian autosaving during sustained
typing, that regenerated the whole changelog several times a second. Passing `true` gives the
trailing edge the name implies — wait until editing goes quiet, then write once.

The timer is also the one thing Obsidian will not clean up for you:

`src/main.ts` — `ChangelogPlugin.onunload`

<!-- prettier-ignore -->
```ts
  onunload(): void {
    // Event listeners registered via registerEvent are cleaned up
    // automatically; the debounce timer is not. Without this, disabling the
    // plugin within 200ms of an edit still fires an update against a
    // torn-down instance -- and on a plugin *update* the new instance has
    // already loaded, so two of them write the same file.
    this.debouncedVaultChange.cancel();
  }
```

`registerEvent` unsubscribes the listeners, but it does not touch a timer a listener already
started. Without the `cancel()`, disabling the plugin inside the 200 ms window still fires an
update against an instance Obsidian considers gone — and during a plugin _update_ the
replacement instance has already loaded, so two of them write the same file.

## One update, end to end

Both triggers go through one reporter, so a failure is reported in exactly one place:

`src/main.ts` — `ChangelogPlugin.runUpdate`

<!-- prettier-ignore -->
```ts
  /**
   * The one place an update failure is reported. Both call sites -- the
   * command and the debounced vault handler -- were discarding the rejection
   * value, so the message naming the failing path was built and never read.
   */
  private runUpdate(): void {
    this.updateChangelog().catch((err: unknown) => {
      console.error("Vault Changelog: update failed", err);
      new Notice(
        `Failed to update changelog: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
```

Both call sites used to discard the rejection, which meant the carefully-built message naming the
failing path was constructed and never read.

`updateChangelog` does the whole write. First, render:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

<!-- prettier-ignore -->
```ts
  async updateChangelog(): Promise<void> {
    const { changelogPath } = this.settings;
    const content = renderChangelog(
      this.app.vault.getMarkdownFiles(),
      this.settings,
      (mtime, fmt) => window.moment(mtime).format(fmt),
      (file) =>
        this.app.metadataCache.fileToLinktext(file as TFile, changelogPath),
    );
```

Those last two arguments are the other two injection points. The formatter wraps Obsidian's
globally-installed moment, so nothing is bundled; tests pass the npm `moment` package instead,
which is why `moment` is a devDependency and never ships. The link resolver wraps
`metadataCache.fileToLinktext`, which uses the bare filename when it is unique in the vault and
the full path when it is not — a rule that needs the whole vault's link graph, which is exactly
the knowledge the pure core must not have.

Second, find or create the file:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

<!-- prettier-ignore -->
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

The `catch` is a TOCTOU race, not defensive padding. Between `getAbstractFileByPath` returning
nothing and `create` running, a concurrent vault event can create the file; `create` then throws
on a file that now exists. Looking it up again is the recovery, and the original error rides
along as `cause` for the case where the file genuinely could not be created.

Third — and this is the part that stops the plugin destroying your notes:

`src/main.ts` — `ChangelogPlugin.updateChangelog`

<!-- prettier-ignore -->
```ts
    if (file instanceof TFile) {
      // The plugin owns the file at changelogPath and replaces it wholesale,
      // so confirm this is a file the plugin wrote before destroying it. The
      // path can be typed to any note in the vault.
      const existing = await this.app.vault.read(file);
      if (
        !isPluginGeneratedChangelog(existing, this.settings.changelogHeading)
      ) {
        throw new Error(
          `Refusing to overwrite ${changelogPath}: it does not look like a changelog this plugin generated. Point "Changelog path" at a new or empty note, or clear that file first.`,
        );
      }
      await this.app.vault.modify(file, content);
    } else {
      new Notice(`Could not update changelog at path: ${changelogPath}`);
    }
```

`changelogPath` is free text. It can name any note in the vault, and this function replaces that
note's contents wholesale. Checking the extension is useless, because every note is `.md`. So the
plugin asks whether the file _looks like one it wrote_, and refuses otherwise. The error names
the path and says what to do about it.

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

Three filters in one pass: the changelog never lists itself, excluded folders are prefix matches,
and the rest sort newest-first and truncate. The `folder.endsWith("/") ? folder : folder + "/"`
is not cosmetic — without the appended separator, excluding `Arch` would also exclude `Archive/`,
because `"Archive/x.md".startsWith("Arch")` is true.

### Rendering

`src/changelog.ts` — `renderChangelog`

<!-- prettier-ignore -->
```ts
export function renderChangelog(
  files: ChangelogFile[],
  settings: ChangelogSettings,
  formatTime: TimeFormatter,
  resolveLinkText: LinkTextResolver,
): string {
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

One render entry point, taking the whole settings object rather than six of its fields spelled
out positionally — so adding a setting that affects output does not mean widening a signature and
a call site that carry no information of their own. It calls `filterAndSort` itself, so there is
no way to render unfiltered files by forgetting a step.

Note the link text is resolved in **both** modes. A bare basename is ambiguous in plain text for
exactly the same reason it is ambiguous as a wiki-link, and two notes sharing a filename used to
produce two identical rows.

### The ownership guard

`src/changelog.ts` — `isPluginGeneratedChangelog`

<!-- prettier-ignore -->
```ts
/**
 * Does this file look like one this plugin wrote? The plugin replaces the
 * file at changelogPath wholesale, and every note in the vault satisfies the
 * only other check there is (`.md`), so the shell asks this before
 * overwriting and refuses a file that is someone else's note.
 *
 * Deliberately tolerant of a heading it does not recognise: the heading slot
 * accepts whatever is currently there, so changing the changelogHeading
 * setting cannot make the user's own changelog foreign to the plugin that
 * wrote it. What it will not tolerate is prose where entries should be.
 */
export function isPluginGeneratedChangelog(
  content: string,
  changelogHeading: string,
): boolean {
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
}
```

This is the predicate that makes the free-text path setting safe. It works by grammar: after an
optional leading heading, every non-empty line must look like an entry. Prose fails. A checklist
fails. Your actual notes fail — which is the point.

Both tolerances encode a specific failure that was hit before:

- **Empty passes**, because `updateChangelog`'s create path lays down `""` and the very next step
  is this check. The guard must not reject the file the plugin just created.
- **The heading slot accepts whatever heading is there**, not the configured one. Otherwise
  changing the `changelogHeading` setting would make your own changelog foreign to the plugin
  that wrote it, and lock the plugin out of its own file.

Worth noticing what is _not_ tolerated in the same way: the entry pattern itself. It has to keep
matching output written by earlier versions, and nothing says so — filed as a finding below.

## Settings: two boundaries, one rule each

This is the part of the codebase most likely to be misunderstood, so it is worth stating the
organizing idea before any code.

Settings arrive from two places that cannot be trusted: `data.json` at load (hand-editable,
sync-corruptible, written by older versions) and the settings tab at edit time (a human typing).
For most of the plugin's life each boundary validated independently, and they drifted — the tab
refused a `changelogPath` without `.md` while the loader accepted one, so a vault could be
actively writing to a file its own settings tab would not display.

**Now every rule with a choice in it is one exported function, and both boundaries call it.**

`src/changelog.ts` — `coerceChangelogPath`

<!-- prettier-ignore -->
```ts
/**
 * Authoritative rule for changelogPath: the changelog must be a markdown
 * file. Both boundaries call this, which is the whole point -- the settings
 * tab has refused a non-`.md` path since #142, and the loader never has, so
 * a persisted `"Notes"` was a value the plugin ran on and the settings tab
 * would not display.
 *
 * `fallback` is the settings tab's current value and the loader's default,
 * so a typo in the field reverts to what the user had rather than resetting
 * the setting to `Changelog.md`.
 */
export function coerceChangelogPath(
  value: unknown,
  normalize: (path: string) => string,
  fallback: string = DEFAULT_SETTINGS.changelogPath,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = normalize(value);
  return normalized.endsWith(".md") ? normalized : fallback;
}
```

The `fallback` parameter is what lets one function serve two boundaries that genuinely want
different behaviour on bad input. The loader omits it and gets the default, because at load there
is no prior value. The settings tab passes the value the plugin is currently running on, so a
typo reverts to what the user had rather than resetting the setting.

`src/changelog.ts` — `coerceDatetimeFormat`

<!-- prettier-ignore -->
```ts
/**
 * Authoritative rule for datetimeFormat: an empty format is not a format.
 * The failure it prevents is silent rather than loud -- moment's `format("")`
 * falls through to ISO-8601, so an empty persisted format turns every row
 * into a full timestamp instead of raising anything.
 *
 * This is the one rule the settings tab calls *without* passing its current
 * value. Clearing the field and blurring is the only reset-to-default the
 * field offers, and it has always landed on the default; handing it the
 * current value would quietly take that away.
 */
export function coerceDatetimeFormat(
  value: unknown,
  fallback: string = DEFAULT_SETTINGS.datetimeFormat,
): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
```

This one has the exception you need to know about: **the settings tab calls it without a
fallback.** Clearing that field is the only reset-to-default gesture it offers, and it has always
landed on the default. Passing the current value would have removed a feature while looking like
consistency.

`src/changelog.ts` — `coerceExcludedFolders`

<!-- prettier-ignore -->
```ts
/**
 * Authoritative rule for excludedFolders: normalize each entry, then put it
 * through the same verdict the Add button uses. Root markers and duplicates
 * both fall out of that one pass, because the verdict is taken against the
 * accumulating result rather than against the input -- which is what makes
 * `["Archive/", "Archive"]` collapse to one row instead of two identical
 * ones whose remove buttons both delete the first.
 *
 * An array carrying a non-string is corrupt rather than partly usable, so
 * the whole field falls back. That is the all-or-nothing rule the scalar
 * guards apply, and the suite pins it.
 */
export function coerceExcludedFolders(
  value: unknown,
  normalize: (path: string) => string,
  fallback: string[] = DEFAULT_SETTINGS.excludedFolders,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((folder) => typeof folder === "string")
  ) {
    return [...fallback];
  }
  const folders: string[] = [];
  for (const entry of value as string[]) {
    const folder = normalize(entry);
    if (validateExcludedFolder(folder, folders) === "ok") folders.push(folder);
  }
  return folders;
}
```

The accumulator is the trick here. Each entry's verdict is taken against the _result so far_
rather than against the input, so a duplicate that normalization creates —
`["Archive/", "Archive"]` both becoming `"Archive"` — is dropped by the same pass that drops
root markers. There is no separate de-duplication step.

`src/changelog.ts` — `clampMaxRecentFiles`

<!-- prettier-ignore -->
```ts
/**
 * The one authoritative clamping rule for maxRecentFiles: floor to an
 * integer and clamp to [1, MAX_RECENT_FILES]; anything that is not a number
 * falls back. Load-time and the settings UI both call this.
 *
 * `fallback` is what a value that is not a number at all becomes. The loader
 * omits it and gets the default, because at load there is no prior value; the
 * settings tab passes the value the plugin is currently running on, so a typo
 * reverts rather than resetting the setting. Note this is the *non-numeric*
 * path only -- an out-of-range number still clamps, which is why 0 becomes 1
 * and 1000 becomes 500 at both boundaries.
 *
 * Non-numbers are rejected *before* coercion rather than after. `Number()`
 * maps null, "", "   ", [] and false to a perfectly finite 0, which the clamp
 * below would then raise to 1 -- turning a corrupt data.json into a changelog
 * one entry long, which reads as "the plugin broke" rather than as a settings
 * problem. Numeric strings stay accepted because the settings tab hands this
 * function the raw contents of a text field.
 */
export function clampMaxRecentFiles(
  value: unknown,
  fallback: number = DEFAULT_SETTINGS.maxRecentFiles,
): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES));
}
```

Two details that look like over-thinking and are not. `Number()` maps `null`, `""`, `"   "`, `[]`
and `false` to a perfectly finite `0`, which the clamp would then raise to `1` — turning a corrupt
`data.json` into a changelog exactly one entry long, which reads as "the plugin broke" rather
than as a settings problem. Hence the type test _before_ coercion. And numeric strings stay
accepted because the settings tab hands this function the raw contents of a text field.

Note the `fallback` covers the non-numeric path only. An out-of-range _number_ still clamps, at
both boundaries — `0` becomes `1` and `1000` becomes `500`.

Then the loader is just those rules, called once each:

`src/changelog.ts` — `normalizeLoadedSettings`

<!-- prettier-ignore -->
```ts
/**
 * Turn persisted data into valid settings: one rule call per field. Disk is
 * one of the two trust boundaries and the settings tab is the other, and
 * every rule above is called by both -- which is the property this function
 * exists to hold up. It passes no `fallback` anywhere, because at load there
 * is no prior value to revert to; the settings tab passes one.
 *
 * The two fields with no rule to share are the booleans, which a typed toggle
 * cannot get wrong, and the heading, whose whole rule is `.trim()`.
 * `normalize` is injected (Obsidian's normalizePath in production) to keep
 * this module Obsidian-free.
 *
 * Unknown keys cannot survive, and no filter is needed to stop them: the
 * result is *built* rather than patched, so nothing from `loaded` is spread
 * into it and every field arrives by name. That also makes the object immune
 * to a `__proto__` key in the persisted JSON, which is a property of the
 * construction rather than of a guard someone could delete.
 */
export function normalizeLoadedSettings(
  raw: unknown,
  normalize: (path: string) => string,
): ChangelogSettings {
  const loaded = (raw ?? {}) as Partial<
    Record<keyof ChangelogSettings, unknown>
  >;

  const str = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  return {
    autoUpdate: bool(loaded.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
    changelogPath: coerceChangelogPath(loaded.changelogPath, normalize),
    datetimeFormat: coerceDatetimeFormat(loaded.datetimeFormat),
    maxRecentFiles: clampMaxRecentFiles(loaded.maxRecentFiles),
    excludedFolders: coerceExcludedFolders(loaded.excludedFolders, normalize),
    useWikiLinks: bool(loaded.useWikiLinks, DEFAULT_SETTINGS.useWikiLinks),
    changelogHeading: str(
      loaded.changelogHeading,
      DEFAULT_SETTINGS.changelogHeading,
    ).trim(),
  };
}
```

Two guarantees here come from the _construction_ rather than from any guard, which is worth
holding on to if you ever rewrite this function. It is an object literal reading each field by
name, and nothing from the persisted data is ever spread into it. So unknown keys from removed
settings cannot survive a load, and a `__proto__` key in the JSON cannot reach
`Object.prototype`. Both used to be enforced by an explicit known-key filter; that filter was
deleted precisely because building the result is a stronger way to get the same properties.

### The folder verdict

`src/changelog.ts` — `validateExcludedFolder`

<!-- prettier-ignore -->
```ts
export type ExcludedFolderVerdict = "ok" | "invalid" | "duplicate";

/**
 * Every shape a normalizer can hand back for "no folder at all". The guard
 * below is reached only with already-normalized input, and Obsidian's
 * normalizePath maps an empty or separator-only string onto one of these
 * rather than onto "" -- which of them is version-dependent, so the set
 * covers all four instead of betting on one. A root marker that survives
 * into excludedFolders is not corrupting, just permanently inert:
 * filterAndSort would test `path.startsWith("./")`, and no vault path
 * begins that way, so the row excludes nothing and never stops doing so.
 */
const ROOT_MARKERS = new Set(["", ".", "./", "/"]);

/**
 * Validate a normalized folder path before adding it to excludedFolders:
 * the vault root in any of its spellings is invalid; an already-listed
 * folder is a duplicate.
 */
export function validateExcludedFolder(
  normalizedFolder: string,
  existing: string[],
): ExcludedFolderVerdict {
  if (ROOT_MARKERS.has(normalizedFolder.trim())) return "invalid";
  if (existing.includes(normalizedFolder)) return "duplicate";
  return "ok";
}
```

The four-element `ROOT_MARKERS` set is a hedge, and deliberately so. `obsidian` ships **type
declarations only** — there is no JavaScript in the package — so `normalizePath` cannot be
executed from this repository and which marker it returns for empty input could not be
determined. Covering all four spellings is correct under every reading.

## The commit path

Every settings change in the plugin goes through one method.

`src/main.ts` — `ChangelogPlugin.updateSettings`

<!-- prettier-ignore -->
```ts
  /**
   * The one place a setting changes. Callers hand over a patch instead of
   * mutating `this.settings`, and that is what makes the rollback possible:
   * the previous object is still intact when the write fails, so memory can
   * be put back into agreement with disk. Assigning first and persisting
   * afterwards -- the shape this replaces -- left nowhere to keep the old
   * value, so a failed write showed a notice and then went on running on a
   * setting that was never saved, until the next restart silently reverted
   * it.
   *
   * It trusts the values it is given. Coercion belongs at the two boundaries
   * that have a fallback to offer -- `normalizeLoadedSettings` for disk, the
   * settings handlers for the user -- and re-validating here would run every
   * rule twice per edit with no way to say which result was stored. Do not
   * add a defensive re-validation.
   *
   * Deliberately free of side effects. Re-registering vault listeners when
   * `autoUpdate` flips is exactly the leak behind #97 and #124; the handlers
   * are registered once in `onload` and read `this.settings.autoUpdate`
   * inside the guard, and a commit path is an inviting place to break that.
   */
  updateSettings(patch: Partial<ChangelogSettings>): void {
    const previous = this.settings;
    this.settings = { ...previous, ...patch };
    this.saveData(this.settings).catch((err: unknown) => {
      this.settings = previous;
      console.error("Vault Changelog: failed to save settings", err);
      new Notice(
        `Failed to save changelog settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
```

Three things about this are load-bearing:

**The rollback.** The previous object is kept, so a failed write can restore it. The shape this
replaced — assign, then persist — had nowhere to keep the old value, so a failed save showed a
notice and then left the plugin running on a setting that was never written, until a restart
silently reverted it.

**No re-validation.** The handler coerces, compares, notices, and hands over the coerced value;
this method stores it. Adding a defensive re-validation here would run every rule twice per edit
with two call sites that can disagree about which result was stored. The comment says so because
the next reader's instinct is to add one.

**No side effects.** Re-registering vault listeners when `autoUpdate` flips is the bug behind two
closed issues. The handlers are registered once in `onload` and read `this.settings.autoUpdate`
inside the guard, and a commit path is an inviting place to break that.

## The settings tab

`src/settings.ts` — `PathSuggest.getPaths`

<!-- prettier-ignore -->
```ts
  private getPaths(): string[] {
    if (this.cachedPaths) return this.cachedPaths;

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
  }
```

Folders only, for both fields that use this suggester, and the reason is asymmetric. For the
excluded-folder field a file is simply never a valid answer. For the changelog path it is worse
than invalid: completing to an existing note is one click away from overwriting it, which was the
fastest known route to losing a note before the ownership guard existed.

`display()` builds every control. Its opening is the one piece of this file that needs explaining
before the controls make sense:

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
  display(): void {
    const { containerEl } = this;

    // No `const { settings } = this.plugin` here. updateSettings replaces the
    // settings object rather than mutating it, so a binding captured once at
    // display time would be a snapshot that goes stale on the first edit and
    // feeds pre-change values back into the next one. Handlers read
    // `this.plugin.settings` at event time instead.
    containerEl.empty();
    const { settings } = this.plugin; // initial values for the controls only
```

`updateSettings` _replaces_ the settings object rather than mutating it, so a binding captured
once at display time is a snapshot that goes stale on the first edit. Handlers read
`this.plugin.settings` at event time. The surviving destructure is for the controls' initial
values only, which are read during `display()` and are correct.

The changelog-path field shows the general shape of a handler:

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
        text.inputEl.addEventListener("blur", () => {
          const normalized = normalizePath(text.getValue());
          // The rule runs once. Comparing its result against the *normalized*
          // input rather than the raw input matters: a trailing slash or a
          // backslash normalizes away harmlessly, and comparing against the
          // raw text would report those as rejected paths.
          const coerced = coerceChangelogPath(
            normalized,
            normalizePath,
            this.plugin.settings.changelogPath,
          );
          if (coerced !== normalized) {
            new Notice("Changelog path must end with .md");
          }
          text.setValue(coerced);
          this.plugin.updateSettings({ changelogPath: coerced });
        });
```

Rule called once, result compared against the input to decide whether to notice, coerced value
written back into the field and handed to the commit path. Note it validates on `blur`, not per
keystroke — a half-typed path is not a wrong path.

The datetime field is the one that needed splitting:

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
    const datetimeSetting = new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js format string")
      .addText((text) => {
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          // Preview only -- no setValue, no save. onChange fires per keystroke,
          // and an empty field is a transient state on the way to a new format,
          // since select-all-then-retype is how a value gets replaced. Writing
          // the default back into the input here moved the caret mid-edit and
          // persisted that default over the user's format before they had typed
          // the first character of its replacement. #175 was this same bug in
          // the field below, fixed the same way.
          .onChange((format) => {
            setDatetimePreview(coerceDatetimeFormat(format));
          });

        // Commit on blur, matching both sibling text fields. Blur is the point
        // the user has finished, so substituting the default for a field left
        // empty is a decision rather than an interruption.
        text.inputEl.addEventListener("blur", () => {
          // No current-value fallback, deliberately, and unlike every other
          // field here. Clearing this field is the only reset-to-default it
          // offers, and it has always landed on the default; passing the
          // current value would quietly take that away.
          const nextFormat = coerceDatetimeFormat(text.getValue());
          text.setValue(nextFormat);
          setDatetimePreview(nextFormat);
          this.plugin.updateSettings({ datetimeFormat: nextFormat });
        });
      });
```

`onChange` fires per keystroke, and it now does nothing but update the preview. It used to also
substitute the default for an empty field and save — so selecting all and deleting before
retyping, the ordinary way to replace a value, stuffed the default back into the input, moved the
caret, and persisted it over the user's format before they had typed the first character of the
replacement. The preview is the only reason `onChange` is used at all, so the fix was to split
the two jobs rather than to move the whole field to `blur`.

`datetimePreview` is declared `| null` and read through a guard because the assignment genuinely
cannot precede the closure that reads it — `descEl` does not exist until the `Setting` has been
constructed. This is the one place the narrative has to run backwards, and the `| null` is what
makes the ordering assumption something the compiler can check.

The max-recent-files field is where one rule replaced two:

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
      .addText((text) => {
        text.setValue(settings.maxRecentFiles.toString());

        text.inputEl.addEventListener("blur", () => {
          const entered = text.getValue().trim();
          // One rule, one branch. The hand-rolled `isNaN || < 1` pre-check
          // that used to sit here enforced only the low end, so 1000 and 25.9
          // were rewritten silently while 0 and "abc" got a notice naming a
          // range the handler did not actually apply.
          const clamped = clampMaxRecentFiles(
            entered,
            this.plugin.settings.maxRecentFiles,
          );
          // Compare numerically, not by string round-trip: "025", "25.0" and
          // "1e2" are all valid input that re-serializes differently.
          if (clamped !== Number(entered)) {
            new Notice(
              `Max recent files must be a whole number between 1 and ${MAX_RECENT_FILES}`,
            );
          }
          text.setValue(clamped.toString());
          this.plugin.updateSettings({ maxRecentFiles: clamped });
        });
      });
```

The comparison is numeric rather than a string round-trip, and that is deliberate:
`clamped.toString() !== entered` would fire a spurious "must be a whole number" on `025`, `25.0`
and `1e2`, all of which are valid input that happens to re-serialize differently.

Adding an excluded folder is the one exhaustive switch in the codebase:

`src/settings.ts` — `ChangelogSettingsTab.display`

<!-- prettier-ignore -->
```ts
      .addButton((button) => {
        button.setButtonText("Add").onClick(() => {
          const existing = this.plugin.settings.excludedFolders;
          const folder = normalizePath(folderInputEl.value);
          const verdict = validateExcludedFolder(folder, existing);
          // Exhaustive, so a fourth verdict cannot be added without the
          // compiler naming this call site. Falling off the end is exactly how
          // "duplicate" went unhandled: no notice, input not cleared, list not
          // re-rendered -- indistinguishable from a dead button.
          switch (verdict) {
            case "invalid":
              new Notice(
                "Excluded folder path cannot be empty or the vault root",
              );
              return;
            case "duplicate":
              new Notice(`"${folder}" is already excluded`);
              folderInputEl.value = "";
              return;
            case "ok":
              // Replaced, not pushed: a push into the shared array would
              // survive updateSettings restoring the previous object, so the
              // rollback would leave the folder in memory but not on disk.
              this.plugin.updateSettings({
                excludedFolders: [...existing, folder],
              });
              folderInputEl.value = "";
              this.renderExcludedFolders(excludedFoldersList);
              return;
            default: {
              const unhandled: never = verdict;
              throw new Error(
                `Unhandled excluded-folder verdict: ${String(unhandled)}`,
              );
            }
          }
        });
```

The `never` default is the point. `"duplicate"` used to fall off the end of an if-chain — no
notice, input not cleared, list not re-rendered, indistinguishable from a dead button — and an
exhaustive switch is what stops a fourth verdict doing the same thing silently.

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

The release seam is a triple that moves together — `package.json` version, `manifest.json`
version, and a `versions.json` entry mapping the new version to the current `minAppVersion`.

`version-bump.ts` — `version-bump`

<!-- prettier-ignore -->
```ts
const manifest = await Bun.file("manifest.json").json();
const { minAppVersion } = manifest;
manifest.version = targetVersion;
await Bun.write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
```

The subtle part is that `minAppVersion` is read _before_ the version field is overwritten.
`release.yml` triggers on a bare `X.Y.Z` tag and creates the GitHub release itself, with build
provenance attestation — so pushing the tag is the publish step.

CI runs `bun run build` and then `git diff --exit-code main.js`. Since the committed bundle is
what ships, any change to `src/` or to a dependency that is not followed by a rebuild fails the
PR. Bun is deliberately unpinned, so a bundler-output shift trips the same check; the fix is the
same either way.

## Findings

Filed while tracing the code for this walkthrough.

| Finding                                                                                                                                                                                                         | Severity | Where                                                                         | Status                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The ownership guard's entry-line grammar is coupled to the renderer's output format, and the round-trip test pins agreement only within a single build — not the cross-version recognition the guard exists for | medium   | `src/changelog.ts` — `ENTRY_LINE`, `renderChangelog`                          | [#237](https://github.com/philoserf/obsidian-vault-changelog/issues/237) |
| `changelogHeading` is the one setting whose rule is still implemented at both boundaries rather than shared                                                                                                     | medium   | `src/changelog.ts` — `normalizeLoadedSettings`, `src/settings.ts` — `display` | [#236](https://github.com/philoserf/obsidian-vault-changelog/issues/236) |
| Snippets in the previous edition of this document had drifted out of agreement with the source, because prettier reformats code inside fenced blocks                                                            | low      | `WALKTHROUGH.md`                                                              | fixed in this edition                                                    |
| The changelog-path handler normalizes twice and compares against the middle result                                                                                                                              | low      | `src/settings.ts` — `display`                                                 | [#238](https://github.com/philoserf/obsidian-vault-changelog/issues/238) |
