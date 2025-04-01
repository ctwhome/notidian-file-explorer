import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { InputModal } from './InputModal'; // Assuming InputModal is in the same src directory

// Helper function to find a unique path (could also be in a separate utils file)
export async function findUniquePath(app: App, folderPath: string, baseName: string, extension: string): Promise<string> {
  let counter = 0;
  let newPath = normalizePath(`${folderPath}/${baseName}${extension}`);
  const adapter = app.vault.adapter;

  while (await adapter.exists(newPath)) {
    counter++;
    newPath = normalizePath(`${folderPath}/${baseName} ${counter}${extension}`);
  }
  return newPath;
}

// --- Create Operations ---

export async function handleCreateNewNote(
  app: App,
  folderPath: string,
  fileExtension = '.md',
  templatePath: string | undefined,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>,
  selectAndFocusCallback: (itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) => void
) {
  const baseName = "Untitled"; // Use default name
  const fileTypeDesc = fileExtension === '.canvas' ? "Canvas" : (fileExtension === '.excalidraw.md' ? "Excalidraw note" : "Note");
  const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));

  try {
    // Find unique path first
    const newNotePath = await findUniquePath(app, normalizedFolderPath, baseName, fileExtension);
    console.log(`Creating ${fileTypeDesc}: Path="${newNotePath}", ParentFolderToRefresh="${normalizedFolderPath}"`);

    // Create the file
    let newFile: TFile | null = null;
    const excalidrawAutomate = (window as any).ExcalidrawAutomate;
    let apiUsed = false;

    if (fileExtension === '.excalidraw.md' && excalidrawAutomate?.create) {
      console.log("Attempting to use ExcalidrawAutomate API...");
      apiUsed = true;
      try {
        const createOptions: any = {
          filename: newNotePath.split('/').pop()?.replace(fileExtension, ''), // Extract base name for API
          foldername: normalizedFolderPath,
        };
        if (templatePath && templatePath.trim() !== '') {
          console.log(`Using Excalidraw template: "${templatePath}"`);
          createOptions.templatePath = templatePath;
        } else {
          console.log("No specific Excalidraw template path set, using Excalidraw default.");
        }
        const created = await excalidrawAutomate.create(createOptions);
        if (!created) throw new Error("ExcalidrawAutomate.create() did not return success.");

        const createdAbstractFile = app.vault.getAbstractFileByPath(newNotePath);
        if (createdAbstractFile instanceof TFile) {
          newFile = createdAbstractFile;
        } else {
          const altPath = normalizePath(`${normalizedFolderPath}/${newNotePath.split('/').pop()?.replace(fileExtension, '')}.excalidraw`);
          const createdAltAbstractFile = app.vault.getAbstractFileByPath(altPath);
          if (createdAltAbstractFile instanceof TFile) {
            newFile = createdAltAbstractFile;
            console.log("Found created Excalidraw file with .excalidraw extension");
          } else {
            throw new Error(`File not found at "${newNotePath}" or "${altPath}" after ExcalidrawAutomate.create()`);
          }
        }
      } catch (excalidrawError) {
        console.error("ExcalidrawAutomate API create failed:", excalidrawError);
        new Notice(`Failed to create Excalidraw note using API: ${excalidrawError.message}`);
        return; // Stop if API failed
      }
    }

    // Fallback or standard creation
    if (!apiUsed) {
      if (fileExtension === '.excalidraw.md') {
        console.warn("ExcalidrawAutomate API not found. Creating empty Excalidraw file via vault.create.");
      } else {
        console.log("Using standard vault.create...");
      }
      newFile = await app.vault.create(newNotePath, ''); // Creates an empty file
    }

    // --- Post-creation steps ---
    if (newFile instanceof TFile) {
      new Notice(`${fileTypeDesc} "${newFile.basename}" created.`);
      const refreshedColumnEl = await refreshCallback(normalizedFolderPath);

      if (refreshedColumnEl) {
        selectAndFocusCallback(newFile.path, false, refreshedColumnEl); // Trigger selection/focus/open
      }
    } else {
      throw new Error("File object not found after creation or Excalidraw API failed silently.");
    }
  } catch (error) {
    console.error(`Error creating ${fileTypeDesc}:`, error);
    new Notice(`Error creating ${fileTypeDesc}: ${error.message || 'Unknown error'}`);
  }
}


export async function handleCreateNewFolder(
  app: App,
  folderPath: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>,
  selectAndFocusCallback: (itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) => void,
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>,
  containerEl: HTMLElement
) {
  const baseName = "New Folder"; // Use default name
  const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));

  try {
    // Find unique path first
    const newFolderPath = await findUniquePath(app, normalizedFolderPath, baseName, ''); // No extension for folders
    console.log(`Creating folder: Path="${newFolderPath}", ParentFolderToRefresh="${normalizedFolderPath}"`);

    // Create the new folder
    await app.vault.createFolder(newFolderPath);
    const newFolder = app.vault.getAbstractFileByPath(newFolderPath);

    if (newFolder instanceof TFolder) {
      new Notice(`Folder "${newFolder.name}" created.`);
      const refreshedColumnEl = await refreshCallback(normalizedFolderPath);

      if (refreshedColumnEl) {
        // Select the new folder and trigger opening its column
        selectAndFocusCallback(newFolder.path, true, refreshedColumnEl);
        // Render the new folder's column (logic moved to selectAndFocusCallback handler in main view)
      }
    } else {
      throw new Error("Folder creation seemed to succeed but couldn't retrieve TFolder object.");
    }
  } catch (error) {
    console.error(`Error creating folder:`, error);
    new Notice(`Error creating folder: ${error.message || 'Unknown error'}`);
  }
}


