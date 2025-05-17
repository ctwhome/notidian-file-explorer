import { TFile, Notice } from 'obsidian';
import { IColumnExplorerView } from './types';

export class NavigationManager {
  private view: IColumnExplorerView;

  constructor(view: IColumnExplorerView) {
    this.view = view;
  }

  navigateToCurrentFile() {
    const activeFile = this.view.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No file is currently open");
      return;
    }

    // Try the direct navigation approach
    this.navigateDirectlyToFile(activeFile);
  }

  findAndSelectFile(file: TFile) {
    if (!this.view.columnsContainerEl) return;

    // Get the parent path
    const parentPath = file.parent?.path || '/';
    console.log(`Looking for file ${file.path} in parent folder ${parentPath}`);

    // Find the parent column
    const parentColumnEl = this.view.findColumnElementByPath(parentPath);
    if (!parentColumnEl) {
      console.warn(`Parent column not found for path: ${parentPath}`);
      return;
    }

    // Find the file item in the parent column
    const allItems = Array.from(parentColumnEl.querySelectorAll('.notidian-file-explorer-item'));
    console.log(`Items in parent column: ${allItems.length}`);

    // Find the file by path
    const fileItem = allItems.find(
      item => (item as HTMLElement).dataset.path === file.path
    ) as HTMLElement | undefined;

    if (fileItem) {
      console.log(`Found file item: ${file.path}`);

      // Get the column depth
      const depth = parseInt(parentColumnEl.dataset.depth || '0');

      // Select the file (this handles clearing previous selections)
      this.view.handleItemClick(fileItem, false, depth);

      // Scroll the file into view without smooth behavior to avoid animation
      fileItem.scrollIntoView({ block: 'center' });

      // Open canvas files if needed
      if (file.extension === 'canvas') {
        this.view.app.workspace.openLinkText(file.path, '', false);
      }
    } else {
      console.warn(`File not found in parent column: ${file.path}`);

      // Fallback: search in all columns
      console.log("Searching in all columns as fallback");

      // Get all columns
      const columns = Array.from(this.view.columnsContainerEl.querySelectorAll('.notidian-file-explorer-column'));

      for (let i = 0; i < columns.length; i++) {
        const column = columns[i] as HTMLElement;
        const fileInColumn = Array.from(column.querySelectorAll('.notidian-file-explorer-item'))
          .find(item => (item as HTMLElement).dataset.path === file.path) as HTMLElement | undefined;

        if (fileInColumn) {
          console.log(`Found file in column ${i}: ${file.path}`);
          this.view.handleItemClick(fileInColumn, false, i);
          fileInColumn.scrollIntoView({ block: 'center' });

          if (file.extension === 'canvas') {
            this.view.app.workspace.openLinkText(file.path, '', false);
          }

          return;
        }
      }

      new Notice(`File found, but could not locate it in the explorer view.`);
    }
  }

  async navigateDirectlyToFile(file: TFile) {
    if (!file || !this.view.columnsContainerEl) return;

    // Get folder paths
    const folderPath = file.parent?.path || '/';
    console.log(`Direct navigation to: ${file.path} in folder: ${folderPath}`);

    // Build all folder paths from root to the file's parent
    const pathSegments = folderPath.split('/').filter(segment => segment.length > 0);
    let currentPath = '/';
    const folderPaths = [currentPath];

    for (const segment of pathSegments) {
      currentPath = currentPath === '/' ? `/${segment}` : `${currentPath}/${segment}`;
      folderPaths.push(currentPath);
    }

    // Start with the root column
    try {
      // Reset to root view
      this.view.columnsContainerEl.empty();
      let lastColumnEl = await this.view.renderColumn('/', 0);
      if (lastColumnEl) {
        this.view.columnsContainerEl.appendChild(lastColumnEl);

        // Render each folder column in sequence
        for (let i = 1; i < folderPaths.length; i++) {
          const folderPath = folderPaths[i];

          // Find the folder item in the previous column
          const prevFolderEl = lastColumnEl?.querySelector(
            `.notidian-file-explorer-item[data-path="${folderPath}"]`
          ) as HTMLElement | undefined;

          if (prevFolderEl) {
            // Render the next column
            const nextColumnEl = await this.view.renderColumn(folderPath, i);
            if (nextColumnEl) {
              this.view.columnsContainerEl.appendChild(nextColumnEl);
              lastColumnEl = nextColumnEl;

              // Mark the folder as selected in the path
              prevFolderEl.addClass('is-selected-path');
            }
          }
        }

        // All columns rendered, now find and select the file
        setTimeout(() => this.findAndSelectFile(file), 10);
      }
    } catch (error) {
      console.error("Error in direct navigation:", error);
      new Notice("Error navigating to file. Falling back to standard navigation.");
      this.navigateToCurrentFile(); // Fall back to standard navigation
    }
  }
}
