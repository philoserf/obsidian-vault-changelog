import {
  AbstractInputSuggest,
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";

import { DEFAULT_SETTINGS, MAX_RECENT_FILES } from "./changelog";
import type ChangelogPlugin from "./main";

class PathSuggest extends AbstractInputSuggest<string> {
  inputEl: HTMLInputElement;
  private cachedPaths: string[] | null = null;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  private getPaths(): string[] {
    if (this.cachedPaths) return this.cachedPaths;

    const paths: string[] = [];
    for (const folder of this.app.vault.getAllFolders()) {
      paths.push(`${folder.path}/`);
    }
    for (const file of this.app.vault.getFiles()) {
      if (file.extension === "md") {
        paths.push(file.path);
      }
    }
    this.cachedPaths = paths;
    return paths;
  }

  getSuggestions(inputStr: string): string[] {
    const lowerInput = inputStr.toLowerCase();
    return this.getPaths().filter((p) => p.toLowerCase().contains(lowerInput));
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    this.inputEl.trigger("input");
    this.inputEl.dispatchEvent(new Event("blur"));
    this.close();
  }
}

export class ChangelogSettingsTab extends PluginSettingTab {
  plugin: ChangelogPlugin;

  constructor(app: App, plugin: ChangelogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  renderExcludedFolders(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.excludedFolders.length === 0) {
      container.createDiv({ text: "No excluded folders" });
      return;
    }

    this.plugin.settings.excludedFolders.forEach((folder) => {
      const folderDiv = container.createDiv("excluded-folder-item");
      folderDiv.createSpan({ text: folder });

      const removeButton = folderDiv.createEl("button", {
        text: "✕",
        cls: "excluded-folder-remove",
      });

      removeButton.addEventListener("click", () => {
        const index = this.plugin.settings.excludedFolders.indexOf(folder);
        if (index > -1) {
          this.plugin.settings.excludedFolders.splice(index, 1);
          void this.plugin.saveSettings();
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
        toggle.setValue(settings.autoUpdate).onChange((value) => {
          settings.autoUpdate = value;
          void this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Changelog path")
      .setDesc("Relative path including filename and extension")
      .addText((text) => {
        text
          .setPlaceholder("Folder/Changelog.md")
          .setValue(settings.changelogPath);

        text.inputEl.addEventListener("blur", () => {
          const normalized = normalizePath(text.getValue());
          if (!normalized.endsWith(".md")) {
            text.setValue(settings.changelogPath);
            new Notice("Changelog path must end with .md");
            return;
          }
          settings.changelogPath = normalized;
          void this.plugin.saveSettings();
        });

        new PathSuggest(this.app, text.inputEl);
      });

    let datetimePreview: HTMLElement;

    const datetimeSetting = new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js format string")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          .onChange((format) => {
            const nextFormat = format || DEFAULT_SETTINGS.datetimeFormat;
            if (!format) {
              text.setValue(nextFormat);
            }
            settings.datetimeFormat = nextFormat;
            datetimePreview.textContent = `Preview: ${window.moment().format(nextFormat)}`;
            void this.plugin.saveSettings();
          }),
      );

    datetimePreview = datetimeSetting.descEl.createDiv({
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
    });

    new Setting(containerEl)
      .setName("Max recent files")
      .setDesc(
        `Maximum number of recently edited files to include (1\u2013${MAX_RECENT_FILES})`,
      )
      .addText((text) =>
        text.setValue(settings.maxRecentFiles.toString()).onChange((value) => {
          const numValue = Number(value);
          if (Number.isNaN(numValue) || numValue < 1) {
            text.setValue(settings.maxRecentFiles.toString());
            new Notice(
              `Max recent files must be between 1 and ${MAX_RECENT_FILES}`,
            );
            return;
          }
          const flooredValue = Math.min(Math.floor(numValue), MAX_RECENT_FILES);
          settings.maxRecentFiles = flooredValue;
          text.setValue(flooredValue.toString());
          void this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Use wiki-links")
      .setDesc("Format filenames as wiki-links [[note]] instead of plain text")
      .addToggle((toggle) =>
        toggle.setValue(settings.useWikiLinks).onChange((value) => {
          settings.useWikiLinks = value;
          void this.plugin.saveSettings();
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
          .onChange((value) => {
            settings.changelogHeading = value;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Excluded folders").setHeading();

    const excludedFoldersList = containerEl.createDiv("excluded-folders-list");
    this.renderExcludedFolders(excludedFoldersList);

    let folderInputEl: HTMLInputElement;

    new Setting(containerEl)
      .setName("Add excluded folder")
      .setDesc("Folders to exclude from the changelog")
      .addText((text) => {
        text.setPlaceholder("folder/path/");
        folderInputEl = text.inputEl;
        new PathSuggest(this.app, folderInputEl);
      })
      .addButton((button) => {
        button.setButtonText("Add").onClick(() => {
          const folder = normalizePath(folderInputEl.value);
          if (!folder || folder === ".") {
            new Notice(
              "Excluded folder path cannot be empty or the vault root",
            );
            return;
          }
          if (!settings.excludedFolders.includes(folder)) {
            settings.excludedFolders.push(folder);
            void this.plugin.saveSettings();
            folderInputEl.value = "";
            this.renderExcludedFolders(excludedFoldersList);
          }
        });
      });
  }
}
