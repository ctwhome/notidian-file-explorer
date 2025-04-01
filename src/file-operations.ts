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
  let modalTitle = "Create New Note";
  let placeholder = "Enter note name";
  let fileTypeDesc = "Note";

  if (fileExtension === '.excalidraw.md') {
    modalTitle = "Create New Excalidraw Note";
    fileTypeDesc = "Excalidraw note";
  } else if (fileExtension === '.canvas') {
    modalTitle = "Create New Canva Note";
    fileTypeDesc = "Canva note";
  } else {
    placeholder += " (without .md)";
  }

  new InputModal(app, modalTitle, placeholder, "", async (baseName) => {
    const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));
    const newNotePath = normalizePath(`${normalizedFolderPath}/${baseName}${fileExtension}`);
    console.log(`Creating ${fileTypeDesc}: Path="${newNotePath}", ParentFolderToRefresh="${normalizedFolderPath}"`);

    try {
      const existingFile = app.vault.getAbstractFileByPath(newNotePath);
      if (existingFile) {
        new Notice(`File "${baseName}${fileExtension}" already exists in ${normalizedFolderPath}.`);
        return;
      }

      let newFile: TFile | null = null;
      const excalidrawAutomate = (window as any).ExcalidrawAutomate;
      let apiUsed = false;

      if (fileExtension === '.excalidraw.md' && excalidrawAutomate?.create) {
        console.log("Attempting to use ExcalidrawAutomate API...");
        apiUsed = true;
        try {
          const createOptions: any = { filename: baseName, foldername: normalizedFolderPath };
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
            const altPath = normalizePath(`${normalizedFolderPath}/${baseName}.excalidraw`);
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
          return;
        }
      }

      if (!apiUsed) {
        if (fileExtension === '.excalidraw.md') {
          console.warn("ExcalidrawAutomate API not found. Creating empty Excalidraw file via vault.create.");
        } else {
          console.log("Using standard vault.create...");
        }
        newFile = await app.vault.create(newNotePath, '');
      }

      if (newFile instanceof TFile) {
        new Notice(`${fileTypeDesc} "${newFile.basename}" created.`);
        const refreshedColumnEl = await refreshCallback(normalizedFolderPath);
        if (refreshedColumnEl) {
          selectAndFocusCallback(newFile.path, false, refreshedColumnEl);
        }
      } else {
        throw new Error("File object not found after creation.");
      }
    } catch (error) {
      console.error(`Error creating ${fileTypeDesc} ${newNotePath}:`, error);
      new Notice(`Error creating ${fileTypeDesc}: ${error.message || 'Unknown error'}`);
    }
  }).open();
}


export async function handleCreateNewFolder(
  app: App,
  folderPath: string,
  refreshCallback: (folderPath: string) => Promise<HTMLElement | null>,
  selectAndFocusCallback: (itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) => void,
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>, // Callback to render next column
  containerEl: HTMLElement // Needed to append new column
) {
  new InputModal(app, "Create New Folder", "Enter folder name", "", async (folderName) => {
    if (folderName.length === 0) {
      new Notice("Folder name cannot be empty.");
      return;
    }
    if (/[\\/:*?"<>|]/.test(folderName)) {
      new Notice('Folder name contains invalid characters.');
      return;
    }

    const normalizedFolderPath = folderPath === '/' ? '/' : normalizePath(folderPath.replace(/\/$/, ''));
    const newFolderPath = normalizePath(`${normalizedFolderPath}/${folderName}`);
    console.log(`Creating folder: Path="${newFolderPath}", ParentFolderToRefresh="${normalizedFolderPath}"`);

    try {
      const existingItem = app.vault.getAbstractFileByPath(newFolderPath);
      if (existingItem) {
        new Notice(`"${folderName}" already exists.`);
        return;
      }

      await app.vault.createFolder(newFolderPath);
      const newFolder = app.vault.getAbstractFileByPath(newFolderPath);

      if (newFolder instanceof TFolder) {
        new Notice(`Folder "${newFolder.name}" created.`);
        const refreshedColumnEl = await refreshCallback(normalizedFolderPath);
        if (refreshedColumnEl) {
          // Select the new folder and trigger opening its column
          selectAndFocusCallback(newFolder.path, true, refreshedColumnEl);
          // Render the new folder's column
          const depth = parseInt(refreshedColumnEl.dataset.depth || '0');
          const nextColumnEl = await renderColumnCallback(newFolderPath, depth + 1);
          if (nextColumnEl) {
            containerEl.appendChild(nextColumnEl);
            requestAnimationFrame(() => {
              containerEl.scrollTo({ left: containerEl.scrollWidth, behavior: 'smooth' });
            });
          }
        }
      } else {
        throw new Error("Folder creation seemed to succeed but couldn't retrieve TFolder object.");
      }
    } catch (error) {
      console.error(`Error creating folder ${newFolderPath}:`, error);
      new Notice(`Error creating folder: ${error.message}`);
    }
  }).open();
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
        // If root, need a way to trigger full refresh (maybe pass a separate callback?)
        // For now, log a warning. A full refresh might be needed via the main view.
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
      // If root, need a way to trigger full refresh
      console.warn("Cannot refresh root via refreshColumnByPath after delete.");
      new Notice("Root folder refresh after delete might require manual view reload.");
    }
  } catch (error) {
    console.error(`Error deleting ${itemPath}:`, error);
    new Notice(`Error deleting ${itemType}: ${error.message}`);
  }
}