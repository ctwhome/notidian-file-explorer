import { IColumnExplorerView } from './types';
import { handleMoveItem, copyExternalFilesToVault } from './file-operations';

export class DragManager {
  private view: IColumnExplorerView;
  private dragOverTimeoutId: number | null = null;
  private dragOverTargetElement: HTMLElement | null = null;

  constructor(view: IColumnExplorerView) {
    this.view = view;
  }

  get DRAG_FOLDER_OPEN_DELAY(): number {
    return this.view.plugin.settings.dragFolderOpenDelay;
  }

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
  async triggerFolderOpenFromDrag(folderPath: string, depth: number) {
    if (!this.view.columnsContainerEl) return;
    console.log(`Triggering folder open from drag: ${folderPath}`);

    const columns = Array.from(this.view.columnsContainerEl.children) as HTMLElement[];
    const targetDepth = depth + 1;

    // Find existing column at the target depth
    const existingColumnAtDepth = columns.find(col => {
      const colDepth = col.dataset.depth;
      return colDepth !== undefined && parseInt(colDepth) === targetDepth;
    });

    // Check if folder is already open at the target position
    if (existingColumnAtDepth && existingColumnAtDepth.dataset.path === folderPath) {
      console.log("Folder already open at this position, not re-triggering from drag.");
      this.dragOverTimeoutId = null;
      this.dragOverTargetElement = null;
      return;
    }

    // Render the new column first (reusing existing element if available to avoid flicker)
    await this.view.renderAndReplaceNextColumn(folderPath, depth, existingColumnAtDepth);

    // Now remove any columns beyond the target depth
    const updatedColumns = Array.from(this.view.columnsContainerEl.children) as HTMLElement[];
    for (let i = updatedColumns.length - 1; i >= 0; i--) {
      const colDepthStr = updatedColumns[i].dataset.depth;
      if (colDepthStr !== undefined && parseInt(colDepthStr) > targetDepth) {
        updatedColumns[i].remove();
      }
    }

    // Clear the timeout state as the action is done
    this.dragOverTimeoutId = null;
    this.dragOverTargetElement = null;
  }

  // Handles the drop event for internal vault files, calling the file operation
  async handleDrop(sourcePath: string, targetFolderPath: string) {
    console.log(`View received drop: Moving ${sourcePath} to ${targetFolderPath}`);

    // Call the actual move handler and check result
    const moveSuccess = await handleMoveItem(
      this.view.app,
      sourcePath,
      targetFolderPath,
      this.view.refreshColumnByPath.bind(this.view)
    );

    // The refreshCallback calls within handleMoveItem should handle updating
    // the necessary columns (original parent and target folder).
  }

  // Handles the drop event for external files (from OS file system)
  async handleExternalFileDrop(files: FileList, targetFolderPath: string) {
    console.log(`View received external file drop: ${files.length} file(s) to ${targetFolderPath}`);

    // Call the copy handler to bring external files into the vault
    await copyExternalFilesToVault(
      this.view.app,
      files,
      targetFolderPath,
      this.view.refreshColumnByPath.bind(this.view)
    );
  }
}
