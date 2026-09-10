import { App, Menu, Notice, TFile, TFolder, Platform, getIcon } from 'obsidian';
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
  renameItem: (itemPath: string) => Promise<void>;
  deleteItem: (itemPath: string, isFolder: boolean, sourceEl?: HTMLElement) => Promise<void>; // Pass handleDeleteItem
  createNewNote: (folderPath: string, fileExtension?: string) => Promise<void>; // Pass handleCreateNewNote
  createNewFolder: (folderPath: string) => Promise<void>; // Pass handleCreateNewFolder
  setEmoji: (itemPath: string, isFolder: boolean) => Promise<void>; // Callback for setting emoji
  setIcon: (itemPath: string, isFolder: boolean) => Promise<void>; // Callback for setting custom icon
  moveToFolder: (itemPath: string, sourceEl?: HTMLElement) => Promise<void>; // Callback for moving file to another folder
  hideInExplorer: (itemPath: string) => Promise<void>;
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
    for (const tag of tagDefs) {
      const isTagged = currentTags.includes(tag.id);
      menu.addItem((item) => item
        .setTitle(`${isTagged ? '\u2713 ' : '   '}${tag.name}`)
        .setIcon('tag')
        .onClick(() => { callbacks.toggleTagForPath(targetPath, tag.id); })
      );
    }
    menu.addItem((item) => item
      .setTitle('Manage Tags...')
      .setIcon('settings')
      .onClick(() => { callbacks.openTagManager(); })
    );
  }
}

function addDeleteMenuItem(menu: Menu, onClick: () => void): void {
  const title = document.createDocumentFragment();
  title.createSpan({ cls: 'notidian-delete-menu-label', text: 'Delete' });
  menu.addSeparator();
  menu.addItem((item) => item
    .setTitle(title)
    .setIcon('trash')
    .onClick(onClick)
  );
}

function addCopyPathMenuItem(menu: Menu, path: string): void {
  menu.addItem((item) => item
    .setTitle('Copy path')
    .setIcon('copy')
    .onClick(async () => {
      try {
        await navigator.clipboard.writeText(path);
        new Notice('Path copied.');
      } catch {
        new Notice('Could not copy path.');
      }
    })
  );
}

export function showExplorerContextMenu(
  app: App,
  event: MouseEvent,
  callbacks: ContextMenuCallbacks
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
    if (Platform.isDesktop) {
      menu.addItem((item) => item
        .setTitle(Platform.isMacOS ? "Reveal in Finder" : Platform.isWin ? "Show in Explorer" : "Show in File Manager")
        .setIcon("folder-open")
        .onClick(() => {
          const electronShell = getShell();
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (electronShell && vaultPath) {
            electronShell.showItemInFolder(`${vaultPath}/${file.path}`);
          }
        })
      );
      menu.addItem((item) => item
        .setTitle("Open in Terminal")
        .setIcon("terminal")
        .onClick(() => {
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (vaultPath && file.parent) {
            openInTerminal(`${vaultPath}/${file.parent.path}`);
          }
        })
      );
    }
    addCopyPathMenuItem(menu, file.path);

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Rename")
      .setIcon("pencil")
      .onClick(() => { callbacks.renameItem(file.path); })
    );
    menu.addItem((item) => item
      .setTitle("Move to Folder")
      .setIcon("folder-input")
      .onClick(() => { callbacks.moveToFolder(file.path, itemEl || undefined); }) // Use callback
    );
    menu.addItem((item) => item
      .setTitle("Hide in explorer")
      .setIcon("eye-off")
      .onClick(() => { callbacks.hideInExplorer(file.path); })
    );

    menu.addSeparator();
    const isFileFavorited = callbacks.isFavorite(file.path);
    menu.addItem((item) => item
      .setTitle(isFileFavorited ? "Remove from Favorites" : "Add to Favorites")
      .setIcon(isFileFavorited ? "star-off" : "star")
      .onClick(() => { callbacks.toggleFavorite(file.path); })
    );
    addTagMenuItems(menu, file.path, callbacks);

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Set Emoji")
      .setIcon("smile")
      .onClick(() => { callbacks.setEmoji(file.path, false); })
    );
    menu.addItem((item) => item
      .setTitle("Set Custom Icon")
      .setIcon("image-plus")
      .onClick(() => { callbacks.setIcon(file.path, false); })
    );
    addDeleteMenuItem(menu, () => { callbacks.deleteItem(file.path, false, itemEl || undefined); });
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
      .setIcon(getIcon('excalidraw-icon') ? 'excalidraw-icon' : 'pencil-line')
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
    menu.addSeparator();
    if (Platform.isDesktop) {
      menu.addItem((item) => item
        .setTitle(Platform.isMacOS ? "Reveal in Finder" : Platform.isWin ? "Show in Explorer" : "Show in File Manager")
        .setIcon("folder-open")
        .onClick(() => {
          const electronShell = getShell();
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (electronShell && vaultPath) {
            electronShell.showItemInFolder(`${vaultPath}/${folder.path}`);
          }
        })
      );
      menu.addItem((item) => item
        .setTitle("Open in Terminal")
        .setIcon("terminal")
        .onClick(() => {
          const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
          if (vaultPath) {
            openInTerminal(`${vaultPath}/${folder.path}`);
          }
        })
      );
    }
    addCopyPathMenuItem(menu, folder.path);

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Rename")
      .setIcon("pencil")
      .onClick(() => { callbacks.renameItem(folder.path); })
    );
    menu.addItem((item) => item
      .setTitle("Move to Folder")
      .setIcon("folder-input")
      .onClick(() => { callbacks.moveToFolder(folder.path, itemEl || undefined); }) // Use callback
    );
    menu.addItem((item) => item
      .setTitle("Hide in explorer")
      .setIcon("eye-off")
      .onClick(() => { callbacks.hideInExplorer(folder.path); })
    );

    menu.addSeparator();
    const isFolderFavorited = callbacks.isFavorite(folder.path);
    menu.addItem((item) => item
      .setTitle(isFolderFavorited ? "Remove from Favorites" : "Add to Favorites")
      .setIcon(isFolderFavorited ? "star-off" : "star")
      .onClick(() => { callbacks.toggleFavorite(folder.path); })
    );
    addTagMenuItems(menu, folder.path, callbacks);

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Set Emoji")
      .setIcon("smile")
      .onClick(() => { callbacks.setEmoji(folder.path, true); })
    );
    menu.addItem((item) => item
      .setTitle("Set Custom Icon")
      .setIcon("image-plus")
      .onClick(() => { callbacks.setIcon(folder.path, true); })
    );
    addDeleteMenuItem(menu, () => { callbacks.deleteItem(folder.path, true, itemEl || undefined); });
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
      .setIcon(getIcon('excalidraw-icon') ? 'excalidraw-icon' : 'pencil-line')
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
