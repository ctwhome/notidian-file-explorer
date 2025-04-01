import { ItemView, WorkspaceLeaf, Notice } from 'obsidian'; // Removed TFile, TFolder, MarkdownView
import OneNoteExplorerPlugin, { VIEW_TYPE_ONENOTE_EXPLORER } from '../main';
import { showExplorerContextMenu } from './context-menu';
import { renderColumnElement } from './column-renderer';
import { handleCreateNewNote, handleCreateNewFolder, handleRenameItem, handleDeleteItem, handleMoveItem } from './file-operations'; // Added handleMoveItem
import { addDragScrolling, attemptInlineTitleFocus } from './dom-helpers';
// import { InputModal } from './InputModal'; // No longer needed
import { EmojiPickerModal } from './EmojiPickerModal'; // Added: Import EmojiPickerModal
export class ColumnExplorerView extends ItemView {
  containerEl: HTMLElement;
  plugin: OneNoteExplorerPlugin;
  // Store the cleanup function for drag scrolling listeners
  private cleanupDragScrolling: (() => void) | null = null;
  // State for drag-over folder opening
  private dragOverTimeoutId: number | null = null;
  private dragOverTargetElement: HTMLElement | null = null;
  private readonly DRAG_FOLDER_OPEN_DELAY = 500; // ms

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
      this.handleItemClick.bind(this),
      this.renderColumn.bind(this),
      this.handleDrop.bind(this),
      // Pass new drag-over callbacks and delay
      this.setDragOverTimeout.bind(this),
      this.clearDragOverTimeout.bind(this),
      this.triggerFolderOpenFromDrag.bind(this),
      this.DRAG_FOLDER_OPEN_DELAY // Pass the constant
    );
  }

  // Helper to refresh a specific column in place
  async refreshColumnByPath(folderPath: string): Promise<HTMLElement | null> {
    console.log(`[REFRESH] Attempting for path: "${folderPath}"`);
    // Use path directly in selector, assuming no problematic characters for now
    const columnSelector = `.onenote-explorer-column[data-path="${folderPath}"]`;
    console.log(`[REFRESH] Using selector: "${columnSelector}"`);
    const columnEl = this.containerEl.querySelector(columnSelector) as HTMLElement | null;
    if (columnEl) {
      const depthStr = columnEl.dataset.depth;
      const depth = depthStr ? parseInt(depthStr) : 0;
      await this.renderColumn(folderPath, depth, columnEl); // Update existing element
      console.log(`[REFRESH] Found column, re-rendering for path: "${folderPath}"`);
      return columnEl;
    } else {
      console.warn(`[REFRESH] Could not find column element for path: "${folderPath}". Falling back to full refresh.`);
      await this.renderColumns();
      console.log(`[REFRESH] Fallback refresh complete.`);
      return null;
    }
  }

  // --- Event Handlers / Callbacks ---

  // Handles clicks on items within columns
  handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
    const columns = Array.from(this.containerEl.children) as HTMLElement[];

    // --- 1. Clear ALL existing selection classes ---
    this.containerEl.querySelectorAll('.onenote-explorer-item.is-selected-final, .onenote-explorer-item.is-selected-path').forEach(el => {
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
      const selector = `.onenote-explorer-item[data-path="${escapedPath}"]`;
      const itemToMarkAsPath = pathColumn.querySelector(selector) as HTMLElement | null;
      if (itemToMarkAsPath) {
        itemToMarkAsPath.addClass('is-selected-path');
      } else {
        console.warn(`[Select Path] Could not find item for path "${nextColumnPath}" in column ${i}`);
        // Note: console.warn remains for cases where item isn't found
      }
    }

    // --- 4. Remove columns to the right ---
    // Use slice to get columns strictly after the current depth
    const columnsToRemove = columns.slice(depth + 1);
    columnsToRemove.forEach(col => col.remove());


    // --- 5. Open Next Column if Folder ---
    if (isFolder) {
      const folderPath = clickedItemEl.dataset.path;
      if (folderPath) {
        // Check if the next column already exists and represents this folder path
        const nextColumnExists = columns[depth + 1]?.dataset.path === folderPath;
        if (!nextColumnExists) {
          try {
            this.renderAndAppendNextColumn(folderPath, depth);
          } catch (error) {
            console.error(`Error rendering next column for folder ${folderPath}:`, error);
            new Notice(`Error opening folder: ${error.message || 'Unknown error'}`);
          }
        } else {
          console.log("Next column already exists for this path, not re-rendering.");
        }
      }
    }

    // --- 6. Auto Scroll ---
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
      // Scroll logic moved here to ensure it runs after append.
      requestAnimationFrame(() => {
        this.containerEl.scrollTo({ left: this.containerEl.scrollWidth, behavior: 'smooth' });
      });
    }
  }

  // --- Drag Over Timeout Management ---

  setDragOverTimeout(id: number, target: HTMLElement) {
    this.clearDragOverTimeout(); // Clear any existing one first
    this.dragOverTimeoutId = id;
    this.dragOverTargetElement = target;
  }

  clearDragOverTimeout() {
    if (this.dragOverTimeoutId !== null) {
      clearTimeout(this.dragOverTimeoutId);
      this.dragOverTimeoutId = null;
    }
    // Optionally remove highlight if needed, though dragleave should handle it
    if (this.dragOverTargetElement) {
      this.dragOverTargetElement.removeClass('drag-over'); // Ensure highlight is removed
      this.dragOverTargetElement = null;
    }
  }

  // Triggers opening a folder column during drag-over
  triggerFolderOpenFromDrag(folderPath: string, depth: number) {
    console.log(`Triggering folder open from drag: ${folderPath}`);
    // Check if the folder isn't already the last opened column
    const columns = Array.from(this.containerEl.children) as HTMLElement[];
    const lastColumn = columns[columns.length - 1];
    if (!lastColumn || lastColumn.dataset.path !== folderPath) {
      // Remove columns to the right first (simulates click)
      for (let i = columns.length - 1; i > depth; i--) {
        const colDepthStr = columns[i].dataset.depth;
        if (colDepthStr !== undefined && parseInt(colDepthStr) > depth) {
          columns[i].remove();
        }
      }
      // Now render the new column
      this.renderAndAppendNextColumn(folderPath, depth);
    } else {
      console.log("Folder already open as last column, not re-triggering from drag.");
    }
    // Clear the timeout state as the action is done
    this.dragOverTimeoutId = null;
    this.dragOverTargetElement = null;
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

  // Handles the drop event, calling the file operation
  async handleDrop(sourcePath: string, targetFolderPath: string) {
    console.log(`View received drop: Moving ${sourcePath} to ${targetFolderPath}`);
    // Call the actual move handler and check result
    const moveSuccess = await handleMoveItem(this.app, sourcePath, targetFolderPath, this.refreshColumnByPath.bind(this));

    if (moveSuccess) {
      // Find the column for the target folder's parent to get its depth
      const targetFolder = this.app.vault.getAbstractFileByPath(targetFolderPath);
      const parentOfTarget = targetFolder?.parent;
      const parentPath = parentOfTarget?.path || '/'; // Handle root case
      const parentColumnSelector = `.onenote-explorer-column[data-path="${parentPath}"]`;
      const parentColumnEl = this.containerEl.querySelector(parentColumnSelector) as HTMLElement | null;
      const parentDepth = parentColumnEl ? parseInt(parentColumnEl.dataset.depth || '-1') : -1;

      if (parentDepth !== -1) {
        // Check if the target folder's column is already the last one open
        const columns = Array.from(this.containerEl.children) as HTMLElement[];
        const lastColumn = columns[columns.length - 1];
        const targetAlreadyOpen = lastColumn?.dataset.path === targetFolderPath;

        if (!targetAlreadyOpen) {
          console.log(`Target folder "${targetFolderPath}" not open, opening its column after drop.`);
          // Use a slight delay to ensure refresh completes DOM updates
          setTimeout(() => {
            this.renderAndAppendNextColumn(targetFolderPath, parentDepth + 1);
          }, 50);
        } else {
          console.log(`Target folder "${targetFolderPath}" column already open after drop.`);
        }
      } else {
        console.warn(`Could not find parent column for target folder "${targetFolderPath}" to determine depth for opening after drop.`);
      }
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
      createNewFolder: this.createNewFolder.bind(this),
      setEmoji: this.handleSetEmoji.bind(this), // Pass the emoji handler
      setIcon: this.handleSetIcon.bind(this)   // Pass the new icon handler
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
      this.plugin, // Pass the plugin instance
      itemPath,
      isFolder,
      this.refreshColumnByPath.bind(this)
    );
  }

  // --- Emoji Handling ---

  private async handleSetEmoji(itemPath: string, isFolder: boolean) {
    // Use the new EmojiPickerModal
    new EmojiPickerModal(this.app, async (selectedEmoji) => {
      const currentEmoji = this.plugin.settings.emojiMap[itemPath];
      let changed = false;

      if (selectedEmoji) { // User selected an emoji
        if (currentEmoji !== selectedEmoji) {
          this.plugin.settings.emojiMap[itemPath] = selectedEmoji;
          changed = true;
        }
      } else { // User clicked "Remove Emoji" (or closed modal without selection - handled by modal)
        if (itemPath in this.plugin.settings.emojiMap) {
          delete this.plugin.settings.emojiMap[itemPath];
          changed = true;
        }
      }

      if (changed) {
        await this.plugin.saveSettings();
        // Refresh the column containing the item
        const abstractItem = this.app.vault.getAbstractFileByPath(itemPath);
        const parentPath = abstractItem?.parent?.path || '/'; // Get parent path for refresh
        await this.refreshColumnByPath(parentPath);
        // Also refresh the item's own column if it's a folder and was open
        if (isFolder) {
          // Check if the folder's column exists before trying to refresh
          const folderColumnSelector = `.onenote-explorer-column[data-path="${itemPath}"]`;
          if (this.containerEl.querySelector(folderColumnSelector)) {
            await this.refreshColumnByPath(itemPath);
          }
        }
      }
    }).open();
  }

  // --- Custom Icon Handling ---

  private async handleSetIcon(itemPath: string, isFolder: boolean) {
    console.log(`Setting custom icon for: ${itemPath}`);

    // Create a hidden file input element
    const fileInput = createEl('input', {
      type: 'file',
      attr: {
        accept: 'image/png, image/jpeg, image/gif, image/svg+xml, image/webp', // Accept common image types
        style: 'display: none;' // Hide the element
      }
    });

    // Append to body temporarily to allow click trigger
    document.body.appendChild(fileInput);

    // Listen for file selection
    fileInput.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) {
        console.log("No file selected.");
        document.body.removeChild(fileInput); // Clean up
        return;
      }

      const file = files[0];
      console.log(`Selected file: ${file.name}, type: ${file.type}, size: ${file.size}`);

      try {
        // Read file content as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Define the target directory for icons (plugin's root data folder)
        const pluginDataDir = `.obsidian/plugins/${this.plugin.manifest.id}`;

        // Ensure the directory exists
        if (!await this.app.vault.adapter.exists(pluginDataDir)) {
          console.log(`Plugin data directory not found, creating: ${pluginDataDir}`);
          await this.app.vault.adapter.mkdir(pluginDataDir);
        }

        // Generate a unique filename
        const uniqueFilename = `${Date.now()}-${file.name}`;
        const iconFullPath = `${pluginDataDir}/${uniqueFilename}`; // Save directly in the plugin data dir

        // Save the file
        await this.app.vault.adapter.writeBinary(iconFullPath, arrayBuffer);
        console.log(`Icon saved to: ${iconFullPath}`);

        // Update settings
        this.plugin.settings.iconAssociations[itemPath] = uniqueFilename; // Store only the filename
        await this.plugin.saveSettings();
        console.log(`Icon association saved for ${itemPath}: ${uniqueFilename}`);

        // Refresh the relevant column(s)
        const abstractItem = this.app.vault.getAbstractFileByPath(itemPath);
        const parentPath = abstractItem?.parent?.path || '/'; // Refresh parent column
        await this.refreshColumnByPath(parentPath);

        // Also refresh the item's own column if it's a folder and was open
        if (isFolder) {
          const folderColumnSelector = `.onenote-explorer-column[data-path="${CSS.escape(itemPath)}"]`; // Use CSS.escape for safety
          if (this.containerEl.querySelector(folderColumnSelector)) {
            await this.refreshColumnByPath(itemPath);
          }
        }

        new Notice(`Custom icon set for ${abstractItem?.name || itemPath}`);

      } catch (error) {
        console.error("Error processing or saving custom icon:", error);
        new Notice("Failed to set custom icon. Check console for details.");
      } finally {
        // Clean up the input element regardless of success/failure
        document.body.removeChild(fileInput);
      }
    };

    // Trigger the file picker
    fileInput.click();
  }
}