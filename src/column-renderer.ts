import { App, TFile, TFolder, TAbstractFile, setIcon, Notice } from 'obsidian';
import OneNoteExplorerPlugin from '../main'; // Import plugin type for settings

// Callback type for handling item clicks in the main view
type ItemClickCallback = (itemEl: HTMLElement, isFolder: boolean, depth: number) => void;
// Callback type for handling drops
type ItemDropCallback = (sourcePath: string, targetFolderPath: string) => void;

// Helper function (could be in utils)
function isExcluded(path: string, patterns: string[]): boolean {
  const lowerPath = path.toLowerCase();
  for (const pattern of patterns) {
    if (lowerPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export async function renderColumnElement(
  app: App,
  plugin: OneNoteExplorerPlugin, // Pass plugin for settings
  folderPath: string,
  depth: number,
  existingColumnEl: HTMLElement | null, // Pass existing element to update
  handleItemClickCallback: ItemClickCallback, // Callback for item clicks
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>, // Callback to render next column
  handleDropCallback: ItemDropCallback // Callback for drop events
): Promise<HTMLElement | null> {

  const columnEl = existingColumnEl || createDiv({ cls: 'onenote-explorer-column' });
  columnEl.dataset.path = folderPath;
  columnEl.dataset.depth = String(depth);
  columnEl.empty(); // Clear content before re-rendering

  let tChildren: TAbstractFile[];
  try {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      tChildren = folder.children;
    } else {
      console.warn(`Path is not a folder or does not exist: ${folderPath}`);
      columnEl.createDiv({ text: `Not a folder: ${folderPath}` });
      return existingColumnEl ? null : columnEl;
    }
  } catch (error) {
    console.error(`Error accessing folder ${folderPath}:`, error);
    columnEl.createDiv({ text: `Error loading: ${folderPath}` });
    return existingColumnEl ? null : columnEl;
  }

  const folders: TFolder[] = [];
  const files: TFile[] = [];
  for (const child of tChildren) {
    if (child instanceof TFolder) {
      folders.push(child);
    } else if (child instanceof TFile) {
      files.push(child);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  const exclusionPatterns = plugin.settings.exclusionPatterns
    .split('\n')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  // Render Folders
  for (const folder of folders) {
    if (isExcluded(folder.path, exclusionPatterns)) continue;

    const folderName = folder.name;
    const itemEl = columnEl.createDiv({ cls: 'onenote-explorer-item nav-folder' });
    itemEl.dataset.path = folder.path;
    itemEl.draggable = true; // Make folders draggable
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-folder-icon' }), 'folder');
    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: folderName });
    // Add arrow icon to the right for folders
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-arrow' }), 'chevron-right');

    itemEl.addEventListener('click', async (event) => {
      handleItemClickCallback(itemEl, true, depth); // Use callback
      try {
        const nextColumnEl = await renderColumnCallback(folder.path, depth + 1); // Use callback
        if (nextColumnEl) {
          // Appending needs to happen in the main view, as this module doesn't know the container
          // We signal back that a new column needs appending. How?
          // Option 1: Return the new element (breaks Promise<null> for updates)
          // Option 2: Pass an append callback (getting complex)
          // Option 3: Let handleItemClick handle appending in the main view? Yes.
          // So, renderColumnCallback just returns the element, handleItemClick appends it.
          // This function (renderColumnElement) shouldn't append.
        }
        // Scroll logic also needs to be in the main view's handleItemClick
      } catch (error) {
        console.error("Error rendering next column:", error);
        new Notice(`Error rendering folder: ${folderName}`);
      }
    });

    // --- Drag and Drop Listeners for Folders (as Drop Targets) ---
    itemEl.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', folder.path);
      event.dataTransfer?.setData('text/type', 'folder'); // Indicate type
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      itemEl.addClass('is-dragging'); // Optional: visual feedback
      console.log(`Drag Start Folder: ${folder.path}`);
    });

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
    });

    // Allow dropping onto folders
    itemEl.addEventListener('dragover', (event) => {
      event.preventDefault(); // Necessary to allow drop
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      itemEl.addClass('drag-over'); // Highlight potential drop target
    });

    itemEl.addEventListener('dragleave', (event) => {
      itemEl.removeClass('drag-over');
    });

    itemEl.addEventListener('drop', (event) => {
      event.preventDefault();
      itemEl.removeClass('drag-over');
      const sourcePath = event.dataTransfer?.getData('text/plain');
      const sourceType = event.dataTransfer?.getData('text/type'); // Get type if needed
      const targetFolderPath = itemEl.dataset.path;

      if (sourcePath && targetFolderPath && sourcePath !== targetFolderPath) {
        console.log(`Drop: Source=${sourcePath} (${sourceType}), TargetFolder=${targetFolderPath}`);
        handleDropCallback(sourcePath, targetFolderPath); // Use callback
      } else {
        console.log("Drop ignored: missing path or dropping onto self.");
      }
    });
  }

  // Render Files
  for (const file of files) {
    if (isExcluded(file.path, exclusionPatterns)) continue;
    if (file.name.startsWith('.')) continue;

    const fileName = file.name;
    const itemEl = columnEl.createDiv({ cls: 'onenote-explorer-item nav-file' });
    itemEl.dataset.path = file.path;
    itemEl.draggable = true; // Make files draggable
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-file-icon' }), 'file-text');
    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: fileName });

    itemEl.addEventListener('click', (event) => {
      handleItemClickCallback(itemEl, false, depth); // Use callback
      app.workspace.openLinkText(file.path, '', false);
    });

    // --- Drag Listener for Files (as Draggable Items) ---
    itemEl.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', file.path);
      event.dataTransfer?.setData('text/type', 'file'); // Indicate type
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      itemEl.addClass('is-dragging'); // Optional: visual feedback
      console.log(`Drag Start File: ${file.path}`);
    });

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
    });
  }

  // Add drop listeners to the column background itself (for dropping into this folder)
  columnEl.addEventListener('dragover', (event) => {
    event.preventDefault(); // Allow drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // Add highlight only if dragging directly over the column background, not over an item within it
    if (event.target === columnEl) {
      columnEl.addClass('drag-over-column');
    } else {
      columnEl.removeClass('drag-over-column'); // Remove if over an item
    }
  });

  columnEl.addEventListener('dragleave', (event) => {
    // Remove highlight if leaving the column element itself
    if (event.target === columnEl) {
      columnEl.removeClass('drag-over-column');
    }
    // Also check if leaving the bounds entirely
    if (!columnEl.contains(event.relatedTarget as Node)) {
      columnEl.removeClass('drag-over-column');
    }
  });

  columnEl.addEventListener('drop', (event) => {
    event.preventDefault();
    columnEl.removeClass('drag-over-column');
    // Ensure the drop happened directly on the column background, not on an item within it
    if (event.target !== columnEl) {
      console.log("Drop ignored: Target was an item within the column, not the background.");
      return;
    }

    const sourcePath = event.dataTransfer?.getData('text/plain');
    const targetFolderPath = columnEl.dataset.path; // Path of the folder this column represents

    if (sourcePath && targetFolderPath) {
      console.log(`Drop onto Column Background: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
      handleDropCallback(sourcePath, targetFolderPath);
    }
  });


  return columnEl; // Return the created/updated element
}