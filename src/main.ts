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
} from "./changelog";
import { ChangelogSettingsTab } from "./settings";

export default class ChangelogPlugin extends Plugin {
  settings: ChangelogSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update-changelog",
      name: "Update Changelog",
      callback: () => this.updateChangelog(),
    });

    this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);

    const handler = (file: TAbstractFile) => {
      if (file instanceof TFile) this.onVaultChange(file);
    };
    this.registerEvent(this.app.vault.on("modify", handler));
    this.registerEvent(this.app.vault.on("delete", handler));
    this.registerEvent(this.app.vault.on("rename", handler));
  }

  onVaultChange(file: TFile): void {
    if (!this.settings.autoUpdate) return;
    if (file.path !== this.settings.changelogPath) {
      this.updateChangelog();
    }
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
    );
    await this.writeToFile(this.settings.changelogPath, changelog);
  }

  async writeToFile(path: string, content: string): Promise<void> {
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, "");
      } catch {
        file = this.app.vault.getAbstractFileByPath(path);
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

    if (this.settings.excludedFolders.length > 0) {
      this.settings.excludedFolders = this.settings.excludedFolders.map(
        (folder) => {
          const normalized = normalizePath(folder);
          return normalized.endsWith("/") ? normalized : `${normalized}/`;
        },
      );
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
