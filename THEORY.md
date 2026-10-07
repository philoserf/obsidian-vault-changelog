# Theory of Vault Changelog

This describes the 2.0.0 code on the `v2` branch as of `7ea05bf`, not what `main` ships. `main` still carries 1.8.0, which is 1.5.4's code under a higher number, and `CLAUDE.md` describes that code. The version fields on `v2` still read `1.8.0` on purpose: the Beta workflow stamps a prerelease number into `manifest.json` for one run and commits nothing, so `package.json` and `versions.json` change only in the release prep PR. If you are reading this after 2.0.0 merges, everything below describes `main`.

## What it is for

A vault is a folder of markdown notes, each with a modification time. The plugin keeps one of those notes, the _changelog_, as a derived view: the N most recently modified other notes, newest first, one line each, showing a formatted time and a name. The changelog has no history. It is a pure function of the vault's current state and seven settings, recomputed and written over the whole file on every update. Nothing in the plugin remembers what an earlier changelog said, and nothing needs to.

That one fact explains most of the design. The changelog is a projection, so the only state worth protecting is the settings. The output can be checked byte for byte against a reference, so rendering is the most heavily tested part. And the plugin writes, in full, to a note the user names, so the most serious risk it carries is destroying a note that was not its to write.

The domain vocabulary maps directly: a _row_ is one listed note. The _changelog path_ is the note the plugin owns. An _excluded folder_ is a path prefix whose notes never become rows. The changelog never lists itself. _Auto-update_ means vault events trigger a recompute. The manual command does the same thing on demand.

## The organizing ideas

### Rendering is pure, and its output is frozen against 1.8.0

`src/changelog.ts` imports nothing. Everything Obsidian-specific that rendering needs is passed in: a time formatter, a link-text resolver, and a path normalizer for loading. `ChangelogFile` is a structural type holding the three fields the core reads (`path`, `basename`, `stat.mtime`), so tests pass object literals and production passes `TFile`s. Nothing is mocked. All 58 tests target this module. `main.ts` and `settings.ts` have no tests and cannot have them, because they do not run outside Obsidian.

