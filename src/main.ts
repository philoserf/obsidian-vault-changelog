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
  filterAndSort,
  generateChangelog,
  isPluginGeneratedChangelog,
  normalizeLoadedSettings,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    this.runUpdate();
  }, 200);

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
          this.settings.changelogPath = file.path;
          this.saveSettingsSafely();
          return; // the changelog moved; nothing to regenerate
        }
        handler(file);
      }),
    );
  }

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

  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, "");
      } catch (createErr) {
        // File may have been created by a concurrent event (TOCTOU race)
        file = this.app.vault.getAbstractFileByPath(path);
        if (!file)
          throw new Error(`Failed to create changelog at: ${path}`, {
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
          `Refusing to overwrite ${path}: it does not look like a changelog this plugin generated. Point "Changelog path" at a new or empty note, or clear that file first.`,
        );
      }
      await this.app.vault.modify(file, content);
    } else {
      new Notice(`Could not update changelog at path: ${path}`);
    }
  }

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
}
