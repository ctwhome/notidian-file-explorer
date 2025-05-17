import NotidianExplorerPlugin, { VIEW_TYPE_NOTIDIAN_EXPLORER } from '../main';
import { showExplorerContextMenu } from './context-menu';
import { renderColumnElement } from './column-renderer';
import { addDragScrolling } from './dom-helpers';
import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile } from 'obsidian';
import { NavigationManager } from './navigators';
import { IconManager } from './icon-handlers';
import { FileOperationsManager } from './file-operations-view';
import { DragManager } from './drag-handlers';
import { VaultEventManager } from './vault-event-handlers';
import { IColumnExplorerView } from './types';

export class ColumnExplorerView extends ItemView implements IColumnExplorerView {
  containerEl: HTMLElement; // The root element provided by ItemView
  columnsContainerEl: HTMLElement | null; // Specific container for columns, sits below header (Allow null)
  plugin: NotidianExplorerPlugin;

  // Store the cleanup function for drag scrolling listeners
  private cleanupDragScrolling: (() => void) | null = null;

  // Managers for different functionality
  private navigationManager: NavigationManager;
  private iconManager: IconManager;
  private fileOpsManager: FileOperationsManager;
  private dragManager: DragManager;
  private vaultEventManager: VaultEventManager;

  constructor(leaf: WorkspaceLeaf, plugin: NotidianExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Initialize managers
    this.navigationManager = new NavigationManager(this);
    this.iconManager = new IconManager(this);
    this.fileOpsManager = new FileOperationsManager(this);
    this.dragManager = new DragManager(this);
    this.vaultEventManager = new VaultEventManager(this);
  }

  getViewType(): string {
    return VIEW_TYPE_NOTIDIAN_EXPLORER;
  }

  getDisplayText(): string {
    return "Notidian File Explorer";
  }

  getIcon(): string {
    return "columns";
  }

