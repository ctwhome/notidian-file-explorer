// Removed duplicate import line
import OneNoteExplorerPlugin, { VIEW_TYPE_ONENOTE_EXPLORER } from '../main';
import { showExplorerContextMenu } from './context-menu';
import { renderColumnElement } from './column-renderer';
import { handleCreateNewNote, handleCreateNewFolder, handleRenameItem, handleDeleteItem, handleMoveItem } from './file-operations'; // Added handleMoveItem
import { addDragScrolling, attemptInlineTitleFocus } from './dom-helpers';
// import { InputModal } from './InputModal'; // No longer needed
import { EmojiPickerModal } from './EmojiPickerModal'; // Added: Import EmojiPickerModal
import { ItemView, WorkspaceLeaf, Notice, normalizePath, TFile, CachedMetadata, TAbstractFile, setIcon } from 'obsidian'; // Added setIcon
export class ColumnExplorerView extends ItemView {
  containerEl: HTMLElement; // The root element provided by ItemView
  columnsContainerEl: HTMLElement | null; // Specific container for columns, sits below header (Allow null)
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
    console.log("OneNote Explorer View opened"); // Reverted log
    this.containerEl = this.contentEl; // This is the root element for the view
    this.containerEl.empty();
    this.containerEl.addClass('onenote-explorer-view-root'); // Use a different class for the root

    // --- Add Header ---
    const headerEl = this.containerEl.createDiv({ cls: 'onenote-explorer-header' });
    const refreshButton = headerEl.createEl('button', { cls: 'onenote-explorer-refresh-button', attr: { 'aria-label': 'Refresh Explorer' } });
    setIcon(refreshButton, 'refresh-cw'); // Use a refresh icon
    refreshButton.addEventListener('click', () => {
      console.log("Manual refresh triggered");
      this.renderColumns(); // Call the full render function for the columns container
    });
    // --- End Header ---

