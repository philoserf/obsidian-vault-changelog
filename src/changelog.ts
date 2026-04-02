export interface ChangelogSettings {
  autoUpdate: boolean;
  changelogPath: string;
  datetimeFormat: string;
  maxRecentFiles: number;
  excludedFolders: string[];
  useWikiLinks: boolean;
  changelogHeading: string;
}

export const DEFAULT_SETTINGS: ChangelogSettings = {
  autoUpdate: false,
  changelogPath: "Changelog.md",
  datetimeFormat: "YYYY-MM-DD[T]HHmm",
  maxRecentFiles: 25,
  excludedFolders: [],
  useWikiLinks: true,
  changelogHeading: "",
};

interface ChangelogFile {
  path: string;
  basename: string;
  stat: { mtime: number };
}

export function filterAndSort<T extends ChangelogFile>(
  files: T[],
  changelogPath: string,
  excludedFolders: string[],
  maxRecentFiles: number,
): T[] {
  return files
    .filter((file) => {
      if (file.path === changelogPath) return false;
      for (const folder of excludedFolders) {
        if (file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`))
          return false;
      }
      return true;
    })
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, maxRecentFiles);
}

export function generateChangelog(
  files: ChangelogFile[],
  datetimeFormat: string,
  useWikiLinks: boolean,
  changelogHeading: string,
): string {
  let content = changelogHeading ? `${changelogHeading}\n\n` : "";
  for (const file of files) {
    const time = window.moment(file.stat.mtime).format(datetimeFormat);
    const name = useWikiLinks ? `[[${file.basename}]]` : file.basename;
    content += `- ${time} · ${name}\n`;
  }
  return content;
}
