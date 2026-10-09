# Theory of Vault Changelog

This describes the 2.0.0 code. 2.0.0 keeps 1.8.0's output and replaces almost everything around it: how settings are validated and saved, how vault events are read, and when the changelog is written. The version fields change only in the release prep PR. The Beta workflow stamps a prerelease number into `manifest.json` for one run and commits nothing, so a checkout from before that PR still reads `1.8.0`.

## What it is for

A vault is a folder of markdown notes, each with a modification time. The plugin keeps one of those notes, the _changelog_, as a derived view: the N most recently modified other notes, newest first, one line each, showing a formatted time and a name. The changelog has no history. It is a pure function of the vault's current state and seven settings, recomputed and written over the whole file on every update. Nothing in the plugin remembers what an earlier changelog said, and nothing needs to.

That one fact explains most of the design. The changelog is a projection, so the only state worth protecting is the settings. The output can be checked byte for byte against a reference, so rendering is the most heavily tested part. And the plugin writes, in full, to a note the user names, so the most serious risk it carries is destroying a note that was not its to write.

The domain vocabulary maps directly: a _row_ is one listed note. The _changelog path_ is the note the plugin owns. An _excluded folder_ is a path prefix whose notes never become rows. The changelog never lists itself. _Auto-update_ means vault events trigger a recompute. The manual command does the same thing on demand.

## The organizing ideas

### The core decides, the shell acts

`src/changelog.ts` imports nothing. Everything Obsidian-specific it needs is passed in: a time formatter, a link-text resolver, and a path normalizer for loading. `ChangelogFile` is a structural type holding the three fields the core reads (`path`, `basename`, `stat.mtime`), so tests pass object literals and production passes `TFile`s. Nothing is mocked. All 67 tests target this module. `main.ts` and `settings.ts` have no tests and cannot have them, because they do not run outside Obsidian.