    // --- Add Columns Container ---
    // This element will hold the actual columns and will be scrollable/clearable
    this.columnsContainerEl = this.containerEl.createDiv({ cls: 'onenote-explorer-columns-wrapper' });

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
      this.app.vault.on('rename', this.handleFileRename.bind(this))
    );
  }

  // Removed initializeView method

  async onClose() {
    console.log("OneNote Explorer View closed"); // Reverted log
    // Clean up drag scrolling listeners (was attached to columnsContainerEl)
    if (this.cleanupDragScrolling) {
      this.cleanupDragScrolling();
      this.cleanupDragScrolling = null;
    }
    // Clear drag-over timeout if active
    this.clearDragOverTimeout();
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
      this.handleDrop.bind(this),
      // Pass new drag-over callbacks and delay
      this.setDragOverTimeout.bind(this),
      this.clearDragOverTimeout.bind(this),
      this.triggerFolderOpenFromDrag.bind(this),
      this.DRAG_FOLDER_OPEN_DELAY, // Pass the constant
      this.renameItem.bind(this) // Pass rename callback
    );
  }

  // Helper to refresh a specific column in place
  async refreshColumnByPath(folderPath: string): Promise<HTMLElement | null> {
    if (!this.columnsContainerEl) return null; // Add null check
    console.log(`[REFRESH] Attempting for path: "${folderPath}"`);
    // Use path directly in selector, assuming no problematic characters for now
    const columnSelector = `.onenote-explorer-column[data-path="${folderPath}"]`;
    console.log(`[REFRESH] Using selector: "${columnSelector}"`);
    // Query within the columns container
    const columnEl = this.columnsContainerEl.querySelector(columnSelector) as HTMLElement | null; // Already checked above
    if (columnEl) {
      const depthStr = columnEl.dataset.depth;
      const depth = depthStr ? parseInt(depthStr) : 0;
      await this.renderColumn(folderPath, depth, columnEl); // Update existing element
      console.log(`[REFRESH] Found column, re-rendering for path: "${folderPath}"`);
      return columnEl;
    } else {
      console.warn(`[REFRESH] Could not find column element for path: "${folderPath}". Falling back to full refresh.`);
      await this.renderColumns(); // Full refresh still targets columnsContainerEl
      console.log(`[REFRESH] Fallback refresh complete.`);
      return null;
    }
  }

  // --- Event Handlers / Callbacks ---

  // Handles clicks on items within columns
  handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
    if (!this.columnsContainerEl) return; // Add null check
    // Query within columnsContainerEl
    const columns = Array.from(this.columnsContainerEl.children) as HTMLElement[]; // Already checked above

    // --- 1. Clear ALL existing selection classes ---
    // --- 1. Clear ALL existing selection classes (within columnsContainerEl) ---
    this.columnsContainerEl.querySelectorAll('.onenote-explorer-item.is-selected-final, .onenote-explorer-item.is-selected-path').forEach(el => { // Already checked above
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
      const targetColumn = clickedItemEl.closest('.onenote-explorer-column') as HTMLElement | null;
      if (!this.columnsContainerEl) return; // Add null check for scrolling container
      if (targetColumn) {
        const containerRect = this.columnsContainerEl.getBoundingClientRect(); // Already checked above
        const columnRect = targetColumn.getBoundingClientRect();
        const scrollLeftTarget = this.columnsContainerEl.scrollLeft + columnRect.right - containerRect.right; // Already checked above

        if (scrollLeftTarget > this.columnsContainerEl.scrollLeft) { // Already checked above
          this.columnsContainerEl.scrollTo({ left: scrollLeftTarget + 10, behavior: 'smooth' }); // Already checked above
        } else if (columnRect.left < containerRect.left) {
          this.columnsContainerEl.scrollTo({ left: this.columnsContainerEl.scrollLeft + columnRect.left - containerRect.left - 10, behavior: 'smooth' }); // Already checked above
        }
      }
    });
  }

  // Helper to avoid duplicating async logic in handleItemClick
  private async renderAndAppendNextColumn(folderPath: string, currentDepth: number) {
    if (!this.columnsContainerEl) return; // Add null check
    const nextColumnEl = await this.renderColumn(folderPath, currentDepth + 1);
    if (nextColumnEl && this.columnsContainerEl) { // Add null check for container
      this.columnsContainerEl.appendChild(nextColumnEl); // Already checked above
      // Scroll logic for columnsContainerEl
      requestAnimationFrame(() => {
        // Add null check inside the callback
        if (this.columnsContainerEl) {
          this.columnsContainerEl.scrollTo({ left: this.columnsContainerEl.scrollWidth, behavior: 'auto' });
        }
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
    if (!this.columnsContainerEl) return; // Add null check
    console.log(`Triggering folder open from drag: ${folderPath}`);
    // Check if the folder isn't already the last opened column
    // Query within columnsContainerEl
    const columns = Array.from(this.columnsContainerEl.children) as HTMLElement[]; // Already checked above
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
            // The call to handleItemClick above already handles opening the next column
            // No need to call renderAndAppendNextColumn directly here.
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
      // Variables related to finding the parent depth are no longer needed
      // as the subsequent block using them has been removed.

      // The refreshCallback calls within handleMoveItem should handle updating
      // the necessary columns (original parent and target folder).
      // No need to explicitly check and render the target column here again.
    }
  }


  // --- Context Menu ---

  showContextMenu(event: MouseEvent) {
    if (!this.columnsContainerEl) return; // Don't show context menu if container doesn't exist
    // Prepare callbacks object
    const callbacks = {
      refreshColumnByPath: this.refreshColumnByPath.bind(this),
      selectAndFocusCallback: this.handleSelectAndFocus.bind(this),
      renderColumnCallback: this.renderColumn.bind(this),
      // Pass columnsContainerEl instead of containerEl for context menu actions like creating folders in the background
      // Pass columnsContainerEl, we've already checked it's not null above
      containerEl: this.columnsContainerEl,
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
    if (!this.columnsContainerEl) return; // Add null check before passing container
    await handleCreateNewFolder(
      this.app,
      folderPath,
      this.refreshColumnByPath.bind(this),
      this.handleSelectAndFocus.bind(this),
      this.renderColumn.bind(this), // Pass renderColumn for opening new folder
      this.columnsContainerEl // Already checked above
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
          if (this.columnsContainerEl?.querySelector(folderColumnSelector)) { // Use optional chaining for safety
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

        // Define the target directory (persistent data folder, relative to vault root)
        const dataDir = `.onenote-explorer-data`;
        const iconsDir = `${dataDir}/icons`;
        const normalizedIconsDir = normalizePath(iconsDir); // Use top-level normalizePath

        // Ensure the base data directory exists
        const normalizedDataDir = normalizePath(dataDir);
        try {
          if (!await this.app.vault.adapter.exists(normalizedDataDir)) {
            console.log(`[Icon Save] Data directory not found, attempting creation: ${normalizedDataDir}`);
            await this.app.vault.adapter.mkdir(normalizedDataDir);
            console.log(`[Icon Save] Data directory created successfully: ${normalizedDataDir}`);
          } else {
            console.log(`[Icon Save] Data directory already exists: ${normalizedDataDir}`);
          }
        } catch (mkdirError) {
          console.error(`[Icon Save] Error creating data directory ${normalizedDataDir}:`, mkdirError);
          new Notice(`Error creating data directory: ${mkdirError.message}`);
          document.body.removeChild(fileInput); // Clean up input
          return; // Stop execution if directory creation fails
        }

        // Ensure the icons subdirectory exists
        try {
          if (!await this.app.vault.adapter.exists(normalizedIconsDir)) {
            console.log(`[Icon Save] Icons directory not found, attempting creation: ${normalizedIconsDir}`);
            await this.app.vault.adapter.mkdir(normalizedIconsDir);
            console.log(`[Icon Save] Icons directory created successfully: ${normalizedIconsDir}`);
          } else {
            console.log(`[Icon Save] Icons directory already exists: ${normalizedIconsDir}`);
          }
        } catch (mkdirError) {
          console.error(`[Icon Save] Error creating icons directory ${normalizedIconsDir}:`, mkdirError);
          new Notice(`Error creating icons directory: ${mkdirError.message}`);
          document.body.removeChild(fileInput); // Clean up input
          return; // Stop execution if directory creation fails
        }

        // Generate a unique filename
        const uniqueFilename = `${Date.now()}-${file.name}`;
        // Use normalized path for writing
        const iconFullPath = normalizePath(`${iconsDir}/${uniqueFilename}`); // Use top-level normalizePath

        // Save the file
        console.log(`[Icon Save] Attempting to write icon to: ${iconFullPath}`);
        await this.app.vault.adapter.writeBinary(iconFullPath, arrayBuffer);
        console.log(`[Icon Save] Icon successfully written to vault path: ${iconFullPath}`);

        // Update settings
        console.log(`[Icon Save] Updating settings for ${itemPath} with icon: ${uniqueFilename}`);
        this.plugin.settings.iconAssociations[itemPath] = uniqueFilename; // Store only the filename
        await this.plugin.saveSettings();
        console.log(`[Icon Save] Settings saved successfully.`);

        // Refresh the relevant column(s)
        const abstractItem = this.app.vault.getAbstractFileByPath(itemPath);
        const parentPath = abstractItem?.parent?.path || '/'; // Refresh parent column
        await this.refreshColumnByPath(parentPath);

        // Also refresh the item's own column if it's a folder and was open
        if (isFolder) {
          const folderColumnSelector = `.onenote-explorer-column[data-path="${CSS.escape(itemPath)}"]`; // Use CSS.escape for safety
          if (this.containerEl.querySelector(folderColumnSelector)) {
            await this.refreshColumnByPath(itemPath);
          } // Closing brace for inner if (this.containerEl.querySelector(folderColumnSelector))
        } // Closing brace for outer if (isFolder)

        new Notice(`Custom icon set for ${abstractItem?.name || itemPath}`);

      } catch (error) {
        console.error(`[Icon Save] Error processing or saving icon for ${itemPath}:`, error);
        // Log the specific error object for more details
        console.error("[Icon Save] Full error object:", error);
        new Notice(`Failed to set custom icon. Check console for details. Error: ${error.message}`);
      } finally {
        // Clean up the input element regardless of success/failure
        document.body.removeChild(fileInput);
      }
    }; // End of fileInput.onchange

    // Trigger the file picker
    fileInput.click();
  } // End of handleSetIcon method

  // --- Vault Event Handling ---

  private handleFileRename(file: TAbstractFile, oldPath: string) {
    // We only care about files being renamed in this view
    if (!(file instanceof TFile)) {
      // If a folder is renamed, we might need to update the column header and data-path
      // For now, let's focus on files. A full refresh might be simpler for folders.
      // TODO: Handle folder renames more gracefully?
      console.log(`[Rename Event] Ignoring folder rename: ${oldPath} -> ${file.path}`);
      // Potentially refresh the parent column if a folder is renamed
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
      this.refreshColumnByPath(parentPath); // Refresh parent to show renamed folder
      // Also need to refresh the column *if* it was open under the old name
      const oldFolderColumnSelector = `.onenote-explorer-column[data-path="${CSS.escape(oldPath)}"]`;
      const oldFolderColumnEl = this.containerEl.querySelector(oldFolderColumnSelector) as HTMLElement | null;
      if (oldFolderColumnEl) {
        // Remove the old column, let selection logic handle reopening if necessary
        oldFolderColumnEl.remove();
        console.log(`[Rename Event] Removed column for renamed folder: ${oldPath}`);
        // Maybe try to select the parent folder's item?
        const parentColumnSelector = `.onenote-explorer-column[data-path="${CSS.escape(parentPath)}"]`;
        const parentColumnEl = this.containerEl.querySelector(parentColumnSelector) as HTMLElement | null;
        if (parentColumnEl) {
          const renamedFolderItemSelector = `.onenote-explorer-item[data-path="${CSS.escape(file.path)}"]`;
          const renamedItemEl = parentColumnEl.querySelector(renamedFolderItemSelector) as HTMLElement | null;
          if (renamedItemEl) {
            const depth = parseInt(parentColumnEl.dataset.depth || '0');
            this.handleItemClick(renamedItemEl, true, depth); // Reselect the renamed folder
          }
        }
      }
      return;
    }

    // Find the item element using the OLD path
    const escapedOldPath = CSS.escape(oldPath);
    const itemSelector = `.onenote-explorer-item[data-path="${escapedOldPath}"]`;
    const itemEl = this.containerEl.querySelector(itemSelector) as HTMLElement | null;

    if (itemEl) {
      console.log(`[Rename Event] Found item for old path: ${oldPath}. Updating to: ${file.path}`);
      // Update the data-path attribute to the new path
      itemEl.dataset.path = file.path;

      const titleEl = itemEl.querySelector('.onenote-explorer-item-title');
      if (titleEl) {
        // Recalculate the display name based on the *new* file info
        let displayFileName = file.basename; // Default to basename
        if (file.extension.toLowerCase() === 'md') {
          // Need to get the cache for the *renamed* file
          const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
          const firstHeading = cache?.headings?.[0]?.heading;
          if (firstHeading) {
            displayFileName = firstHeading;
          }
          // Handle Excalidraw naming convention if no H1 is present
          else if (file.name.toLowerCase().endsWith('.excalidraw.md')) {
            displayFileName = file.name.slice(0, -'.excalidraw.md'.length);
          }
        }

        // Update the text content
        titleEl.textContent = displayFileName;
        console.log(`[Rename Event] Updated display name for ${file.path} to "${displayFileName}"`);
      }

      // Refresh parent column to ensure correct sorting after rename
      if (file.parent) {
        console.log(`[Rename Event] Refreshing parent column ${file.parent.path} for sorting.`);
        this.refreshColumnByPath(file.parent.path);
      }

    } else {
      console.log(`[Rename Event] Could not find item for old path: ${oldPath}. Item might not be visible or was in a folder that got renamed.`);
      // If the item wasn't found, its parent column likely needs refreshing anyway.
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
      // Check if the parent column *exists* before refreshing
      const parentColumnSelector = `.onenote-explorer-column[data-path="${CSS.escape(parentPath)}"]`;
      if (this.containerEl.querySelector(parentColumnSelector)) {
        console.log(`[Rename Event] Refreshing parent column ${parentPath} as item was not found.`);
        this.refreshColumnByPath(parentPath);
      } else {
        console.log(`[Rename Event] Parent column ${parentPath} not found either, possibly root or deeper issue.`);
        // As a fallback, maybe refresh the root? Or do nothing if the view is inconsistent.
        // Let's try refreshing root as a last resort if parent path isn't '/'
        if (parentPath !== '/') {
          this.renderColumns(); // Full refresh if parent column isn't visible
        }
      }
    }
  } // End of handleFileRename method

} // End of ColumnExplorerView class