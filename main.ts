import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  debounce,
  TFile,
} from "obsidian";
import type moment from "moment";

const DEFAULT_SETTINGS: ChangelogSettings = {
  numberOfFilesToShow: 10,
  changelogFilePath: "",
  watchVaultChange: false,
  excludePaths: "",
};

declare global {
  interface Window {
    app: App;
    moment: typeof moment;
  }
}

export default class Changelog extends Plugin {
  settings: ChangelogSettings;

  async onload() {
    console.log("Loading Changelog plugin");

    await this.loadSettings();

    this.addSettingTab(new ChangelogSettingsTab(this.app, this));

    this.addCommand({
      id: "update",
      name: "update",
      callback: () => this.writeChangelog(),
      hotkeys: [],
    });

    this.watchVaultChange = debounce(
      this.watchVaultChange.bind(this),
      200,
      false
    );
    this.registerWatchVaultEvents();
  }

  registerWatchVaultEvents() {
    if (this.settings.watchVaultChange) {
      this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
      this.registerEvent(this.app.vault.on("delete", this.watchVaultChange));
      this.registerEvent(this.app.vault.on("rename", this.watchVaultChange));
    } else {
      this.app.vault.off("modify", this.watchVaultChange);
      this.app.vault.off("delete", this.watchVaultChange);
      this.app.vault.off("rename", this.watchVaultChange);
    }
  }

  watchVaultChange(file: any) {
    if (file.path === this.settings.changelogFilePath) {
      return;
    } else {
      this.writeChangelog();
    }
  }

  async writeChangelog() {
    const changelog = this.buildChangelog();
    await this.writeInFile(this.settings.changelogFilePath, changelog);
  }

  buildChangelog(): string {
    const pathsToExclude = this.settings.excludePaths.split(',');
    const cache = this.app.metadataCache;
    const files = this.app.vault.getMarkdownFiles();
    const recentlyEditedFiles = files
      // Remove changelog file from recentlyEditedFiles list
      .filter(
        (recentlyEditedFile) =>
          recentlyEditedFile.path !== this.settings.changelogFilePath
      )
      // Remove files from paths to be excluded from recentlyEditedFiles list
      .filter(
        function (recentlyEditedFile) {
          let i;
          let keep = true;
          for (i = 0; i < pathsToExclude.length; i++) {
            if (recentlyEditedFile.path.startsWith(pathsToExclude[i].trim())) {
              keep = false;
              break;
            }
          }
          return keep;
        }
      )
      // exclude if specifically told not to
      .filter(
        function (recentlyEditedFile) {
          const frontMatter = cache.getFileCache(recentlyEditedFile).frontmatter;
          if (frontMatter && frontMatter.publish === false) {
            return false;  
          }
          return true;
         }        
      )
      .sort((a, b) => (a.stat.mtime < b.stat.mtime ? 1 : -1))
      .slice(0, this.settings.numberOfFilesToShow);
    let changelogContent = ``;
    let header = ``;
    for (let recentlyEditedFile of recentlyEditedFiles) {
      // TODO: make date format configurable (and validate it)
      const humanTime = window
        .moment(recentlyEditedFile.stat.mtime)
        // date is already shown in the titles
        .format("YYYY-MM-DD HH[h]mm");
        if (header != humanTime.substring(0,10)) {
        header = humanTime.substring(0,10)
        changelogContent += `## ${header}\n`
      }
      changelogContent += `- ${humanTime.substring(10,16)} · [[${recentlyEditedFile.basename}]]\n`;
    }
    return changelogContent;
  }

  async writeInFile(filePath: string, content: string) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      new Notice("Couldn't write changelog: check the file path");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    console.log("Unloading Changelog plugin");
  }
}

interface ChangelogSettings {
  changelogFilePath: string;
  numberOfFilesToShow: number;
  watchVaultChange: boolean;
  excludePaths: string;
}

class ChangelogSettingsTab extends PluginSettingTab {
  plugin: Changelog;

  constructor(app: App, plugin: Changelog) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("Changelog note location")
      .setDesc("Changelog file absolute path (including the extension)")
      .addText((text) => {
        text
          .setPlaceholder("Example: Folder/Changelog.md")
          .setValue(settings.changelogFilePath)
          .onChange((value) => {
            settings.changelogFilePath = value;
            this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Number of recent files in changelog")
      .setDesc("Number of most recently edited files to show in the changelog")
      .addText((text) =>
        text
          .setValue(String(settings.numberOfFilesToShow))
          .onChange((value) => {
            if (!isNaN(Number(value))) {
              settings.numberOfFilesToShow = Number(value);
              this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Automatically update changelog")
      .setDesc(
        "Automatically update changelog on any vault change (modification, renaming or deletion of a note)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.watchVaultChange)
          .onChange((value) => {
            this.plugin.settings.watchVaultChange = value;
            this.plugin.saveSettings();
            this.plugin.registerWatchVaultEvents();
          })
      );
    
      new Setting(containerEl)
      .setName("Excluded paths")
      .setDesc("Paths or folders to ignore from changelog, separated by a comma")
      .addText((text) => {
        text
          .setPlaceholder("Example: Meetings,People")
          .setValue(settings.excludePaths)
          .onChange((value) => {
            settings.excludePaths = value;
            this.plugin.saveSettings();
          });
      });
  }
}
