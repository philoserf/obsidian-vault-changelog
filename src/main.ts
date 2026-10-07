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
  filterAndSort,
  generateChangelog,
  normalizeLoadedSettings,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  override settings: ChangelogSettings = DEFAULT_SETTINGS;
  private saveQueue: Promise<void> = Promise.resolve();
  private settingTab: ChangelogSettingsTab | undefined;
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
        this.runUpdate();
      },
    });

    // Only markdown files can appear in the changelog, so only they can
    // change it (#269). The path test is the loop breaker: writing the
    // changelog is itself a modify event.
    const handler = (file: TAbstractFile) => {
      if (
        this.settings.autoUpdate &&
        file instanceof TFile &&
        file.extension === "md" &&
        file.path !== this.settings.changelogPath
      ) {
        this.debouncedVaultChange();
      }
    };
    this.registerEvent(this.app.vault.on("modify", handler));
    this.registerEvent(this.app.vault.on("delete", handler));
    // rename alone carries oldPath, the only value that can say the renamed
    // file was the changelog. Without it the setting goes stale: the next
    // update recreates a ghost at the old path and lists the moved
    // changelog as an ordinary note (#196).
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (
          file instanceof TFile &&
          oldPath === this.settings.changelogPath &&
          changelogPathError(file.path) === undefined
        ) {
          // The new path is assigned only once it is saved. An update
          // already pending would run in that gap against the old path, so
          // cancel it. updateSettings schedules a fresh one after the
          // assignment when auto-update is on.
          this.debouncedVaultChange.cancel();
          void this.updateSettings({ changelogPath: file.path });
          return;
        }
        handler(file);
      }),
    );
  }

  async updateChangelog(): Promise<void> {
    const path = this.settings.changelogPath;
    const recentFiles = filterAndSort(
      this.app.vault.getMarkdownFiles(),
      path,
      this.settings.excludedFolders,
      this.settings.maxRecentFiles,
    );
    const content = generateChangelog(
      recentFiles,
      this.settings.datetimeFormat,
      this.settings.useWikiLinks,
      this.settings.changelogHeading,
      (mtime, fmt) => window.moment(mtime).format(fmt),
    );

    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
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
   */
  private runUpdate(): void {
    this.updateChangelog().catch((err: unknown) => {
      console.error("Vault Changelog: update failed", err);
      new Notice(
        `Failed to update changelog: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
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