  async onOpen() {
    console.log("Notidian File Explorer View opened");
    this.containerEl = this.contentEl;
    this.containerEl.empty();
    this.containerEl.addClass('notidian-file-explorer-view-root');

    // --- Add Header ---
    const headerEl = this.containerEl.createDiv({ cls: 'notidian-file-explorer-header' });

    // Refresh button
    const refreshButton = headerEl.createEl('button', {
      cls: 'notidian-file-explorer-refresh-button',
      attr: { 'aria-label': 'Refresh Explorer' }
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => {
      console.log("Manual refresh triggered");
      this.renderColumns();
    });

    // Navigate to current file button
    const navigateToCurrentButton = headerEl.createEl('button', {
      cls: 'notidian-file-explorer-navigate-button',
      attr: { 'aria-label': 'Navigate to Current Document' }
    });
    setIcon(navigateToCurrentButton, 'locate');
    navigateToCurrentButton.addEventListener('click', () => {
      this.navigateToCurrentFile();
    });
    // --- End Header ---

    // --- Add Columns Container ---
    // This element will hold the actual columns and will be scrollable/clearable
    this.columnsContainerEl = this.containerEl.createDiv({ cls: 'notidian-file-explorer-columns-wrapper' });

    // Initial render (renders into columnsContainerEl)
    await this.renderColumns();

    // Setup context menu (attach to columnsContainerEl)
    this.columnsContainerEl.addEventListener('contextmenu', (event) => {
      this.showContextMenu(event);
    });

    // Setup drag scrolling (attach to columnsContainerEl) and store cleanup function
    this.cleanupDragScrolling = addDragScrolling(this.columnsContainerEl);

    // Listener for vault rename events (handles inline title changes)
    this.registerEvent(
      this.app.vault.on('rename', this.vaultEventManager.handleFileRename.bind(this.vaultEventManager))
    );

    // Listener for vault delete events
    this.registerEvent(
      this.app.vault.on('delete', this.vaultEventManager.handleFileDelete.bind(this.vaultEventManager))
    );
  }

  async onClose() {
    console.log("Notidian File Explorer View closed");
    // Clean up drag scrolling listeners (was attached to columnsContainerEl)
    if (this.cleanupDragScrolling) {
      this.cleanupDragScrolling();
      this.cleanupDragScrolling = null;
    }
    // Clear drag-over timeout if active
    this.dragManager.clearDragOverTimeout();
    // Empty the main container (removes header and columns wrapper)
    this.containerEl.empty();
    // Nullify the reference
    this.columnsContainerEl = null; // Important for cleanup
  }

  // --- Core Rendering ---

  async renderColumns(startFolderPath = '/') {
    // Target the dedicated columns container now
    if (!this.columnsContainerEl) {
      console.error("Columns container not initialized!");
      return;
    }
    this.columnsContainerEl.empty(); // Clear previous columns only
    try {
      const rootColumnEl = await this.renderColumn(startFolderPath, 0);
      if (rootColumnEl) {
        this.columnsContainerEl.appendChild(rootColumnEl); // Append to columns container
      }
    } catch (error) {
      console.error("Error rendering initial column:", error);
      new Notice(`Error rendering folder: ${startFolderPath}`);
      this.columnsContainerEl.createDiv({ text: `Error loading folder: ${startFolderPath}` }); // Add error to columns container
    }
  }

  // Wrapper around the extracted renderer function
  async renderColumn(folderPath: string, depth: number, existingColumnEl?: HTMLElement): Promise<HTMLElement | null> {
    // Reverted renderColumn to original structure
    return renderColumnElement(
      this.app,
      this.plugin,
      folderPath,
      depth,
      existingColumnEl || null, // Pass null if creating new
      this.handleItemClick.bind(this),
      this.renderColumn.bind(this),
      this.dragManager.handleDrop.bind(this.dragManager),
      // Pass drag-over callbacks and delay
      this.dragManager.setDragOverTimeout.bind(this.dragManager),
      this.dragManager.clearDragOverTimeout.bind(this.dragManager),
      this.dragManager.triggerFolderOpenFromDrag.bind(this.dragManager),
      this.dragManager.DRAG_FOLDER_OPEN_DELAY, // Pass the constant
      this.fileOpsManager.renameItem.bind(this.fileOpsManager) // Pass rename callback
    );
  }

  // Helper to refresh a specific column in place
  async refreshColumnByPath(folderPath: string): Promise<HTMLElement | null> {
    if (!this.columnsContainerEl) return null;
    console.log(`[REFRESH] Attempting for path: "${folderPath}"`);

    // Use path directly in selector, assuming no problematic characters for now
    const columnSelector = `.notidian-file-explorer-column[data-path="${folderPath}"]`;
    console.log(`[REFRESH] Using selector: "${columnSelector}"`);

    // Query within the columns container
    const columnEl = this.columnsContainerEl.querySelector(columnSelector) as HTMLElement | null;
    if (columnEl) {
      const depthStr = columnEl.dataset.depth;
      const depth = depthStr ? parseInt(depthStr) : 0;
      const nextSibling = columnEl.nextElementSibling; // Get the next column for insertion reference

      console.log(`[REFRESH] Found column, removing and re-rendering for path: "${folderPath}"`);
      columnEl.remove(); // Remove the old column element

      // Render a completely new column element
      const newColumnEl = await this.renderColumn(folderPath, depth, undefined); // Pass undefined for existingColumnEl

      if (newColumnEl && this.columnsContainerEl) {
        // Insert the new column back into the correct position
        this.columnsContainerEl.insertBefore(newColumnEl, nextSibling);
        console.log(`[REFRESH] Re-inserted new column for path: "${folderPath}"`);
        return newColumnEl; // Return the new element
      } else {
        console.warn(`[REFRESH] Failed to render new column for path: "${folderPath}"`);
        return null; // Indicate failure if rendering failed
      }
    } else {
      // NOTE: Removed the fallback to full refresh here as it caused issues with rename
      console.warn(`[REFRESH] Could not find column element for path: "${folderPath}". No refresh performed.`);
      return null;
    }
  }

  // --- Event Handlers / Callbacks ---

  // Handles clicks on items within columns
  handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
    if (!this.columnsContainerEl) return;

    // Query within columnsContainerEl
    const columns = Array.from(this.columnsContainerEl.children) as HTMLElement[];

    // --- 1. Clear ALL existing selection classes ---
    this.columnsContainerEl.querySelectorAll('.notidian-file-explorer-item.is-selected-final, .notidian-file-explorer-item.is-selected-path').forEach(el => {
      el.removeClasses(['is-selected-final', 'is-selected-path']);
    });

    // --- 2. Apply 'is-selected-final' to the clicked item ---
    clickedItemEl.addClass('is-selected-final');

    // --- 3. Apply 'is-selected-path' to items in preceding columns ---
    for (let i = depth - 1; i >= 0; i--) {
      const pathColumn = columns[i];
      const nextColumn = columns[i + 1]; // The column opened *by* pathColumn
      if (!pathColumn || !nextColumn) continue;

      const nextColumnPath = nextColumn.dataset.path; // Path of the folder opened from pathColumn
      if (!nextColumnPath) {
        console.warn(`[Select Path] Column ${i + 1} is missing data-path attribute.`);
        continue;
      }

      // Find the item in pathColumn that corresponds to the folder opened in nextColumn
      const escapedPath = CSS.escape(nextColumnPath);
      const selector = `.notidian-file-explorer-item[data-path="${escapedPath}"]`;
      const itemToMarkAsPath = pathColumn.querySelector(selector) as HTMLElement | null;
      if (itemToMarkAsPath) {
        itemToMarkAsPath.addClass('is-selected-path');
      } else {
        console.warn(`[Select Path] Could not find item for path "${nextColumnPath}" in column ${i}`);
      }
    }

    const folderPath = clickedItemEl.dataset.path; // Get folder path regardless of type for check
    const isNextColumnAlreadyCorrect = isFolder && folderPath && columns[depth + 1]?.dataset.path === folderPath;

    // --- 4. Remove columns to the right ONLY if the correct next column isn't already open ---
    if (!isNextColumnAlreadyCorrect) {
      // Use slice to get columns strictly after the current depth
      const columnsToRemove = columns.slice(depth + 1);
      columnsToRemove.forEach(col => col.remove());
    }

    // --- 5. Open Next Column if Folder AND it's not already the correct one ---
    if (isFolder && folderPath && !isNextColumnAlreadyCorrect) {
      try {
        this.renderAndAppendNextColumn(folderPath, depth);
      } catch (error) {
        console.error(`Error rendering next column for folder ${folderPath}:`, error);
        new Notice(`Error opening folder: ${error.message || 'Unknown error'}`);
      }
    } else if (isFolder && isNextColumnAlreadyCorrect) {
      console.log("Next column already correct for this path, not removing or re-rendering.");
    }

    // --- 6. Auto Scroll ---
    requestAnimationFrame(() => {
      const targetColumn = clickedItemEl.closest('.notidian-file-explorer-column') as HTMLElement | null;
      if (!this.columnsContainerEl) return;
      if (targetColumn) {
        const containerRect = this.columnsContainerEl.getBoundingClientRect();
        const columnRect = targetColumn.getBoundingClientRect();
        const scrollLeftTarget = this.columnsContainerEl.scrollLeft + columnRect.right - containerRect.right;

        if (scrollLeftTarget > this.columnsContainerEl.scrollLeft) {
          this.columnsContainerEl.scrollTo({ left: scrollLeftTarget + 10, behavior: 'smooth' });
        } else if (columnRect.left < containerRect.left) {
          this.columnsContainerEl.scrollTo({
            left: this.columnsContainerEl.scrollLeft + columnRect.left - containerRect.left - 10,
            behavior: 'smooth'
          });
        }
      }
    });
  }

