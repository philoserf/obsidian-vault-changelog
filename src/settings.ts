import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	moment,
	normalizePath,
} from "obsidian";

import ChangelogPlugin from "./main";
import { PathSuggest } from "./suggest";

/**
 * Settings interface for the Vault Changelog plugin
 *
 * Future settings to consider:
 * - Custom entry template (format for each changelog entry)
 * - Group entries by date (create headings for each date)
 * - Exclude files by tag (filter out files with specific tags)
 * - Append mode (add to existing changelog instead of overwriting)
 * - Entry sorting options (beyond just modification time)
 * - Custom file metadata to include (e.g., tags, properties)
 */
export interface ChangelogSettings {
	autoUpdate: boolean;
	changelogPath: string;
	datetimeFormat: string;
	maxRecentFiles: number;
	excludedFolders: string[];
}

/** Define the default settings */
export const DEFAULT_SETTINGS: ChangelogSettings = {
	autoUpdate: false,
	changelogPath: "Changelog.md",
	datetimeFormat: "YYYY-MM-DD[T]HHmm",
	maxRecentFiles: 25,
	excludedFolders: [],
};

/** Define the settings tab */
export class ChangelogSettingsTab extends PluginSettingTab {
	plugin: ChangelogPlugin;

	constructor(app: App, plugin: ChangelogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Helper method to render the list of excluded folders
	 * @param container The HTML element to render into
	 */
	renderExcludedFolders(container: HTMLElement) {
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
				const index =
					this.plugin.settings.excludedFolders.indexOf(folder);
				if (index > -1) {
					this.plugin.settings.excludedFolders.splice(index, 1);
					await this.plugin.saveSettings();
					this.renderExcludedFolders(container);
				}
			});
		});
	}

	/**
	 * Display the settings tab with all configuration options
	 */
	display() {
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
					} else {
						this.plugin.disableAutoUpdate();
					}
				}),
			);

		/**
		 * Changelog path setting
		 * Controls where the changelog file will be created/updated
		 */
		new Setting(containerEl)
			.setName("Changelog path")
			.setDesc("Relative path including filename and extension")
			.addText((text) => {
				text.setPlaceholder("Folder/Changelog.md")
					.setValue(settings.changelogPath)
					.onChange(async (path) => {
						settings.changelogPath = normalizePath(path);
						await this.plugin.saveSettings();
					});

				// Add path autocompletion
				new PathSuggest(this.app, text.inputEl);
			});

		/**
		 * Datetime format setting
		 * Configures how timestamps appear in the changelog using Moment.js format
		 */
		new Setting(containerEl)
			.setName("Datetime format")
			.setDesc("Moment.js datetime format string")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD[T]HHmm")
					.setValue(settings.datetimeFormat)
					.onChange(async (format) => {
						// Attempt to format current date with the new format string
						// Returns "Invalid date" if the format is invalid
						const isValid =
							moment().format(format) !== "Invalid date";

						if (!isValid) {
							// Revert to previous valid format and notify user
							text.setValue(settings.datetimeFormat);
							new Notice("Invalid datetime format");
							return;
						}

						// Save valid format and persist settings
						settings.datetimeFormat = format;
						await this.plugin.saveSettings();
					}),
			);

		/**
		 * Maximum recent files setting
		 * Controls how many files to include in the changelog
		 */
		new Setting(containerEl)
			.setName("Max recent files")
			.setDesc("Maximum number of recently edited files to include")
			.addText((text) =>
				text
					.setValue(settings.maxRecentFiles.toString())
					.onChange(async (value) => {
						// Ensure the value is a positive number
						const numValue = Number(value);
						if (isNaN(numValue) || numValue < 1) {
							text.setValue(settings.maxRecentFiles.toString());
							return;
						}
						settings.maxRecentFiles = numValue;
						await this.plugin.saveSettings();
					}),
			);

		/** Excluded folders section header */
		containerEl.createEl("h3", { text: "Excluded folders" });

		/** Create a list of currently excluded folders with delete buttons */
		const excludedFoldersList = containerEl.createDiv(
			"excluded-folders-list",
		);
		this.renderExcludedFolders(excludedFoldersList);

		/**
		 * Add a new excluded folder with path suggestions
		 * Allows users to specify folders to exclude from the changelog
		 */
		new Setting(containerEl)
			.setName("Add excluded folder")
			.setDesc("Folders to exclude from the changelog")
			.addText((text) => {
				text.setPlaceholder("folder/path/");

				// Add path autocompletion
				new PathSuggest(this.app, text.inputEl);
			})
			.addButton((button) => {
				button.setButtonText("Add").onClick(async () => {
					const input =
						button.buttonEl.parentElement?.querySelector("input");
					if (input) {
						const folderPath = input.value;
						if (
							folderPath &&
							!settings.excludedFolders.includes(folderPath)
						) {
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
