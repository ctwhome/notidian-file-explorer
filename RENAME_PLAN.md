# Project Renaming Plan: Notidian Explorer -> Notidian File Explorer

This document outlines the steps to rename the Obsidian plugin project from "Notidian Explorer" to "Notidian File Explorer".

## Steps

1.  **Update Core Metadata:**
    *   **`manifest.json`**:
        *   Change `id` from `"notidian-file-explorer"` to `"notidian-file-explorer"`.
        *   Change `name` from `"Notidian Explorer"` to `"Notidian File Explorer"`.
        *   Update `description` to: "Provides a multi-column file explorer for Obsidian."
    *   **`package.json`**:
        *   Change `name` from `"obsidian-sample-plugin"` to `"notidian-file-explorer"`.
        *   Update `description` to: "A multi-column file explorer for Obsidian, similar to macOS Finder's column view."

2.  **Update Documentation (`README.md`):**
    *   Replace all occurrences of "Notidian Explorer" with "Notidian File Explorer".
    *   Update the main title (`# Notidian Explorer for Obsidian`) to `# Notidian File Explorer for Obsidian`.
    *   Update the manual installation folder name from `notidian-file-explorer` to `notidian-file-explorer`.
    *   Update all GitHub URLs from `https://github.com/your-github-username/notidian-file-explorer/...` to `https://github.com/ctwhome/notidian-file-explorer/...`.

3.  **Update Source Code (`src/**/*.ts`):**
    *   **Display Text:** Change "Notidian Explorer" to "Notidian File Explorer" in `src/ColumnExplorerView.ts` (`getDisplayText`) and `src/SettingsTab.ts` (settings title).
    *   **CSS Class Prefixes:** Systematically replace all occurrences of the prefix `notidian-file-explorer-` with `notidian-file-explorer-` across all relevant `.ts` files.
    *   **Data Directory:** Change the data directory path from `.notidian-file-explorer-data` to `.notidian-file-explorer-data`. (Note: Existing user data like custom icons will *not* be migrated automatically).
    *   **Console Logs:** Update any console log messages containing the old name (optional but good practice).

4.  **Update Stylesheet (`styles.css`):**
    *   Replace all occurrences of the CSS class prefix `notidian-file-explorer-` with `notidian-file-explorer-` to match the changes made in the TypeScript files.

5.  **Repository Renaming (Manual User Step):**
    *   You will need to manually rename the GitHub repository from `notidian-file-explorer` to `notidian-file-explorer` via the GitHub website settings after the code changes are complete.

## Plan Diagram

```mermaid
graph TD
    A[Start: Rename Request] --> B(Gather Info: Read manifest, package, README, Search Code);
    B --> C{Analyze Usage: Metadata, Docs, Code (CSS Classes, Data Dir, Display Text)};
    C --> D[Plan Created & Refined];
    D --> E[Step 1: Update manifest.json & package.json];
    D --> F[Step 2: Update README.md (Text & URLs)];
    D --> G[Step 3: Update *.ts Files (Display Text, CSS Prefix, Data Dir)];
    D --> H[Step 4: Update styles.css (CSS Prefix)];
    D --> I[Step 5: Manual Repo Rename (User Action)];
    E & F & G & H --> J{Implementation (Code Mode)};
    J --> K[End: Project Renamed];

    subgraph Code Changes
        G --> G1[Change Display Text];
        G --> G2[Replace CSS Prefix 'notidian-file-explorer-'];
        G --> G3[Change Data Dir '.notidian-file-explorer-data'];
        H --> H1[Replace CSS Prefix 'notidian-file-explorer-'];
    end

    subgraph Documentation & Config
        E --> E1[manifest: id, name, desc];
        E --> E2[package: name, desc];
        F --> F1[README: Text Replace];
        F --> F2[README: Update URLs];
    end

    subgraph External Action
        I --> I1[User Renames GitHub Repo];
    end