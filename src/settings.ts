import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import ChangelogPlugin from "./main";

export interface ChangelogSettings {
	autoUpdate: boolean;
	changelogPath: string;
	datetimeFormat: string;
	maxRecentFiles: number;
}

export const DEFAULT_SETTINGS: ChangelogSettings = {
	autoUpdate: false,
	changelogPath: "Changelog.md",
	datetimeFormat: "YYYY-MM-DD[T]HHmm",
	maxRecentFiles: 25,
};

export class ChangelogSettingsTab extends PluginSettingTab {
	plugin: ChangelogPlugin;

	constructor(app: App, plugin: ChangelogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

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

		new Setting(containerEl)
			.setName("Changelog path")
			.setDesc("Relative path including filename and extension")
			.addText((text) =>
				text
					.setPlaceholder("Folder/Changelog.md")
					.setValue(settings.changelogPath)
					.onChange(async (path) => {
						settings.changelogPath = normalizePath(path);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Datetime format")
			.setDesc("Moment.js datetime format string")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD[T]HHmm")
					.setValue(settings.datetimeFormat)
					.onChange(async (format) => {
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
						settings.maxRecentFiles = Number(value);
						await this.plugin.saveSettings();
					}),
			);
	}
}
