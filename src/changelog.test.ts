import { afterAll, describe, expect, test } from "bun:test";
import moment from "moment";

import {
  type ChangelogSettings,
  changelogPathError,
  clampMaxRecentFiles,
  DEFAULT_SETTINGS,
  datetimeFormatError,
  excludedFolderError,
  filterAndSort,
  maxRecentFilesError,
  normalizeLoadedSettings,
  renderChangelog,
  type VaultEventEffect,
  vaultEventEffect,
  withExcludedFolder,
} from "./changelog";

const formatter = (mtime: number, fmt: string) => moment(mtime).format(fmt);
// Path normalizers to inject into the loader: none, and the one behaviour of
// Obsidian's normalizePath the tests rely on.
const identity = (p: string) => p;
const stripTrailing = (p: string) => p.replace(/\/+$/, "");

describe("filterAndSort", () => {
  const files = [
    { path: "Note A.md", basename: "Note A", stat: { mtime: 100 } },
    { path: "Note B.md", basename: "Note B", stat: { mtime: 300 } },
    { path: "Note C.md", basename: "Note C", stat: { mtime: 200 } },
    { path: "Changelog.md", basename: "Changelog", stat: { mtime: 400 } },
    {
      path: "Archive/Old Note.md",
      basename: "Old Note",
      stat: { mtime: 500 },
    },
  ];

  test("excludes the changelog file", () => {
    const result = filterAndSort(files, "Changelog.md", [], 25);
    expect(result.find((f) => f.path === "Changelog.md")).toBeUndefined();
  });

  test("excludes files in excluded folders", () => {
    // normalizePath strips trailing slashes, so "Archive" is the only shape
    // the settings layer persists (#307).
    const result = filterAndSort(files, "Changelog.md", ["Archive"], 25);
    expect(result.find((f) => f.path.startsWith("Archive/"))).toBeUndefined();
  });

  test("sorts by mtime descending", () => {
    const result = filterAndSort(files, "Changelog.md", ["Archive"], 25);
    expect(result.map((f) => f.basename)).toEqual([
      "Note B",
      "Note C",
      "Note A",
    ]);
  });

  test("limits to maxRecentFiles", () => {
    const result = filterAndSort(files, "Changelog.md", [], 2);
    expect(result).toHaveLength(2);
  });

  test("does not exclude folders that share a prefix", () => {
    const filesWithPrefix = [
      { path: "Notes/file.md", basename: "file", stat: { mtime: 100 } },
      { path: "Notes2/file.md", basename: "file2", stat: { mtime: 200 } },
      { path: "Notebook/file.md", basename: "file3", stat: { mtime: 300 } },
    ];
    const result = filterAndSort(
      filesWithPrefix,
      "Changelog.md",
      ["Notes"],
      25,
    );
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      "Notebook/file.md",
      "Notes2/file.md",
    ]);
  });
});

