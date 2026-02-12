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

    // Build all columns off-screen in a fragment, then swap in at once to avoid blink
    try {
      const fragment = document.createDocumentFragment();
      let lastColumnEl = await this.view.renderColumn('/', 0);
      if (lastColumnEl) {
        fragment.appendChild(lastColumnEl);
        console.log(`[NAV] Rendered root column`);

        // Render each folder column in sequence
        for (let i = 1; i < folderPaths.length; i++) {
          const targetFolderPath = folderPaths[i];
          console.log(`[NAV] Looking for folder: ${targetFolderPath} in column ${i - 1}`);

          // Find the folder item in the previous column using CSS.escape for safety
          const escapedPath = CSS.escape(targetFolderPath);
          let prevFolderEl = lastColumnEl?.querySelector(
            `.notidian-file-explorer-item[data-path="${escapedPath}"]`
          ) as HTMLElement | undefined;

          // Fallback without CSS.escape
          if (!prevFolderEl) {
            prevFolderEl = lastColumnEl?.querySelector(
              `.notidian-file-explorer-item[data-path="${targetFolderPath}"]`
            ) as HTMLElement | undefined;
          }

          if (prevFolderEl) {
            console.log(`[NAV] Found folder item: ${targetFolderPath}`);
            const nextColumnEl = await this.view.renderColumn(targetFolderPath, i);
            if (nextColumnEl) {
              fragment.appendChild(nextColumnEl);
              lastColumnEl = nextColumnEl;
              console.log(`[NAV] Rendered column ${i} for path: ${targetFolderPath}`);
              prevFolderEl.addClass('is-selected-path');
            } else {
              console.warn(`[NAV] Failed to render column for: ${targetFolderPath}`);
              break;
            }
          } else {
            console.error(`[NAV] Could not find folder: ${targetFolderPath}`);
            break;
          }
        }

        // Find the file item in the last column before swapping into the DOM
        const finalColumn = fragment.lastElementChild as HTMLElement;
        let fileItem: HTMLElement | null = null;
        if (finalColumn) {
          fileItem = finalColumn.querySelector(
            `.notidian-file-explorer-item[data-path="${CSS.escape(file.path)}"]`
          ) as HTMLElement;
          if (!fileItem) {
            fileItem = finalColumn.querySelector(
              `.notidian-file-explorer-item[data-path="${file.path}"]`
            ) as HTMLElement;
          }
        }

        // Swap all columns into the DOM in one operation
        this.view.columnsContainerEl.empty();
        this.view.columnsContainerEl.appendChild(fragment);

        // Now handle file selection and scrolling
        if (fileItem && finalColumn) {
          console.log(`[NAV] Found and selecting file: ${file.path}`);
          const depth = parseInt(finalColumn.dataset.depth || '0');
          this.view.handleItemClick(fileItem, false, depth);

          requestAnimationFrame(() => {
            if (this.view.columnsContainerEl && finalColumn && fileItem) {
              const containerRect = this.view.columnsContainerEl.getBoundingClientRect();
              const columnRect = finalColumn.getBoundingClientRect();

              const scrollLeftTarget = this.view.columnsContainerEl.scrollLeft + columnRect.right - containerRect.right;

              if (scrollLeftTarget > this.view.columnsContainerEl.scrollLeft) {
                this.view.columnsContainerEl.scrollTo({
                  left: scrollLeftTarget + 20,
                  behavior: 'instant' as ScrollBehavior
                });
              }

              fileItem.scrollIntoView({
                block: 'center',
                behavior: 'instant' as ScrollBehavior
              });
            }
          });

          // Open canvas files if needed
          if (file.extension === 'canvas') {
            this.view.app.workspace.openLinkText(file.path, '', false);
          }
        } else if (finalColumn) {
          console.warn(`[NAV] File not found in final column: ${file.path}`);
          const allItems = Array.from(finalColumn.querySelectorAll('.notidian-file-explorer-item'));
          console.log(`[NAV] Available items in final column:`, allItems.map(item => (item as HTMLElement).dataset.path));
        } else {
          console.warn(`[NAV] No final column found`);
        }
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
