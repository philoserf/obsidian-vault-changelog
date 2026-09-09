# Theory

For the engineer inheriting this plugin. This is not a tour of the files; it is the set of
ideas you need to hold in mind so that a change you make does not quietly break something the
code assumes but never states.

## The one idea everything else hangs from

The name is a lie the codebase maintains on purpose, and understanding that is most of the
theory.

There is no log here. Nothing accumulates. `generateChangelog` is a pure function of the
vault's current state — take every markdown file, sort by `stat.mtime` descending, keep the
first _n_, render one line each. Run it twice against an unchanged vault and you get the same
string, byte for byte. Nothing about the previous run is consulted, and nothing about the
current run is remembered.

So the file at `changelogPath` is **cache, not data**. It is a materialized view of a query
whose source of truth is the vault's own filesystem metadata, and it can be thrown away and
regenerated at any moment at no cost. Once you see the file that way, nearly every decision in
this codebase stops looking like a shortcut and starts looking like the obvious consequence:

- `writeToFile` calls `vault.modify` with the whole rendered string. There is no merge, no
  append, no plugin-managed region between markers. Overwriting is not vandalism when the
  thing being overwritten is derived.
- There is no locking and no ordering discipline between the command path and the vault-event
  path. Two overlapping updates can only race to write the same answer.
- Failure is cheap enough to swallow. Look at the `catch` blocks in `main.ts` — they raise a
  `Notice` and return. Nothing retries, because the next vault event regenerates everything
  anyway. A dropped update is a stale cache, not lost work.
- `writeToFile`'s TOCTOU handling (`main.ts:72-88`) is tolerant rather than careful: if
  `vault.create` throws, it assumes a concurrent event won the race, re-fetches by path, and
  proceeds. That is only safe because whoever won was going to write the same content.

The README says the quiet part out loud for users — "the changelog note is entirely overwritten
on each update" — and that sentence is the user-facing shadow of this theory.

The corollary is the sharpest thing to know about this plugin: **any requirement that asks the
changelog to remember something is not a feature request, it is a request to discard the
theory.** Appending rather than replacing, recording deletions, diffing against the last run,
grouping entries by day across runs — none of those are additions to the current design. Each
one turns the file from cache into data, and once it is data, the overwrite has to go, the
races start to matter, and the swallowed errors become bugs. If that requirement ever arrives,
budget for a rewrite of `main.ts`, not a patch.

## The pure core and the shell around it

`src/changelog.ts` imports nothing from `obsidian`. That is not incidental tidiness; it is an
enforced boundary, and two injection points exist solely to hold it.

The first is `TimeFormatter`. `generateChangelog` takes a `(mtime, format) => string` callback
rather than reaching for moment itself. In production `main.ts` passes
`(mtime, fmt) => window.moment(mtime).format(fmt)` — Obsidian's globally-installed moment, so
nothing is bundled. In tests, `changelog.test.ts` passes the npm `moment` package, which is why
`moment` appears in `devDependencies` and never in the shipped bundle. Same behavior, two
different moments, and the pure layer knows about neither.

The second is `normalize`. `normalizeLoadedSettings` takes a path normalizer as an argument
instead of importing Obsidian's `normalizePath`. Tests pass `identity`, or a small stub, and
can therefore assert normalization is _called_ on the right fields without needing Obsidian's
implementation.

The third boundary is quieter and easy to break by accident. `filterAndSort` and
`generateChangelog` accept `ChangelogFile[]`:

```ts
interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}
```

That is the narrowest structural subset of Obsidian's `TFile` the functions actually touch. A
real `TFile` satisfies it, so `main.ts` passes `getMarkdownFiles()` straight through with no
adapter; a three-field object literal in a test satisfies it too. The temptation, when you need
one more property, is to widen this to `TFile` — that single edit would drag `obsidian` into
the pure module and collapse the whole arrangement. Add the field to `ChangelogFile` instead.

`src/settings.ts` and `src/main.ts` are the shell. Everything Obsidian-shaped lives there:
`Plugin` lifecycle, vault event registration, `PluginSettingTab`, `AbstractInputSuggest`,
`Notice`, `debounce`. The shell is meant to hold no decisions, only wiring. Where it currently
holds one — see the `duplicate` verdict finding below — that is drift, not design.

## The invariants

Five things must stay true. Two are enforced, three are not, and knowing which is which is the
difference between a safe change and a damaging one.

