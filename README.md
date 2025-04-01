# OneNote Explorer for Obsidian

This plugin adds a multi-column file explorer to Obsidian, inspired by the navigation found in Microsoft OneNote and the "Columns" view in macOS Finder. It provides an alternative way to browse your vault, especially useful for deeply nested folder structures.

![Screenshot of OneNote Explorer View](images/screenshot.png) <!-- Placeholder - Add a real screenshot later -->

## Features

*   **Multi-Column Navigation:** Browse folders and files in a cascading column layout. Clicking a folder opens its contents in a new column to the right.
*   **Ribbon Icon:** Activate the OneNote Explorer view using the dedicated ribbon icon (looks like columns).
*   **File Operations:** Right-click on files, folders, or the column background to access a context menu with common operations:
    *   New Note (.md)
    *   New Excalidraw Note (.excalidraw.md) - *Requires Excalidraw plugin*
    *   New Canva Note (.canvas)
    *   New Folder
    *   Rename (File/Folder)
    *   Delete (File/Folder) - *Moves items to system trash*
    *   Open in New Tab (Files)
*   **Exclusion Settings:** Configure patterns (in plugin settings) to hide specific files or folders from the explorer view (e.g., `.git`, `.obsidian`).
*   **Excalidraw Template:** Optionally specify a template file path for new Excalidraw notes in settings.
*   **Automatic Scrolling:**
    *   Scrolls horizontally to reveal newly opened columns.
    *   Supports click-and-drag horizontal scrolling on the container background.
*   **Drag and Drop:** Move files and folders by dragging and dropping them onto folder items or column backgrounds.
    *   **Spring-Loaded Folders:** Hovering over a folder while dragging automatically opens it after a short delay.
    *   **Target Folder Auto-Open:** The destination folder's column opens automatically after a successful drop.
*   **Theme Aware:** Uses Obsidian's theme variables for styling to match your current theme.
*   **Persistent Settings:** Settings (including exclusions, templates, and emoji associations) are stored in `.obsidian/onenote-explorer.json` within your vault, ensuring they persist even if the plugin is uninstalled and reinstalled.
*   **Creation Workflow:** Creates "Untitled" notes/folders instantly, opens them, and attempts to focus the inline title for notes (experimental).

## How to Use

1.  Install the plugin from the Obsidian Community Plugins browser or manually.
2.  Enable the plugin in Obsidian's settings.
3.  Click the "Columns" icon in the left ribbon to open the OneNote Explorer view.
4.  Click folders to navigate deeper.
5.  Click files to open them in the editor.
6.  Right-click for file/folder operations.
7.  Configure exclusion patterns and the optional Excalidraw template path in the plugin settings tab.

## Future Ideas / Potential Enhancements

*   **Drag and Drop (Improvements):** Enhance drag-and-drop (e.g., dropping into editor, visual cues).
*   **Customizable Icons:** Allow users to associate icons with specific file types or folders.
*   **Custom Sort Order:** Provide options to sort items by modification date, creation date, or manually.
*   **Keyboard Navigation:** Add keyboard shortcuts for navigating between columns and items.
*   **Pinning Columns:** Allow specific columns (folders) to remain visible even when navigating deeper.
*   **Improved Filtering:** More advanced filtering options beyond simple exclusion (e.g., regex, file types).
*   **Vault Selection:** Option to start the explorer view from a specific folder instead of the vault root.
*   **Performance Optimization:** Investigate virtual scrolling for very large folders.
*   **Refined Inline Title Focus:** Improve the reliability of focusing the inline title after note creation if possible via future Obsidian APIs.

## Installation

### From Community Plugins

1.  Open Obsidian Settings > Community Plugins.
2.  Make sure "Safe mode" is **off**.
3.  Click **Browse** community plugins.
4.  Search for "OneNote Explorer".
5.  Click **Install**.
6.  Once installed, click **Enable**.

### Manual Installation

1.  Download the latest release files (`main.js`, `styles.css`, `manifest.json`) from the [GitHub Releases page](https://github.com/your-github-username/onenote-explorer/releases) <!-- Update URL -->.
2.  Navigate to your Obsidian vault's plugins folder: `VaultFolder/.obsidian/plugins/`.
3.  Create a new folder named `onenote-explorer`.
4.  Copy the downloaded `main.js`, `styles.css`, and `manifest.json` files into the `onenote-explorer` folder.
5.  Reload Obsidian (Ctrl/Cmd+R).
6.  Open Obsidian Settings > Community Plugins, find "OneNote Explorer", and enable it.

## Development

(Keep the original development instructions here if desired, or remove/update them)

```bash
# Clone the repository
git clone https://github.com/your-github-username/onenote-explorer.git
cd onenote-explorer

# Install dependencies
npm i

# Build for production
npm run build

# Run in development mode (watches for changes)
npm run dev
```

## Contributing

Contributions, issues, and feature requests are welcome! Please feel free to check [issues page](https://github.com/your-github-username/onenote-explorer/issues). <!-- Update URL -->

---

*Placeholder for Funding Information if applicable*
