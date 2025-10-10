/**
 * main.ts - Core implementation of the Vault Changelog Obsidian plugin
 *
 * This file contains the primary plugin class that tracks file modifications
 * in an Obsidian vault and maintains a chronological changelog of recently
 * edited notes. It handles file system events, changelog generation, and
 * implements the plugin lifecycle methods.
 */

import { Notice, Plugin, TAbstractFile, TFile, debounce } from "obsidian";

import {
	type ChangelogSettings,
	ChangelogSettingsTab,
	DEFAULT_SETTINGS,
} from "./settings";

/**
 * Main plugin class that handles tracking file changes and updating the changelog
 * Extends Obsidian's Plugin class and implements all core functionality
 */
export default class ChangelogPlugin extends Plugin {
	/** Plugin settings configuration */
	settings: ChangelogSettings = DEFAULT_SETTINGS;

	/**
	 * Initializes the plugin when Obsidian loads it
	 * Sets up settings, commands, styles, and event listeners
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2188|Plugin.loadData}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2207|Plugin.addSettingTab}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2149|Plugin.addCommand}
	 */
	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ChangelogSettingsTab(this.app, this));

		// Register the manual update command
		this.addCommand({
			id: "update-changelog",
			name: "Update Changelog",
			callback: () => this.updateChangelog(),
		});

		this.loadStyles();

		// Debounce vault change handler to prevent excessive updates
		this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);
		this.enableAutoUpdate();
	}

	/**
	 * Handles cleanup when plugin is disabled
	 * No manual cleanup needed as Obsidian handles event listener cleanup
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2140|Plugin.unload}
	 */
	onunload() {
		// Cleanup happens automatically
	}

	/**
	 * Loads the plugin's CSS styles from the styles.css file
	 */
	async loadStyles() {
		const cssFile = await this.app.vault.adapter.read(
			this.manifest.dir + "/styles.css",
		);
		this.registerStyles(cssFile);
	}

	/**
	 * Registers CSS styles by creating a style element and appending it to the document
	 * @param cssText - The CSS content to add to the document
	 */
	registerStyles(cssText: string) {
		const styleEl = document.createElement("style");
		styleEl.textContent = cssText;
		this.register(() => styleEl.remove());
		document.head.appendChild(styleEl);
	}

	/**
	 * Enables automatic changelog updates by registering file system event listeners
	 * Only registers events if autoUpdate is enabled in settings
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2175|Plugin.registerEvent}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3250|Vault.on}
	 */
	enableAutoUpdate() {
		if (this.settings.autoUpdate) {
			// Handler for modify events
			this.registerEvent(
				this.app.vault.on("modify", (file: TAbstractFile) => {
					if (file instanceof TFile) {
						this.onVaultChange(file);
					}
				}),
			);

			// Handler for delete events
			this.registerEvent(
				this.app.vault.on("delete", (file: TAbstractFile) => {
					if (file instanceof TFile) {
						this.onVaultChange(file);
					}
				}),
			);

			// Handler for rename events (has different signature with oldPath parameter)
			this.registerEvent(
				this.app.vault.on("rename", (file: TAbstractFile) => {
					if (file instanceof TFile) {
						this.onVaultChange(file);
					}
				}),
			);
		}
	}

	/**
	 * Event handler for vault file changes
	 * Triggers changelog update when any file except the changelog itself changes
	 * @param file - The file that changed
	 */
	onVaultChange(file: TFile) {
		if (file.path !== this.settings.changelogPath) {
			this.updateChangelog();
		}
	}

	/**
	 * Updates the changelog file with the latest list of recently edited files
	 * Generates changelog content and writes it to the configured file path
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts|Obsidian API}
	 */
	async updateChangelog() {
		const changelog = await this.generateChangelog();
		await this.writeToFile(this.settings.changelogPath, changelog);
	}

	/**
	 * Generates the changelog content by formatting a list of recently edited files
	 * @returns A formatted string containing the changelog content
	 */
	async generateChangelog() {
		const recentFiles = this.getRecentlyEditedFiles();

		let changelogContent = "";
		recentFiles.forEach((file) => {
			// Use window.moment to prevent TypeScript error with the imported moment
			const m = window.moment(file.stat.mtime);
			const formattedTime = m.format(this.settings.datetimeFormat);

			// Format filename based on useWikiLinks setting
			const fileName = this.settings.useWikiLinks
				? `[[${file.basename}]]`
				: file.basename;

			changelogContent += `- ${formattedTime} · ${fileName}\n`;
		});

		return changelogContent;
	}

	/**
	 * Gets the list of recently edited markdown files in the vault
	 * Excludes the changelog file itself and any files in excluded folders
	 * @returns A sorted array of TFile objects, limited to maxRecentFiles
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3326|Vault.getMarkdownFiles}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L797|TFile}
	 */
	getRecentlyEditedFiles() {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => {
				// Exclude the changelog file itself
				if (file.path === this.settings.changelogPath) {
					return false;
				}

				// Exclude files in excluded folders
				for (const folder of this.settings.excludedFolders) {
					if (file.path.startsWith(folder)) {
						return false;
					}
				}

				return true;
			})
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, this.settings.maxRecentFiles);
	}

	/**
	 * Writes content to a file at the specified path
	 * Creates the file if it doesn't exist, otherwise modifies it
	 * @param path - The path to write to
	 * @param content - The content to write
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3340|Vault.getAbstractFileByPath}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3284|Vault.create}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3296|Vault.modify}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L2869|Notice}
	 */
	async writeToFile(path: string, content: string) {
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

	/**
	 * Loads saved settings from disk and merges them with default settings
	 */
	async loadSettings() {
		const loadedSettings = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedSettings,
		};
	}

	/**
	 * Saves current settings to disk
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}
