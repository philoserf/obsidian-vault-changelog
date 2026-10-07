# Contributing

This plugin is in the community directory and has outside users. Outside a planned major release
it is in maintenance mode (#252): no change unless a user asks for it.

## Gates

Every change runs the same gates locally and in CI:

```bash
bun run build                 # typecheck + Biome, then bundle
bun test
git diff --exit-code main.js  # the committed bundle is what ships
```

`main.ts` and `settings.ts` cannot run outside Obsidian, so behavior there is proven by the beta
checklist below, run in a real vault.

Before a release tag, run the community site's lint rules locally and expect zero warnings. Run
them from a scratch directory so ESLint never enters this repository, which is Biome-only:
`eslint-plugin-obsidianmd` (`obsidianmd/eslint-plugin`).

## Betas

A beta is a GitHub prerelease cut from the release branch by the **Beta** workflow
(`.github/workflows/beta.yml`). Run it with a version such as `2.0.0-beta.1`. The version is
written into `manifest.json` for that run only. Install the prerelease with BRAT in a scratch
vault.

A beta passes when **every** item below passes on that one beta. Any later change to `src/` or to
dependencies needs a new beta and a full re-run. A change that touches only docs does not.

### Checklist

#### The changelog file

The note at the changelog path is the plugin's to replace, in full, on every update. The plugin
does not try to protect a note the user points it at (#197).

- [ ] Empty vault, then change the heading: the changelog is still written.
- [ ] Another plugin edits the changelog after each write (for example, adds frontmatter): the
      plugin keeps writing it.
- [ ] Upgrade from 1.8.0: the existing changelog keeps being written, and nothing is asked.
- [ ] Change the path away from an existing changelog: a Notice names the old file as an ordinary
      note, and it is not deleted.
- [ ] Change the path when no changelog exists at the old path: no Notice.

#### Upgrade from 1.8.0 settings

- [ ] Fresh install.
- [ ] `data.json` with defaults only.
- [ ] `data.json` with every field set.
- [ ] Corrupt `data.json`: `maxRecentFiles: null`, `datetimeFormat: ""`, `changelogPath: "Notes"`,
      `excludedFolders: ["Archive/", "Archive"]`, plus an unknown key. Each loads to its
      documented value and shows correctly in the settings tab. `changelogPath: "Notes"` is kept,
      not replaced by `Changelog.md`. The update shows a Notice naming the path, and nothing is
      written. With auto-update on, further edits do not repeat the Notice, while the command does.
- [ ] Obsidian older than the new `minAppVersion` still resolves to 1.8.0 (`versions.json`).

#### Settings edits

- [ ] Type quickly in the datetime format and heading fields, then reload: the last edit is on
      disk and in memory.
- [ ] With auto-update on, type a heading at a normal pace: `data.json` and the changelog change
      after typing pauses, not once per character, and the field never loses a typed space.
- [ ] Type in the heading field and close settings at once: the last edit is saved.
- [ ] Toggle a setting twice quickly: the final state is the one saved.
- [ ] Make `data.json` read-only and edit two fields: nothing claims to be saved that is not.
- [ ] Clear the datetime format field: an inline error shows, nothing is saved, and the preview
      shows the default.
- [ ] Max recent files: `0`, `501`, `2.5` and text are refused with an inline error.
- [ ] With auto-update on, change each output-shaping setting: the changelog updates once.

- [ ] Settings search finds each setting by name, including the excluded folders.
- [ ] Type a changelog path that passes through a valid one on the way, such as
      `Notes.md/Changelog.md`: nothing is written until the field loses focus.
- [ ] The command palette shows `Vault Changelog: Update changelog`, and an existing hotkey for
      it still works.

#### Sync

- [ ] Change a setting on one device: the other picks it up without a restart and without saving.
- [ ] Change a setting on both devices while a save is in flight.

#### Rename and move

- [ ] Rename the changelog: no ghost file at the old path, and the changelog does not list itself.
- [ ] Move the changelog to another folder, then move its folder, then undo.
- [ ] Rename the changelog to `Changelog.txt`: a Notice says it is now an ordinary file and names
      the path the plugin keeps writing to. The setting does not follow it, `Changelog.txt` is left
      alone, and the next update writes a fresh changelog at the configured path.
- [ ] With auto-update on, rename a listed note to `.txt`: the changelog drops its row.
- [ ] With auto-update on, edit a note and rename the changelog within 200 ms: no ghost appears at
      the old path.

#### Rendering

- [ ] Output matches the 1.8.0 fixtures except where basenames collide.
- [ ] Two notes with the same filename: distinct rows, with wiki-links on and off.

#### Write discipline

- [ ] Edit an image, a note in an excluded folder, and the top note twice inside one minute: the
      changelog's modified time does not change.
- [ ] Type steadily in a note: the changelog is written once after typing stops.
- [ ] A stream of note changes less than 200 ms apart, such as a first Sync of many notes: the
      changelog is written about every two seconds while it lasts, and once more when it ends.

#### Errors

- [ ] Point the changelog path into a folder that does not exist, then run the update: either the
      changelog is created, or a Notice gives the reason, and the developer console logs the
      error with its cause.
- [ ] Point the changelog path at a folder named like a note (`Folder.md/`): the Notice says it
      is a folder.

#### Lifecycle

- [ ] Disable the plugin within 200 ms of an edit: no write afterwards.
- [ ] Update the plugin in place: two instances never both write.

#### Excluded folders

- [ ] Add, delete, a duplicate, a folder that does not exist, and the vault root.
- [ ] With three folders listed, delete the first two in quick succession: exactly those two go,
      and the third stays.
- [ ] Delete a folder and, before the list redraws, pick a folder in a new row: the list has no
      gap, and every update still runs.

#### Mobile

- [ ] One full pass on iOS.

### Run log

One line per beta: date, version, device, and pass or the failing items.

| Date       | Version      | Device                                                                              | Result                                                                                                                                                                                                                                                                                          |
| ---------- | ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-07 | 2.0.0-beta.3 | sextant, `obsidian-settings-test`, Obsidian 1.14.4, driven through the Obsidian CLI | **Fail.** A save to a read-only `data.json` was reported as success, and memory diverged (#206). A path inside a missing folder failed on every update (#287). Excluded-folder rows showed their path twice (#288). Everything else checked passed.                                             |
| 2026-10-07 | 2.0.0-beta.4 | same                                                                                | **Fail.** The three beta.3 findings were fixed. A note created with content never triggered an update (#291). Everything else checked passed.                                                                                                                                                   |
| 2026-10-07 | 2.0.0-beta.5 | same                                                                                | **Pass** on every item checked: upgrade, settings edits, the changelog file, errors, rename and move, write discipline, lifecycle, excluded folders, settings search, the command name, mobile emulation, and a full app restart. **Not covered:** Sync between two devices, and a real iPhone. |
| 2026-10-07 | 2.0.0-beta.5 | telemetry (iPhone), notes vault, BRAT                                               | **Pass** (hands-on).                                                                                                                                                                                                                                                                            |