So the core holds every _decision_ that can be stated without Obsidian, and the shell only carries it out. That now includes which vault events matter. `vaultEventEffect` takes a path, the old path for a rename, and the changelog path, and answers with one of four effects: `ignore`, `refresh`, `follow` (the changelog moved, and the setting goes with it) or `cannotFollow` (it moved somewhere it cannot be a changelog). The handler in `onload` only acts on the answer (#313). The excluded-folder row edit is the same: `withExcludedFolder` is the list arithmetic, and the tab only says which row changed. When you add behaviour, the first question is whether it can be stated in `changelog.ts`. A rule that lives in an event handler or a tab closure is a rule no test will reach.

### Rendering is pure, and its output is frozen against 1.8.0

`renderChangelog` is the single way to turn files into text. It calls `filterAndSort` itself, so no caller can format a list it forgot to filter. In 1.x, filtering and formatting were two calls whose order the caller had to get right (#195). It also owns the heading's one rule: surrounding whitespace is dropped where the heading is rendered, so a blank heading is no heading. The loader and the tab store what was typed (#310).

The invariant that governs rendering is **compatibility with 1.8.0's output**. Wherever no two listed notes share a basename, 2.0.0 must write exactly the bytes 1.8.0 wrote. Two mechanisms hold it in place. `render180` in the test file is 1.8.0's renderer frozen verbatim and compared across a matrix of settings. `src/fixtures/1.8.0.json` holds eight scenarios captured from a real vault: the input files, the settings, the time zone, and the changelog 1.8.0 actually wrote. Their replay asserts byte equality on every line that is not a basename collision, and a _difference_ on every line that is. So the row shape `- <time> · <name>\n`, the middle dot, the blank line after the heading, and an empty string for an empty list are compatibility commitments, not style. Changing any of them is a breaking change and must be decided as one.

Collisions are the one place 2.0.0 deliberately departs from 1.8.0 (#202), and the departure is asymmetric for a principled reason. A wiki-link resolves against the whole vault, so its text comes from Obsidian's `fileToLinktext`. That gives the bare name when the basename is unique in the vault and a path when it is not, even when the other note is excluded or unlisted. Plain text is read only against the list, so a row shows its path only when another _row_ shares its basename. The fixture test encodes the same asymmetry in its definition of "ambiguous". If you change one mode, check whether the other mode's rule still makes sense.

Excluded folders match only as a whole path segment: `filterAndSort` tests `startsWith(folder + "/")`, so excluding `Notes` does not exclude `Notes2/`. Folders reach it in their one persisted form, normalized and without a trailing slash, so there is one spelling to match (#307).

### Every settings rule has two forms built on one predicate

Settings cross two trust boundaries: `data.json` at load, and the settings tab at edit time. For most of 1.x each boundary validated on its own, and the two drifted (#213). In 2.0.0 each rule lives once in `changelog.ts` and comes in two forms. The _load form_ cannot ask anyone anything, so it coerces: it falls back to the default or clamps into range. The _tab form_ returns an error string, so the tab can refuse the edit and keep the value the user already has. `maxRecentFiles` shows the split: the loader clamps `9999` to 500, while the tab refuses `501` outright. Both go through `parseCount`, so whatever the tab accepts, the loader leaves unchanged.

Not every field is symmetric, and the asymmetries are deliberate:

- **Excluded folders** share one rule, `excludedFolderError`: not the vault root in any spelling, and not a folder already listed. The tab adds a clause of its own, that the folder exists in the vault (#205). The loader cannot check this, and should not. A folder that does not exist yet on this device may arrive later through Sync. So the loader drops roots and duplicates and keeps everything else.
- **Booleans** have no rule beyond their type. **The heading** has none at either boundary; its trim is a rendering rule.
- **`changelogPath`** is the one field whose load form does not coerce. A saved path that fails its rule is kept, and `updateChangelog` refuses to write it, with the reason (#298). Only a missing, blank or non-string path loads the default, as on a fresh install. The next section says why.

`normalizeLoadedSettings` builds its result field by field and never spreads the persisted data. That one choice drops unknown and renamed keys, keeps a `__proto__` key out, and keeps the result from sharing arrays with `DEFAULT_SETTINGS` (#208, #266). Adding a setting means adding a line there. The compiler enforces this, because the return type is `ChangelogSettings`.

### The plugin never guesses whose file a note is

The changelog note is the plugin's to overwrite in full, every time. The plugin does not try to tell its own note from a user's. 1.6.0 tried: it guessed from the note's content and was wrong in both directions. That was a central reason 1.6.0 and 1.7.0 were withdrawn (#250). 2.0.0 handles the risk through the interface instead:

- The path field does not offer existing notes (#197).
- When the path changes, `noticeOldChangelog` tells the user the old file is now an ordinary note and leaves it where it is, neither deleting nor rewriting it (#271).
- When the changelog is renamed or moved, the setting follows it. The rename handler is the only place that sees `oldPath`, the one value that can show the moved file _was_ the changelog (#196). When the new name is not a markdown note, the setting cannot follow. The renamed file is left alone, a Notice says so and names the path the plugin keeps writing to, and the next update writes a fresh changelog there (#299). A file appearing unexplained would be worse than the Notice.

This principle is what bent the two-forms pattern for `changelogPath`. The default, `Changelog.md` at the vault root, is not a neutral value for this field. It names a note, and falling back to it would be a guess about which note may be overwritten. If the user had their own `Changelog.md`, the guess would destroy it. So the loader keeps the bad path and the write refuses it. The cost is a refusal on every update until the user fixes the path, and `runUpdate`'s `lastFailure` exists to make that cost bearable: an automatic update does not repeat a Notice it has already shown, the command always reports, and a success clears the memory. Without it, #298's resolution would put up a Notice after every pause in typing.

### One queue for everything that reads settings to act

`enqueue` in `main.ts` runs operations one at a time. Everything that reads settings to decide something, or writes them, goes through it: settings commits, the external reload, and changelog updates (#312). A decision made outside the queue is made against state that a queued write may be about to replace. Before 2.0.0's last round of fixes only settings writes were queued, and each of the other paths had its own race: an update that ran against the old path while a renamed changelog's new path was being saved (#300), an edit that landed on top of a sync reload (#297), excluded-folder rows deleted by stale position (#295, #296).

The queue has one rule: a queued operation never awaits the queue, which would deadlock. Scheduling the debounce from inside one is fine, because the update it leads to is queued later, when the timer fires. A failed operation does not stop the queue; the next one waits for it either way, and the caller still sees the failure.

`updateSettings` is the only way a setting changes after load. Its ordering is the point: write `data.json`, read it back, compare, and only then assign `this.settings`. Memory therefore never holds a value that disk does not (#206), and a failed write needs no rollback. The read-back exists because `saveData` resolves even when the write fails: Obsidian's `writePluginData` swallows the error. Beta 3 failed on exactly this, with a read-only `data.json` on Obsidian 1.14.4, and the run log in `CONTRIBUTING.md` records it. The read-back happens only at `manifest.dir`, which Obsidian sets for every installed plugin. Without it there is no known path to check, and a guessed one would report saves that worked as failed, so the save is trusted (#303).

The patch can be a function of the current settings, and it is evaluated _inside_ the queue, against whatever the previous write left. If each patch were computed outside, two overlapping edits would each start from the same old state and the later write would silently drop the earlier edit. Any caller that edits a collection passes a function, not a value. The tab's excluded-folder rows show the pattern. A row's control key is its index in the list as it was drawn. The tab resolves that index to the _value_ the row showed (`drawnFolders`) before anything is queued, and the patch then removes or replaces by value against the list as it is by then. `withExcludedFolder` checks the shared rule again against that list, and a value that breaks it leaves the list unchanged (#296).

`updateSettings` reports failures through a Notice and never throws, and its only side effect is scheduling a refresh when auto-update is on (#270). It never re-registers vault listeners. That was the leak behind #97 and #124, and it is the reason a settings save is kept free of side effects.

### Settings that arrive from elsewhere are read, never written back

`onExternalSettingsChange` runs when `data.json` changes underneath the plugin, through Sync, git, or another device (#264). It reloads through the same loader as startup and **never saves**. If a reload saved, one device would write normalized settings, the other would see a change and write its own, and `data.json` would bounce between them. The reload runs in the queue like a write, so an edit made while it reads builds on the synced settings, not on the copy being replaced (#297). It then redraws the tab and schedules a refresh.

### Writing is idempotent, and the plugin never reacts to its own write

`updateChangelog` renders the content and then reads the current file with `vault.read`, not `cachedRead`, because a stale cache would skip a write that was needed. It writes only when the bytes differ (#269). Most events cannot change the output: an edit to a note outside the top N, an edit in an excluded folder, a second save inside the timestamp format's resolution. Without this check, each of those would bump the changelog's mtime and, in a synced vault, upload a revision of nothing.

Writing the changelog fires `modify` (or `create`), and `vaultEventEffect`'s `ignore` for the changelog's own path is all that stops the plugin triggering itself. The changelog not listing itself is a separate rule, `filterAndSort`'s first clause. Only markdown can be a row, so only a markdown file can change the changelog. For a rename that is true of either name: a note renamed away from `.md` is a row leaving the list, and only `oldPath` shows it was one (#299).

`create` is registered only after `onLayoutReady`. Obsidian fires `create` for every file while the vault loads, and without the delay startup would queue one update per file. Notes that arrive already written, through Sync, a template or another app, are why the plugin listens to `create` at all (#291). Layout-ready can come after an early unload, so the registration checks `unloaded` first; registering then would attach to a component that will never release it (#302).

The 200 ms debounce is trailing-edge (`resetTimer = true`): one update after events stop. In 1.x it was a throttle that fired repeatedly while the user typed (#193). A trailing-edge debounce alone can be postponed for as long as a steady stream of events lasts, such as Sync downloading a vault or another plugin writing in a loop (#304). So `scheduleUpdate` remembers when the burst began (`burstStart`) and, two seconds in, forces the pending update to run; the trailing update follows when the burst ends. Two seconds is well above the spacing of Obsidian's autosaves, so typing still gets one update after it stops. Schedule through `scheduleUpdate`, never the debouncer directly, or the bound is lost.

`onunload` sets `unloaded` and cancels the pending timer. `registerEvent` releases the listeners, but the timer and the queue belong to the plugin. With `unloaded` set, nothing queued runs, so a save or reload that finishes late cannot lead to a write from a disabled or replaced plugin (#201, #301).

When the changelog's parent folder is missing, the plugin creates it, because `vault.create` does not (#287). A failed `create` re-checks for the file before giving up, to tolerate a concurrent update that created it first. Every failure in the write path throws with a reason. `runUpdate` is the one place those failures become a Notice and a console error (#217).

## The seams

**Obsidian's vault events** are where the plugin meets the world. The four event types funnel through one handler, one decision function and one debounce. The handler judges a file by its _current_ path and, for a rename, its old one. Its known edge is a note renamed _onto_ the changelog path when no changelog exists there. `vaultEventEffect` answers `ignore`, because the new path is the changelog's, and the test pins that answer. The note is now the changelog by name, and the next update overwrites it. That is consistent with the plugin owning a path rather than a file, but no refresh is scheduled for the row that just left the list.

**The declarative settings tab** (Obsidian 1.13, the reason `minAppVersion` moved from 1.6.6 to 1.13.0) commits text in two different ways, for two different reasons:

- The **changelog path** is its own `addText` row that commits on blur. On the way to typing `Notes.md/Changelog.md`, the field passes through `Notes.md`, which is valid, and with auto-update on that would write a changelog there. Here the danger is a _valid intermediate value_, so nothing short of the user leaving the field is safe. It is also deliberately not a file picker, because a file picker offers existing notes (#197).
- The **heading and datetime format** are declarative text controls whose commits wait for a 500 ms pause in typing and are flushed when the tab hides (#303). Here the danger is _cost_: each commit writes `data.json`, reads it back and, with auto-update on, renders the changelog, so per-keystroke commits wrote half-typed headings into it. An intermediate heading is harmless once it is replaced, so a pause is enough. A probe on beta 5 confirmed that these controls do not redraw from the saved value mid-edit, so a delayed commit cannot fight the user's typing.

A newcomer who unifies these will reintroduce one of the two bugs.

**The tab's validation runs outside the queue, and that is accepted.** A folder row's `validate` checks against the list as drawn, which may be stale by the time the save runs. The authoritative check is the second one, inside the patch. When the two disagree, the save leaves the list unchanged and the tab redraws, so the typed value disappears without an inline error. That outcome is rare, needs two edits racing, and leaves the list correct.

**Sync** is covered in design by the read-never-write reload and its place in the queue. The run log records the two-device Sync items as not covered on any beta.

**The build and release boundary** is principled and enforced by CI, not by convention. Obsidian ships the committed `main.js`. CI, the Beta workflow and the release workflow all rebuild and run `git diff --exit-code main.js`. Bun is unpinned, so a bundler change alone can trip this, and the fix is always to rebuild and commit. A release ships `main.js` and `manifest.json` and nothing else. `styles.css` is gone (#311): the settings tab is declarative and needs no CSS. A user upgrading from 1.8.0 may keep 1.8.0's `styles.css` in the plugin folder; if so, its selectors match nothing 2.0.0 draws.

**Tests stop at `changelog.ts`.** Everything in `main.ts` and `settings.ts` is verified by the beta checklist in `CONTRIBUTING.md`, run by hand in a real vault, and its run log is the only evidence that layer works. The checklist is effectively the test suite for event handling, saving and the tab. A change under `src/` invalidates every previous beta, and the checklist says so. Moving decisions into the core (#313, #312) shrank what only the checklist can prove, which is the direction to keep going.

## What it is shaped to accommodate

**A new output-shaping setting** is the expected extension, and the shape makes it cheap. Add the field to `ChangelogSettings` and `DEFAULT_SETTINGS`. Write its rule in `changelog.ts` in both forms if it has one. Add a line to `normalizeLoadedSettings`, which the compiler will demand. Read it inside `renderChangelog`, whose signature already takes the whole settings object. Add a control to `getSettingDefinitions`; if it is free text, route it through `pendingText` like the heading. `updateSettings` already schedules a refresh for any change. A newcomer is most likely to do damage by putting the rule in the control's `validate` closure or in `setControlValue`. That compiles and works, and it brings back the two-boundary drift that #213 removed.

**A new reaction to a vault event** belongs in `vaultEventEffect` as a new effect, with a test case, and the handler grows one branch to act on it. Anything that reads or writes settings in reaction to it goes through `enqueue`.

**Changing what a row looks like** is not a small change. The 1.8.0 fixtures will fail, correctly. Either it is a breaking change in a major version, or the row stays the same.

**Anything that needs memory of earlier changelogs** (history, diffs, "added" versus "modified", a device name per row: #8 and #58, both declined) contradicts the premise that the changelog is a projection. It would need persistent state outside the note, a merge strategy for Sync, and a different answer to "what does the plugin own". Treat it as a different plugin, not a feature of this one.

**Protecting the target note** has been tried once and withdrawn. Read #250 first. 2.0.0's approach is to avoid offering an existing note, to name the old file when the path changes, and to refuse rather than replace a bad saved path. Any new guard has to beat that approach without guessing.

**Multiple changelogs** would break the `ignore` that stops the plugin reacting to its own writes, the rename-follow logic, and `noticeOldChangelog`. All three assume exactly one owned path.

## Uncertainties

- **Obsidian behaviour the code depends on but cannot test.** That `create` fires for every file before layout-ready. That a folder rename fires a `rename` per descendant file, so the changelog's own `oldPath` arrives, and that a folder delete fires a `delete` per descendant file, so their rows leave. That `vault.createFolder` creates intermediate folders. That `Debouncer.run()` calls the function synchronously, so `burstStart` is cleared before the next event. The comments assert the first, and the beta run log is the only evidence for the folder rename ("Move the changelog to another folder, then move its folder" passed on beta 5). I have not read Obsidian's source.
- **What the number control actually passes to `setControlValue`.** `SettingNumberControl` is typed `number`, and a comment in `settings.ts` says an unparseable entry arrives as `0`. If the framework ever passes the raw string instead, `maxRecentFilesError` would accept `"42"` and memory would hold a string until the next reload. I believe the typing, but nothing at runtime checks it.
- **Which beta proves the current shell.** The run log in `CONTRIBUTING.md` ends at beta 5, whose bundle predates the queue, the burst cap, the debounced text commits, the kept invalid path and the rename Notice. Betas 6 and 7 exist as tags, but no run of the checklist against them is recorded in the repository. The claims above about `main.ts` and `settings.ts` rest on reading the code, not on a recorded pass.
- **A pending text commit and a sync reload.** The reload redraws the tab, but a heading or format edit still waiting out its 500 ms pause was captured before the reload and will be saved after it, over the synced value for that field. That is probably the right answer for a field the user is typing in. I am inferring it from the code; it has not been exercised.
- **Tie order.** `filterAndSort` sorts on `mtime` alone and relies on a stable sort, so notes with identical millisecond mtimes keep `getMarkdownFiles()` order. Bulk imports and checkouts can produce such ties. I do not know whether that order is stable across restarts. If it is not, the compare-before-write would rewrite the changelog after a restart even though nothing changed. I am inferring the risk, not observing it.
- **Whether `onExternalSettingsChange` fires for the plugin's own `saveData`.** The design assumes it does not. If it did, every save would queue a reload of itself. That would be harmless, because the reload never writes, but it would be wasted work and an extra refresh.
- **The scope of the maintenance-mode rule.** `CONTRIBUTING.md` says no change goes in unless a user asks for one, except in a planned major release. 2.0.0 is that exception. I read the rule as resuming once 2.0.0 ships, so the next change to this code needs a user asking for it.