`renderChangelog` is the single way to turn files into text. It calls `filterAndSort` itself, so no caller can format a list it forgot to filter. In 1.x, filtering and formatting were two calls whose order the caller had to get right (#195).

The invariant that governs rendering is **compatibility with 1.8.0's output**. Wherever no two listed notes share a basename, 2.0.0 must write exactly the bytes 1.8.0 wrote. Two mechanisms hold it in place. `render180` in the test file is 1.8.0's renderer frozen verbatim and compared across a matrix of settings. `src/fixtures/1.8.0.json` holds eight scenarios captured from a real vault: the input files, the settings, the time zone, and the changelog 1.8.0 actually wrote. Their replay asserts byte equality on every line that is not a basename collision, and a _difference_ on every line that is. So the row shape `- <time> · <name>\n`, the middle dot, the blank line after the heading, and an empty string for an empty list are compatibility commitments, not style. Changing any of them is a breaking change and must be decided as one.

Collisions are the one place 2.0.0 deliberately departs from 1.8.0 (#202), and the departure is asymmetric for a principled reason. A wiki-link resolves against the whole vault, so its text comes from Obsidian's `fileToLinktext`. That gives the bare name when the basename is unique in the vault and a path when it is not, even when the other note is excluded or unlisted. Plain text is read only against the list, so a row shows its path only when another _row_ shares its basename. The fixture test encodes the same asymmetry in its definition of "ambiguous". If you change one mode, check whether the other mode's rule still makes sense.

### Every settings rule has two forms built on one predicate

Settings cross two trust boundaries: `data.json` at load, and the settings tab at edit time. For most of 1.x each boundary validated on its own, and the two drifted (#213). In 2.0.0 each rule lives once in `changelog.ts` and comes in two forms. The _load form_ cannot ask anyone anything, so it coerces: it falls back to the default or clamps into range. The _tab form_ returns an error string, so the tab can refuse the edit and keep the value the user already has. `maxRecentFiles` shows the split: the loader clamps `9999` to 500, while the tab refuses `501` outright. Both go through `parseCount`, so whatever the tab accepts, the loader leaves unchanged.

Not every field is symmetric, and the asymmetries are deliberate:

- **Excluded folders** have a tab-only clause: the folder must exist in the vault (#205). The loader cannot check this, and should not. A folder that does not exist yet on this device may arrive later through Sync. So the loader drops roots and duplicates and keeps everything else.
- **Booleans** have no rule beyond their type.
- **`changelogPath`** commits on blur, not per keystroke. The reason is in the code: on the way to typing `Notes.md/Changelog.md`, the field passes through `Notes.md`, which is valid, and with auto-update on that would write a changelog there. It is also deliberately not a file picker, because a file picker offers existing notes (#197).

One field is not deliberate. The `changelogHeading` rule, a trim, is still written inline twice: once in `normalizeLoadedSettings` and once in a special case in `setControlValue`. This is the drift pattern #213 exists to remove, and #213 covers it (#236 was folded into it). The v2 work on #213 left this case behind.

`normalizeLoadedSettings` builds its result field by field and never spreads the persisted data. That one choice drops unknown and renamed keys, keeps a `__proto__` key out, and keeps the result from sharing arrays with `DEFAULT_SETTINGS` (#208, #266). Adding a setting means adding a line there. The compiler enforces this, because the return type is `ChangelogSettings`.

### Persist first, assign second, and one write at a time

`updateSettings` in `main.ts` is the only way a setting changes after load. The ordering is the point: write `data.json`, read it back, compare, and only then assign `this.settings`. Memory therefore never holds a value that disk does not (#206), and a failed write needs no rollback. The read-back exists because `saveData` resolves even when the write fails. Obsidian's `writePluginData` swallows the error. This is not hypothetical. Beta 3 failed on exactly this, with a read-only `data.json` on Obsidian 1.14.4, and the run log in `CONTRIBUTING.md` records it.

Writes are serialized through `saveQueue`, and the patch can be a function of the current settings. It is evaluated _inside_ the queue, against whatever the previous write left. The settings tab commits on every change, so edits routinely overlap. If each patch were computed outside the queue, the later write would silently undo the earlier one. Any new caller that edits a collection should pass a function, not a value.

`updateSettings` reports failures through a Notice and never throws, and its only side effect is scheduling a refresh when auto-update is on (#270). It never re-registers vault listeners. That was the leak behind #97 and #124, and it is the reason a settings save is kept free of side effects.

### Settings that arrive from elsewhere are read, never written back

`onExternalSettingsChange` runs when `data.json` changes underneath the plugin, through Sync, git, or another device. It reloads through the same loader as startup and **never saves**. If a reload saved, one device would write normalized settings, the other would see a change and write its own, and `data.json` would bounce between them. It waits for the save queue first, so a write of our own cannot land on top of the copy it just read.

### The plugin never guesses whose file a note is

The changelog note is the plugin's to overwrite in full, every time. The plugin does not try to tell its own note from a user's. 1.6.0 tried: it guessed from the note's content and was wrong in both directions. That was a central reason 1.6.0 and 1.7.0 were withdrawn (#250). 2.0.0 handles the risk through the interface instead:

- The path field does not offer existing notes.
- When the path changes, `noticeOldChangelog` tells the user the old file is now an ordinary note and leaves it where it is, neither deleting nor rewriting it (#271).
- When the changelog is renamed or moved, the setting follows it. The rename handler is the only place that sees `oldPath`, the one value that can show the moved file _was_ the changelog (#196).

Read the rest of the design with this principle in mind. In particular, see the loader's fallback for `changelogPath` under "The seams".

### Writing is idempotent, and the plugin never reacts to its own write

`updateChangelog` renders the content and then reads the current file with `vault.read`, not `cachedRead`, because a stale cache would skip a write that was needed. It writes only when the bytes differ (#269). Most events cannot change the output: an edit to a note outside the top N, an edit in an excluded folder, a second save inside the timestamp format's resolution. Without this check, each of those would bump the changelog's mtime and, in a synced vault, upload a revision of nothing.

The plugin avoids reacting to its own writes with a single comparison in the shared event handler: `file.path !== this.settings.changelogPath`. The changelog does not list itself either, but that is `filterAndSort`'s first clause and is a separate rule. Writing the changelog fires `modify` (or `create`), and that comparison is all that stops the plugin from triggering itself. The handler also ignores non-markdown files, because only markdown can appear as a row.

`create` is registered only after `onLayoutReady`. Obsidian fires `create` for every file while the vault loads, and without the delay startup would queue one update per file. Notes that arrive already written, through Sync, a template or another app, are why the plugin listens to `create` at all (#291).

The 200 ms debounce is trailing-edge (`resetTimer = true`): one update after events stop. In 1.x it was a throttle that fired repeatedly while the user typed (#193). `onunload` cancels the pending timer. `registerEvent` releases the listeners, but the timer belongs to the plugin, and without the cancel a disabled or replaced plugin could still write (#201).

When the changelog's parent folder is missing, the plugin creates it, because `vault.create` does not (#287). A failed `create` re-checks for the file before giving up, to tolerate a concurrent update that created it first. Every failure in the write path throws with a reason. `runUpdate` is the one place those failures become a Notice and a console error (#217).

## The seams

**Obsidian's vault events** are where the plugin meets the world, and the edge cases cluster here. The shared handler judges a file by its _current_ extension and path. So renaming a note away from `.md` is invisible to it, and so is renaming the changelog to a non-markdown name (#299). The rename branch cancels any pending update before the new path is saved. An update that is already running, though, still targets the old path (#300). A steady stream of events can postpone a trailing-edge debounce indefinitely (#304). That cost was accepted in exchange for not rewriting the changelog while the user types. These issues are filed and open. They are the expected failures of a design that funnels four event types through a single debounce. They do not call the design into question.

**The declarative settings tab** (Obsidian 1.13, the reason `minAppVersion` moved from 1.6.6 to 1.13.0) is the thinnest part of the theory. Persist-before-assign and in-queue patch evaluation make `updateSettings` safe against overlap. The tab, though, decides some things _outside_ the queue. Excluded-folder rows are addressed by the index they had when the tab last drew. The duplicate check runs against the in-memory list at validate time, not against the list the queued write will see. Delete one row, then quickly delete or save another, and the index may point somewhere else by the time the write runs (#295, #296). The fix those issues propose matches the rest of the design: address rows by value, and repeat the check inside the patch function.

The tab and the save path also sit at opposite ends of a cost trade-off. Text controls commit on every keystroke. Each commit writes `data.json` and reads it back. With auto-update on, a pause in typing renders a half-typed heading or format into the changelog (#303). The same thing in the path field was considered serious enough to warrant blur-commit. In the heading and format fields it is currently accepted.

**The loader's fallback for `changelogPath` conflicts with the principle above.** If the persisted path fails its rule, the load form does what every load form does: it falls back to the default, `Changelog.md` at the vault root. For this one field, the default is not a neutral value. It is a guess about which note may be overwritten, and if the user has their own `Changelog.md`, that guess is wrong (#298). This is the most contested seam in the codebase. The single-rule-per-field pattern and the never-guess principle are both load-bearing, and for this field they disagree. Whoever resolves #298 is choosing which one bends.

**Sync and reload.** `onExternalSettingsChange` waits for the queue before it reloads, but the reload itself does not run _in_ the queue. An edit made while the reload is reading can interleave with it (#297). The beta run log records the two-device Sync items as not covered.

**The build and release boundary** is principled and enforced by CI, not by convention. Obsidian ships the committed `main.js`. CI, the beta workflow and the release workflow all rebuild and run `git diff --exit-code main.js`. Bun is unpinned, so a bundler change alone can trip this, and the fix is always to rebuild and commit. `styles.css` is empty and exists only because every release ships it and the release step fails on a missing file.

**Tests stop at `changelog.ts`.** Everything in `main.ts` and `settings.ts` is verified by the beta checklist in `CONTRIBUTING.md`, run by hand in a real vault, and its run log is the only evidence that layer works. The checklist is effectively the test suite for event handling, saving and the tab. A change under `src/` invalidates every previous beta, and the checklist says so.

## What it is shaped to accommodate

**A new output-shaping setting** is the expected extension, and the shape makes it cheap. Add the field to `ChangelogSettings` and `DEFAULT_SETTINGS`. Write its rule in `changelog.ts` in both forms if it has one. Add a line to `normalizeLoadedSettings`, which the compiler will demand. Read it inside `renderChangelog`, whose signature already takes the whole settings object. Add a control to `getSettingDefinitions`. `updateSettings` already schedules a refresh for any change. A newcomer is most likely to do damage by putting the rule in the control's `validate` closure or in `setControlValue`. That compiles and works, and it brings back the two-boundary drift that #213 removed.

**Changing what a row looks like** is not a small change. The 1.8.0 fixtures will fail, correctly. Either it is a breaking change in a major version, or the row stays the same.

**Anything that needs memory of earlier changelogs** (history, diffs, "added" versus "modified", a device name per row: #8 and #58, both declined) contradicts the premise that the changelog is a projection. It would need persistent state outside the note, a merge strategy for Sync, and a different answer to "what does the plugin own". Treat it as a different plugin, not a feature of this one.

**Protecting the target note** has been tried once and withdrawn. Read #250 first. 2.0.0's approach is to avoid offering an existing note and to name the old file when the path changes. Any new guard has to beat that approach without guessing.

**Multiple changelogs** would break the single comparison that stops the plugin reacting to its own writes, the rename-follow logic, and `noticeOldChangelog`. All three assume exactly one owned path.

## Uncertainties

- **Obsidian behaviour the code depends on but cannot test.** Three examples. That `create` fires for every file before layout-ready. That a folder rename fires a `rename` per descendant file, so the changelog's own `oldPath` arrives. That `vault.createFolder` creates intermediate folders. The comments assert the first, and the beta run log is the only evidence for the other two ("Move the changelog to another folder, then move its folder" passed on beta 5). I have not read Obsidian's source.
- **What the number control actually passes to `setControlValue`.** `SettingNumberControl` is typed `number`, and a comment in `settings.ts` says an unparseable entry arrives as `0`. If the framework ever passes the raw string instead, `maxRecentFilesError` would accept `"42"` and memory would hold a string until the next reload. I believe the typing, but nothing at runtime checks it.
- **Whether text controls re-read `getControlValue` after a commit.** `setControlValue` trims the heading before saving. If the framework redraws the field from the trimmed value mid-typing, a space typed between words would disappear. Beta 5 passed "type quickly in the heading", so this probably does not happen. I could not confirm it from the typings.
- **Tie order.** `filterAndSort` sorts on `mtime` alone and relies on a stable sort, so notes with identical millisecond mtimes keep `getMarkdownFiles()` order. Bulk imports and checkouts can produce such ties. I do not know whether that order is stable across restarts. If it is not, the compare-before-write would rewrite the changelog after a restart even though nothing changed. I am inferring the risk, not observing it.
- **Whether `onExternalSettingsChange` fires for the plugin's own `saveData`.** The design assumes it does not. If it did, every save would reload itself. That would be harmless, because the reload never writes, but it would be wasted work.
- **The `folder.endsWith("/")` branch in `filterAndSort`** cannot be reached in production, because `normalizePath` strips trailing slashes before anything is persisted. I read it as tolerance kept so the tests can pass `"Archive/"`, not as a guard against something that once happened.
- **The scope of the maintenance-mode rule.** `CONTRIBUTING.md` says no change goes in unless a user asks for one, except in a planned major release. 2.0.0 is that exception. I am inferring that the open #295–#304 issues are meant to land before 2.0.0 merges, and not after.
