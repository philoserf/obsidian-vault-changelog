/**
 * suggest.ts - Path suggestion functionality for the Vault Changelog plugin
 *
 * This file implements autocompletion for file and folder paths in the settings UI.
 * It extends Obsidian's AbstractInputSuggest to provide context-aware path
 * suggestions, helping users select valid locations for their changelog file
 * and excluded folders.
 */

import { AbstractInputSuggest, App } from "obsidian";

/**
 * Provides autocomplete suggestions for file and folder paths
 * Used in settings UI to help users select valid paths
 *
 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L1708|AbstractInputSuggest}
 */
export class PathSuggest extends AbstractInputSuggest<string> {
	/** The input element to attach suggestions to */
	inputEl: HTMLInputElement;

	/**
	 * Creates a new path suggestion provider
	 * @param app - The Obsidian app instance
	 * @param inputEl - The input element to enhance with suggestions
	 */
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	/**
	 * Gets path suggestions based on input string
	 * Searches for both folders and markdown files that match the input
	 * @param inputStr - The current input string to match against
	 * @returns Array of matching path strings
	 *
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3316|Vault.getAllFolders}
	 * @see {@link https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts#L3327|Vault.getFiles}
	 */
	getSuggestions(inputStr: string): string[] {
		const lowerCaseInputStr = inputStr.toLowerCase();

		// Get all folders
		const folders = this.app.vault.getAllFolders();
		const files = this.app.vault
			.getFiles()
			.filter((file) => file.extension === "md");

		const suggestions: string[] = [];

		// Add folder suggestions with trailing slash
		folders.forEach((folder) => {
			const folderPath = folder.path;
			if (folderPath.toLowerCase().contains(lowerCaseInputStr)) {
				suggestions.push(folderPath + "/");
			}
		});

		// Add markdown files
		files.forEach((file) => {
			const filePath = file.path;
			if (filePath.toLowerCase().contains(lowerCaseInputStr)) {
				suggestions.push(filePath);
			}
		});

		return suggestions;
	}

	/**
	 * Renders a suggestion in the dropdown
	 * @param path - The path string to render
	 * @param el - The HTML element to render into
	 */
	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	/**
	 * Handles selection of a suggestion
	 * Updates the input value and triggers input event
	 * @param path - The selected path
	 */
	selectSuggestion(path: string): void {
		this.inputEl.value = path;
		this.inputEl.trigger("input");
		this.close();
	}
}
