import { AbstractInputSuggest, App } from "obsidian";

/**
 * Path suggestion provider for file path inputs
 *
 * Enhancements to consider:
 * - Create a TagSuggest class for tag exclusion feature
 * - Improve prioritization of suggestions for changelog paths
 * - Add smarter filtering based on context (e.g., folder vs file)
 * - Add icons to differentiate between files and folders in suggestions
 */
export class PathSuggest extends AbstractInputSuggest<string> {
	inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	/**
	 * Get suggestions based on user input
	 * @param inputStr The current input string to match against
	 * @returns Array of matching path suggestions
	 */
	getSuggestions(inputStr: string): string[] {
		const lowerCaseInputStr = inputStr.toLowerCase();

		/**
		 * Get all folders and markdown files from the vault
		 */
		const folders = this.app.vault.getAllFolders();
		const files = this.app.vault
			.getFiles()
			.filter((file) => file.extension === "md");

		const suggestions: string[] = [];

		/**
		 * Add folder suggestions with trailing slash
		 * Folders are appended with "/" to indicate they are directories
		 */
		folders.forEach((folder) => {
			const folderPath = folder.path;
			if (folderPath.toLowerCase().contains(lowerCaseInputStr)) {
				suggestions.push(folderPath + "/");
			}
		});

		/**
		 * Add markdown files to suggestions
		 * Only includes files with .md extension
		 */
		files.forEach((file) => {
			const filePath = file.path;
			if (filePath.toLowerCase().contains(lowerCaseInputStr)) {
				suggestions.push(filePath);
			}
		});

		return suggestions;
	}

	/**
	 * Render the suggestion in the dropdown
	 *
	 * @param path The path to render
	 * @param el The HTML element to render into
	 */
	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	/**
	 * Handle suggestion selection
	 * Updates the input field and triggers input event
	 *
	 * @param path The selected path
	 */
	selectSuggestion(path: string): void {
		this.inputEl.value = path;
		this.inputEl.trigger("input");
		this.close();
	}
}
