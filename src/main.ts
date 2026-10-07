import {
  debounce,
  Notice,
  normalizePath,
  Plugin,
  type TAbstractFile,
  TFile,
} from "obsidian";

import {
  type ChangelogSettings,
  changelogPathError,
  DEFAULT_SETTINGS,
  normalizeLoadedSettings,
  renderChangelog,
  vaultEventEffect,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  override settings: ChangelogSettings = DEFAULT_SETTINGS;
  private saveQueue: Promise<void> = Promise.resolve();
  private settingTab: ChangelogSettingsTab | undefined;
  /** The last failure an automatic update reported, until one succeeds. */
  private lastFailure: string | undefined;
  // resetTimer = true makes this a trailing-edge debounce: one update once
  // editing has been quiet for 200 ms. Left at its default of false it is a
  // throttle that fires repeatedly through a burst of autosaves (#193).
  private debouncedVaultChange = debounce(
    () => {
      this.runUpdate();
    },
    200,
    true,
  );

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

    // Which events matter is decided in changelog.ts (#313); this only acts
    // on the answer. rename alone passes oldPath, which is how a moved
    // changelog is told apart from any other rename (#196).
    const handler = (file: TAbstractFile, oldPath?: string) => {
      if (!(file instanceof TFile)) return;
      const effect = vaultEventEffect(
        file.path,
        oldPath,
        this.settings.changelogPath,
      );
      if (effect === "ignore") return;
      if (effect === "refresh") {
        if (this.settings.autoUpdate) this.debouncedVaultChange();
        return;
      }
      if ("cannotFollow" in effect) {
        // The renamed file is now the user's, and is left alone. The setting
        // keeps its path, and the next update writes a changelog there. Say
        // so instead of letting a new file appear unexplained (#299).
        new Notice(
          `The changelog was renamed to ${effect.cannotFollow}, which is not a markdown note, so it is now an ordinary file. Vault Changelog keeps writing to ${this.settings.changelogPath}.`,
        );
        if (this.settings.autoUpdate) this.debouncedVaultChange();
        return;
      }
      // The new path is assigned only once it is saved. An update already
      // pending would run in that gap against the old path, so cancel it.
      // updateSettings schedules a fresh one after the assignment when
      // auto-update is on.
      this.debouncedVaultChange.cancel();
      void this.updateSettings({ changelogPath: effect.follow });
    };
    this.registerEvent(this.app.vault.on("modify", (file) => handler(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => handler(file)));
    // A note can arrive already written, through Sync, a template or another
    // app, and never be modified afterwards (#291). Obsidian fires create for
    // every file while the vault loads, so listen only once the layout is
    // ready, or startup would run an update per file.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => handler(file)));
    });
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => handler(file, oldPath)),
    );
  }

  async updateChangelog(): Promise<void> {
    const path = this.settings.changelogPath;
    // The loader keeps an invalid saved path rather than guess another note
    // to write (#298). This is where it is refused, with the reason.
    if (changelogPathError(path) !== undefined) {
      throw new Error(
        `the changelog path ${path} is not a markdown note. Choose one ending in .md in settings`,
      );
    }
    const content = renderChangelog(
      this.app.vault.getMarkdownFiles(),
      this.settings,
      (mtime, fmt) => window.moment(mtime).format(fmt),
      (file) => this.app.metadataCache.fileToLinktext(file, path),
    );

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
        if (!file) {
          const reason =
            createErr instanceof Error ? createErr.message : String(createErr);
          throw new Error(`could not create ${path}: ${reason}`, {
            cause: createErr,
          });
        }
      }
    }
    if (!(file instanceof TFile)) {
      throw new Error(`${path} is a folder, not a note`);
    }
    // An unchanged changelog is not rewritten (#269). Most vault events
    // cannot change it: a note outside the list, an excluded folder, a second
    // edit inside the format's resolution. Rewriting anyway bumps its mtime
    // and, in a synced vault, uploads a revision for nothing. read, not
    // cachedRead: a stale cache would skip a write that was needed.
    if ((await this.app.vault.read(file)) === content) return;
    await this.app.vault.modify(file, content);
  }

  /**
   * The one place an update failure is reported, for both the command and
   * the debounced vault handler. Every failure in the write path throws, so
   * the reason reaches the user and the developer console, not a fixed
   * message with the error discarded (#217).
   *
   * An automatic update does not repeat the Notice for a failure it has
   * already shown. A failure that persists, such as an invalid path (#298),
   * would otherwise pop up after every pause in typing. The command always
   * reports, and a success clears the memory.
   */
  private runUpdate(manual = false): void {
    this.updateChangelog().then(
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

  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }

  /**
   * The one way a setting changes after load. The change is persisted first
   * and assigned only once the write succeeds, so memory never holds a value
   * disk does not (#206), and a failed write needs no rollback.
   *
   * Writes run one at a time, and each builds its next state from the last
   * one persisted, inside the queue. The settings tab commits on every
   * change, so edits overlap routinely. Built outside the queue, two
   * overlapping edits would each start from the same old state and the
   * later write would drop the earlier edit.
   *
   * A change is reported here, never thrown, and has no side effect except
   * scheduling a changelog refresh when auto-update is on (#270). In
   * particular it never re-registers vault listeners, which is the leak
   * behind #97 and #124.
   */
  updateSettings(
    change:
      | Partial<ChangelogSettings>
      | ((current: ChangelogSettings) => Partial<ChangelogSettings>),
  ): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const patch =
        typeof change === "function" ? change(this.settings) : change;
      const next = { ...this.settings, ...patch };
      await this.saveData(next);
      // saveData resolves even when the write fails: Obsidian's
      // writePluginData swallows the error (seen with a read-only data.json
      // on Obsidian 1.14.4). So read the file back, and treat the save as done
      // only if disk holds what was written.
      const dataPath = `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/data.json`;
      const onDisk: unknown = JSON.parse(
        await this.app.vault.adapter.read(dataPath),
      );
      if (JSON.stringify(onDisk) !== JSON.stringify(next)) {
        throw new Error(`could not write ${dataPath}`);
      }
      this.settings = next;
      if (next.autoUpdate) this.debouncedVaultChange();
    });
    const reported = run.catch((err: unknown) => {
      console.error("Vault Changelog: failed to save settings", err);
      new Notice(
        `Failed to save changelog settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.saveQueue = reported;
    return reported;
  }

  /**
   * data.json changed on disk outside this instance: Obsidian Sync, git, or
   * another device (#264). Reload it through the same loader as startup, and
   * never save. A reload that writes makes data.json bounce between devices.
   * Waiting for queued writes first keeps a write of our own from landing
   * after, and over, the copy just read.
   */
  override async onExternalSettingsChange(): Promise<void> {
    await this.saveQueue;
    await this.loadSettings();
    this.settingTab?.update();
    if (this.settings.autoUpdate) this.debouncedVaultChange();
  }

  override onunload(): void {
    // registerEvent releases the vault listeners; the pending timer is ours to
    // cancel, or a disabled or replaced plugin still writes (#201).
    this.debouncedVaultChange.cancel();
  }
}