  // Helper to avoid duplicating async logic in handleItemClick
  async renderAndAppendNextColumn(folderPath: string, currentDepth: number) {
    if (!this.columnsContainerEl) return;
    const nextColumnEl = await this.renderColumn(folderPath, currentDepth + 1);
    if (nextColumnEl && this.columnsContainerEl) {
      this.columnsContainerEl.appendChild(nextColumnEl);
      // Scroll logic for columnsContainerEl
      requestAnimationFrame(() => {
        if (this.columnsContainerEl) {
          this.columnsContainerEl.scrollTo({ left: this.columnsContainerEl.scrollWidth, behavior: 'auto' });
        }
      });
    }
  }

  // --- Context Menu ---

  showContextMenu(event: MouseEvent) {
    if (!this.columnsContainerEl) return; // Don't show context menu if container doesn't exist

    // Prepare callbacks object
    const callbacks = {
      refreshColumnByPath: this.refreshColumnByPath.bind(this),
      selectAndFocusCallback: this.fileOpsManager.handleSelectAndFocus.bind(this.fileOpsManager),
      renderColumnCallback: this.renderColumn.bind(this),
      containerEl: this.columnsContainerEl,
      renameItem: this.fileOpsManager.renameItem.bind(this.fileOpsManager),
      deleteItem: this.fileOpsManager.deleteItem.bind(this.fileOpsManager),
      createNewNote: this.fileOpsManager.createNewNote.bind(this.fileOpsManager),
      createNewFolder: this.fileOpsManager.createNewFolder.bind(this.fileOpsManager),
      setEmoji: this.iconManager.handleSetEmoji.bind(this.iconManager),
      setIcon: this.iconManager.handleSetIcon.bind(this.iconManager)
    };

    showExplorerContextMenu(this.app, event, callbacks, this.plugin.settings);
  }

  // --- Delegate Methods ---

  // Navigation
  navigateToCurrentFile() {
    this.navigationManager.navigateToCurrentFile();
  }

  findAndSelectFile(file: TFile) {
    this.navigationManager.findAndSelectFile(file);
  }

  findColumnElementByPath(path: string): HTMLElement | null {
    if (!this.columnsContainerEl) return null;
    return this.columnsContainerEl.querySelector(`.notidian-file-explorer-column[data-path="${CSS.escape(path)}"]`);
  }
}