// --- Rename Operation ---

export async function handleRenameItem(
  app: App,
  itemPath: string,
  isFolder: boolean,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>
) {
  const item = app.vault.getAbstractFileByPath(itemPath);
  if (!item) {
    new Notice("Item not found.");
    return;
  }

  const currentName = isFolder ? item.name : (item as TFile).basename;

  new InputModal(app, `Rename ${isFolder ? 'Folder' : 'File'}`, "Enter new name", currentName, async (newName) => {
    if (newName === currentName) return;

    if (newName.length === 0) {
      new Notice("Name cannot be empty.");
      return;
    }
    if (/[\\/:*?"<>|]/.test(newName)) {
      new Notice('Name contains invalid characters.');
      return;
    }

    const parentPath = item.parent?.path === '/' ? '' : item.parent?.path;
    const newPath = normalizePath(`${parentPath ? parentPath + '/' : ''}${newName}${isFolder ? '' : '.' + (item as TFile).extension}`);

    try {
      const existingItem = app.vault.getAbstractFileByPath(newPath);
      if (existingItem && existingItem.path !== item.path) {
        new Notice(`An item named "${newName}" already exists.`);
        return;
      }

      await app.vault.rename(item, newPath);
      new Notice(`Renamed to "${newName}${isFolder ? '' : '.' + (item as TFile).extension}"`);

      const parentFolder = item.parent;
      if (parentFolder) {
        await refreshCallback(parentFolder.path);
      } else {
        console.warn("Cannot refresh root via refreshColumnByPath after rename.");
        new Notice("Root folder refresh after rename might require manual view reload.");
      }
    } catch (error) {
      console.error(`Error renaming ${itemPath} to ${newPath}:`, error);
      new Notice(`Error renaming: ${error.message}`);
    }
  }).open();
}

// --- Delete Operation ---

export async function handleDeleteItem(
  app: App,
  itemPath: string,
  isFolder: boolean,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>
) {
  const item = app.vault.getAbstractFileByPath(itemPath);
  if (!item) {
    new Notice("Item not found.");
    return;
  }

  const itemName = item.name;
  const itemType = isFolder ? 'folder' : 'file';

  if (!confirm(`Are you sure you want to delete the ${itemType} "${itemName}"? This will move it to the system trash.`)) {
    return;
  }

  try {
    await app.vault.trash(item, true);
    new Notice(`Deleted ${itemType} "${itemName}".`);

    const parentFolder = item.parent;
    if (parentFolder) {
      await refreshCallback(parentFolder.path);
    } else {
      console.warn("Cannot refresh root via refreshColumnByPath after delete.");
      new Notice("Root folder refresh after delete might require manual view reload.");
    }
  } catch (error) {
    console.error(`Error deleting ${itemPath}:`, error);
    new Notice(`Error deleting ${itemType}: ${error.message}`);
  }
} // End of handleDeleteItem

// --- Move Operation (Drag and Drop) ---

export async function handleMoveItem(
  app: App,
  sourcePath: string,
  targetFolderPath: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>
): Promise<boolean> { // Added return type
  const sourceItem = app.vault.getAbstractFileByPath(sourcePath);
  const targetFolder = app.vault.getAbstractFileByPath(targetFolderPath);

  if (!sourceItem) {
    new Notice(`Source item not found: ${sourcePath}`);
    return false; // Indicate failure
  }
  if (!(targetFolder instanceof TFolder)) {
    new Notice(`Invalid drop target (not a folder): ${targetFolderPath}`);
    return false; // Indicate failure
  }
  if (sourceItem.parent?.path === targetFolder.path) {
    new Notice("Item is already in the target folder.");
    return false; // Indicate failure
  }
  if (sourceItem instanceof TFolder && targetFolderPath.startsWith(sourcePath + '/')) {
    new Notice("Cannot move a folder into itself or a subfolder.");
    return false; // Indicate failure
  }

  // Capture the original parent path HERE, before the try block
  const originalParentPath = sourceItem.parent?.path;
  console.log(`[MOVE] Captured original parent path: "${originalParentPath}"`);

  const newPath = normalizePath(`${targetFolderPath}/${sourceItem.name}`);

  try {
    // Check for conflict at the destination FIRST
    const existingItem = app.vault.getAbstractFileByPath(newPath);
    if (existingItem) {
      new Notice(`An item named "${sourceItem.name}" already exists in "${targetFolder.name}".`);
      return false; // Indicate failure
    }

    // Perform the move
    console.log(`Moving "${sourcePath}" to "${newPath}"`);
    await app.vault.rename(sourceItem, newPath); // rename is used for moving
    new Notice(`Moved "${sourceItem.name}" to "${targetFolder.name}".`);

    // Refresh the original source parent folder using the CAPTURED path
    if (originalParentPath) {
      console.log(`[MOVE] Attempting to refresh original parent: "${originalParentPath}"`);
      await refreshCallback(originalParentPath);
    } else {
      // If originalParentPath is undefined, it means the source was in the root
      console.log("[MOVE] Original parent was root, attempting to refresh root column.");
      await refreshCallback('/'); // Explicitly refresh root
    }

    // Refresh the target folder
    console.log(`[MOVE] Attempting to refresh target folder: "${targetFolderPath}"`);
    await refreshCallback(targetFolderPath);

    return true; // Indicate success

  } catch (error) {
    // Log error specific to the move operation
    console.error(`Error moving ${sourcePath} to ${newPath}:`, error);
    new Notice(`Error moving item: ${error.message || 'Unknown error'}`);
    return false; // Indicate failure
  }
}

