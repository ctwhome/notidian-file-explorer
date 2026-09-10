import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { getRenameParts, validateItemName } from './explorer-utils';

const MAX_EXTERNAL_IMPORT_SIZE = 250 * 1024 * 1024;

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

export async function importExternalFiles(
  app: App,
  files: File[],
  targetFolderPath: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>
): Promise<{ imported: number; failed: number; refreshFailed: boolean }> {
  const normalizedFolderPath = targetFolderPath === '/' ? '/' : normalizePath(targetFolderPath.replace(/\/$/, ''));
  if (!(app.vault.getAbstractFileByPath(normalizedFolderPath) instanceof TFolder)) {
    throw new Error('Drop target is not a folder.');
  }

  let imported = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const validationError = validateItemName(file.name);
      if (validationError) throw new Error(validationError);
      if (file.size > MAX_EXTERNAL_IMPORT_SIZE) throw new Error('File exceeds the 250 MB import limit.');
      const { name, suffix } = getRenameParts(file.name, false);
      const destination = await findUniquePath(app, normalizedFolderPath, name, suffix);
      await app.vault.createBinary(destination, await file.arrayBuffer());
      imported++;
    } catch (error) {
      failed++;
      console.error(`[Notidian Explorer] Could not import ${file.name}:`, error);
    }
  }
  let refreshFailed = false;
  if (imported) {
    try {
      await refreshCallback(normalizedFolderPath);
    } catch (error) {
      refreshFailed = true;
      console.error('[Notidian Explorer] Imported files but could not refresh the target folder:', error);
    }
  }
  return { imported, failed, refreshFailed };
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
  selectAndFocusCallback: (itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) => void
): Promise<{ newFolderPath: string } | null> {
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

      // Return the new folder path so the caller can show the rename modal
      return { newFolderPath: newFolder.path };
    } else {
      throw new Error("Folder creation seemed to succeed but couldn't retrieve TFolder object.");
    }
  } catch (error) {
    console.error(`Error creating folder:`, error);
    new Notice(`Error creating folder: ${error.message || 'Unknown error'}`);
    return null;
  }
}


// --- Rename Operation ---

export async function handleRenameItem(
  app: App,
  itemPath: string,
  isFolder: boolean,
  newName: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>
): Promise<boolean> {
  const item = app.vault.getAbstractFileByPath(itemPath);
  if (!item) {
    new Notice("Item not found.");
    return false;
  }

  const renameParts = getRenameParts(item.name, isFolder);
  const currentName = renameParts.name;
  const trimmedName = newName.trim();
  if (trimmedName === currentName) return true;

  const validationError = validateItemName(trimmedName);
  if (validationError) {
    new Notice(validationError);
    return false;
  }
  const parentPath = item.parent?.path === '/' ? '' : item.parent?.path;
  const suffix = renameParts.suffix;
  const newPath = normalizePath(`${parentPath ? parentPath + '/' : ''}${trimmedName}${suffix}`);

  try {
    const existingItem = app.vault.getAbstractFileByPath(newPath);
    if (existingItem && existingItem.path !== item.path) {
      new Notice(`An item named "${trimmedName}" already exists.`);
      return false;
    }

    await app.vault.rename(item, newPath);
    new Notice(`Renamed to "${trimmedName}${suffix}"`);

    const parentFolder = item.parent;
    if (parentFolder) {
      await refreshCallback(parentFolder.path);
    } else {
      console.warn("Cannot refresh root via refreshColumnByPath after rename.");
      new Notice("Root folder refresh after rename might require manual view reload.");
    }
    return true;
  } catch (error) {
    console.error(`Error renaming ${itemPath} to ${newPath}:`, error);
    new Notice(`Error renaming: ${error.message}`);
    return false;
  }
}

// --- Delete Operation ---

import NotidianExplorerPlugin from '../main'; // Import the plugin class

export async function handleDeleteItem(
  app: App,
  plugin: NotidianExplorerPlugin, // Add plugin instance parameter
  itemPath: string,
  isFolder: boolean,
  showNotice = true
): Promise<boolean> {
  const item = app.vault.getAbstractFileByPath(itemPath);
  if (!item) {
    new Notice("Item not found.");
    return false;
  }

  const itemName = item.name;
  const itemType = isFolder ? 'folder' : 'file';
  const iconAssociations = plugin.settings.iconAssociations;
  const associatedIconFilename = iconAssociations[itemPath];

  try {
    await app.vault.trash(item, true);
  } catch (error) {
    console.error(`Error deleting ${itemPath}:`, error);
    new Notice(`Error deleting ${itemType}: ${error.message}`);
    return false;
  }

  if (associatedIconFilename) {
    try {
      console.log(`Item "${itemPath}" has associated icon "${associatedIconFilename}". Removing.`);
      if (iconAssociations[itemPath]) {
        delete iconAssociations[itemPath];
        await plugin.saveSettings();
      }

      const iconFullPath = normalizePath(`Assets/notidian-file-explorer-data/images/${associatedIconFilename}`);
      if (!Object.values(iconAssociations).includes(associatedIconFilename) && await app.vault.adapter.exists(iconFullPath)) {
        await app.vault.adapter.remove(iconFullPath);
        console.log(`Deleted associated icon file: ${iconFullPath}`);
      }
    } catch (iconError) {
      console.error(`Error cleaning up associated icon for ${itemPath}:`, iconError);
      new Notice(`The item was deleted, but its custom icon could not be cleaned up.`);
    }
  }

  if (showNotice) new Notice(`Deleted ${itemType} "${itemName}".`);
  return true;
} // End of handleDeleteItem

// --- Move Operation (Drag and Drop) ---

export async function handleMoveItem(
  app: App,
  sourcePath: string,
  targetFolderPath: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>,
  showNotice = true
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
  if (sourceItem instanceof TFolder && (targetFolderPath === sourcePath || targetFolderPath.startsWith(sourcePath + '/'))) {
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
    if (showNotice) new Notice(`Moved "${sourceItem.name}" to "${targetFolder.name}".`);

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
