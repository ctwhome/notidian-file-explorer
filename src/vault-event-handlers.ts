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

    // Vault events are the shared path for keyboard, command, and context-menu deletion.
    this.view.columnsContainerEl.querySelectorAll<HTMLElement>(
      `.notidian-file-explorer-item[data-path="${CSS.escape(file.path)}"]`
    ).forEach(item => item.remove());
    await new Promise(resolve => setTimeout(resolve, 0));
    await this.view.refreshColumnByPath(parentPath);

    // --- Remove Deleted Folder's Column (if applicable and visible) ---
    if (file instanceof TFolder) {
      this.view.columnsContainerEl.querySelectorAll<HTMLElement>('.notidian-file-explorer-column').forEach(column => {
        if (column.dataset.path === file.path || column.dataset.path?.startsWith(`${file.path}/`)) column.remove();
      });
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
    const selectedPath = this.view.columnsContainerEl.querySelector<HTMLElement>(
      '.notidian-file-explorer-column-content > .notidian-file-explorer-item.is-selected-final'
    )?.dataset.path;

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

    // --- 3. Remap the renamed folder and every visible descendant column ---
    if (file instanceof TFolder) {
      const affectedColumns = Array.from(this.view.columnsContainerEl.querySelectorAll<HTMLElement>('.notidian-file-explorer-column'))
        .filter(column => column.dataset.path === oldPath || column.dataset.path?.startsWith(`${oldPath}/`));
      for (const column of affectedColumns) {
        const previousPath = column.dataset.path as string;
        const updatedPath = `${file.path}${previousPath.slice(oldPath.length)}`;
        this.view.remapColumnState(previousPath, updatedPath);
        if (newParentPath !== oldParentPath) {
          column.remove();
        } else {
          const depth = parseInt(column.dataset.depth || '0');
          column.dataset.path = updatedPath;
          await this.view.renderColumn(updatedPath, depth, column);
        }
      }
    }

    // --- 4. Update Selection State (if necessary) ---
    const updatedSelectedPath = selectedPath && (selectedPath === oldPath || selectedPath.startsWith(`${oldPath}/`))
      ? `${file.path}${selectedPath.slice(oldPath.length)}`
      : selectedPath;
    if (updatedSelectedPath) {
      const selectedItem = this.view.columnsContainerEl.querySelector<HTMLElement>(
        `.notidian-file-explorer-column-content > .notidian-file-explorer-item[data-path="${CSS.escape(updatedSelectedPath)}"]`
      );
      const selectedFile = this.view.app.vault.getAbstractFileByPath(updatedSelectedPath);
      const selectedColumn = selectedItem?.closest<HTMLElement>('.notidian-file-explorer-column');
      if (selectedItem && selectedColumn) {
        const depth = parseInt(selectedColumn.dataset.depth || '0');
        setTimeout(() => this.view.handleItemClick(selectedItem, selectedFile instanceof TFolder, depth), 50);
      }
    }
  }
}
