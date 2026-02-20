import {
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";

import type ChangelogPlugin from "./main";
import { PathSuggest } from "./suggest";

export interface ChangelogSettings {
  autoUpdate: boolean;
  changelogPath: string;
  datetimeFormat: string;
  maxRecentFiles: number;
  excludedFolders: string[];
  useWikiLinks: boolean;
  changelogHeading: string;
}

export const DEFAULT_SETTINGS: ChangelogSettings = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [],
  useWikiLinks: true,
  changelogHeading: "",
};

export class ChangelogSettingsTab extends PluginSettingTab {
  plugin: ChangelogPlugin;

  constructor(app: App, plugin: ChangelogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  renderExcludedFolders(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.excludedFolders.length === 0) {
      container.createEl("div", { text: "No excluded folders" });
      return;
    }

    this.plugin.settings.excludedFolders.forEach((folder) => {
      const folderDiv = container.createDiv("excluded-folder-item");
      folderDiv.createSpan({ text: folder });

      const removeButton = folderDiv.createEl("button", {
        text: "✕",
        cls: "excluded-folder-remove",
      });

      removeButton.addEventListener("click", async () => {
        const index = this.plugin.settings.excludedFolders.indexOf(folder);
        if (index > -1) {
          this.plugin.settings.excludedFolders.splice(index, 1);
          await this.plugin.saveSettings();
          this.renderExcludedFolders(container);
        }
      });
    });
  }

  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Auto update")
      .setDesc("Automatically update changelog on vault changes")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoUpdate).onChange(async (value) => {
          settings.autoUpdate = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.enableAutoUpdate();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Changelog path")
      .setDesc("Relative path including filename and extension")
      .addText((text) => {
        text
          .setPlaceholder("Folder/Changelog.md")
          .setValue(settings.changelogPath)
          .onChange(async (path) => {
            settings.changelogPath = normalizePath(path);
            await this.plugin.saveSettings();
          });

        new PathSuggest(this.app, text.inputEl);
      });

    new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js datetime format string")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          .onChange(async (format) => {
            const m = window.moment();
            const isValid = m.format(format) !== "Invalid date";

            if (!isValid) {
              text.setValue(settings.datetimeFormat);
              new Notice("Invalid datetime format");
              return;
            }

            settings.datetimeFormat = format;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max recent files")
      .setDesc("Maximum number of recently edited files to include")
      .addText((text) =>
        text
          .setValue(settings.maxRecentFiles.toString())
          .onChange(async (value) => {
            const numValue = Number(value);
            if (Number.isNaN(numValue) || numValue < 1) {
              text.setValue(settings.maxRecentFiles.toString());
              return;
            }
            settings.maxRecentFiles = numValue;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Use wiki-links")
      .setDesc("Format filenames as wiki-links [[note]] instead of plain text")
      .addToggle((toggle) =>
        toggle.setValue(settings.useWikiLinks).onChange(async (value) => {
          settings.useWikiLinks = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Changelog heading")
      .setDesc(
        "Optional heading to prepend to the changelog (e.g., # Changelog). Leave empty for no heading.",
      )
      .addText((text) =>
        text
          .setPlaceholder("# Changelog")
          .setValue(settings.changelogHeading)
          .onChange(async (value) => {
            settings.changelogHeading = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Excluded folders" });

    const excludedFoldersList = containerEl.createDiv("excluded-folders-list");
    this.renderExcludedFolders(excludedFoldersList);

    new Setting(containerEl)
      .setName("Add excluded folder")
      .setDesc("Folders to exclude from the changelog")
      .addText((text) => {
        text.setPlaceholder("folder/path/");
        new PathSuggest(this.app, text.inputEl);
      })
      .addButton((button) => {
        button.setButtonText("Add").onClick(async () => {
          const input = button.buttonEl.parentElement?.querySelector("input");
          if (input) {
            const folderPath = input.value;
            if (folderPath && !settings.excludedFolders.includes(folderPath)) {
              settings.excludedFolders.push(folderPath);
              await this.plugin.saveSettings();
              input.value = "";
              this.renderExcludedFolders(excludedFoldersList);
            }
          }
        });
      });
  }
}
