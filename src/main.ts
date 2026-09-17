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
  DEFAULT_SETTINGS,
  isPluginGeneratedChangelog,
  normalizeLoadedSettings,
  renderChangelog,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
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

  async updateChangelog(): Promise<void> {
    const { changelogPath } = this.settings;
    const content = renderChangelog(
      this.app.vault.getMarkdownFiles(),
      this.settings,
      (mtime, fmt) => window.moment(mtime).format(fmt),
      (file) =>
        this.app.metadataCache.fileToLinktext(file as TFile, changelogPath),
    );

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
  }

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

  async loadSettings(): Promise<void> {
    this.settings = normalizeLoadedSettings(
      await this.loadData(),
      normalizePath,
    );
  }

  onunload(): void {
    // Event listeners registered via registerEvent are cleaned up
    // automatically; the debounce timer is not. Without this, disabling the
    // plugin within 200ms of an edit still fires an update against a
    // torn-down instance -- and on a plugin *update* the new instance has
    // already loaded, so two of them write the same file.
    this.debouncedVaultChange.cancel();
  }

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
}
