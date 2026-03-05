import { App, Menu, TFile, TFolder, Platform } from 'obsidian';
import type { TagDefinition } from '../main';
// We don't need to import the handlers here, they will be passed via callbacks

// Lazy-load desktop-only modules to avoid crashing on mobile
function getShell(): { showItemInFolder: (path: string) => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').shell;
  } catch {
    return null;
  }
}

function getSpawn(): typeof import('child_process').spawn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('child_process').spawn;
  } catch {
    return null;
  }
}

/**
 * Opens the default terminal at the specified directory path
 */
function openInTerminal(directoryPath: string): void {
  const spawn = getSpawn();
  if (!spawn) return;

  if (Platform.isMacOS) {
    // macOS: Use 'open' command with Terminal.app
    spawn('open', ['-a', 'Terminal', directoryPath], { detached: true });
  } else if (Platform.isWin) {
    // Windows: Use cmd.exe with /K to keep window open
    spawn('cmd.exe', ['/K', `cd /d "${directoryPath}"`], {
      detached: true,
      shell: true
    });
  } else {
    // Linux: Try common terminal emulators
    const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
    for (const terminal of terminals) {
      try {
        if (terminal === 'gnome-terminal') {
          spawn(terminal, ['--working-directory', directoryPath], { detached: true });
        } else if (terminal === 'konsole') {
          spawn(terminal, ['--workdir', directoryPath], { detached: true });
        } else {
          spawn(terminal, [], { cwd: directoryPath, detached: true });
        }
        break;
      } catch {
        continue;
      }
    }
  }
}

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
  moveToFolder: (itemPath: string) => Promise<void>; // Callback for moving file to another folder
  toggleFavorite: (itemPath: string) => Promise<void>; // Callback for toggling favorite status
  isFavorite: (itemPath: string) => boolean; // Check if item is favorited
  getTagDefinitions: () => TagDefinition[];
  getTagsForPath: (path: string) => string[];
  toggleTagForPath: (path: string, tagId: string) => Promise<void>;
  openTagManager: () => void;
}


function addTagMenuItems(menu: Menu, targetPath: string, callbacks: ContextMenuCallbacks): void {
  const tagDefs = callbacks.getTagDefinitions();
  if (tagDefs.length > 0) {
    const currentTags = callbacks.getTagsForPath(targetPath);
    menu.addSeparator();
    for (const tag of tagDefs) {
      const isTagged = currentTags.includes(tag.id);
      menu.addItem((item) => item
        .setTitle(`${isTagged ? '\u2713 ' : '   '}${tag.name}`)
        .setIcon('tag')
        .onClick(() => { callbacks.toggleTagForPath(targetPath, tag.id); })
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('Manage Tags...')
      .setIcon('settings')
      .onClick(() => { callbacks.openTagManager(); })
    );
  }
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
    menu.addItem((item) => item
      .setTitle("Move to Folder")
      .setIcon("folder-input")
      .onClick(() => { callbacks.moveToFolder(file.path); }) // Use callback
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
    // Favorites toggle
    const isFileFavorited = callbacks.isFavorite(file.path);
    menu.addItem((item) => item
      .setTitle(isFileFavorited ? "Remove from Favorites" : "Add to Favorites")
      .setIcon(isFileFavorited ? "star-off" : "star")
      .onClick(() => { callbacks.toggleFavorite(file.path); })
    );
    menuHasItems = true;
    // Tags
    addTagMenuItems(menu, file.path, callbacks);
    menuHasItems = true;
    if (Platform.isDesktop) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(Platform.isMacOS ? "Reveal in Finder" : Platform.isWin ? "Show in Explorer" : "Show in File Manager")
        .setIcon("folder-open")
        .onClick(() => {
          const electronShell = getShell();
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (electronShell && vaultPath) {
            const absolutePath = `${vaultPath}/${file.path}`;
            electronShell.showItemInFolder(absolutePath);
          }
        })
      );
      menuHasItems = true;
      menu.addItem((item) => item
        .setTitle("Open in Terminal")
        .setIcon("terminal")
        .onClick(() => {
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (vaultPath && file.parent) {
            const absolutePath = `${vaultPath}/${file.parent.path}`;
            openInTerminal(absolutePath);
          }
        })
      );
      menuHasItems = true;
    }
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
    menu.addItem((item) => item
      .setTitle("Move to Folder")
      .setIcon("folder-input")
      .onClick(() => { callbacks.moveToFolder(folder.path); }) // Use callback
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
    // Favorites toggle
    const isFolderFavorited = callbacks.isFavorite(folder.path);
    menu.addItem((item) => item
      .setTitle(isFolderFavorited ? "Remove from Favorites" : "Add to Favorites")
      .setIcon(isFolderFavorited ? "star-off" : "star")
      .onClick(() => { callbacks.toggleFavorite(folder.path); })
    );
    menuHasItems = true;
    // Tags
    addTagMenuItems(menu, folder.path, callbacks);
    menuHasItems = true;
    if (Platform.isDesktop) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(Platform.isMacOS ? "Reveal in Finder" : Platform.isWin ? "Show in Explorer" : "Show in File Manager")
        .setIcon("folder-open")
        .onClick(() => {
          const electronShell = getShell();
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (electronShell && vaultPath) {
            const absolutePath = `${vaultPath}/${folder.path}`;
            electronShell.showItemInFolder(absolutePath);
          }
        })
      );
      menuHasItems = true;
      menu.addItem((item) => item
        .setTitle("Open in Terminal")
        .setIcon("terminal")
        .onClick(() => {
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (vaultPath) {
            const absolutePath = `${vaultPath}/${folder.path}`;
            openInTerminal(absolutePath);
          }
        })
      );
      menuHasItems = true;
    }
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