describe("renderChangelog", () => {
  const files = [
    {
      path: "Note B.md",
      basename: "Note B",
      stat: { mtime: new Date("2026-01-15T14:30:00").getTime() },
    },
    {
      path: "Note A.md",
      basename: "Note A",
      stat: { mtime: new Date("2026-01-15T14:00:00").getTime() },
    },
  ];
  const basename = (file: { basename: string }) => file.basename;
  const settings = (overrides: Partial<ChangelogSettings> = {}) => ({
    ...DEFAULT_SETTINGS,
    excludedFolders: [],
    ...overrides,
  });

  test("renders with wiki-links and no heading", () => {
    expect(renderChangelog(files, settings(), formatter, basename)).toBe(
      "- 2026-01-15T1430 · [[Note B]]\n- 2026-01-15T1400 · [[Note A]]\n",
    );
  });

  test("renders without wiki-links", () => {
    expect(
      renderChangelog(
        files,
        settings({ useWikiLinks: false }),
        formatter,
        basename,
      ),
    ).toBe("- 2026-01-15T1430 · Note B\n- 2026-01-15T1400 · Note A\n");
  });

  test("renders a heading", () => {
    expect(
      renderChangelog(
        files,
        settings({ changelogHeading: "# Changelog" }),
        formatter,
        basename,
      ),
    ).toStartWith("# Changelog\n\n");
  });

  test("trims the heading, and a blank heading is no heading (#310)", () => {
    expect(
      renderChangelog(
        files,
        settings({ changelogHeading: "  # Changelog \n" }),
        formatter,
        basename,
      ),
    ).toStartWith("# Changelog\n\n- ");
    expect(
      renderChangelog(
        files,
        settings({ changelogHeading: "   " }),
        formatter,
        basename,
      ),
    ).toStartWith("- ");
  });

  test("renders an empty changelog", () => {
    expect(renderChangelog([], settings(), formatter, basename)).toBe("");
  });

  test("filters before it formats (#195)", () => {
    const result = renderChangelog(
      [
        ...files,
        { path: "Changelog.md", basename: "Changelog", stat: { mtime: 9e12 } },
        { path: "Archive/Old.md", basename: "Old", stat: { mtime: 9e12 } },
      ],
      settings({ excludedFolders: ["Archive"], maxRecentFiles: 1 }),
      formatter,
      basename,
    );
    expect(result).toBe("- 2026-01-15T1430 · [[Note B]]\n");
  });

  describe("notes that share a basename (#202)", () => {
    const twins = [
      {
        path: "Projects/Meeting Notes.md",
        basename: "Meeting Notes",
        stat: { mtime: new Date("2026-01-15T14:30:00").getTime() },
      },
      {
        path: "Archive/Meeting Notes.md",
        basename: "Meeting Notes",
        stat: { mtime: new Date("2026-01-15T14:00:00").getTime() },
      },
      {
        path: "Solo.md",
        basename: "Solo",
        stat: { mtime: new Date("2026-01-15T13:00:00").getTime() },
      },
    ];

    test("wiki-links carry whatever link text the vault resolves", () => {
      const vaultLinkText = (file: { path: string; basename: string }) =>
        file.basename === "Solo" ? "Solo" : file.path.replace(/\.md$/, "");
      expect(renderChangelog(twins, settings(), formatter, vaultLinkText)).toBe(
        "- 2026-01-15T1430 · [[Projects/Meeting Notes]]\n" +
          "- 2026-01-15T1400 · [[Archive/Meeting Notes]]\n" +
          "- 2026-01-15T1300 · [[Solo]]\n",
      );
    });

    test("plain text names a repeated basename by path, and only that one", () => {
      expect(
        renderChangelog(
          twins,
          settings({ useWikiLinks: false }),
          formatter,
          basename,
        ),
      ).toBe(
        "- 2026-01-15T1430 · Projects/Meeting Notes.md\n" +
          "- 2026-01-15T1400 · Archive/Meeting Notes.md\n" +
          "- 2026-01-15T1300 · Solo\n",
      );
    });
  });

  // 1.8.0's renderer, frozen verbatim. Wherever no two listed notes share a
  // basename, 2.0.0 must render byte-for-byte what 1.8.0 did. The real-vault
  // fixtures (#263) check the same promise against files 1.8.0 wrote.
  function render180(
    list: { basename: string; stat: { mtime: number } }[],
    datetimeFormat: string,
    useWikiLinks: boolean,
    changelogHeading: string,
    formatTime: (mtime: number, format: string) => string,
  ): string {
    let content = changelogHeading ? `${changelogHeading}\n\n` : "";
    for (const file of list) {
      const time = formatTime(file.stat.mtime, datetimeFormat);
      const name = useWikiLinks ? `[[${file.basename}]]` : file.basename;
      content += `- ${time} · ${name}\n`;
    }
    return content;
  }

  test("matches 1.8.0 byte for byte when no basenames repeat", () => {
    const vault = Array.from({ length: 40 }, (_, i) => ({
      path: `${i % 3 ? "Notes" : "Archive"}/Note ${i}.md`,
      basename: `Note ${i}`,
      stat: { mtime: Date.UTC(2026, 0, 1) + i * 37 * 60_000 },
    }));
    for (const useWikiLinks of [true, false]) {
      for (const changelogHeading of ["", "# Changelog"]) {
        for (const datetimeFormat of ["YYYY-MM-DD[T]HHmm", "HH:mm"]) {
          const s = settings({
            useWikiLinks,
            changelogHeading,
            datetimeFormat,
            excludedFolders: ["Archive"],
            maxRecentFiles: 10,
          });
          const listed = filterAndSort(
            vault,
            s.changelogPath,
            s.excludedFolders,
            s.maxRecentFiles,
          );
          expect(renderChangelog(vault, s, formatter, basename)).toBe(
            render180(
              listed,
              datetimeFormat,
              useWikiLinks,
              changelogHeading,
              formatter,
            ),
          );
        }
      }
    }
  });
});

