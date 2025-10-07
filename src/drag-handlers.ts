import { IColumnExplorerView } from './types';
import { handleMoveItem, copyExternalFilesToVault } from './file-operations';

export class DragManager {
  private view: IColumnExplorerView;
  private dragOverTimeoutId: number | null = null;
  private dragOverTargetElement: HTMLElement | null = null;
  readonly DRAG_FOLDER_OPEN_DELAY = 500; // ms

  constructor(view: IColumnExplorerView) {
    this.view = view;
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
  triggerFolderOpenFromDrag(folderPath: string, depth: number) {
    if (!this.view.columnsContainerEl) return;
    console.log(`Triggering folder open from drag: ${folderPath}`);

    // Check if the folder isn't already the last opened column
    const columns = Array.from(this.view.columnsContainerEl.children) as HTMLElement[];
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
      this.view.renderAndAppendNextColumn(folderPath, depth);
    } else {
      console.log("Folder already open as last column, not re-triggering from drag.");
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
