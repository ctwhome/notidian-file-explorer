import { ItemView, WorkspaceLeaf, Notice } from 'obsidian'; // Removed TFile, TFolder, MarkdownView
import OneNoteExplorerPlugin, { VIEW_TYPE_ONENOTE_EXPLORER } from '../main';
import { showExplorerContextMenu } from './context-menu';
import { renderColumnElement } from './column-renderer';
import { handleCreateNewNote, handleCreateNewFolder, handleRenameItem, handleDeleteItem } from './file-operations';
import { addDragScrolling, attemptInlineTitleFocus } from './dom-helpers';

export class ColumnExplorerView extends ItemView {
  containerEl: HTMLElement;
  plugin: OneNoteExplorerPlugin;
  // Store the cleanup function for drag scrolling listeners
  private cleanupDragScrolling: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OneNoteExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ONENOTE_EXPLORER;
  }

  getDisplayText(): string {
    return "OneNote Explorer";
  }

  getIcon(): string {
    return "columns";
  }

  async onOpen() {
    console.log("OneNote Explorer View opened");
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass('onenote-explorer-container');

    // Initial render
    await this.renderColumns();

    // Setup context menu
    this.containerEl.addEventListener('contextmenu', (event) => {
      this.showContextMenu(event);
    });

    // Setup drag scrolling and store cleanup function
    this.cleanupDragScrolling = addDragScrolling(this.containerEl);
  }

  async onClose() {
    console.log("OneNote Explorer View closed");
    // Clean up drag scrolling listeners
    if (this.cleanupDragScrolling) {
      this.cleanupDragScrolling();
      this.cleanupDragScrolling = null;
    }
    this.containerEl.empty();
  }

  // --- Core Rendering ---

  async renderColumns(startFolderPath = '/') {
    this.containerEl.empty(); // Clear previous content for full render
    try {
      const rootColumnEl = await this.renderColumn(startFolderPath, 0);
      if (rootColumnEl) {
        this.containerEl.appendChild(rootColumnEl);
      }
    } catch (error) {
      console.error("Error rendering initial column:", error);
      new Notice(`Error rendering folder: ${startFolderPath}`);
      this.containerEl.createDiv({ text: `Error loading folder: ${startFolderPath}` });
    }
  }

  // Wrapper around the extracted renderer function
  async renderColumn(folderPath: string, depth: number, existingColumnEl?: HTMLElement): Promise<HTMLElement | null> {
    return renderColumnElement(
      this.app,
      this.plugin,
      folderPath,
      depth,
      existingColumnEl || null, // Pass null if creating new
      this.handleItemClick.bind(this), // Pass bound method as callback
      this.renderColumn.bind(this) // Pass bound method for recursive calls
    );
  }

  // Helper to refresh a specific column in place
  async refreshColumnByPath(folderPath: string): Promise<HTMLElement | null> {
    console.log(`Attempting to refresh column for path: "${folderPath}"`);
    const columnSelector = `.onenote-explorer-column[data-path="${folderPath}"]`;
    console.log(`Using selector: "${columnSelector}"`);
    const columnEl = this.containerEl.querySelector(columnSelector) as HTMLElement | null;
    if (columnEl) {
      const depthStr = columnEl.dataset.depth;
      const depth = depthStr ? parseInt(depthStr) : 0;
      await this.renderColumn(folderPath, depth, columnEl); // Update existing element
      console.log(`Finished refreshing column for path: "${folderPath}"`);
      return columnEl;
    } else {
      console.warn(`Could not find column element for path: ${folderPath} to refresh.`);
      await this.renderColumns(); // Fallback to full refresh
      console.log(`Fell back to full refresh because column for "${folderPath}" not found.`);
      return null;
    }
  }

  // --- Event Handlers / Callbacks ---

  // Handles clicks on items within columns
  handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
    const columnEl = clickedItemEl.parentElement;
    if (columnEl) {
      columnEl.querySelectorAll('.onenote-explorer-item.is-selected').forEach(el => {
        el.removeClass('is-selected');
      });
    }
    clickedItemEl.addClass('is-selected');

    // Remove columns to the right
    const columns = Array.from(this.containerEl.children) as HTMLElement[];
    for (let i = columns.length - 1; i > depth; i--) {
      const colDepthStr = columns[i].dataset.depth;
      if (colDepthStr !== undefined && parseInt(colDepthStr) > depth) {
        columns[i].remove();
      }
    }

    // If a folder was clicked, render and append the next column
    if (isFolder) {
      const folderPath = clickedItemEl.dataset.path;
      if (folderPath) {
        // Use try-catch for safety
        try {
          this.renderAndAppendNextColumn(folderPath, depth);
        } catch (error) {
          console.error(`Error rendering next column for folder ${folderPath}:`, error);
          new Notice(`Error opening folder: ${error.message || 'Unknown error'}`);
        }
      }
    }

    // Auto Scroll (logic remains here as it needs containerEl)
    requestAnimationFrame(() => {
      const targetColumn = clickedItemEl.closest('.onenote-explorer-column') as HTMLElement | null;
      if (targetColumn) {
        const containerRect = this.containerEl.getBoundingClientRect();
        const columnRect = targetColumn.getBoundingClientRect();
        const scrollLeftTarget = this.containerEl.scrollLeft + columnRect.right - containerRect.right;

        if (scrollLeftTarget > this.containerEl.scrollLeft) {
          this.containerEl.scrollTo({ left: scrollLeftTarget + 10, behavior: 'smooth' });
        } else if (columnRect.left < containerRect.left) {
          this.containerEl.scrollTo({ left: this.containerEl.scrollLeft + columnRect.left - containerRect.left - 10, behavior: 'smooth' });
        }
      }
    });
  }

  // Helper to avoid duplicating async logic in handleItemClick
  private async renderAndAppendNextColumn(folderPath: string, currentDepth: number) {
    const nextColumnEl = await this.renderColumn(folderPath, currentDepth + 1);
    if (nextColumnEl) {
      this.containerEl.appendChild(nextColumnEl);
      // Scroll logic is already handled by the requestAnimationFrame in handleItemClick
      // We might need to ensure the scroll happens *after* appending though.
      // Let's move the scroll logic here to ensure it runs after append.
      requestAnimationFrame(() => {
        this.containerEl.scrollTo({ left: this.containerEl.scrollWidth, behavior: 'smooth' });
      });
    }
  }

  // Callback for file operations to select/focus/open new items
  handleSelectAndFocus(itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) {
    if (!columnEl) {
      console.warn("Cannot select item, parent column element not found.");
      return;
    }
    const newItemEl = columnEl.querySelector(`.onenote-explorer-item[data-path="${itemPath}"]`) as HTMLElement | null;
    if (newItemEl) {
      setTimeout(async () => {
        try {
          const depth = parseInt(columnEl.dataset.depth || '0');
          this.handleItemClick(newItemEl, isFolder, depth); // Select visually

          if (isFolder) {
            // Open the new folder's column using the helper
            await this.renderAndAppendNextColumn(itemPath, depth);
          } else {
            // Open the new file and attempt inline title focus
            await this.app.workspace.openLinkText(itemPath, '', false);
            attemptInlineTitleFocus(this.app); // Call the helper
          }
        } catch (err) {
          console.error("Error during post-creation navigation/focus:", err);
          new Notice("Error navigating to new item.");
        }
      }, 100); // Delay
    } else {
      console.warn(`Could not find newly created item element for path: ${itemPath}`);
    }
  }


  // --- Context Menu ---

  showContextMenu(event: MouseEvent) {
    // Prepare callbacks object
    const callbacks = {
      refreshColumnByPath: this.refreshColumnByPath.bind(this),
      selectAndFocusCallback: this.handleSelectAndFocus.bind(this),
      renderColumnCallback: this.renderColumn.bind(this),
      containerEl: this.containerEl,
      // Pass bound versions of the action handlers
      renameItem: this.renameItem.bind(this),
      deleteItem: this.deleteItem.bind(this),
      createNewNote: this.createNewNote.bind(this),
      createNewFolder: this.createNewFolder.bind(this)
    };
    showExplorerContextMenu(this.app, event, callbacks, this.plugin.settings);
  }

  // --- File Operations (Wrappers around imported handlers) ---

  private async createNewNote(folderPath: string, fileExtension = '.md') {
    await handleCreateNewNote(
      this.app,
      folderPath,
      fileExtension,
      this.plugin.settings.excalidrawTemplatePath,
      this.refreshColumnByPath.bind(this),
      this.handleSelectAndFocus.bind(this)
    );
  }

  private async createNewFolder(folderPath: string) {
    await handleCreateNewFolder(
      this.app,
      folderPath,
      this.refreshColumnByPath.bind(this),
      this.handleSelectAndFocus.bind(this),
      this.renderColumn.bind(this), // Pass renderColumn for opening new folder
      this.containerEl
    );
  }

  private async renameItem(itemPath: string, isFolder: boolean) {
    await handleRenameItem(
      this.app,
      itemPath,
      isFolder,
      this.refreshColumnByPath.bind(this)
    );
  }

  private async deleteItem(itemPath: string, isFolder: boolean) {
    await handleDeleteItem(
      this.app,
      itemPath,
      isFolder,
      this.refreshColumnByPath.bind(this)
    );
  }
}