describe("clampMaxRecentFiles", () => {
  test("returns a valid in-range integer as-is", () => {
    expect(clampMaxRecentFiles(25)).toBe(25);
    expect(clampMaxRecentFiles(1)).toBe(1);
    expect(clampMaxRecentFiles(500)).toBe(500);
  });

  test("floors floats", () => {
    expect(clampMaxRecentFiles(25.9)).toBe(25);
  });

  test("clamps below 1 to 1", () => {
    expect(clampMaxRecentFiles(0)).toBe(1);
    expect(clampMaxRecentFiles(-5)).toBe(1);
    expect(clampMaxRecentFiles(0.4)).toBe(1);
  });

  test("clamps above the maximum", () => {
    expect(clampMaxRecentFiles(1000)).toBe(500);
  });

  test("accepts numeric strings", () => {
    expect(clampMaxRecentFiles("42")).toBe(42);
  });

  test("falls back to the default for non-finite input", () => {
    expect(clampMaxRecentFiles(Number.NaN)).toBe(25);
    expect(clampMaxRecentFiles("abc")).toBe(25);
    expect(clampMaxRecentFiles(Number.POSITIVE_INFINITY)).toBe(25);
    expect(clampMaxRecentFiles(undefined)).toBe(25);
  });

  test("falls back for every non-numeric value (#209)", () => {
    for (const bad of [null, "", "  ", [], false, true, {}]) {
      expect(clampMaxRecentFiles(bad)).toBe(DEFAULT_SETTINGS.maxRecentFiles);
    }
  });
});

