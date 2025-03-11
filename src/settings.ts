/**
 * settings.ts - Settings management for the Vault Changelog plugin
 *
 * This file defines the plugin's configuration interface, default values,
 * and the settings UI tab. It handles user preferences for:
 * - Auto-updating the changelog
 * - Setting the changelog file path
 * - Configuring datetime formats
 * - Setting maximum number of files to track
 * - Managing excluded folders
 */

import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	normalizePath,
} from "obsidian";

import ChangelogPlugin from "./main";
import { PathSuggest } from "./suggest";

/**
 * Interface defining all configurable settings for the Vault Changelog plugin
 */
export interface ChangelogSettings {
	/** Whether to automatically update the changelog when files are modified */
	autoUpdate: boolean;

	/** Path to the changelog file */
	changelogPath: string;

	/** Format string for timestamps (using Moment.js syntax) */
	datetimeFormat: string;

	/** Maximum number of files to include in the changelog */
	maxRecentFiles: number;

	/** Array of folder paths to exclude from the changelog */
	excludedFolders: string[];
}

/**
 * Default configuration values for the plugin
 */
export const DEFAULT_SETTINGS: ChangelogSettings = {
	autoUpdate: false,
	changelogPath: "Changelog.md",
	datetimeFormat: "YYYY-MM-DD[T]HHmm",
	maxRecentFiles: 25,
	excludedFolders: [],
};

/**
 * Settings tab implementation for the Vault Changelog plugin
 * Provides the UI for configuring all plugin settings
 *
 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2596|PluginSettingTab}
 */
export class ChangelogSettingsTab extends PluginSettingTab {
	/** Reference to the parent plugin instance */
	plugin: ChangelogPlugin;

	/**
	 * Creates a new settings tab instance
	 * @param app - The Obsidian app instance
	 * @param plugin - The plugin instance
	 */
	constructor(app: App, plugin: ChangelogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Renders the list of excluded folders with remove buttons
	 * @param container - The HTML element to render the list into
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
				const index = this.plugin.settings.excludedFolders.indexOf(folder);
				if (index > -1) {
					this.plugin.settings.excludedFolders.splice(index, 1);
					await this.plugin.saveSettings();
					this.renderExcludedFolders(container);
				}
			});
		});
	}

	/**
	 * Renders the settings UI in the Obsidian settings tab
	 * Creates all input elements and handles their change events
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2601|PluginSettingTab.display}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2521|Setting}
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

				// Add path autocompletion
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
						// Attempt to format current date with the new format string
						// Returns "Invalid date" if the format is invalid
						// Use window.moment to prevent TypeScript error
						const m = window.moment();
						const isValid = m.format(format) !== "Invalid date";

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

		// Excluded folders section header
		containerEl.createEl("h3", { text: "Excluded folders" });

		// Create a list of currently excluded folders with delete buttons
		const excludedFoldersList = containerEl.createDiv("excluded-folders-list");
		this.renderExcludedFolders(excludedFoldersList);

		// Add a new excluded folder with path suggestions
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