**Settings are valid the moment they are loaded, and `normalizeLoadedSettings` is the only
gate.** It is deliberately paranoid about `data.json`, which a user can hand-edit and a failed
write can truncate. It drops keys it does not recognize, so a setting you rename does not leave
its predecessor lying around forever. It replaces any known key whose runtime type is wrong with
the default — that is the `typeof` sweep over the string keys, then the boolean keys, then the
`every` check on `excludedFolders`, which throws away the whole array if a single element is not
a string. Then it normalizes paths, clamps, and trims. **When you add a setting, you must add it
to `DEFAULT_SETTINGS` _and_ to the matching type-guard loop.** Adding only the first compiles,
passes the tests, and silently ships a setting that a corrupt `data.json` can turn into
`undefined` at runtime. This is the most likely way to damage the system while believing you
followed the pattern.

**`clampMaxRecentFiles` is the single clamping authority.** Load-time calls it; the settings UI
calls it. Its comment says so. The reason is that the two paths previously disagreed about
floats and about the upper bound, and reconciling them is what 1.5.3 was for. Do not
re-implement the rule at a third call site.

**The changelog never triggers its own regeneration.** The vault-event handler
(`main.ts:41-49`) checks three things before touching the debouncer: auto-update is on, the
subject is a `TFile`, and its path is not `changelogPath`. That third check is the loop
breaker — `vault.modify` on the changelog fires a `modify` event, and without the guard the
plugin would rewrite the file in response to having rewritten the file. The guards sit
_before_ the debounce rather than inside the callback, which was a deliberate move (1.4.0,
#133): put them after, and the debouncer's pending state gets set by events that should have
been ignored.

**The committed `main.js` matches a fresh build of `src/`.** This one is enforced, and it is
worth knowing how, because it looks like sloppiness if you do not. Obsidian ships the committed
bundle, so `main.js` is a tracked build artifact rather than build output. CI runs
`bun run build` then `git diff --exit-code main.js`, which fails the PR if the two diverge. The
workflow comment notes that `bun` is deliberately left unpinned so that a bundler-output change
trips the same wire. I rebuilt from source while writing this and the output was byte-identical
to the committed file.

**The file at `changelogPath` belongs to the plugin.** This one is not enforced at all, and it
is the load-bearing assumption that the overwrite rests on. `isValidChangelogPath` checks only
that the path ends in `.md`, which every note in the vault does — and `PathSuggest` cheerfully
offers every one of them as a completion. See the high-severity finding below.

## Vocabulary worth learning before you touch it

**Excluded folders are stored without a trailing slash and matched with one.** This looks like
a bug the first time you read `filterAndSort`:

```ts
file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
```

Both halves of that ternary are live. `normalizePath` strips trailing slashes, so anything
saved through the settings UI arrives as `Archive`; but the setting predates that normalization,
so a long-lived `data.json` can still hold `Archive/`. The slash is re-added at match time
rather than at save time because the alternative — a migration — would have to run against
persisted user data. And the slash matters: without it, excluding `Notes` would also exclude
`Notes2/` and `Notebook/`. There is a test for exactly that (`does not exclude folders that
share a prefix`), which is the tell that someone was burned by it (1.3.0, #101).

**`ChangelogSettings.changelogHeading` is written literally, and trimmed at both boundaries.**
`generateChangelog` emits `heading + "\n\n"` when it is non-empty and nothing at all when it is.
That two-newline spacing is only predictable if the heading carries no leading or trailing
whitespace, which is why it is trimmed on load _and_ on change. The comment on
`normalizeLoadedSettings` names this dependency explicitly.

**"Verdict" means a three-valued answer, not a boolean.** `ExcludedFolderVerdict` is
`"ok" | "invalid" | "duplicate"` because the UI is supposed to say something different about
each. Today it does not.

## The seams

The Obsidian API is the widest one, and the plugin sits on more of it than its size suggests:
`vault.getMarkdownFiles`, `getAllFolders`, `getFiles`, `getAbstractFileByPath`, `create`,
`modify`, the `modify`/`delete`/`rename` events, `normalizePath`, `debounce`, `Notice`,
`PluginSettingTab`, `AbstractInputSuggest`, and the ambient `window.moment`. Note that
`obsidian@1.13.1` is a types-only package — there is no JavaScript in `node_modules/obsidian`.
Nothing in this repository can execute an Obsidian function, which is why the test suite covers
`changelog.ts` completely and `main.ts` and `settings.ts` not at all. That is not a coverage
gap someone forgot to fill; it is the boundary the pure/shell split was drawn to create. The
shell is untested by construction, which is the argument for keeping it as thin as it is.

`data.json`, written by `saveData` and read by `loadData`, is the persistence seam, and it is
treated as hostile input — see the invariant above.

The release seam is a triple that must move together: `package.json` version,
`manifest.json` version, and a `versions.json` entry mapping the new version to the current
`minAppVersion`. `version-bump.ts` writes the latter two from the first, and reads
`minAppVersion` out of the manifest _before_ overwriting the version field, which is the only
subtle thing in that script. `CLAUDE.md` directs you to the release-gate and release-ship
skills rather than tagging by hand.

`deploy.ts` is a local convenience, not part of the pipeline: it copies the three shipped files
into whatever `OBSIDIAN_DEPLOY_DEST` names, from the gitignored `.env.local`.

## Where the theory is thin

Two boundaries here are historical rather than principled, and it is worth not mistaking them
for design.

`PathSuggest` serves both the changelog-path field and the excluded-folder field from a single
list containing every folder (slash-suffixed) and every markdown file. One field wants folders,
the other wants a file, and neither gets a filtered list. The shared suggester is convenient
and is also the mechanism by which a user can autocomplete their way into overwriting a real
note.

The suggester's `cachedPaths` is populated on first use and never invalidated. Because
`display()` rebuilds the tab's DOM and constructs fresh suggesters each time the settings tab
opens, the cache is effectively per-visit — stale only for files created while the tab sits
open. That is a deliberate trade (1.5.0: "cache vault paths to avoid per-keystroke scanning"),
not an oversight, but it is undocumented and looks like a leak.

`onunload()` is an empty method. Every event is registered through `registerEvent`, so Obsidian
tears them down; the debouncer's pending timer is not cancelled, but its callback checks
`this.settings.autoUpdate` on a plugin instance that is going away, and the worst case is one
orphaned write. The method exists because a plugin-checker warning asked for it (1.5.0), which
means it is ceremony rather than cleanup.

## Uncertainties

Where I inferred intent from code and could be wrong:

- **`normalizePath`'s empty-string return.** The obsidian package ships no implementation, so I
  could not execute it. The `validateExcludedFolder` finding below turns on whether an empty
  input normalizes to `""`, `"."`, or `"/"`. The structural complaint holds under any of them;
  the severity does not.
- **`debounce`'s `resetTimer` default.** Same limitation. I read the optional third parameter
  off the type declaration and Obsidian's published docs, not off a running implementation.
- **Whether the `duplicate` verdict was ever wired up.** The type, the function, and the test
  all exist; only the UI arm is missing. I read that as an unfinished intention rather than a
  decision to ignore duplicates silently, but the git history does not settle it.
- **Whether `maxRecentFiles`' asymmetric UI validation is intentional.** Values below 1 are
  rejected with a `Notice`; values above 500 are silently clamped, despite the `Notice` text
  promising a range. Plausibly deliberate — clamping down is harmless, clamping up would hide
  a typo — but nothing says so.
- **Coverage.** I read every source file, the tests, both CI workflows, the build and release
  scripts, and the full `CHANGELOG.md`. I did not run the plugin inside Obsidian, so every
  claim about runtime behavior at the Obsidian seam is inferred from the API declarations.

## Index

| #   | Severity | Issue                                                     | Primary location                              |
| --- | -------- | --------------------------------------------------------- | --------------------------------------------- |
| 1   | high     | `changelog-path-may-target-any-existing-note`             | `src/changelog.ts:86-88`, `src/main.ts:72-88` |
| 2   | medium   | `duplicate-excluded-folder-verdict-is-silently-discarded` | `src/settings.ts:224-244`                     |
| 3   | medium   | `excluded-folder-guard-is-written-for-unnormalized-input` | `src/changelog.ts:97-104`                     |
| 4   | medium   | `test-files-are-excluded-from-typechecking`               | `tsconfig.json:11`                            |
| 5   | low      | `readme-names-a-command-the-palette-does-not-show`        | `README.md`, `src/main.ts:31-39`              |
| 6   | low      | `debounce-is-called-without-resettimer`                   | `src/main.ts:21-25`, `CLAUDE.md`              |

**Total: 6 issues (0 critical, 1 high, 3 medium, 2 low)**
