import { Notice } from 'obsidian';
import { IColumnExplorerView } from './types';
import { handleCreateNewNote, handleCreateNewFolder, handleRenameItem, handleDeleteItem } from './file-operations';
import { attemptInlineTitleFocus } from './dom-helpers';

export class FileOperationsManager {
  private view: IColumnExplorerView;

  constructor(view: IColumnExplorerView) {
    this.view = view;
  }

  async createNewNote(folderPath: string, fileExtension = '.md') {
    await handleCreateNewNote(
      this.view.app,
      folderPath,
      fileExtension,
      this.view.plugin.settings.excalidrawTemplatePath,
      this.view.refreshColumnByPath.bind(this.view),
      this.handleSelectAndFocus.bind(this)
    );
  }

  async createNewFolder(folderPath: string) {
    // Check if columnsContainerEl exists before proceeding
    if (!this.view.columnsContainerEl) {
      console.error("Cannot create new folder: Columns container not initialized");
      new Notice("Error: UI not properly initialized");
      return;
    }

    try {
      // First create the folder with default name
      const result = await handleCreateNewFolder(
        this.view.app,
        folderPath,
        this.view.refreshColumnByPath.bind(this.view),
        this.handleSelectAndFocus.bind(this),
        this.view.renderColumn.bind(this.view),
        this.view.columnsContainerEl
      );

      // If folder was created successfully and we have its path, immediately show rename modal
      if (result && result.newFolderPath) {
        // Small delay to ensure UI is updated before showing rename modal
        setTimeout(() => {
          this.renameItem(result.newFolderPath, true);
        }, 100);
      }
    } catch (error) {
      console.error("Error in folder creation process:", error);
      new Notice("Failed to create folder");
    }
  }

  async renameItem(itemPath: string, isFolder: boolean) {
    await handleRenameItem(
      this.view.app,
      itemPath,
      isFolder,
      this.view.refreshColumnByPath.bind(this.view)
    );
  }

  async deleteItem(itemPath: string, isFolder: boolean) {
    await handleDeleteItem(
      this.view.app,
      this.view.plugin,
      itemPath,
      isFolder,
      this.view.refreshColumnByPath.bind(this.view)
    );
  }

  // Callback for file operations to select/focus/open new items
  handleSelectAndFocus(itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) {
    if (!columnEl) {
      console.warn("Cannot select item, parent column element not found.");
      return;
    }
    const newItemEl = columnEl.querySelector(`.notidian-file-explorer-item[data-path="${itemPath}"]`) as HTMLElement | null;
    if (newItemEl) {
      setTimeout(async () => {
        try {
          const depth = parseInt(columnEl.dataset.depth || '0');
          this.view.handleItemClick(newItemEl, isFolder, depth); // Select visually

          if (isFolder) {
            // The call to handleItemClick above already handles opening the next column
            // No need to call renderAndAppendNextColumn directly here.
          } else {
            // Open the new file and attempt inline title focus
            await this.view.app.workspace.openLinkText(itemPath, '', false);
            attemptInlineTitleFocus(this.view.app);
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
}
