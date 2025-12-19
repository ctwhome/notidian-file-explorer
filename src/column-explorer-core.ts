import NotidianExplorerPlugin, { VIEW_TYPE_NOTIDIAN_EXPLORER } from '../main';
import { showExplorerContextMenu } from './context-menu';
import { renderColumnElement } from './column-renderer';
import { addDragScrolling } from './dom-helpers';
import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, TFolder, App } from 'obsidian';
import { NavigationManager } from './navigators';
import { IconManager } from './icon-handlers';
import { FileOperationsManager } from './file-operations-view';
import { DragManager } from './drag-handlers';
import { VaultEventManager } from './vault-event-handlers';
import { IColumnExplorerView } from './types';

// Extended interface for App with commands property
interface ExtendedApp extends App {
  commands: {
    executeCommandById: (commandId: string) => void;
  };
}

export class ColumnExplorerView extends ItemView implements IColumnExplorerView {
  containerEl: HTMLElement; // The root element provided by ItemView
  columnsContainerEl: HTMLElement | null; // Specific container for columns, sits below header (Allow null)
  plugin: NotidianExplorerPlugin;

  // Store the cleanup function for drag scrolling listeners
  private cleanupDragScrolling: (() => void) | null = null;

  // Flag to prevent auto-reveal during manual clicks
  private isManualNavigation = false;

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

    // Apply column display mode class
    this.updateColumnDisplayMode();

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

