import { type App, normalizePath, PluginSettingTab, Setting } from "obsidian";

import { DEFAULT_SETTINGS } from "./changelog";
import type ChangelogPlugin from "./main";
import { PathSuggest } from "./suggest";

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

    const datetimePreview = containerEl.createEl("div", {
      cls: "setting-item-description",
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
    });

    new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js format string")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          .onChange(async (format) => {
            const nextFormat = format || DEFAULT_SETTINGS.datetimeFormat;
            if (!format) {
              text.setValue(nextFormat);
            }
            settings.datetimeFormat = nextFormat;
            datetimePreview.textContent = `Preview: ${window.moment().format(nextFormat)}`;
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
            const flooredValue = Math.floor(numValue);
            settings.maxRecentFiles = flooredValue;
            text.setValue(flooredValue.toString());
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
            const folder = normalizePath(input.value);
            if (folder && !settings.excludedFolders.includes(folder)) {
              settings.excludedFolders.push(folder);
              await this.plugin.saveSettings();
              input.value = "";
              this.renderExcludedFolders(excludedFoldersList);
            }
          }
        });
      });
  }
}
