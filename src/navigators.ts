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

    console.log(`Auto-revealing file: ${file.path}`);

    // Always use direct navigation to ensure we open the correct folder hierarchy
    this.navigateDirectlyToFile(file);
  }

  async navigateDirectlyToFile(file: TFile) {
    if (!file || !this.view.columnsContainerEl) return;

    // Get folder paths
    const folderPath = file.parent?.path || '/';
    console.log(`[NAV] Direct navigation to: ${file.path} in folder: ${folderPath}`);

    // Build all folder paths from root to the file's parent
    const pathSegments = folderPath === '/' ? [] : folderPath.split('/').filter(segment => segment.length > 0);
    let currentPath = '/';
    const folderPaths = [currentPath];

    for (const segment of pathSegments) {
      currentPath = currentPath === '/' ? segment : `${currentPath}/${segment}`;
      folderPaths.push(currentPath);
    }

    console.log(`[NAV] Folder paths to build: ${JSON.stringify(folderPaths)}`);

    // Start with the root column
    try {
      // Reset to root view
      this.view.columnsContainerEl.empty();
      let lastColumnEl = await this.view.renderColumn('/', 0);
      if (lastColumnEl) {
        this.view.columnsContainerEl.appendChild(lastColumnEl);
        console.log(`[NAV] Rendered root column`);

        // Render each folder column in sequence
        for (let i = 1; i < folderPaths.length; i++) {
          const targetFolderPath = folderPaths[i];
          console.log(`[NAV] Looking for folder: ${targetFolderPath} in column ${i - 1}`);

          // Find the folder item in the previous column using CSS.escape for safety
          const escapedPath = CSS.escape(targetFolderPath);
          const prevFolderEl = lastColumnEl?.querySelector(
            `.notidian-file-explorer-item[data-path="${escapedPath}"]`
          ) as HTMLElement | undefined;

          if (prevFolderEl) {
            console.log(`[NAV] Found folder item: ${targetFolderPath}`);
            // Render the next column
            const nextColumnEl = await this.view.renderColumn(targetFolderPath, i);
            if (nextColumnEl) {
              this.view.columnsContainerEl.appendChild(nextColumnEl);
              lastColumnEl = nextColumnEl;
              console.log(`[NAV] Rendered column ${i} for path: ${targetFolderPath}`);

              // Mark the folder as selected in the path
              prevFolderEl.addClass('is-selected-path');
            } else {
              console.warn(`[NAV] Failed to render column for: ${targetFolderPath}`);
              break;
            }
          } else {
            console.warn(`[NAV] Folder not found in column: ${targetFolderPath}`);
            // Try to find it without CSS.escape as fallback
            const fallbackEl = lastColumnEl?.querySelector(
              `.notidian-file-explorer-item[data-path="${targetFolderPath}"]`
            ) as HTMLElement | undefined;

            if (fallbackEl) {
              console.log(`[NAV] Found folder with fallback method: ${targetFolderPath}`);
              const nextColumnEl = await this.view.renderColumn(targetFolderPath, i);
              if (nextColumnEl) {
                this.view.columnsContainerEl.appendChild(nextColumnEl);
                lastColumnEl = nextColumnEl;
                fallbackEl.addClass('is-selected-path');
              }
            } else {
              console.error(`[NAV] Could not find folder even with fallback: ${targetFolderPath}`);
              break;
            }
          }
        }

        // All columns rendered, now find and select the file
        setTimeout(() => {
          // Find the file in the final column
          const finalColumn = this.view.columnsContainerEl?.lastElementChild as HTMLElement;
          if (finalColumn) {
            console.log(`[NAV] Looking for file in final column: ${file.path}`);

            // Try with CSS.escape first
            let fileItem = finalColumn.querySelector(
              `.notidian-file-explorer-item[data-path="${CSS.escape(file.path)}"]`
            ) as HTMLElement;

            // Fallback without CSS.escape
            if (!fileItem) {
              fileItem = finalColumn.querySelector(
                `.notidian-file-explorer-item[data-path="${file.path}"]`
              ) as HTMLElement;
            }

            if (fileItem) {
              console.log(`[NAV] Found and selecting file: ${file.path}`);
              const depth = parseInt(finalColumn.dataset.depth || '0');
              this.view.handleItemClick(fileItem, false, depth);

              // Ensure the column container scrolls to show the final column and the file
              requestAnimationFrame(() => {
                if (this.view.columnsContainerEl && finalColumn) {
                  // First, scroll the column container to show the final column
                  const containerRect = this.view.columnsContainerEl.getBoundingClientRect();
                  const columnRect = finalColumn.getBoundingClientRect();

                  // Calculate the scroll position to show the final column
                  const scrollLeftTarget = this.view.columnsContainerEl.scrollLeft + columnRect.right - containerRect.right;

                  if (scrollLeftTarget > this.view.columnsContainerEl.scrollLeft) {
                    this.view.columnsContainerEl.scrollTo({
                      left: scrollLeftTarget + 20, // Add some padding
                      behavior: 'smooth'
                    });
                  }

                  // Then scroll the file into view within its column
                  setTimeout(() => {
                    fileItem.scrollIntoView({
                      block: 'center',
                      behavior: 'smooth'
                    });
                  }, 300); // Wait for column scroll to complete
                }
              });

              // Open canvas files if needed
              if (file.extension === 'canvas') {
                this.view.app.workspace.openLinkText(file.path, '', false);
              }
            } else {
              console.warn(`[NAV] File not found in final column: ${file.path}`);
              // List all files in the final column for debugging
              const allItems = Array.from(finalColumn.querySelectorAll('.notidian-file-explorer-item'));
              console.log(`[NAV] Available items in final column:`, allItems.map(item => (item as HTMLElement).dataset.path));
            }
          } else {
            console.warn(`[NAV] No final column found`);
          }
        }, 150); // Increased delay to ensure all columns are rendered
      } else {
        console.error(`[NAV] Failed to render root column`);
      }
    } catch (error) {
      console.error("[NAV] Error in direct navigation:", error);
      new Notice("Error navigating to file. Falling back to standard navigation.");
      this.navigateToCurrentFile(); // Fall back to standard navigation
    }
  }
}
