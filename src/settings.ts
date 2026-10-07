import {
  type App,
  Notice,
  normalizePath,
  PluginSettingTab,
  type SettingDefinitionItem,
  TFile,
  TFolder,
} from "obsidian";

import {
  type ChangelogSettings,
  changelogPathError,
  DEFAULT_SETTINGS,
  datetimeFormatError,
  excludedFolderError,
  MAX_RECENT_FILES,
  maxRecentFilesError,
} from "./changelog";
import type ChangelogPlugin from "./main";

/** Control keys for list rows are `excludedFolders.<index>`. */
const FOLDER_KEY = /^excludedFolders\.(\d+)$/;

/**
 * Declarative settings (Obsidian 1.13). Each control's `validate` is the
 * field's rule from changelog.ts, so the tab and the loader cannot drift
 * apart (#213). A rejected value shows inline and is never saved. Every
 * accepted change goes through the plugin's one commit path,
 * `updateSettings`, which persists before it assigns (#206).
 */
export class ChangelogSettingsTab extends PluginSettingTab {
  plugin: ChangelogPlugin;
  /** A new, still-empty excluded-folder row the user has asked for. */
  private draftFolderRow = false;
  private datetimePreview: HTMLElement | undefined;

  constructor(app: App, plugin: ChangelogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const { settings } = this.plugin;
    const folders = settings.excludedFolders;
    const rows = this.draftFolderRow ? folders.length + 1 : folders.length;

    return [
      {
        name: "Auto update",
        desc: "Automatically update changelog on vault changes",
        control: { type: "toggle", key: "autoUpdate" },
      },
      {
        name: "Changelog path",
        desc: "Relative path including filename and extension",
        // Not a declarative text control, which may commit on every
        // keystroke. On the way to "Notes.md/Changelog.md" the path passes
        // through "Notes.md", which is valid. With auto-update on, that
        // would write a changelog there mid-typing. This row commits on
        // blur. Not a file control either: that offers existing notes,
        // which the next update would overwrite (#197).
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("Folder/Changelog.md")
              .setValue(this.plugin.settings.changelogPath);
            text.inputEl.addEventListener("blur", () => {
              const next = normalizePath(text.getValue());
              const error = changelogPathError(next);
              if (error) {
                text.setValue(this.plugin.settings.changelogPath);
                new Notice(error);
                return;
              }
              const previous = this.plugin.settings.changelogPath;
              if (next === previous) return;
              void this.plugin
                .updateSettings({ changelogPath: next })
                .then(() => this.noticeOldChangelog(previous));
            });
          });
        },
      },
      {
        name: "Datetime format",
        desc: createFragment((fragment) => {
          fragment.appendText("Moment.js format string. ");
          this.datetimePreview = fragment.createSpan();
          this.showPreview(settings.datetimeFormat);
        }),
        control: {
          type: "text",
          key: "datetimeFormat",
          placeholder: DEFAULT_SETTINGS.datetimeFormat,
          // validate sees every candidate, including the empty ones it
          // rejects, so it is where the preview follows the field (#199).
          validate: (format) => {
            this.showPreview(format);
            return datetimeFormatError(format);
          },
        },
      },
      {
        name: "Max recent files",
        desc: `Maximum number of recently edited files to include (1–${MAX_RECENT_FILES})`,
        // No defaultValue: an unparseable entry then arrives as 0 and is
        // refused, instead of silently becoming the default (#210).
        control: {
          type: "number",
          key: "maxRecentFiles",
          min: 1,
          max: MAX_RECENT_FILES,
          step: 1,
          validate: (value) => maxRecentFilesError(value),
        },
      },
      {
        name: "Use wiki-links",
        desc: "Format filenames as wiki-links [[note]] instead of plain text",
        control: { type: "toggle", key: "useWikiLinks" },
      },
      {
        name: "Changelog heading",
        desc: "Optional heading to prepend to the changelog, written literally (e.g., # Changelog). Leave empty for no heading.",
        control: {
          type: "text",
          key: "changelogHeading",
          placeholder: "# Changelog",
        },
      },
      {
        type: "list",
        heading: "Excluded folders",
        emptyState: "No excluded folders",
        items: Array.from({ length: rows }, (_, index) => ({
          // The path is in the field, so the label does not repeat it (#288).
          // It stays an alias, so settings search still finds the row by path.
          name: index < folders.length ? "Folder" : "New folder",
          ...(folders[index] ? { aliases: [folders[index]] } : {}),
          control: {
            type: "folder" as const,
            key: `excludedFolders.${index}`,
            placeholder: "Folder/path",
            // The shared rule, then the tab's own: a folder the vault does
            // not have would be a row that looks like a rule and excludes
            // nothing (#205).
            validate: (value: string) => {
              const folder = normalizePath(value);
              return (
                excludedFolderError(
                  folder,
                  this.plugin.settings.excludedFolders.filter(
                    (_, other) => other !== index,
                  ),
                ) ??
                (this.app.vault.getAbstractFileByPath(folder) instanceof TFolder
                  ? undefined
                  : "No folder with this path")
              );
            },
          },
        })),
        onDelete: (index) => {
          if (index >= this.plugin.settings.excludedFolders.length) {
            this.draftFolderRow = false;
            this.update();
            return;
          }
          void this.plugin
            .updateSettings((current) => ({
              excludedFolders: current.excludedFolders.filter(
                (_, other) => other !== index,
              ),
            }))
            .then(() => this.update());
        },
        addItem: {
          name: "Add excluded folder",
          action: () => {
            this.draftFolderRow = true;
            this.update();
          },
        },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    const row = FOLDER_KEY.exec(key);
    if (row) return this.plugin.settings.excludedFolders[Number(row[1])] ?? "";
    return this.plugin.settings[key as keyof ChangelogSettings];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const row = FOLDER_KEY.exec(key);
    if (row) {
      const index = Number(row[1]);
      const folder = normalizePath(String(value));
      const savingDraft = index >= this.plugin.settings.excludedFolders.length;
      await this.plugin.updateSettings((current) => {
        const excludedFolders = [...current.excludedFolders];
        excludedFolders[index] = folder;
        return { excludedFolders };
      });
      if (savingDraft) this.draftFolderRow = false;
      this.update();
      return;
    }
    if (key === "changelogHeading") {
      await this.plugin.updateSettings({
        changelogHeading: String(value).trim(),
      });
      return;
    }
    await this.plugin.updateSettings({ [key]: value });
  }

  /**
   * The changelog path moved away from `previous`. A changelog left there is
   * now an ordinary note, and it will be listed in the new changelog like any
   * other. Say so, and leave it alone: deleting or rewriting it would mean
   * guessing whose file it is, which the plugin never does (#271, #250).
   */
  private noticeOldChangelog(previous: string): void {
    if (this.plugin.settings.changelogPath === previous) return; // the save failed
    if (!(this.app.vault.getAbstractFileByPath(previous) instanceof TFile)) {
      return;
    }
    new Notice(
      `The previous changelog at ${previous} is now an ordinary note. Delete it if you no longer need it.`,
    );
  }

  private showPreview(format: string): void {
    if (!this.datetimePreview) return;
    const shown = datetimeFormatError(format)
      ? DEFAULT_SETTINGS.datetimeFormat
      : format;
    this.datetimePreview.setText(`Preview: ${window.moment().format(shown)}`);
  }
}
