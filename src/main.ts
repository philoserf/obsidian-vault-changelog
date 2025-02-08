import { Notice, Plugin, TFile, debounce, moment } from "obsidian";

import {
	ChangelogSettings,
	ChangelogSettingsTab,
	DEFAULT_SETTINGS,
} from "./settings";

export default class ChangelogPlugin extends Plugin {
	settings: ChangelogSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ChangelogSettingsTab(this.app, this));

		this.addCommand({
			id: "update-changelog",
			name: "Update Changelog",
			callback: () => this.updateChangelog(),
		});

		this.onVaultChange = debounce(this.onVaultChange.bind(this), 200);
		this.enableAutoUpdate();
	}

	enableAutoUpdate() {
		if (this.settings.autoUpdate) {
			this.registerEvent(this.app.vault.on("modify", this.onVaultChange));
			this.registerEvent(this.app.vault.on("delete", this.onVaultChange));
			this.registerEvent(this.app.vault.on("rename", this.onVaultChange));
		}
	}

	disableAutoUpdate() {
		this.app.vault.off("modify", this.onVaultChange);
		this.app.vault.off("delete", this.onVaultChange);
		this.app.vault.off("rename", this.onVaultChange);
	}

	onVaultChange(file: TFile) {
		if (file.path !== this.settings.changelogPath) {
			this.updateChangelog();
		}
	}

	async updateChangelog() {
		const changelog = await this.generateChangelog();
		await this.writeToFile(this.settings.changelogPath, changelog);
	}

	async generateChangelog() {
		const recentFiles = this.getRecentlyEditedFiles();

		let changelogContent = "";
		recentFiles.forEach((file) => {
			const formattedTime = moment(file.stat.mtime).format(
				this.settings.datetimeFormat,
			);
			changelogContent += `- ${formattedTime} · [[${file.basename}]]\n`;
		});

		return changelogContent;
	}

	getRecentlyEditedFiles() {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path !== this.settings.changelogPath)
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, this.settings.maxRecentFiles);
	}

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

	async loadSettings() {
		const loadedSettings = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedSettings,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
