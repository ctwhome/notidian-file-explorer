import { InputModal } from './InputModal'; // Import the modal
import { ItemView, WorkspaceLeaf, TFile, TFolder, Menu, TAbstractFile, setIcon, Notice, normalizePath } from 'obsidian';
import OneNoteExplorerPlugin, { VIEW_TYPE_ONENOTE_EXPLORER } from '../main'; // Import plugin class

export class ColumnExplorerView extends ItemView {
  containerEl: HTMLElement;
  plugin: OneNoteExplorerPlugin; // Add plugin instance property
  // Properties for drag scrolling
  isDragging = false;
  startX = 0;
  scrollLeftStart = 0;

  constructor(leaf: WorkspaceLeaf, plugin: OneNoteExplorerPlugin) { // Accept plugin instance
    super(leaf);
    this.plugin = plugin; // Store plugin instance
  }

  getViewType(): string {
    return VIEW_TYPE_ONENOTE_EXPLORER;
  }

  getDisplayText(): string {
    return "OneNote Explorer";
  }

  getIcon(): string {
    // Using 'columns' icon for the view tab
    return "columns";
  }

  async onOpen() {
    console.log("OneNote Explorer View opened");
    this.containerEl = this.contentEl; // Use contentEl directly
    this.containerEl.empty();
    this.containerEl.addClass('onenote-explorer-container');

    // Initial render
    await this.renderColumns();

    // Add context menu listener to the container
    this.containerEl.addEventListener('contextmenu', (event) => {
      this.showContextMenu(event);
    });

    // Add listeners for drag scrolling
    this.containerEl.addEventListener('mousedown', (e) => {
      // Only start drag on primary button and if the target is not an item itself
      const targetElement = e.target as HTMLElement;
      if (e.button !== 0 || targetElement.closest('.onenote-explorer-item')) {
        return; // Don't drag if clicking an item or not primary button
      }
      this.isDragging = true;
      this.startX = e.clientX; // Use clientX for viewport-relative coordinate
      this.scrollLeftStart = this.containerEl.scrollLeft;
      this.containerEl.style.cursor = 'grabbing'; // Change cursor
      this.containerEl.style.userSelect = 'none'; // Prevent text selection
      e.preventDefault(); // Prevent default drag behavior (like text selection)
    });

    this.containerEl.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      // No need for preventDefault here if it's already done in mousedown
      const x = e.clientX; // Use clientX
      const walk = (x - this.startX);
      this.containerEl.scrollLeft = this.scrollLeftStart - walk;
    });

    const stopDragging = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.containerEl.style.cursor = 'grab'; // Restore cursor
      this.containerEl.style.removeProperty('user-select');
    };

    this.containerEl.addEventListener('mouseup', stopDragging);
    this.containerEl.addEventListener('mouseleave', stopDragging);

    // Initial cursor style
    this.containerEl.style.cursor = 'grab';
  }

  async onClose() {
    console.log("OneNote Explorer View closed");
    // Clean up any listeners or resources if needed
    this.containerEl.empty();
  }

  async renderColumns(startFolderPath = '/') {
    this.containerEl.empty(); // Clear previous content for full render
    try {
      const rootColumnEl = await this.renderColumn(startFolderPath, 0);
      if (rootColumnEl) { // renderColumn might return null if error occurs early
        this.containerEl.appendChild(rootColumnEl);
      }
    } catch (error) {
      console.error("Error rendering initial column:", error);
      new Notice(`Error rendering folder: ${startFolderPath}`);
      this.containerEl.createDiv({ text: `Error loading folder: ${startFolderPath}` });
    }
  }

  // Helper to refresh a specific column in place
  async refreshColumnByPath(folderPath: string) {
    console.log(`Attempting to refresh column for path: "${folderPath}"`); // Log path
    const columnSelector = `.onenote-explorer-column[data-path="${folderPath}"]`;
    console.log(`Using selector: "${columnSelector}"`); // Log selector
    const columnEl = this.containerEl.querySelector(columnSelector) as HTMLElement | null;
    if (columnEl) {
      const depthStr = columnEl.dataset.depth;
      const depth = depthStr ? parseInt(depthStr) : 0;
      // Re-render the column, updating the existing element
      await this.renderColumn(folderPath, depth, columnEl);
      console.log(`Finished refreshing column for path: "${folderPath}"`); // Log completion
    } else {
      console.warn(`Could not find column element for path: ${folderPath} to refresh.`);
      // Fallback to full refresh if column not found
      await this.renderColumns();
      console.log(`Fell back to full refresh because column for "${folderPath}" not found.`); // Log fallback
    }
  }

  // Modified renderColumn to accept an optional element to update
  async renderColumn(folderPath: string, depth: number, existingColumnEl?: HTMLElement): Promise<HTMLElement | null> {
    const columnEl = existingColumnEl || createDiv({ cls: 'onenote-explorer-column' });
    // Ensure attributes are set/updated
    columnEl.dataset.path = folderPath;
    columnEl.dataset.depth = String(depth);
    columnEl.empty(); // Clear content before re-rendering

    let tChildren: TAbstractFile[];
    try {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        tChildren = folder.children;
      } else {
        // Handle case where path is not a folder or doesn't exist
        console.warn(`Path is not a folder or does not exist: ${folderPath}`);
        columnEl.createDiv({ text: `Not a folder: ${folderPath}` });
        return existingColumnEl ? null : columnEl; // Return null if updating existing, element if new
      }
    } catch (error) {
      console.error(`Error accessing folder ${folderPath}:`, error);
      columnEl.createDiv({ text: `Error loading: ${folderPath}` });
      return existingColumnEl ? null : columnEl; // Return null if updating existing, element if new
    }

    // Separate folders and files
    const folders: TFolder[] = [];
    const files: TFile[] = [];
    for (const child of tChildren) {
      if (child instanceof TFolder) {
        folders.push(child);
      } else if (child instanceof TFile) {
        files.push(child);
      }
    }

    // Sort folders first, then files, alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    // Render Folders
    // Get exclusion patterns from settings
    const exclusionPatterns = this.plugin.settings.exclusionPatterns
      .split('\n')
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0);

    for (const folder of folders) {
      // Check against exclusion patterns (case-insensitive)
      if (this.isExcluded(folder.path, exclusionPatterns)) {
        continue;
      }
      const folderName = folder.name;
      const itemEl = columnEl.createDiv({ cls: 'onenote-explorer-item nav-folder' });
      itemEl.dataset.path = folder.path; // Store full path
      setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-folder-icon' }), 'folder');
      itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: folderName });

      itemEl.addEventListener('click', async (event) => {
        this.handleItemClick(itemEl, true, depth);
        try {
          const nextColumnEl = await this.renderColumn(folder.path, depth + 1);
          if (nextColumnEl) { // Only append if a new element was created
            this.containerEl.appendChild(nextColumnEl);
          }
          // Scroll container fully to the right after adding a new column
          requestAnimationFrame(() => {
            this.containerEl.scrollTo({
              left: this.containerEl.scrollWidth,
              behavior: 'smooth'
            });
          });
        } catch (error) {
          console.error("Error rendering next column:", error);
          new Notice(`Error rendering folder: ${folderName}`);
        }
      });
    }

    // Render Files
    for (const file of files) {
      // Check against exclusion patterns (case-insensitive)
      if (this.isExcluded(file.path, exclusionPatterns)) {
        continue;
      }
      // Also keep the check for hidden files starting with '.'
      if (file.name.startsWith('.')) continue;

      const fileName = file.name;
      const itemEl = columnEl.createDiv({ cls: 'onenote-explorer-item nav-file' });
      itemEl.dataset.path = file.path; // Store full path
      setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-file-icon' }), 'file-text'); // Generic file icon
      itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: fileName });

      itemEl.addEventListener('click', (event) => {
        this.handleItemClick(itemEl, false, depth);
        this.app.workspace.openLinkText(file.path, '', false); // Open the file
      });
    }

    return columnEl;
  }

  private isExcluded(path: string, patterns: string[]): boolean {
    const lowerPath = path.toLowerCase();
    for (const pattern of patterns) {
      // Simple check: does the path contain the pattern?
      // More complex glob/regex matching could be added here later.
      if (lowerPath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
    // Remove selection from siblings in the same column
    const columnEl = clickedItemEl.parentElement;
    if (columnEl) {
      columnEl.querySelectorAll('.onenote-explorer-item.is-selected').forEach(el => {
        el.removeClass('is-selected');
      });
    }

    // Add selection to the clicked item
    clickedItemEl.addClass('is-selected');

    // Remove columns to the right
    const columns = Array.from(this.containerEl.children) as HTMLElement[];
    for (let i = columns.length - 1; i > depth; i--) {
      // Check dataset.depth exists before parsing
      const colDepthStr = columns[i].dataset.depth;
      if (colDepthStr !== undefined && parseInt(colDepthStr) > depth) {
        columns[i].remove();
      }
    }

    // --- Auto Scroll ---
    // Use requestAnimationFrame to ensure layout is updated after column removal/addition
    requestAnimationFrame(() => {
      const targetColumn = clickedItemEl.closest('.onenote-explorer-column') as HTMLElement | null;
      if (targetColumn) {
        // Scroll the container so the right edge of the target column is visible
        const containerRect = this.containerEl.getBoundingClientRect();
        const columnRect = targetColumn.getBoundingClientRect();
        const scrollLeftTarget = this.containerEl.scrollLeft + columnRect.right - containerRect.right;

        if (scrollLeftTarget > this.containerEl.scrollLeft) { // Only scroll right if needed
          this.containerEl.scrollTo({
            left: scrollLeftTarget + 10, // Add a small buffer
            behavior: 'smooth'
          });
        }
        // Optionally, also scroll if the column is partially hidden to the left
        else if (columnRect.left < containerRect.left) {
          this.containerEl.scrollTo({
            left: this.containerEl.scrollLeft + columnRect.left - containerRect.left - 10, // Add buffer
            behavior: 'smooth'
          });
        }
      }
    });
  }

  private showContextMenu(event: MouseEvent) {
    event.preventDefault(); // Prevent default browser context menu

    const targetEl = event.target as HTMLElement;
    const itemEl = targetEl.closest('.onenote-explorer-item') as HTMLElement | null;
    const columnEl = targetEl.closest('.onenote-explorer-column') as HTMLElement | null;

    const menu = new Menu();
    let menuHasItems = false; // Flag to track if items were added

    let targetPath: string | null = null;
    let isFolder = false;
    let isFile = false;
    let targetFolderForCreation: string | null = null; // Path of the folder where new items should be created

    if (itemEl) {
      // Right-clicked on a file or folder item
      targetPath = itemEl.dataset.path ?? null;
      if (targetPath) {
        const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
        if (abstractFile instanceof TFolder) {
          isFolder = true;
          targetFolderForCreation = targetPath; // Can create inside this folder
        } else if (abstractFile instanceof TFile) {
          isFile = true;
          targetFolderForCreation = abstractFile.parent?.path ?? '/'; // Can create in parent folder
        }
      }
    } else if (columnEl) {
      // Right-clicked on the empty space within a column
      targetFolderForCreation = columnEl.dataset.path ?? '/'; // Can create in this column's folder
    } else {
      // Right-clicked outside any specific column (should be rare, default to root)
      targetFolderForCreation = '/';
    }

    // --- Build Menu Items ---

    if (isFile && targetPath) {
      const file = this.app.vault.getAbstractFileByPath(targetPath) as TFile; // Already checked it's a TFile
      menu.addItem((item) =>
        item
          .setTitle("Open in new tab")
          .setIcon("file-plus")
          .onClick(() => {
            this.app.workspace.openLinkText(file.path, '', true); // true for new tab
          })
      );
      menuHasItems = true;
      menu.addSeparator();
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
            this.renameItem(file.path, false); // Placeholder call
          })
      );
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash")
          .onClick(() => {
            this.deleteItem(file.path, false); // Placeholder call
          })
      );
      menuHasItems = true;
    } else if (isFolder && targetPath) {
      const folder = this.app.vault.getAbstractFileByPath(targetPath) as TFolder; // Already checked it's a TFolder
      menu.addItem((item) =>
        item
          .setTitle("New Note")
          .setIcon("file-plus")
          .onClick(() => {
            this.createNewNote(folder.path); // Placeholder call
          })
      );
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("New Folder")
          .setIcon("folder-plus")
          .onClick(() => {
            this.createNewFolder(folder.path); // Placeholder call
          })
      );
      menuHasItems = true;
      menu.addSeparator();
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
            this.renameItem(folder.path, true); // Placeholder call
          })
      );
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash")
          .onClick(() => {
            this.deleteItem(folder.path, true); // Placeholder call
          })
      );
      menuHasItems = true;
    } else if (targetFolderForCreation) {
      // Clicked on column background or outside
      menu.addItem((item) =>
        item
          .setTitle("New Note")
          .setIcon("file-plus")
          .onClick(() => {
            this.createNewNote(targetFolderForCreation as string); // Placeholder call
          })
      );
      menuHasItems = true;
      menu.addItem((item) =>
        item
          .setTitle("New Folder")
          .setIcon("folder-plus")
          .onClick(() => {
            this.createNewFolder(targetFolderForCreation as string); // Placeholder call
          })
      );
      menuHasItems = true;
    }

    if (menuHasItems) {
      menu.showAtMouseEvent(event);
    }
  }

  // --- Placeholder Action Methods ---
  // These will be implemented in the next step

  private async createNewNote(folderPath: string) {
    new InputModal(this.app, "Create New Note", "Enter note name (without .md)", "", async (noteName) => {
      // Ensure folderPath doesn't have trailing slash for consistency, unless it's root
      const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));
      // Construct the full path, ensuring it ends with .md
      const newNotePath = normalizePath(`${normalizedFolderPath}/${noteName}.md`);
      console.log(`Creating note: Path="${newNotePath}", ParentFolderToRefresh="${normalizedFolderPath}"`); // Log paths

      try {
        // Check if file already exists
        const existingFile = this.app.vault.getAbstractFileByPath(newNotePath);
        if (existingFile) {
          new Notice(`File "${noteName}.md" already exists in ${normalizedFolderPath}.`);
          return; // Keep modal open? Or close and show notice? Notice is simpler.
        }

        // Create the new note
        const newFile = await this.app.vault.create(newNotePath, '');
        if (newFile instanceof TFile) { // Check if creation was successful
          new Notice(`Note "${newFile.basename}" created.`);
          // Refresh the parent column
          await this.refreshColumnByPath(normalizedFolderPath);
          // Optional: Open the newly created note
          // this.app.workspace.openLinkText(newFile.path, '', false);
        } else {
          throw new Error("Vault API did not return a file object.");
        }
      } catch (error) {
        console.error(`Error creating note ${newNotePath}:`, error);
        new Notice(`Error creating note: ${error.message || 'Unknown error'}`);
      }
    }).open();
  }

  private async createNewFolder(folderPath: string) {
    new InputModal(this.app, "Create New Folder", "Enter folder name", "", async (folderName) => {
      // Basic validation (already handled by modal, but keep for safety)
      if (folderName.length === 0) {
        new Notice("Folder name cannot be empty."); // Should not happen if modal works
        return;
      }
      // Avoid invalid characters (simplified check)
      if (/[\\/:*?"<>|]/.test(folderName)) {
        new Notice('Folder name contains invalid characters.');
        return; // Keep modal open?
      }

      // Ensure folderPath doesn't have trailing slash for consistency, unless it's root
      const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));
      const newFolderPath = normalizePath(`${normalizedFolderPath}/${folderName}`);
      console.log(`Creating folder: Path="${newFolderPath}", ParentFolderToRefresh="${normalizedFolderPath}"`); // Log paths

      try {
        // Check if folder/file already exists
        const existingItem = this.app.vault.getAbstractFileByPath(newFolderPath);
        if (existingItem) {
          new Notice(`"${folderName}" already exists.`);
          return;
        }

        // Create the new folder
        await this.app.vault.createFolder(newFolderPath);
        new Notice(`Folder "${folderName}" created.`);

        // Refresh the parent column using the normalized path
        await this.refreshColumnByPath(normalizedFolderPath);

      } catch (error) {
        console.error(`Error creating folder ${newFolderPath}:`, error);
        new Notice(`Error creating folder: ${error.message}`);
      }
    }).open();
  }

  private async renameItem(itemPath: string, isFolder: boolean) {
    const item = this.app.vault.getAbstractFileByPath(itemPath);
    if (!item) {
      new Notice("Item not found.");
      return;
    }

    const currentName = isFolder ? item.name : (item as TFile).basename; // Get name without extension for files

    new InputModal(this.app, `Rename ${isFolder ? 'Folder' : 'File'}`, "Enter new name", currentName, async (newName) => {
      if (newName === currentName) return; // Name unchanged

      // Basic validation (already handled by modal, but keep for safety)
      if (newName.length === 0) {
        new Notice("Name cannot be empty.");
        return;
      }
      if (/[\\/:*?"<>|]/.test(newName)) {
        new Notice('Name contains invalid characters.');
        return;
      }

      const parentPath = item.parent?.path === '/' ? '' : item.parent?.path; // Handle root path correctly
      const newPath = normalizePath(`${parentPath ? parentPath + '/' : ''}${newName}${isFolder ? '' : '.' + (item as TFile).extension}`);

      try {
        // Check if item with the new name already exists
        const existingItem = this.app.vault.getAbstractFileByPath(newPath);
        if (existingItem && existingItem.path !== item.path) { // Allow renaming case (e.g., file.md to File.md)
          new Notice(`An item named "${newName}" already exists.`);
          return;
        }

        // Rename the item
        await this.app.vault.rename(item, newPath);
        new Notice(`Renamed to "${newName}${isFolder ? '' : '.' + (item as TFile).extension}"`);

        // Refresh the parent column
        const parentFolder = item.parent;
        if (parentFolder) {
          await this.refreshColumnByPath(parentFolder.path);
        } else {
          // If root, do a full refresh (should be rare for rename)
          await this.renderColumns();
        }
      } catch (error) {
        console.error(`Error renaming ${itemPath} to ${newPath}:`, error);
        new Notice(`Error renaming: ${error.message}`);
      }
    }).open();
  }

  private async deleteItem(itemPath: string, isFolder: boolean) {
    const item = this.app.vault.getAbstractFileByPath(itemPath);
    if (!item) {
      new Notice("Item not found.");
      return;
    }

    const itemName = item.name;
    const itemType = isFolder ? 'folder' : 'file';

    if (!confirm(`Are you sure you want to delete the ${itemType} "${itemName}"? This will move it to the system trash.`)) {
      return; // User cancelled
    }

    try {
      // Use trash instead of delete for safety (moves to system trash)
      await this.app.vault.trash(item, true); // true for system trash
      new Notice(`Deleted ${itemType} "${itemName}".`);

      // Refresh the parent column
      const parentFolder = item.parent;
      if (parentFolder) {
        await this.refreshColumnByPath(parentFolder.path);
      } else {
        // If root, do a full refresh
        await this.renderColumns();
      }

    } catch (error) {
      console.error(`Error deleting ${itemPath}:`, error);
      new Notice(`Error deleting ${itemType}: ${error.message}`);
    }
  }
}