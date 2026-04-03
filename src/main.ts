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
  MAX_RECENT_FILES,
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;
  private debouncedVaultChange = debounce(() => {
    void this.updateChangelog().catch((err) => {
      console.error("Changelog update failed:", err);
      new Notice("Failed to update changelog");
    });
  }, 200);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: async () => this.updateChangelog(),
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
    this.registerEvent(this.app.vault.on("rename", handler));
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

  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, "");
      } catch {
        // File may have been created by a concurrent event (TOCTOU race)
        file = this.app.vault.getAbstractFileByPath(path);
        if (!file) throw new Error(`Failed to create changelog at: ${path}`);
      }
    }
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      new Notice(`Could not update changelog at path: ${path}`);
    }
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
    };

    // Normalize persisted folder paths so duplicate detection in the
    // settings UI (which also runs normalizePath) stays consistent.
    this.settings.changelogPath = normalizePath(this.settings.changelogPath);
    this.settings.excludedFolders =
      this.settings.excludedFolders.map(normalizePath);
    const raw = Number(this.settings.maxRecentFiles);
    this.settings.maxRecentFiles = Number.isFinite(raw)
      ? Math.max(1, Math.min(Math.floor(raw), MAX_RECENT_FILES))
      : DEFAULT_SETTINGS.maxRecentFiles;
  }

  onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
