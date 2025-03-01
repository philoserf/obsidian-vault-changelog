# Obsidian Vault Changelog Plugin Roadmap

This document outlines planned enhancements and new features for the Vault Changelog plugin. These ideas represent potential directions for future development and are subject to change based on user feedback and evolving needs.

## Core Functionality Improvements

### UI/UX Enhancements

- Add ribbon icon for quick access to update changelog
- Add status bar item showing last changelog update time
- Improve visual display of settings panel
- Add keyboard shortcuts for updating changelog

### Content Formatting

- Support custom templates for changelog entries
- Allow grouping entries by date/folder
- Add option to include a header with update time/date
- Support Markdown formatting options for entries
- Add ability to customize the link format (wiki links, markdown links, etc)

### File Handling

- Option to append to existing changelog instead of overwriting
- Support for multiple changelog files (e.g., by category)
- Add option to create backups before overwriting
- Support for changelog rotation (e.g., monthly changelog files)

## Advanced Features

### Filtering Options

- Support for excluding files by tag
- Support for excluding files by filename pattern (regex)
- Exclude files by content (e.g., containing specific frontmatter)
- Add inclusion filters (only include files matching criteria)
- Add support for filtering by vault folder structure

### Integration Improvements

- Integration with core Obsidian features (e.g., search, tags)
- Support for connecting with other plugins (e.g., Dataview)
- Export options for changelog data

### Visualization Options

- Add visualization of change frequency
- Calendar view of file modifications
- Activity heatmap for vault changes

## Technical Improvements

### Code Organization

- Refactor code for better modularity
- Move UI styles to separate CSS file
- Improve type definitions
- Add comprehensive code documentation

### Performance

- Optimize file filtering for large vaults
- Improve change detection efficiency
- Add caching mechanisms for better performance

### Testing & Quality

- Add unit tests for core functionality
- Add end-to-end tests for UI
- Implement robust error handling
- Add telemetry option for crash reporting (opt-in)

## Documentation

- Expand user documentation with examples
- Add developer documentation
- Create video tutorials
- Improve in-app help

## User-Requested Features

- Consider adding a heading (#4)
- Consider added, deleted, in addition to modified (#8)
- Consider makiing the wikilinks optional (#9)
- Consider adding the name of the device in the changelog (#28)

To suggest additions to this roadmap, please open a discussion or issue on the [GitHub repository](https://github.com/philoserf/obsidian-vault-changelog).
