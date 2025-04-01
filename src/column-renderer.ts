import { App, TFile, TFolder, TAbstractFile, setIcon, Notice } from 'obsidian';
import OneNoteExplorerPlugin from '../main'; // Import plugin type for settings

// Callback type for handling item clicks in the main view
type ItemClickCallback = (itemEl: HTMLElement, isFolder: boolean, depth: number) => void;

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
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null> // Callback to render next column
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
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-folder-icon' }), 'folder');
    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: folderName });

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
  }

  // Render Files
  for (const file of files) {
    if (isExcluded(file.path, exclusionPatterns)) continue;
    if (file.name.startsWith('.')) continue;

    const fileName = file.name;
    const itemEl = columnEl.createDiv({ cls: 'onenote-explorer-item nav-file' });
    itemEl.dataset.path = file.path;
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-file-icon' }), 'file-text');
    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: fileName });

    itemEl.addEventListener('click', (event) => {
      handleItemClickCallback(itemEl, false, depth); // Use callback
      app.workspace.openLinkText(file.path, '', false);
    });
  }

  return columnEl; // Return the created/updated element
}