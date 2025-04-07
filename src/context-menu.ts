import { App, Menu, TFile, TFolder } from 'obsidian';
// We don't need to import the handlers here, they will be passed via callbacks

// Define the structure for callbacks needed by the context menu actions
interface ContextMenuCallbacks {
  refreshColumnByPath: (folderPath: string) => Promise<HTMLElement | null>;
  selectAndFocusCallback: (itemPath: string, isFolder: boolean, columnEl: HTMLElement | null) => void;
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>;
  containerEl: HTMLElement; // Needed for appending new folder columns
  renameItem: (itemPath: string, isFolder: boolean) => Promise<void>; // Use the main view's rename for consistency? Or pass handleRenameItem? Let's pass handleRenameItem
  deleteItem: (itemPath: string, isFolder: boolean) => Promise<void>; // Pass handleDeleteItem
  createNewNote: (folderPath: string, fileExtension?: string) => Promise<void>; // Pass handleCreateNewNote
  createNewFolder: (folderPath: string) => Promise<void>; // Pass handleCreateNewFolder
  setEmoji: (itemPath: string, isFolder: boolean) => Promise<void>; // Callback for setting emoji
  setIcon: (itemPath: string, isFolder: boolean) => Promise<void>; // Callback for setting custom icon
}


export function showExplorerContextMenu(
  app: App,
  event: MouseEvent,
  callbacks: ContextMenuCallbacks,
  pluginSettings: { excalidrawTemplatePath: string } // Pass necessary settings
) {
  event.preventDefault();

  const targetEl = event.target as HTMLElement;
  const itemEl = targetEl.closest('.notidian-file-explorer-item') as HTMLElement | null;
  const columnEl = targetEl.closest('.notidian-file-explorer-column') as HTMLElement | null;

  const menu = new Menu();
  let menuHasItems = false;

  let targetPath: string | null = null;
  let isFolder = false;
  let isFile = false;
  let targetFolderForCreation: string | null = null;

  if (itemEl) {
    targetPath = itemEl.dataset.path ?? null;
    if (targetPath) {
      const abstractFile = app.vault.getAbstractFileByPath(targetPath);
      if (abstractFile instanceof TFolder) {
        isFolder = true;
        targetFolderForCreation = targetPath;
      } else if (abstractFile instanceof TFile) {
        isFile = true;
        targetFolderForCreation = abstractFile.parent?.path ?? '/';
      }
    }
  } else if (columnEl) {
    targetFolderForCreation = columnEl.dataset.path ?? '/';
  } else {
    targetFolderForCreation = '/';
  }

  // --- Build Menu Items ---

  if (isFile && targetPath) {
    const file = app.vault.getAbstractFileByPath(targetPath) as TFile;
    menu.addItem((item) => item
      .setTitle("Open in new tab")
      .setIcon("file-plus")
      .onClick(() => { app.workspace.openLinkText(file.path, '', true); })
    );
    menuHasItems = true;
    menu.addSeparator();
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Rename")
      .setIcon("pencil")
      .onClick(() => { callbacks.renameItem(file.path, false); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Delete")
      .setIcon("trash")
      .onClick(() => { callbacks.deleteItem(file.path, false); }) // Use callback
    );
    menuHasItems = true;
    menu.addSeparator(); // Separator before emoji action
    menu.addItem((item) => item
      .setTitle("Set Emoji")
      .setIcon("smile") // Placeholder icon
      .onClick(() => { callbacks.setEmoji(file.path, false); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Set Custom Icon")
      .setIcon("image-plus") // Or another suitable icon
      .onClick(() => { callbacks.setIcon(file.path, false); }) // Use setIcon callback
    );
    menuHasItems = true;
  } else if (isFolder && targetPath) {
    const folder = app.vault.getAbstractFileByPath(targetPath) as TFolder;
    menu.addItem((item) => item
      .setTitle("New Note (.md)")
      .setIcon("file-text")
      .onClick(() => { callbacks.createNewNote(folder.path, '.md'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Excalidraw Note")
      .setIcon("pencil")
      .onClick(() => { callbacks.createNewNote(folder.path, '.excalidraw.md'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Canva Note")
      .setIcon("layout-dashboard")
      .onClick(() => { callbacks.createNewNote(folder.path, '.canvas'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Folder")
      .setIcon("folder-plus")
      .onClick(() => { callbacks.createNewFolder(folder.path); }) // Use callback
    );
    menuHasItems = true;
    menu.addSeparator();
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Rename")
      .setIcon("pencil")
      .onClick(() => { callbacks.renameItem(folder.path, true); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Delete")
      .setIcon("trash")
      .onClick(() => { callbacks.deleteItem(folder.path, true); }) // Use callback
    );
    menuHasItems = true;
    menu.addSeparator(); // Separator before emoji action
    menu.addItem((item) => item
      .setTitle("Set Emoji")
      .setIcon("smile") // Placeholder icon
      .onClick(() => { callbacks.setEmoji(folder.path, true); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("Set Custom Icon")
      .setIcon("image-plus") // Or another suitable icon
      .onClick(() => { callbacks.setIcon(folder.path, true); }) // Use setIcon callback
    );
    menuHasItems = true;
  } else if (targetFolderForCreation) {
    menu.addItem((item) => item
      .setTitle("New Note (.md)")
      .setIcon("file-text")
      .onClick(() => { callbacks.createNewNote(targetFolderForCreation as string, '.md'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Excalidraw Note")
      .setIcon("pencil")
      .onClick(() => { callbacks.createNewNote(targetFolderForCreation as string, '.excalidraw.md'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Canva Note")
      .setIcon("layout-dashboard")
      .onClick(() => { callbacks.createNewNote(targetFolderForCreation as string, '.canvas'); }) // Use callback
    );
    menuHasItems = true;
    menu.addItem((item) => item
      .setTitle("New Folder")
      .setIcon("folder-plus")
      .onClick(() => { callbacks.createNewFolder(targetFolderForCreation as string); }) // Use callback
    );
    menuHasItems = true;
  }

  if (menuHasItems) {
    menu.showAtMouseEvent(event);
  }
}