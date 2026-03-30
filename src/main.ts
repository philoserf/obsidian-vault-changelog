import { debounce, Notice, Plugin, type TAbstractFile, TFile } from "obsidian";

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

    this.loadStyles();

    this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);
    this.enableAutoUpdate();
  }

  onunload(): void {}

  async loadStyles(): Promise<void> {
    const cssFile = await this.app.vault.adapter.read(
      `${this.manifest.dir}/styles.css`,
    );
    this.registerStyles(cssFile);
  }

  registerStyles(cssText: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    this.register(() => styleEl.remove());
    document.head.appendChild(styleEl);
  }

  enableAutoUpdate(): void {
    if (this.settings.autoUpdate) {
      this.registerEvent(
        this.app.vault.on("modify", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("delete", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );

      this.registerEvent(
        this.app.vault.on("rename", (file: TAbstractFile) => {
          if (file instanceof TFile) {
            this.onVaultChange(file);
          }
        }),
      );
    }
  }

  onVaultChange(file: TFile): void {
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
    ) as TFile[];
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
      file = await this.app.vault.create(path, "");
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
