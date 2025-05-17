import { TAbstractFile, TFolder, FileView } from 'obsidian';
import { IColumnExplorerView } from './types';

export class VaultEventManager {
  private view: IColumnExplorerView;

  constructor(view: IColumnExplorerView) {
    this.view = view;
  }

  // Handles vault 'delete' event to refresh the parent column
  async handleFileDelete(file: TAbstractFile) {
    if (!this.view.columnsContainerEl) return; // View might be closing

    const parentPath = file.parent?.path || '/'; // Get parent path, default to root
    console.log(`[Vault Event] Delete detected for "${file.path}". Refreshing parent: "${parentPath}"`);

    // Immediate DOM removal logic removed.
    // Refresh logic is triggered directly from handleDeleteItem after vault.trash completes.
    // This listener handles closing open tabs AND removing the column if the deleted item was a folder.

    // --- Remove Deleted Folder's Column (if applicable and visible) ---
    if (file instanceof TFolder) {
      const deletedColumnSelector = `.notidian-file-explorer-column[data-path="${file.path}"]`;
      const deletedColumnEl = this.view.columnsContainerEl.querySelector(deletedColumnSelector);
      if (deletedColumnEl) {
        console.log(`[Vault Event] Removing column for deleted folder: "${file.path}"`);
        deletedColumnEl.remove();
      } else {
        console.log(`[Vault Event] Column for deleted folder "${file.path}" not found or already removed.`);
      }
    }

    // --- Close Open Tabs for the Deleted File ---
    // Check only markdown leaves for now, adjust if other file types are relevant
    this.view.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
      // Check if the view in the leaf is a FileView and if its file path matches the deleted file's path
      if (leaf.view instanceof FileView && leaf.view.file?.path === file.path) {
        console.log(`[Vault Event] Closing open tab for deleted file: "${file.path}"`);
        leaf.detach(); // Close the tab
      }
    });
  }

  // Handles vault 'rename' event (including moves)
  async handleFileRename(file: TAbstractFile, oldPath: string) {
    if (!this.view.columnsContainerEl) return; // View might be closing

    console.log(`[Vault Event] Rename/Move detected: "${oldPath}" -> "${file.path}"`);

    // --- 1. Refresh the OLD parent column ---
    const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
    console.log(`[Vault Event] Refreshing old parent: "${oldParentPath}"`);
    await this.view.refreshColumnByPath(oldParentPath); // Refresh even if column not visible, might become visible

    // --- 2. Refresh the NEW parent column ---
    const newParentPath = file.parent?.path || '/';
    if (newParentPath !== oldParentPath) {
      console.log(`[Vault Event] Refreshing new parent: "${newParentPath}"`);
      await this.view.refreshColumnByPath(newParentPath);
    } else {
      console.log(`[Vault Event] New parent is the same as old parent ("${newParentPath}"), skipping redundant refresh.`);
    }

    // --- 3. Update or remove the column representing the item itself (if it was a folder) ---
    const oldColumnSelector = `.notidian-file-explorer-column[data-path="${oldPath}"]`;
    const oldColumnEl = this.view.columnsContainerEl.querySelector(oldColumnSelector) as HTMLElement | null;

    if (oldColumnEl) {
      if (file instanceof TFolder) {
        // If it was a folder and still exists (renamed/moved), update its path and re-render its content
        console.log(`[Vault Event] Updating column for renamed/moved folder: "${oldPath}" -> "${file.path}"`);
        const depthStr = oldColumnEl.dataset.depth;
        const depth = depthStr ? parseInt(depthStr) : 0;
        // Update the data-path attribute *before* re-rendering
        oldColumnEl.dataset.path = file.path;
        await this.view.renderColumn(file.path, depth, oldColumnEl); // Re-render with new path
      } else {
        // If it was a folder but is now somehow a file (unlikely vault event?), remove column
        console.log(`[Vault Event] Item at "${oldPath}" is no longer a folder after rename/move. Removing its column.`);
        oldColumnEl.remove();
      }
    } else {
      console.log(`[Vault Event] No column found for old path "${oldPath}", no column update needed.`);
    }

    // --- 4. Update Selection State (if necessary) ---
    // Find the newly renamed/moved item in its *new* parent column
    const newParentColumnSelector = `.notidian-file-explorer-column[data-path="${newParentPath}"]`;
    const newParentColumnEl = this.view.columnsContainerEl.querySelector(newParentColumnSelector) as HTMLElement | null;
    if (newParentColumnEl) {
      const newItemSelector = `.notidian-file-explorer-item[data-path="${file.path}"]`;
      const newItemEl = newParentColumnEl.querySelector(newItemSelector) as HTMLElement | null;
      if (newItemEl) {
        // Check if the *old* path was part of the selection path
        const oldItemSelector = `.notidian-file-explorer-item[data-path="${oldPath}"]`;
        const oldItemInOldParent = this.view.columnsContainerEl.querySelector(
          `.notidian-file-explorer-column[data-path="${oldParentPath}"] ${oldItemSelector}`
        ) as HTMLElement | null;

        if (oldItemInOldParent?.classList.contains('is-selected-final') || oldItemInOldParent?.classList.contains('is-selected-path')) {
          console.log(`[Vault Event] Re-selecting renamed/moved item: "${file.path}"`);
          const depth = parseInt(newParentColumnEl.dataset.depth || '0');
          // Use a slight delay to ensure rendering is complete before clicking
          setTimeout(() => {
            this.view.handleItemClick(newItemEl, file instanceof TFolder, depth);
          }, 50); // Small delay
        }
      }
    }
  }
}