describe("normalizeLoadedSettings", () => {
  test("drops unknown keys", () => {
    const settings = normalizeLoadedSettings(
      { autoUpdate: true, legacySetting: "stale" },
      identity,
    );
    expect(settings.autoUpdate).toBe(true);
    expect("legacySetting" in settings).toBe(false);
  });

  test("normalizes changelogPath and excludedFolders", () => {
    const settings = normalizeLoadedSettings(
      {
        changelogPath: "Notes/Changelog.md/",
        excludedFolders: ["Archive/", "Templates/"],
      },
      stripTrailing,
    );
    expect(settings.changelogPath).toBe("Notes/Changelog.md");
    expect(settings.excludedFolders).toEqual(["Archive", "Templates"]);
  });

  test("clamps maxRecentFiles through clampMaxRecentFiles", () => {
    expect(
      normalizeLoadedSettings({ maxRecentFiles: 9999 }, identity)
        .maxRecentFiles,
    ).toBe(500);
  });

  test("keeps the heading as persisted; render trims it (#310)", () => {
    const settings = normalizeLoadedSettings(
      { changelogHeading: "  # Changelog \n" },
      identity,
    );
    expect(settings.changelogHeading).toBe("  # Changelog \n");
  });

  test("falls back to defaults when known keys have the wrong type", () => {
    const settings = normalizeLoadedSettings(
      {
        changelogPath: 42,
        excludedFolders: null,
        changelogHeading: 42,
        datetimeFormat: 42,
      },
      identity,
    );
    expect(settings.changelogPath).toBe(DEFAULT_SETTINGS.changelogPath);
    expect(settings.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
    expect(settings.changelogHeading).toBe(DEFAULT_SETTINGS.changelogHeading);
    expect(settings.datetimeFormat).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });

  test("falls back for excludedFolders when it contains non-string entries", () => {
    const settings = normalizeLoadedSettings(
      { excludedFolders: ["Archive/", 42] },
      identity,
    );
    expect(settings.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
  });

  test("falls back to defaults when boolean keys have the wrong type", () => {
    const settings = normalizeLoadedSettings(
      { autoUpdate: "false", useWikiLinks: "true" },
      identity,
    );
    expect(settings.autoUpdate).toBe(DEFAULT_SETTINGS.autoUpdate);
    expect(settings.useWikiLinks).toBe(DEFAULT_SETTINGS.useWikiLinks);
  });

  test("never hands out the default excludedFolders array (#266)", () => {
    expect(normalizeLoadedSettings(null, identity).excludedFolders).not.toBe(
      DEFAULT_SETTINGS.excludedFolders,
    );
    expect(normalizeLoadedSettings({}, identity).excludedFolders).not.toBe(
      DEFAULT_SETTINGS.excludedFolders,
    );
    expect(
      normalizeLoadedSettings({ excludedFolders: [1] }, identity)
        .excludedFolders,
    ).not.toBe(DEFAULT_SETTINGS.excludedFolders);
  });

  test("loads excluded folders that normalize alike as one (#211)", () => {
    expect(
      normalizeLoadedSettings(
        { excludedFolders: ["Archive/", "Archive"] },
        stripTrailing,
      ).excludedFolders,
    ).toEqual(["Archive"]);
  });
});

describe("vaultEventEffect (#313)", () => {
  const cases: [string, string, string | undefined, VaultEventEffect][] = [
    ["a markdown note changes", "Notes/Idea.md", undefined, "refresh"],
    ["a non-markdown file changes", "Assets/pic.png", undefined, "ignore"],
    ["the changelog itself changes", "Changelog.md", undefined, "ignore"],
    ["a note is renamed", "Notes/New.md", "Notes/Old.md", "refresh"],
    [
      "the changelog moves",
      "Logs/Changelog.md",
      "Changelog.md",
      { follow: "Logs/Changelog.md" },
    ],
    [
      "the changelog is renamed to non-markdown (#299)",
      "Changelog.txt",
      "Changelog.md",
      { cannotFollow: "Changelog.txt" },
    ],
    [
      "a note is renamed onto the changelog path",
      "Changelog.md",
      "Notes/Old.md",
      "ignore",
    ],
    // Its row leaves the changelog, and only oldPath shows it was a row.
    [
      "a note is renamed away from markdown (#299)",
      "Idea.txt",
      "Idea.md",
      "refresh",
    ],
    ["a non-markdown file is renamed", "pic2.png", "pic.png", "ignore"],
  ];
  for (const [when, path, oldPath, effect] of cases) {
    test(when, () => {
      expect(vaultEventEffect(path, oldPath, "Changelog.md")).toEqual(effect);
    });
  }
});

describe("changelogPathError", () => {
  test("accepts a markdown path", () => {
    expect(changelogPathError("Notes/Changelog.md")).toBeUndefined();
  });

  test("rejects non-markdown paths", () => {
    expect(changelogPathError("Changelog.txt")).toBeString();
    expect(changelogPathError("Changelog")).toBeString();
  });
});

describe("datetimeFormatError", () => {
  test("accepts a format", () => {
    expect(datetimeFormatError("YYYY-MM-DD")).toBeUndefined();
  });

  test("rejects an empty or blank format", () => {
    expect(datetimeFormatError("")).toBeString();
    expect(datetimeFormatError("   ")).toBeString();
  });
});

describe("maxRecentFilesError", () => {
  test("accepts whole numbers in range, typed or numeric", () => {
    for (const ok of [1, 25, 500, "42"]) {
      expect(maxRecentFilesError(ok)).toBeUndefined();
    }
  });

  test("refuses what the load coercion would silently clamp or replace", () => {
    for (const bad of [0, -5, 501, 2.5, "abc", "", null, Number.NaN]) {
      expect(maxRecentFilesError(bad)).toBeString();
    }
  });
});

describe("loading settings by rule", () => {
  test("missing or non-object data loads as the defaults", () => {
    for (const raw of [null, undefined, "junk", 42, true, []]) {
      expect(normalizeLoadedSettings(raw, identity)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test("root entries are dropped from excludedFolders on load (#204)", () => {
    expect(
      normalizeLoadedSettings(
        { excludedFolders: ["", ".", "Archive", "/", "./"] },
        identity,
      ).excludedFolders,
    ).toEqual(["Archive"]);
  });

  test("a valid persisted path and format load unchanged", () => {
    const settings = normalizeLoadedSettings(
      { changelogPath: "Logs/Recent.md", datetimeFormat: "HH:mm" },
      identity,
    );
    expect(settings.changelogPath).toBe("Logs/Recent.md");
    expect(settings.datetimeFormat).toBe("HH:mm");
  });

  test("a persisted invalid changelogPath is kept, never replaced by the default (#298)", () => {
    // The default names a note, possibly the user's own. Loading an invalid
    // path keeps it, and the write refuses it, rather than guessing.
    for (const saved of ["Notes", "Logs/changes", "Changelog.txt"]) {
      expect(
        normalizeLoadedSettings({ changelogPath: saved }, identity)
          .changelogPath,
      ).toBe(saved);
    }
  });

  test("a missing or blank changelogPath loads the default (#298)", () => {
    for (const raw of [{}, { changelogPath: "" }, { changelogPath: "  " }]) {
      expect(normalizeLoadedSettings(raw, identity).changelogPath).toBe(
        DEFAULT_SETTINGS.changelogPath,
      );
    }
  });

  test("a persisted empty datetimeFormat falls back on load (#213)", () => {
    expect(
      normalizeLoadedSettings({ datetimeFormat: "" }, identity).datetimeFormat,
    ).toBe(DEFAULT_SETTINGS.datetimeFormat);
  });
});

describe("excludedFolderError", () => {
  test("accepts a folder the list does not have", () => {
    expect(excludedFolderError("Archive", [])).toBeUndefined();
    expect(excludedFolderError("Notes/Daily", ["Archive"])).toBeUndefined();
  });

  test("refuses every spelling of the vault root (#204)", () => {
    for (const root of ["", ".", "./", "/"]) {
      expect(excludedFolderError(root, [])).toBeString();
    }
  });

  test("refuses a folder already listed (#203)", () => {
    expect(excludedFolderError("Archive", ["Archive"])).toBeString();
  });
});

// The settings tab draws rows, and the edit reaches the list later, inside
// the save queue, against whatever the list holds by then. So an edit names
// the row by the value it showed, never by its position (#312).
describe("excluded-folder row edits (#296)", () => {
  test("a new row appends, even after the list got shorter", () => {
    // The draft row was drawn at index 3 of [A, B, C]. A delete of A is
    // saved first. By position the save would leave a hole (#296).
    const result = withExcludedFolder(["B", "C"], undefined, "X");
    expect(result).toEqual(["B", "C", "X"]);
    expect(result.every((folder) => typeof folder === "string")).toBe(true);
  });

  test("an edited row replaces the value it showed, wherever it is now", () => {
    expect(withExcludedFolder(["A", "B"], "B", "Z")).toEqual(["A", "Z"]);
    expect(withExcludedFolder(["B"], "B", "Z")).toEqual(["Z"]);
  });

  test("an edited row whose value is gone appends the new value", () => {
    expect(withExcludedFolder(["A"], "B", "Z")).toEqual(["A", "Z"]);
  });

  test("the rule is checked again against the list the edit lands on", () => {
    // Two rows set to the same folder before either save lands (#296).
    const first = withExcludedFolder([], undefined, "Archive");
    expect(withExcludedFolder(first, undefined, "Archive")).toEqual([
      "Archive",
    ]);
    expect(withExcludedFolder(["A"], undefined, "/")).toEqual(["A"]);
  });
});

// Real output from 1.8.0, captured in a vault on Obsidian 1.14.4 (#263): for
// each scenario, every markdown file's path, name and mtime, the settings,
// the time zone, and the changelog 1.8.0 wrote. Replaying the same input must
// give the same bytes.
interface Fixture {
  name: string;
  timeZone: string;
  settings: ChangelogSettings;
  files: { path: string; basename: string; mtime: number }[];
  output: string;
}
const fixtures180: Fixture[] = await Bun.file(
  new URL("./fixtures/1.8.0.json", import.meta.url),
).json();

describe("1.8.0 fixtures (#263)", () => {
  const savedTimeZone = process.env.TZ;
  afterAll(() => {
    if (savedTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = savedTimeZone;
  });

  test("cover every captured scenario", () => {
    expect(fixtures180.map((f) => f.name)).toEqual([
      "with-entries",
      "no-eligible-notes",
      "no-eligible-notes-with-heading",
      "heading-set",
      "heading-changed",
      "wiki-links-off",
      "colliding-basenames",
      "colliding-basenames-plain",
    ]);
  });

  for (const fixture of fixtures180) {
    test(`renders what 1.8.0 wrote, telling same-named notes apart: ${fixture.name}`, () => {
      process.env.TZ = fixture.timeZone;
      const files = fixture.files.map((f) => ({
        path: f.path,
        basename: f.basename,
        stat: { mtime: f.mtime },
      }));
      // What Obsidian's fileToLinktext gives: the bare name when it is unique
      // in the vault, the path without its extension when it is not.
      const count = (basename: string) =>
        files.filter((f) => f.basename === basename).length;
      const vaultLinkText = (file: { path: string; basename: string }) =>
        count(file.basename) > 1
          ? file.path.replace(/\.md$/, "")
          : file.basename;

      const rendered = renderChangelog(
        files,
        fixture.settings,
        formatter,
        vaultLinkText,
      ).split("\n");
      const shipped = fixture.output.split("\n");
      expect(rendered).toHaveLength(shipped.length);

      const rows = filterAndSort(
        files,
        fixture.settings.changelogPath,
        fixture.settings.excludedFolders,
        fixture.settings.maxRecentFiles,
      );
      const repeated = (name: string) =>
        rows.filter((f) => f.basename === name).length > 1;
      const heading = fixture.settings.changelogHeading ? 2 : 0;
      rendered.forEach((line, i) => {
        const row = rows[i - heading];
        // A row is ambiguous when its name alone does not identify its note.
        // A wiki-link resolves against the whole vault, so a name shared with
        // any note counts, listed or not. Plain text is read against the list,
        // so only a name repeated among the rows counts (#202).
        const ambiguous =
          row !== undefined &&
          (fixture.settings.useWikiLinks
            ? count(row.basename) > 1
            : repeated(row.basename));
        if (ambiguous) {
          // 1.8.0 wrote the bare name; 2.0.0 names the note.
          expect(line).not.toBe(shipped[i] ?? "");
          expect(line).toContain(row.path.replace(/\.md$/, ""));
        } else {
          expect(line).toBe(shipped[i] ?? "<missing line>");
        }
      });
    });
  }
});