    // Listener for workspace active leaf changes (auto-reveal current file)
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', this.handleActiveLeafChange.bind(this))
    );

    // Listener for file open events (handles document viewer and other file opening methods)
    this.registerEvent(
      this.app.workspace.on('file-open', this.handleFileOpen.bind(this))
    );

    // Listener for layout changes (handles when files are opened in new panes)
    this.registerEvent(
      this.app.workspace.on('layout-change', this.handleLayoutChange.bind(this))
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
      this.fileOpsManager.renameItem.bind(this.fileOpsManager), // Pass rename callback
      this.fileOpsManager.createNewNote.bind(this.fileOpsManager), // Pass create note callback
      this.fileOpsManager.createNewFolder.bind(this.fileOpsManager), // Pass create folder callback
      // Favorites callbacks
      this.toggleFavorite.bind(this),
      this.isFavorite.bind(this),
      this.navigateToFavorite.bind(this),
      this.toggleFavoritesCollapsed.bind(this),
      this.reorderFavorites.bind(this),
      // Folder item reorder callbacks
      this.reorderFolderItems.bind(this),
      this.getCustomFolderOrder.bind(this)
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

    // --- 4. Handle column updates for folders ---
    if (isFolder && folderPath && !isNextColumnAlreadyCorrect) {
      const existingNextColumn = columns[depth + 1];

      // Remove columns beyond depth+1 (keep the immediate next column for reuse)
      const columnsToRemove = columns.slice(depth + 2);
      columnsToRemove.forEach(col => col.remove());

      // Reuse existing column at depth+1 if it exists, otherwise create new
      try {
        this.renderAndReplaceNextColumn(folderPath, depth, existingNextColumn);
      } catch (error) {
        console.error(`Error rendering next column for folder ${folderPath}:`, error);
        new Notice(`Error opening folder: ${error.message || 'Unknown error'}`);
      }
    } else if (!isFolder) {
      // For files, remove all columns to the right
      const columnsToRemove = columns.slice(depth + 1);
      columnsToRemove.forEach(col => col.remove());
    } else if (isFolder && isNextColumnAlreadyCorrect) {
      console.log("Next column already correct for this path, not removing or re-rendering.");
    }

    // --- 5. Auto Scroll ---
    requestAnimationFrame(() => {
      this.scrollToShowColumns(depth, isFolder);
    });
  }

  // Helper to avoid duplicating async logic in handleItemClick
  async renderAndAppendNextColumn(folderPath: string, currentDepth: number) {
    if (!this.columnsContainerEl) return;
    const nextColumnEl = await this.renderColumn(folderPath, currentDepth + 1);
    if (nextColumnEl && this.columnsContainerEl) {
      this.columnsContainerEl.appendChild(nextColumnEl);
      // Scroll logic for columnsContainerEl - scroll to show the new column
      requestAnimationFrame(() => {
        this.scrollToShowColumns(currentDepth + 1, false);
      });
    }
  }

  // Helper to render and replace/reuse an existing column (avoids jarring animation)
  async renderAndReplaceNextColumn(folderPath: string, currentDepth: number, existingColumnEl?: HTMLElement) {
    if (!this.columnsContainerEl) return;

    if (existingColumnEl) {
      // Reuse the existing column element - just update its content in place
      await this.renderColumn(folderPath, currentDepth + 1, existingColumnEl);
      // No scroll animation needed since column stays in place
    } else {
      // No existing column to reuse, create and append new one
      const nextColumnEl = await this.renderColumn(folderPath, currentDepth + 1);
      if (nextColumnEl && this.columnsContainerEl) {
        this.columnsContainerEl.appendChild(nextColumnEl);
      }
    }
  }

  // Handle active leaf change events to auto-reveal files in the explorer
  handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
    // Only auto-reveal if enabled in settings and not during manual navigation
    if (!this.plugin.settings.autoRevealActiveFile || this.isManualNavigation) {
      return;
    }

    console.log('[AUTO-REVEAL] Active leaf changed:', leaf?.view?.getViewType());

    if (leaf && leaf.view) {
      const viewType = leaf.view.getViewType();

      // Handle both markdown and canvas files
      if (viewType === 'markdown' || viewType === 'canvas') {
        // Check if we're actively interacting with canvas elements
        if (viewType === 'canvas' && this.isCanvasInteraction()) {
          console.log('[AUTO-REVEAL] Skipping - user is interacting with canvas elements');
          return;
        }

        const file = (leaf.view as { file?: TFile }).file;
        if (file && file instanceof TFile) {
          console.log('[AUTO-REVEAL] Will reveal file:', file.path, 'Extension:', file.extension);
          // Debounce the reveal to avoid excessive calls
          setTimeout(() => {
            this.findAndSelectFile(file);
          }, 100);
        } else {
          console.log('[AUTO-REVEAL] No file found in view:', viewType);
        }
      } else {
        console.log('[AUTO-REVEAL] Ignoring view type:', viewType);
      }
    }
  }

  // Handle file open events (when files are opened via document viewer, etc.)
  handleFileOpen(file: TFile | null) {
    // Only auto-reveal if enabled in settings and not during manual navigation
    if (!this.plugin.settings.autoRevealActiveFile || this.isManualNavigation) {
      return;
    }

    console.log('[AUTO-REVEAL] File opened:', file?.path, 'Extension:', file?.extension);

    if (file && file instanceof TFile) {
      // Check if we're actively interacting with canvas elements
      if (file.extension === 'canvas' && this.isCanvasInteraction()) {
        console.log('[AUTO-REVEAL] Skipping - user is interacting with canvas elements');
        return;
      }

      console.log('[AUTO-REVEAL] Will reveal opened file:', file.path);
      // Debounce the reveal to avoid excessive calls
      setTimeout(() => {
        this.findAndSelectFile(file);
      }, 150); // Slightly longer delay for file-open events
    }
  }

  // Handle layout changes (when files are opened in new panes, etc.)
  handleLayoutChange() {
    // Only auto-reveal if enabled in settings and not during manual navigation
    if (!this.plugin.settings.autoRevealActiveFile || this.isManualNavigation) {
      return;
    }

    console.log('[AUTO-REVEAL] Layout changed');

    // Get the currently active file from the workspace
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile instanceof TFile) {
      // Check if we're actively interacting with canvas elements
      if (activeFile.extension === 'canvas' && this.isCanvasInteraction()) {
        console.log('[AUTO-REVEAL] Skipping - user is interacting with canvas elements');
        return;
      }

      console.log('[AUTO-REVEAL] Will reveal active file after layout change:', activeFile.path);
      // Debounce the reveal to avoid excessive calls during layout changes
      setTimeout(() => {
        this.findAndSelectFile(activeFile);
      }, 200); // Longer delay for layout changes
    }
  }

  // Helper method to detect if user is interacting with canvas elements
  private isCanvasInteraction(): boolean {
    // Check if the active element is inside a canvas view
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    // Check if the active element or its parents have canvas-related classes
    const canvasContainer = activeElement.closest('.canvas-node-container, .canvas-wrapper, .canvas-controls, .mod-canvas');
    if (canvasContainer) {
      console.log('[CANVAS-DETECT] Active element is inside canvas container');
      return true;
    }

    // Check if we're in a canvas view by looking at the workspace
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf && activeLeaf.view.getViewType() === 'canvas') {
      // Additional check: if the active element is not the view content itself
      // but something inside it (like a canvas node), it's an interaction
      const viewContent = activeLeaf.view.containerEl;
      if (viewContent && viewContent.contains(activeElement) && activeElement !== viewContent) {
        console.log('[CANVAS-DETECT] Active element is inside canvas view content');
        return true;
      }
    }

    return false;
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
      setIcon: this.iconManager.handleSetIcon.bind(this.iconManager),
      moveToFolder: this.handleMoveToFolder.bind(this),
      toggleFavorite: this.toggleFavorite.bind(this),
      isFavorite: this.isFavorite.bind(this)
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

  // --- Favorites Methods ---

  // Check if an item is favorited
  isFavorite(itemPath: string): boolean {
    return this.plugin.settings.favorites?.includes(itemPath) ?? false;
  }

  // Toggle favorite status for an item
  async toggleFavorite(itemPath: string): Promise<void> {
    const favorites = this.plugin.settings.favorites || [];
    const index = favorites.indexOf(itemPath);
    if (index === -1) {
      favorites.push(itemPath);
      console.log(`Added to favorites: ${itemPath}`);
    } else {
      favorites.splice(index, 1);
      console.log(`Removed from favorites: ${itemPath}`);
    }
    this.plugin.settings.favorites = favorites;
    await this.plugin.saveSettings();
    // Refresh first column to update favorites section
    await this.refreshColumnByPath('/');
  }

  // Toggle favorites section collapsed state
  async toggleFavoritesCollapsed(): Promise<void> {
    this.plugin.settings.favoritesCollapsed = !this.plugin.settings.favoritesCollapsed;
    await this.plugin.saveSettings();
    // Refresh first column to update favorites section visibility
    await this.refreshColumnByPath('/');
  }

  // Reorder favorites by moving item from one index to another
  async reorderFavorites(fromIndex: number, toIndex: number): Promise<void> {
    const favorites = this.plugin.settings.favorites || [];
    if (fromIndex < 0 || fromIndex >= favorites.length) return;
    if (toIndex < 0 || toIndex > favorites.length) return;

    // Remove item from original position
    const [item] = favorites.splice(fromIndex, 1);
    // Insert at new position
    favorites.splice(toIndex, 0, item);

    this.plugin.settings.favorites = favorites;
    await this.plugin.saveSettings();
    // Refresh first column to show new order
    await this.refreshColumnByPath('/');
  }

  // Reorder items within a folder by moving item from one position to another
  async reorderFolderItems(folderPath: string, fromPath: string, toPath: string, insertAfter: boolean): Promise<void> {
    // Get or create custom order for this folder
    let customOrder = this.plugin.settings.customFolderOrder?.[folderPath];

    // If no custom order exists, create one from current folder contents
    if (!customOrder) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) return;

      // Get all items in folder, sorted alphabetically (current default)
      const items = folder.children
        .filter(item => !item.name.startsWith('.'))
        .sort((a, b) => {
          // Folders first, then files, both alphabetically
          const aIsFolder = a instanceof TFolder;
          const bIsFolder = b instanceof TFolder;
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(item => item.path);

      customOrder = items;
    }

    // Find indices
    const fromIndex = customOrder.indexOf(fromPath);
    let toIndex = customOrder.indexOf(toPath);

    if (fromIndex === -1) return; // Source item not found

    // If target not found, add at end
    if (toIndex === -1) {
      toIndex = customOrder.length - 1;
    }

    // Remove from original position
    customOrder.splice(fromIndex, 1);

    // Calculate new position
    let insertIndex = toIndex;
    if (insertAfter) {
      insertIndex = fromIndex < toIndex ? toIndex : toIndex + 1;
    } else {
      insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    }

    // Clamp to valid range
    insertIndex = Math.max(0, Math.min(insertIndex, customOrder.length));

    // Insert at new position
    customOrder.splice(insertIndex, 0, fromPath);

    // Save
    if (!this.plugin.settings.customFolderOrder) {
      this.plugin.settings.customFolderOrder = {};
    }
    this.plugin.settings.customFolderOrder[folderPath] = customOrder;
    await this.plugin.saveSettings();

    // Refresh the column
    await this.refreshColumnByPath(folderPath);
  }

  // Get custom order for a folder (returns null if no custom order)
  getCustomFolderOrder(folderPath: string): string[] | null {
    return this.plugin.settings.customFolderOrder?.[folderPath] || null;
  }

  // Navigate to a favorited item (show it in its folder context)
  async navigateToFavorite(itemPath: string): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(itemPath);
    if (!abstractFile) {
      new Notice(`Item not found: ${itemPath}`);
      return;
    }

    if (abstractFile instanceof TFile) {
      // For files: navigate to show the file in explorer AND open it
      this.findAndSelectFile(abstractFile);
      // Also open the file in the editor
      this.app.workspace.openLinkText(abstractFile.path, '', false);
    } else if (abstractFile instanceof TFolder) {
      // For folders: render columns to show the folder's contents
      await this.renderColumns('/');
      // Then navigate to open the folder
      const pathParts = itemPath.split('/').filter(p => p);
      let currentPath = '/';
      let depth = 0;

      for (const part of pathParts) {
        currentPath = currentPath === '/' ? part : `${currentPath}/${part}`;
        const columnEl = await this.renderColumn(currentPath, depth + 1);
        if (columnEl && this.columnsContainerEl) {
          this.columnsContainerEl.appendChild(columnEl);
        }
        depth++;
      }

      // Scroll to show the last column
      requestAnimationFrame(() => {
        this.scrollToShowColumns(depth, true);
      });
    }
  }

  // Move file or folder to another folder using Obsidian command
  async handleMoveToFolder(itemPath: string): Promise<void> {
    try {
      const abstractFile = this.app.vault.getAbstractFileByPath(itemPath);
      if (!abstractFile) {
        new Notice('File or folder not found');
        return;
      }

      if (abstractFile instanceof TFile) {
        // For files: open the file first, then execute move command
        await this.app.workspace.openLinkText(itemPath, '', false);
        (this.app as ExtendedApp).commands.executeCommandById('file-explorer:move-file');
      } else if (abstractFile instanceof TFolder) {
        // For folders: try multiple approaches to make the move command work
        console.log('Attempting to move folder using Obsidian move command');

        let commandWorked = false;

        // Approach 1: Try to focus the folder in the file explorer first
        try {
          const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
          if (fileExplorer && fileExplorer.view) {
            const fileExplorerView = fileExplorer.view as unknown as { tree?: { setFocusedItem?: (item: unknown) => void } };
            if (fileExplorerView.tree && typeof fileExplorerView.tree.setFocusedItem === 'function') {
              fileExplorerView.tree.setFocusedItem(abstractFile);
              await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay
            }
          }

          (this.app as ExtendedApp).commands.executeCommandById('file-explorer:move-file');
          commandWorked = true;
        } catch (error) {
          console.warn('Approach 1 failed:', error);
        }

        // Approach 2: Try opening a file inside the folder first
        if (!commandWorked) {
          try {
            const filesInFolder = abstractFile.children?.filter(child => child instanceof TFile) as TFile[];
            if (filesInFolder && filesInFolder.length > 0) {
              await this.app.workspace.openLinkText(filesInFolder[0].path, '', false);
              await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay
              (this.app as ExtendedApp).commands.executeCommandById('file-explorer:move-file');
              commandWorked = true;
            }
          } catch (error) {
            console.warn('Approach 2 failed:', error);
          }
        }

        // Approach 3: Try the command directly without any setup
        if (!commandWorked) {
          try {
            (this.app as ExtendedApp).commands.executeCommandById('file-explorer:move-file');
            commandWorked = true;
          } catch (error) {
            console.warn('Approach 3 failed:', error);
          }
        }

        // Fallback: Use our custom folder picker and programmatic move
        if (!commandWorked) {
          console.warn('All Obsidian move command approaches failed, using custom folder picker');
          const targetFolder = await this.promptForTargetFolder();
          if (targetFolder) {
            const { handleMoveItem } = await import('./file-operations');
            const success = await handleMoveItem(
              this.app,
              itemPath,
              targetFolder.path,
              this.refreshColumnByPath.bind(this)
            );
            if (!success) {
              new Notice('Failed to move folder');
            }
          }
        }
      }
    } catch (error) {
      console.error('Error executing move command:', error);
      new Notice('Error opening move dialog');
    }
  }

  // Helper method to prompt user for target folder selection
  private async promptForTargetFolder(): Promise<TFolder | null> {
    return new Promise((resolve) => {
      // Get all folders in the vault
      const folders = this.app.vault.getAllLoadedFiles()
        .filter(file => file instanceof TFolder) as TFolder[];

      if (folders.length === 0) {
        new Notice('No folders found in vault');
        resolve(null);
        return;
      }

      // Sort folders by path for better UX
      folders.sort((a, b) => a.path.localeCompare(b.path));

      // Fallback: Use the Obsidian move command instead of complex type handling
      console.warn('Using Obsidian move command as folder picker fallback');
      try {
        (this.app as ExtendedApp).commands.executeCommandById('file-explorer:move-file');
        resolve(null); // We don't get a return value from the command, so resolve with null
      } catch (commandError) {
        console.error('Obsidian move command also failed:', commandError);
        new Notice('Unable to open move dialog. Please use drag & drop to move folders.');
        resolve(null);
      }
    });
  }

  // Update the column display mode class on the container
  updateColumnDisplayMode() {
    if (!this.columnsContainerEl) return;

    // Remove existing mode classes
    this.columnsContainerEl.removeClass('columns-2', 'columns-3');

    // Add the appropriate class based on settings
    const mode = this.plugin.settings.columnDisplayMode;
    this.columnsContainerEl.addClass(`columns-${mode}`);
  }

  // Scroll to show the appropriate number of columns based on settings
  scrollToShowColumns(clickedDepth: number, isFolder: boolean) {
    if (!this.columnsContainerEl) return;

    const columns = Array.from(this.columnsContainerEl.children) as HTMLElement[];
    const displayMode = this.plugin.settings.columnDisplayMode;

    // Calculate which column index should be the rightmost visible column
    // If clicking a folder, a new column will be rendered at depth + 1, so account for that
    const rightmostColumnIndex = isFolder ? clickedDepth + 1 : clickedDepth;

    // Calculate the leftmost column to show based on display mode
    const leftmostColumnIndex = Math.max(0, rightmostColumnIndex - displayMode + 1);

    // Get the leftmost column to show
    const leftColumn = columns[leftmostColumnIndex];

    if (!leftColumn) return;

    // Calculate the scroll position to show from leftColumn to rightColumn
    const containerRect = this.columnsContainerEl.getBoundingClientRect();
    const leftColumnRect = leftColumn.getBoundingClientRect();

    // Calculate scroll position to align the leftmost column at the left edge of the container
    const targetScrollLeft = this.columnsContainerEl.scrollLeft + leftColumnRect.left - containerRect.left;

    // Smooth scroll to the target position
    this.columnsContainerEl.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
  }
}
