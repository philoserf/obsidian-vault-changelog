import { AbstractInputSuggest, type App } from "obsidian";

export class PathSuggest extends AbstractInputSuggest<string> {
  inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  getSuggestions(inputStr: string): string[] {
    const lowerCaseInputStr = inputStr.toLowerCase();

    const folders = this.app.vault.getAllFolders();
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.extension === "md");

    const suggestions: string[] = [];

    folders.forEach((folder) => {
      const folderPath = folder.path;
      if (folderPath.toLowerCase().contains(lowerCaseInputStr)) {
        suggestions.push(`${folderPath}/`);
      }
    });

    files.forEach((file) => {
      const filePath = file.path;
      if (filePath.toLowerCase().contains(lowerCaseInputStr)) {
        suggestions.push(filePath);
      }
    });

    return suggestions;
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    this.inputEl.trigger("input");
    this.close();
  }
}
