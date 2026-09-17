import {
  AbstractInputSuggest,
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";

import {
  clampMaxRecentFiles,
  DEFAULT_SETTINGS,
  isValidChangelogPath,
  MAX_RECENT_FILES,
  validateExcludedFolder,
} from "./changelog";
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

    // Folders only. This suggester serves both the changelog-path field and
    // the excluded-folder field, and neither wants an existing note: the
    // changelog path is overwritten wholesale, so completing to a note is
    // the fast way to lose it, and an excluded *folder* is never a file.
    const paths: string[] = [];
    for (const folder of this.app.vault.getAllFolders()) {
      paths.push(`${folder.path}/`);
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

    this.plugin.settings.excludedFolders.forEach((folder, index) => {
      const folderDiv = container.createDiv("excluded-folder-item");
      folderDiv.createSpan({ text: folder });

      const removeButton = folderDiv.createEl("button", {
        text: "✕",
        cls: "excluded-folder-remove",
        attr: { "aria-label": "Remove excluded folder" },
      });

      removeButton.addEventListener("click", () => {
        // Remove by position, not by value. `indexOf` removed the first row
        // matching the text, so with two rows reading the same folder both
        // buttons deleted the first one. Replacing the array rather than
        // splicing it is also what makes updateSettings' rollback correct --
        // a mutation of the shared array survives restoring the object.
        this.plugin.updateSettings({
          excludedFolders: this.plugin.settings.excludedFolders.filter(
            (_, i) => i !== index,
          ),
        });
        this.renderExcludedFolders(container);
      });
    });
  }

  display(): void {
    const { containerEl } = this;

    // No `const { settings } = this.plugin` here. updateSettings replaces the
    // settings object rather than mutating it, so a binding captured once at
    // display time would be a snapshot that goes stale on the first edit and
    // feeds pre-change values back into the next one. Handlers read
    // `this.plugin.settings` at event time instead.
    containerEl.empty();
    const { settings } = this.plugin; // initial values for the controls only

    new Setting(containerEl)
      .setName("Auto update")
      .setDesc("Automatically update changelog on vault changes")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoUpdate).onChange((value) => {
          this.plugin.updateSettings({ autoUpdate: value });
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
          if (!isValidChangelogPath(normalized)) {
            text.setValue(this.plugin.settings.changelogPath);
            new Notice("Changelog path must end with .md");
            return;
          }
          text.setValue(normalized);
          this.plugin.updateSettings({ changelogPath: normalized });
        });

        new PathSuggest(this.app, text.inputEl);
      });

    // `| null` plus the guard in setDatetimePreview, rather than a bare
    // definite-assignment. The assignment genuinely cannot precede the closure
    // that reads it -- descEl does not exist until the Setting is constructed
    // -- and TypeScript's definite-assignment analysis does not reach into
    // closures, so it raised nothing here and would raise nothing if a later
    // edit broke the ordering. One guard makes the assumption checkable.
    let datetimePreview: HTMLElement | null = null;

    const setDatetimePreview = (format: string): void => {
      if (!datetimePreview) return;
      datetimePreview.textContent = `Preview: ${window.moment().format(format)}`;
    };

    const datetimeSetting = new Setting(containerEl)
      .setName("Datetime format")
      .setDesc("Moment.js format string")
      .addText((text) => {
        text
          .setPlaceholder("YYYY-MM-DD[T]HHmm")
          .setValue(settings.datetimeFormat)
          // Preview only -- no setValue, no save. onChange fires per keystroke,
          // and an empty field is a transient state on the way to a new format,
          // since select-all-then-retype is how a value gets replaced. Writing
          // the default back into the input here moved the caret mid-edit and
          // persisted that default over the user's format before they had typed
          // the first character of its replacement. #175 was this same bug in
          // the field below, fixed the same way.
          .onChange((format) => {
            setDatetimePreview(format || DEFAULT_SETTINGS.datetimeFormat);
          });

        // Commit on blur, matching both sibling text fields. Blur is the point
        // the user has finished, so substituting the default for a field left
        // empty is a decision rather than an interruption.
        text.inputEl.addEventListener("blur", () => {
          const nextFormat = text.getValue() || DEFAULT_SETTINGS.datetimeFormat;
          text.setValue(nextFormat);
          setDatetimePreview(nextFormat);
          this.plugin.updateSettings({ datetimeFormat: nextFormat });
        });
      });

    datetimePreview = datetimeSetting.descEl.createDiv({
      text: `Preview: ${window.moment().format(settings.datetimeFormat)}`,
    });

    new Setting(containerEl)
      .setName("Max recent files")
      .setDesc(
        `Maximum number of recently edited files to include (1\u2013${MAX_RECENT_FILES})`,
      )
      .addText((text) => {
        text.setValue(settings.maxRecentFiles.toString());

        text.inputEl.addEventListener("blur", () => {
          const numValue = Number(text.getValue());
          if (Number.isNaN(numValue) || numValue < 1) {
            text.setValue(this.plugin.settings.maxRecentFiles.toString());
            new Notice(
              `Max recent files must be between 1 and ${MAX_RECENT_FILES}`,
            );
            return;
          }
          const flooredValue = clampMaxRecentFiles(numValue);
          text.setValue(flooredValue.toString());
          this.plugin.updateSettings({ maxRecentFiles: flooredValue });
        });
      });

    new Setting(containerEl)
      .setName("Use wiki-links")
      .setDesc("Format filenames as wiki-links [[note]] instead of plain text")
      .addToggle((toggle) =>
        toggle.setValue(settings.useWikiLinks).onChange((value) => {
          this.plugin.updateSettings({ useWikiLinks: value });
        }),
      );

    new Setting(containerEl)
      .setName("Changelog heading")
      .setDesc(
        "Optional heading to prepend to the changelog, written literally (e.g., # Changelog). Leave empty for no heading.",
      )
      .addText((text) =>
        text
          .setPlaceholder("# Changelog")
          .setValue(settings.changelogHeading)
          .onChange((value) => {
            this.plugin.updateSettings({ changelogHeading: value.trim() });
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
          const existing = this.plugin.settings.excludedFolders;
          const folder = normalizePath(folderInputEl.value);
          const verdict = validateExcludedFolder(folder, existing);
          // Exhaustive, so a fourth verdict cannot be added without the
          // compiler naming this call site. Falling off the end is exactly how
          // "duplicate" went unhandled: no notice, input not cleared, list not
          // re-rendered -- indistinguishable from a dead button.
          switch (verdict) {
            case "invalid":
              new Notice(
                "Excluded folder path cannot be empty or the vault root",
              );
              return;
            case "duplicate":
              new Notice(`"${folder}" is already excluded`);
              folderInputEl.value = "";
              return;
            case "ok":
              // Replaced, not pushed: a push into the shared array would
              // survive updateSettings restoring the previous object, so the
              // rollback would leave the folder in memory but not on disk.
              this.plugin.updateSettings({
                excludedFolders: [...existing, folder],
              });
              folderInputEl.value = "";
              this.renderExcludedFolders(excludedFoldersList);
              return;
            default: {
              const unhandled: never = verdict;
              throw new Error(
                `Unhandled excluded-folder verdict: ${String(unhandled)}`,
              );
            }
          }
        });
      });
  }
}
