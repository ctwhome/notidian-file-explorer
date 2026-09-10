import { App, Menu, TFile, TFolder, TAbstractFile, setIcon, getIcon, Notice, normalizePath } from 'obsidian';
import NotidianExplorerPlugin from '../main'; // Import plugin type for settings
import { startVaultFileDrag } from './file-drag';
import { filterMatches, getRenameParts, isExternalFileDrag, isPathHidden, shouldHandleSelectionClick, shouldOpenFileOnClick, validateItemName } from './explorer-utils';

// Callbacks interface for renderColumnElement
export interface ColumnRenderCallbacks {
  handleItemClick: (itemEl: HTMLElement, isFolder: boolean, depth: number, event?: MouseEvent, navigate?: boolean) => void;
  handleDrop: (sourcePath: string, targetFolderPath: string) => void;
  handleExternalDrop: (files: File[], targetFolderPath: string) => void;
  setDragOverTimeout: (id: number, target: HTMLElement) => void;
  clearDragOverTimeout: () => void;
  triggerFolderOpen: (folderPath: string, depth: number) => void;
  renameItem: (itemPath: string) => Promise<void>;
  commitRename: (itemPath: string, isFolder: boolean, newName: string) => Promise<boolean>;
  createNewNote: (folderPath: string, fileExtension?: string) => Promise<void>;
  createNewFolder: (folderPath: string) => Promise<void>;
  // Favorites
  toggleFavorite: (itemPath: string) => Promise<void>;
  isFavorite: (itemPath: string) => boolean;
  navigateToFavorite: (itemPath: string) => Promise<void>;
  toggleFavoritesCollapsed: () => Promise<void>;
  reorderFavorites: (fromIndex: number, toIndex: number) => Promise<void>;
  // Folder reorder
  reorderFolderItems: (folderPath: string, fromPath: string, toPath: string, insertAfter: boolean) => Promise<void>;
  getCustomFolderOrder: (folderPath: string) => string[] | null;
  // Tags
  getTagsForPath: (path: string) => string[];
  toggleTagForPath: (path: string, tagId: string) => Promise<void>;
  navigateToTaggedItem: (itemPath: string) => Promise<void>;
  toggleTagsCollapsed: () => Promise<void>;
  toggleTagSubgroupCollapsed: (tagId: string) => Promise<void>;
  getColumnWidth: (folderPath: string) => number | undefined;
  setColumnWidth: (folderPath: string, width: number | null) => void;
}

const MIN_COLUMN_WIDTH = 160;
const MAX_COLUMN_WIDTH = 480;

function focusAdjacentVisibleItem(itemEl: HTMLElement, direction: 'previous' | 'next'): void {
  let sibling = direction === 'previous' ? itemEl.previousElementSibling : itemEl.nextElementSibling;
  while (sibling) {
    if (sibling.hasClass('notidian-file-explorer-item') && !sibling.hasClass('is-filtered-out')) {
      (sibling as HTMLElement).focus();
      return;
    }
    sibling = direction === 'previous' ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
}

function getVisibleColumnItem(columnEl: HTMLElement, selectedOnly = false): HTMLElement | null {
  const base = ':scope > .notidian-file-explorer-column-content > .notidian-file-explorer-item';
  return columnEl.querySelector<HTMLElement>(selectedOnly
    ? `${base}.is-selected-path:not(.is-filtered-out), ${base}.is-selected-final:not(.is-filtered-out)`
    : `${base}:not(.is-filtered-out)`
  );
}

function enableInlineRename(itemEl: HTMLElement, titleEl: HTMLElement, initialName: string, itemPath: string, isFolder: boolean, callbacks: ColumnRenderCallbacks): void {
  itemEl.addEventListener('notidian-start-rename', () => {
    if (itemEl.querySelector('.notidian-inline-rename')) return;

    const originalName = initialName;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'notidian-inline-rename';
    input.value = originalName;
    input.setAttribute('aria-label', `Rename ${originalName}`);
    titleEl.hidden = true;
    itemEl.draggable = false;
    titleEl.after(input);

    let cancelled = false;
    let submitting = false;
    const cancel = () => {
      cancelled = true;
      input.remove();
      titleEl.hidden = false;
      itemEl.draggable = true;
      itemEl.focus();
    };
    input.addEventListener('notidian-cancel-rename', cancel);
    const submit = async () => {
      if (cancelled || submitting || !input.isConnected) return;
      const newName = input.value.trim();
      const validationError = validateItemName(newName);
      if (validationError) {
        new Notice(validationError);
        input.addClass('is-invalid');
        input.select();
        return;
      }
      if (newName === originalName) {
        cancel();
        return;
      }
      submitting = true;
      input.disabled = true;
      if (!(await callbacks.commitRename(itemPath, isFolder, newName)) && input.isConnected) {
        submitting = false;
        input.disabled = false;
        input.focus();
        input.select();
      }
    };

    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('pointerdown', event => event.stopPropagation());
    input.addEventListener('blur', () => { if (!cancelled) void submit(); });
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.focus();
    input.select();
  });
}

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

// Helper function to extract path from wikilink format or plain path
function extractPathFromDragData(data: string | undefined | null): string | null {
  if (!data) return null;

  // Check if it's an embed format: ![[path]]
  const embedMatch = data.match(/^!\[\[(.+)\]\]$/);
  if (embedMatch) {
    return embedMatch[1];
  }

  // Check if it's a wikilink format: [[path]]
  const wikilinkMatch = data.match(/^\[\[(.+)\]\]$/);
  if (wikilinkMatch) {
    return wikilinkMatch[1];
  }

  // Otherwise return the data as-is (plain path)
  return data;
}

function handleExternalFileDrop(dataTransfer: DataTransfer | null, targetFolderPath: string | undefined, callbacks: ColumnRenderCallbacks): boolean {
  if (!dataTransfer || !isExternalFileDrag(dataTransfer.types)) return false;
  if (!dataTransfer.items.length) {
    new Notice('Could not verify the dropped Finder items.');
    return true;
  }
  const files: File[] = [];
  let skipped = 0;
  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
    const file = item.kind === 'file' && entry && !entry.isDirectory ? item.getAsFile() : null;
    if (file) files.push(file);
    else skipped++;
  }
  if (targetFolderPath && files.length) callbacks.handleExternalDrop(files, targetFolderPath);
  else if (!targetFolderPath) new Notice('Drop target is not a folder.');
  if (skipped) new Notice(`Skipped ${skipped} folder or unverifiable item${skipped === 1 ? '' : 's'}.`);
  return true;
}
// Microsoft Office SVG icons
const OFFICE_ICONS: Record<string, string> = {
  // Word - Blue
  word: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="#2B579A"/>
    <path d="M3.5 4.5H5.5L6.5 9L8 5.5L9.5 9L10.5 4.5H12.5L10.25 11.5H8.75L8 9L7.25 11.5H5.75L3.5 4.5Z" fill="white"/>
  </svg>`,
  // Excel - Green
  excel: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="#217346"/>
    <path d="M4.5 4.5L6.5 7.5L4.5 11.5H6.5L8 9L9.5 11.5H11.5L9.5 7.5L11.5 4.5H9.5L8 6.5L6.5 4.5H4.5Z" fill="white"/>
  </svg>`,
  // PowerPoint - Orange/Red
  powerpoint: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="#D24726"/>
    <path d="M5.5 4.5H9C10.1 4.5 11 5.4 11 6.5C11 7.6 10.1 8.5 9 8.5H7V11.5H5.5V4.5ZM7 5.8V7.2H8.5C8.8 7.2 9 7 9 6.5C9 6 8.8 5.8 8.5 5.8H7Z" fill="white"/>
  </svg>`,
  // PDF - Red
  pdf: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="14" height="14" rx="2" fill="#E5252A"/>
    <text x="8" y="11" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="7" fill="white">PDF</text>
  </svg>`,
};

// Helper function to get Office SVG icon or null
function getOfficeIcon(extension: string): string | null {
  const ext = extension.toLowerCase();
  switch (ext) {
    case 'doc':
    case 'docx':
      return OFFICE_ICONS.word;
    case 'xls':
    case 'xlsx':
      return OFFICE_ICONS.excel;
    case 'ppt':
    case 'pptx':
      return OFFICE_ICONS.powerpoint;
    case 'pdf':
      return OFFICE_ICONS.pdf;
    default:
      return null;
  }
}

// Helper: render icon/emoji for any file/folder into a parent element
function renderItemIcon(parentEl: HTMLElement, app: App, plugin: NotidianExplorerPlugin, abstractFile: TAbstractFile): void {
  const itemPath = abstractFile.path;
  const isFolder = abstractFile instanceof TFolder;
  const isFile = abstractFile instanceof TFile;
  const customIconFilename = plugin.settings.iconAssociations?.[itemPath];
  const itemEmoji = plugin.settings.emojiMap?.[itemPath];

  if (customIconFilename) {
    const iconFullPath = normalizePath(`Assets/notidian-file-explorer-data/images/${customIconFilename}`);
    const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
    if (iconSrc && iconSrc !== iconFullPath) {
      parentEl.createEl('img', {
        cls: 'notidian-file-explorer-item-icon custom-icon',
        attr: { src: iconSrc, alt: abstractFile.name }
      });
    } else {
      setIcon(parentEl.createSpan({ cls: 'notidian-file-explorer-item-icon' }), isFolder ? 'folder' : 'document');
    }
  } else if (itemEmoji) {
    parentEl.createSpan({ cls: 'notidian-file-explorer-item-emoji', text: itemEmoji });
  } else if (isFile) {
    const file = abstractFile as TFile;
    const officeSvg = getOfficeIcon(file.extension);
    if (officeSvg) {
      const iconSpan = parentEl.createSpan({ cls: 'notidian-file-explorer-item-icon office-icon' });
      iconSpan.innerHTML = officeSvg;
    } else {
      const iconName = getIconForFile(app, file);
      setIcon(parentEl.createSpan({ cls: 'notidian-file-explorer-item-icon' }), iconName);
    }
  } else {
    setIcon(parentEl.createSpan({ cls: 'notidian-file-explorer-item-icon' }), 'folder');
  }
}

// Helper: get display name for a file/folder
function getItemDisplayName(abstractFile: TAbstractFile): string {
  if (abstractFile instanceof TFile) {
    const file = abstractFile;
    const lowerFullName = file.name.toLowerCase();
    if (lowerFullName.endsWith('.excalidraw.md')) {
      return file.name.slice(0, -'.excalidraw.md'.length);
    } else if (file.extension.toLowerCase() === 'md') {
      return file.basename;
    }
    return file.name;
  }
  return abstractFile.name;
}

// Helper function to get icon based on file extension
function getIconForFile(app: App, file: TFile): string {
  // Check frontmatter for Excalidraw first
  const fileCache = app.metadataCache.getFileCache(file);
  if (fileCache?.frontmatter?.['excalidraw-plugin']) {
    return getIcon('excalidraw-icon') ? 'excalidraw-icon' : 'pencil-line';
  }

  // Handle compound extensions first
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.excalidraw.md')) {
    return getIcon('excalidraw-icon') ? 'excalidraw-icon' : 'pencil-line';
  }

  // Then check the simple extension
  const extension = file.extension.toLowerCase();
  switch (extension) {
    case 'md':
      return 'document'; // Standard markdown
    case 'canvas':
      return 'lucide-layout-dashboard'; // Obsidian canvas icon
    case 'base':
      return 'database'; // Obsidian Bases
    case 'txt':
    case 'rtf':
    case 'log':
      return 'file-text';
    case 'json':
    case 'jsonl':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'html':
    case 'css':
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'file-code-2';
    case 'png': // Image types
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
    case 'webp':
    case 'avif':
    case 'heic':
    case 'tif':
    case 'tiff':
    case 'ico':
      return 'image-file'; // Generic image icon
    case 'pdf':
      return 'pdf-file'; // PDF icon
    case 'doc': // Word - handled by SVG but keep for type icon fallback
    case 'docx':
      return 'file-text';
    case 'csv':
    case 'tsv':
    case 'xls': // Excel - handled by SVG but keep for type icon fallback
    case 'xlsx':
      return 'file-spreadsheet';
    case 'ppt': // PowerPoint - handled by SVG but keep for type icon fallback
    case 'pptx':
      return 'presentation';
    case 'zip': // Archives
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'xz':
      return 'archive'; // Archive icon
    case 'mp3': // Audio
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'flac':
    case 'aac':
    case 'wma':
      return 'audio-file'; // Audio file icon
    case 'mp4': // Video
    case 'mov':
    case 'avi':
    case 'webm':
    case 'mkv':
    case 'm4v':
      return 'video-file'; // Video file icon
    case 'db':
    case 'sqlite':
    case 'sqlite3':
      return 'database';
    case 'epub':
    case 'mobi':
      return 'book-open';
    case 'ics':
      return 'calendar-days';
    default:
      return 'document'; // Default icon for other files
  }
}


export async function renderColumnElement(
  app: App,
  plugin: NotidianExplorerPlugin,
  folderPath: string,
  depth: number,
  existingColumnEl: HTMLElement | null,
  callbacks: ColumnRenderCallbacks,
  dragOverTimeoutDelay: number
): Promise<HTMLElement | null> {
  // Get drag initiation delay from settings
  const DRAG_INITIATION_DELAY = plugin.settings.dragInitiationDelay;

  // State for drag delay logic
  let dragDelayTimeoutId: number | null = null;
  let isDragAllowed = false;
  let startDragPosX: number | null = null;
  let startDragPosY: number | null = null;
  const DRAG_MOVE_THRESHOLD = 5; // Pixels threshold to cancel drag delay

  const columnEl = existingColumnEl || createDiv({ cls: 'notidian-file-explorer-column' });
  columnEl.dataset.path = folderPath;
  columnEl.dataset.depth = String(depth);
  columnEl.empty(); // Clear content before re-rendering

  const savedWidth = callbacks.getColumnWidth(folderPath);
  if (savedWidth) columnEl.style.setProperty('--notidian-column-width', `${savedWidth}px`);
  else columnEl.style.removeProperty('--notidian-column-width');

  const resizeHandle = columnEl.createEl('button', {
    cls: 'notidian-file-explorer-column-resize-handle',
    attr: {
      type: 'button',
      'aria-label': `Resize ${folderPath === '/' ? 'root' : folderPath} column`,
      title: 'Drag to resize. Double-click to reset.'
    }
  });
  const setWidth = (width: number) => {
    const clampedWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
    columnEl.style.setProperty('--notidian-column-width', `${clampedWidth}px`);
    callbacks.setColumnWidth(folderPath, clampedWidth);
  };
  resizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startingX = event.clientX;
    const startingWidth = columnEl.getBoundingClientRect().width;
    const body = columnEl.ownerDocument.body;
    body.addClass('notidian-is-resizing-column');
    resizeHandle.setPointerCapture(event.pointerId);

    const resize = (moveEvent: PointerEvent) => setWidth(startingWidth + moveEvent.clientX - startingX);
    const stop = (endEvent: PointerEvent) => {
      body.removeClass('notidian-is-resizing-column');
      resizeHandle.removeEventListener('pointermove', resize);
      resizeHandle.removeEventListener('pointerup', stop);
      resizeHandle.removeEventListener('pointercancel', stop);
      if (resizeHandle.hasPointerCapture(endEvent.pointerId)) resizeHandle.releasePointerCapture(endEvent.pointerId);
    };
    resizeHandle.addEventListener('pointermove', resize);
    resizeHandle.addEventListener('pointerup', stop);
    resizeHandle.addEventListener('pointercancel', stop);
  });
  resizeHandle.addEventListener('dblclick', () => {
    columnEl.style.removeProperty('--notidian-column-width');
    callbacks.setColumnWidth(folderPath, null);
  });
  resizeHandle.addEventListener('keydown', (event) => {
    if (event.key === 'Home') {
      columnEl.style.removeProperty('--notidian-column-width');
      callbacks.setColumnWidth(folderPath, null);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setWidth(columnEl.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -20 : 20));
    }
  });

  // Create top bar with quick action buttons
  const topBarEl = columnEl.createDiv({ cls: 'notidian-file-explorer-column-topbar' });

  const filterButton = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn is-icon-only',
    attr: { 'aria-label': 'Filter this column', title: 'Filter this column (/)' }
  });
  setIcon(filterButton, 'filter');

  const newButton = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn is-new',
    attr: { 'aria-label': 'Create new item', 'aria-haspopup': 'menu' }
  });
  setIcon(newButton.createSpan(), 'plus');
  newButton.createSpan({ text: 'New' });
  newButton.addEventListener('click', () => {
    const menu = new Menu();
    menu.addItem(item => item
      .setTitle('New Note')
      .setIcon('file-plus')
      .onClick(() => callbacks.createNewNote(folderPath, '.md'))
    );
    menu.addItem(item => item
      .setTitle('New Folder')
      .setIcon('folder-plus')
      .onClick(() => callbacks.createNewFolder(folderPath))
    );
    menu.addSeparator();
    menu.addItem(item => item
      .setTitle('New Canvas')
      .setIcon('layout-dashboard')
      .onClick(() => callbacks.createNewNote(folderPath, '.canvas'))
    );
    menu.addItem(item => item
      .setTitle('New Excalidraw Note')
      .setIcon(getIcon('excalidraw-icon') ? 'excalidraw-icon' : 'pencil-line')
      .onClick(() => callbacks.createNewNote(folderPath, '.excalidraw.md'))
    );
    const rect = newButton.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, newButton.ownerDocument);
  });

  const filterBar = columnEl.createDiv({ cls: 'notidian-file-explorer-filter' });
  setIcon(filterBar.createSpan({ cls: 'notidian-file-explorer-filter-icon' }), 'filter');
  const filterInput = filterBar.createEl('input', {
    attr: { type: 'search', placeholder: 'Filter this folder...', 'aria-label': 'Filter this folder' }
  });

  const showFilter = () => {
    filterBar.addClass('is-visible');
    filterInput.focus();
    filterInput.select();
  };
  filterButton.addEventListener('click', showFilter);

  // --- Render Favorites Section (only in first column) ---
  if (depth === 0) {
    const favorites = (plugin.settings.favorites || []).filter(path => !isPathHidden(path, plugin.settings.hiddenPaths || []));
    const isCollapsed = plugin.settings.favoritesCollapsed ?? false;

    if (favorites.length > 0) {
      const favoritesSection = columnEl.createDiv({ cls: 'notidian-favorites-section' });

      // Favorites header (clickable to collapse/expand)
      const favoritesHeader = favoritesSection.createDiv({
        cls: `notidian-favorites-header ${isCollapsed ? 'is-collapsed' : ''}`
      });

      const chevronEl = favoritesHeader.createSpan({ cls: 'notidian-favorites-chevron' });
      setIcon(chevronEl, 'chevron-down');

      const starEl = favoritesHeader.createSpan({ cls: 'notidian-favorites-star' });
      setIcon(starEl, 'star');

      favoritesHeader.createSpan({ cls: 'notidian-favorites-title', text: 'Favorites' });

      favoritesHeader.createSpan({
        cls: 'notidian-favorites-count',
        text: `${favorites.length}`
      });

      favoritesHeader.addEventListener('click', () => {
        callbacks.toggleFavoritesCollapsed();
      });

      // Favorites content (collapsible)
      const favoritesContent = favoritesSection.createDiv({
        cls: `notidian-favorites-content ${isCollapsed ? 'is-collapsed' : ''}`
      });

      // State for drag reordering within favorites
      let draggedFavIndex: number | null = null;
      let dropIndicator: HTMLElement | null = null;

      // Render each favorite item
      favorites.forEach((favPath, index) => {
        const abstractFile = app.vault.getAbstractFileByPath(favPath);
        if (!abstractFile) return; // Skip if file no longer exists

        const isFolder = abstractFile instanceof TFolder;

        const favItemEl = favoritesContent.createDiv({
          cls: `notidian-file-explorer-item notidian-favorite-item ${isFolder ? 'nav-folder' : 'nav-file'}`
        });
        favItemEl.dataset.path = favPath;
        favItemEl.dataset.favIndex = String(index);
        favItemEl.tabIndex = 0;
        favItemEl.draggable = true; // Make draggable for reordering

        renderItemIcon(favItemEl, app, plugin, abstractFile);
        const favoriteTitleEl = favItemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: getItemDisplayName(abstractFile) });
        enableInlineRename(favItemEl, favoriteTitleEl, getRenameParts(abstractFile.name, isFolder).name, favPath, isFolder, callbacks);

        // Star icon (filled, always visible for favorites)
        const starIconEl = favItemEl.createSpan({ cls: 'notidian-favorite-star is-favorited' });
        setIcon(starIconEl, 'star');
        starIconEl.addEventListener('click', (event) => {
          event.stopPropagation();
          callbacks.toggleFavorite(favPath);
        });

        // --- Drag and Drop for Reordering ---
        favItemEl.addEventListener('dragstart', (event) => {
          draggedFavIndex = index;
          favItemEl.addClass('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `fav-reorder:${index}`);
          }
        });

        favItemEl.addEventListener('dragend', () => {
          draggedFavIndex = null;
          favItemEl.removeClass('is-dragging');
          // Remove any drop indicators
          favoritesContent.querySelectorAll('.notidian-favorites-drop-indicator').forEach(el => el.remove());
        });

        favItemEl.addEventListener('dragover', (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (event.dataTransfer && isExternalFileDrag(event.dataTransfer.types)) {
            event.dataTransfer.dropEffect = 'copy';
            favItemEl.addClass('drag-over');
            return;
          }

          if (draggedFavIndex === null || draggedFavIndex === index) return;

          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
          }

          // Determine if dropping above or below this item
          const rect = favItemEl.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = event.clientY < midY;

          // Remove existing drop indicators
          favoritesContent.querySelectorAll('.notidian-favorites-drop-indicator').forEach(el => el.remove());

          // Create drop indicator
          dropIndicator = document.createElement('div');
          dropIndicator.className = 'notidian-favorites-drop-indicator';

          if (isAbove) {
            favItemEl.before(dropIndicator);
          } else {
            favItemEl.after(dropIndicator);
          }
        });

        favItemEl.addEventListener('dragleave', (event) => {
          // Only remove indicator if leaving the item entirely
          if (!favItemEl.contains(event.relatedTarget as Node)) {
            favoritesContent.querySelectorAll('.notidian-favorites-drop-indicator').forEach(el => el.remove());
            favItemEl.removeClass('drag-over');
          }
        });

        favItemEl.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          favItemEl.removeClass('drag-over');

          // Remove drop indicators
          favoritesContent.querySelectorAll('.notidian-favorites-drop-indicator').forEach(el => el.remove());

          const importTarget = isFolder ? abstractFile.path : abstractFile.parent?.path;
          if (handleExternalFileDrop(event.dataTransfer, importTarget, callbacks)) return;

          if (draggedFavIndex === null || draggedFavIndex === index) return;

          // Check if this is a favorites reorder drag
          const dragData = event.dataTransfer?.getData('text/plain');
          if (!dragData?.startsWith('fav-reorder:')) return;

          // Determine drop position
          const rect = favItemEl.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = event.clientY < midY;

          let toIndex = isAbove ? index : index + 1;
          // Adjust if dragging from before to after
          if (draggedFavIndex < toIndex) {
            toIndex--;
          }

          if (draggedFavIndex !== toIndex) {
            callbacks.reorderFavorites(draggedFavIndex, toIndex);
          }

          draggedFavIndex = null;
        });

        // Click handler - navigate to item
        favItemEl.addEventListener('click', () => {
          callbacks.navigateToFavorite(favPath);
        });

        // Keyboard navigation
        favItemEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            callbacks.navigateToFavorite(favPath);
          }
        });
      });
    }
  }

  // --- Render Tags Section (only in first column) ---
  if (depth === 0) {
    const tagDefinitions = plugin.settings.tagDefinitions || [];
    const tagAssignments = plugin.settings.tagAssignments || {};
    const isTagsCollapsed = plugin.settings.tagsCollapsed ?? false;
    const tagSubgroupCollapsed = plugin.settings.tagSubgroupCollapsed || {};

    // Build reverse map: tagId -> paths[]
    const tagToPathsMap: Record<string, string[]> = {};
    for (const tag of tagDefinitions) {
      tagToPathsMap[tag.id] = [];
    }
    for (const [path, tagIds] of Object.entries(tagAssignments)) {
      if (isPathHidden(path, plugin.settings.hiddenPaths || [])) continue;
      for (const tagId of tagIds) {
        if (tagToPathsMap[tagId]) {
          tagToPathsMap[tagId].push(path);
        }
      }
    }

    const tagsWithItems = tagDefinitions.filter(t => tagToPathsMap[t.id].length > 0);

    if (tagsWithItems.length > 0) {
      const tagsSection = columnEl.createDiv({ cls: 'notidian-tags-section' });

      const tagsHeader = tagsSection.createDiv({
        cls: `notidian-tags-header ${isTagsCollapsed ? 'is-collapsed' : ''}`
      });

      const chevronEl = tagsHeader.createSpan({ cls: 'notidian-tags-chevron' });
      setIcon(chevronEl, 'chevron-down');

      const tagIconEl = tagsHeader.createSpan({ cls: 'notidian-tags-icon' });
      setIcon(tagIconEl, 'tags');

      tagsHeader.createSpan({ cls: 'notidian-tags-title', text: 'Tags' });

      const totalTaggedCount = Object.values(tagToPathsMap).reduce((sum, paths) => sum + paths.length, 0);
      tagsHeader.createSpan({
        cls: 'notidian-tags-count',
        text: `${totalTaggedCount}`
      });

      tagsHeader.addEventListener('click', () => {
        callbacks.toggleTagsCollapsed();
      });

      const tagsContent = tagsSection.createDiv({
        cls: `notidian-tags-content ${isTagsCollapsed ? 'is-collapsed' : ''}`
      });

      for (const tag of tagsWithItems) {
        const paths = tagToPathsMap[tag.id];
        const isSubCollapsed = tagSubgroupCollapsed[tag.id] ?? false;

        const subgroupEl = tagsContent.createDiv({ cls: 'notidian-tags-subgroup' });

        const subHeader = subgroupEl.createDiv({
          cls: `notidian-tags-subgroup-header ${isSubCollapsed ? 'is-collapsed' : ''}`
        });

        const subChevron = subHeader.createSpan({ cls: 'notidian-tags-subgroup-chevron' });
        setIcon(subChevron, 'chevron-down');

        const colorDot = subHeader.createSpan({ cls: 'notidian-tags-color-dot' });
        colorDot.style.backgroundColor = tag.color;

        subHeader.createSpan({ cls: 'notidian-tags-subgroup-name', text: tag.name });

        subHeader.createSpan({
          cls: 'notidian-tags-subgroup-count',
          text: `${paths.length}`
        });

        subHeader.addEventListener('click', () => {
          callbacks.toggleTagSubgroupCollapsed(tag.id);
        });

        const subContent = subgroupEl.createDiv({
          cls: `notidian-tags-subgroup-content ${isSubCollapsed ? 'is-collapsed' : ''}`
        });

        for (const itemPath of paths) {
          const abstractFile = app.vault.getAbstractFileByPath(itemPath);
          if (!abstractFile) continue;

          const isFolder = abstractFile instanceof TFolder;

          const tagItemEl = subContent.createDiv({
            cls: `notidian-file-explorer-item notidian-tag-item ${isFolder ? 'nav-folder' : 'nav-file'}`
          });
          tagItemEl.dataset.path = itemPath;
          tagItemEl.tabIndex = 0;

          renderItemIcon(tagItemEl, app, plugin, abstractFile);
          const tagTitleEl = tagItemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: getItemDisplayName(abstractFile) });
          enableInlineRename(tagItemEl, tagTitleEl, getRenameParts(abstractFile.name, isFolder).name, itemPath, isFolder, callbacks);

          tagItemEl.addEventListener('dragover', event => {
            if (!event.dataTransfer || !isExternalFileDrag(event.dataTransfer.types)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'copy';
            tagItemEl.addClass('drag-over');
          });
          tagItemEl.addEventListener('dragleave', event => {
            if (!tagItemEl.contains(event.relatedTarget as Node)) tagItemEl.removeClass('drag-over');
          });
          tagItemEl.addEventListener('drop', event => {
            event.preventDefault();
            event.stopPropagation();
            tagItemEl.removeClass('drag-over');
            const importTarget = isFolder ? abstractFile.path : abstractFile.parent?.path;
            handleExternalFileDrop(event.dataTransfer, importTarget, callbacks);
          });

          tagItemEl.addEventListener('click', () => {
            callbacks.navigateToTaggedItem(itemPath);
          });

          tagItemEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              callbacks.navigateToTaggedItem(itemPath);
            }
          });
        }
      }
    }
  }

  // Create the content wrapper for items
  const contentWrapperEl = columnEl.createDiv({ cls: 'notidian-file-explorer-column-content' });
  const applyFilter = () => {
    const items = Array.from(contentWrapperEl.querySelectorAll<HTMLElement>(':scope > .notidian-file-explorer-item'));
    let visibleItems = 0;
    for (const item of items) {
      const matches = filterMatches(item.querySelector('.notidian-file-explorer-item-title')?.textContent || '', filterInput.value);
      item.toggleClass('is-filtered-out', !matches);
      if (matches) visibleItems++;
    }
    contentWrapperEl.querySelector('.notidian-file-explorer-filter-empty')?.remove();
    if (filterInput.value.trim() && visibleItems === 0) {
      contentWrapperEl.createDiv({ cls: 'notidian-file-explorer-filter-empty', text: 'No matches' });
    }
  };
  filterInput.addEventListener('input', applyFilter);
  filterInput.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      filterInput.value = '';
      applyFilter();
      filterBar.removeClass('is-visible');
      filterButton.focus();
    }
  });
  contentWrapperEl.addEventListener('keydown', event => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      showFilter();
    }
  });

  let tChildren: TAbstractFile[];
  try {
    const folder = app.vault.getAbstractFileByPath(folderPath);

    // Explicitly check for null first
    if (!folder) {
      console.error(`Could not find folder object for path: ${folderPath}`);
      contentWrapperEl.createDiv({ text: `Error: Path not found: ${folderPath}` });
      return existingColumnEl ? null : columnEl;
    }
    // Now check if it's a folder
    else if (folder instanceof TFolder) {
      tChildren = folder.children;
    }
    // Handle cases where the path exists but isn't a folder
    else {
      console.warn(`Path exists but is not a folder: ${folderPath}`);
      contentWrapperEl.createDiv({ text: `Not a folder: ${folderPath}` });
      return existingColumnEl ? null : columnEl;
    }
  } catch (error) {
    console.error(`Error accessing folder ${folderPath}:`, error);
    // Add error message to content wrapper instead of column
    contentWrapperEl.createDiv({ text: `Error loading: ${folderPath}` });
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

  // --- Calculate Initial Stats ---
  let totalSize = 0;
  let hiddenFilesCount = 0;
  // Removed unused initialFileCount and initialFolderCount

  files.forEach(file => {
    totalSize += file.stat.size;
    if (file.name.startsWith('.')) {
      hiddenFilesCount++;
    }
  });

  // --- Filter based on Exclusions & Hidden ---
  const exclusionPatterns = plugin.settings.exclusionPatterns
    .split('\n')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  const hiddenPaths = plugin.settings.hiddenPaths || [];
  const filteredFolders = folders.filter(folder => !isExcluded(folder.path, exclusionPatterns) && !isPathHidden(folder.path, hiddenPaths));
  const filteredFiles = files.filter(file => !isExcluded(file.path, exclusionPatterns) && !isPathHidden(file.path, hiddenPaths));

  // --- Sort (check for custom order first) ---
  const customOrder = callbacks.getCustomFolderOrder(folderPath);

  if (customOrder && customOrder.length > 0) {
    // Use custom order - items in custom order come first in that order,
    // items not in custom order come last (alphabetically)
    const orderMap = new Map(customOrder.map((path, index) => [path, index]));

    const sortByCustomOrder = (a: TAbstractFile, b: TAbstractFile) => {
      const aIndex = orderMap.get(a.path);
      const bIndex = orderMap.get(b.path);

      // Both have custom order
      if (aIndex !== undefined && bIndex !== undefined) {
        return aIndex - bIndex;
      }
      // Only a has custom order - a comes first
      if (aIndex !== undefined) return -1;
      // Only b has custom order - b comes first
      if (bIndex !== undefined) return 1;
      // Neither has custom order - sort alphabetically
      return a.name.localeCompare(b.name);
    };

    filteredFolders.sort(sortByCustomOrder);
    filteredFiles.sort(sortByCustomOrder);
  } else {
    // Default alphabetical sort
    filteredFolders.sort((a, b) => a.name.localeCompare(b.name));
    filteredFiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  const displayedFolderCount = filteredFolders.length;
  const displayedFileCount = filteredFiles.length;

  // --- State for drag reordering within this column ---
  let draggedItemPath: string | null = null;

  // --- Get Settings Maps ---
  const emojiMap = plugin.settings.emojiMap; // Get emoji map from settings
  const iconAssociations = plugin.settings.iconAssociations; // Get icon associations

  // Render Filtered Folders
  for (const folder of filteredFolders) {
    // Exclusion check already done

    const folderName = folder.name;
    // Append items to the content wrapper
    const itemEl = contentWrapperEl.createDiv({ cls: 'notidian-file-explorer-item nav-folder' });
    itemEl.dataset.path = folder.path;
    itemEl.draggable = true; // Make folders draggable
    itemEl.tabIndex = 0; // Make folder focusable
    const customIconFilename = iconAssociations[folder.path];
    const folderEmoji = emojiMap[folder.path];

    if (customIconFilename) {
      // Render custom icon using getResourcePath directly
      const iconFullPath = normalizePath(`Assets/notidian-file-explorer-data/images/${customIconFilename}`); // Updated path
      // Use adapter.getResourcePath which works for files not indexed as TFiles
      const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
      // Basic check if resource path generation worked (it might return the input path on failure)
      if (iconSrc && iconSrc !== iconFullPath) {
        itemEl.createEl('img', {
          cls: 'notidian-file-explorer-item-icon custom-icon',
          attr: { src: iconSrc, alt: folder.name }
        });
      } else {
        // Fallback if getResourcePath fails or returns the original path
        console.warn(`Could not get resource path for folder icon: ${iconFullPath}. Falling back.`);
        setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-folder-icon' }), 'folder');
      }
    } else if (folderEmoji) {
      // Render emoji
      itemEl.createSpan({ cls: 'notidian-file-explorer-item-emoji', text: folderEmoji });
      itemEl.dataset.emoji = folderEmoji; // Store for potential use
    } else {
      // Render default folder icon
      setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-folder-icon' }), 'folder');
    }
    const titleEl = itemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: folderName });
    enableInlineRename(itemEl, titleEl, folderName, folder.path, true, callbacks);

    // Add star icon for favorites (hover to show, always visible if favorited) - before arrow
    const isFolderFavorited = callbacks.isFavorite(folder.path);
    const folderStarEl = itemEl.createSpan({
      cls: `notidian-favorite-star ${isFolderFavorited ? 'is-favorited' : ''}`
    });
    setIcon(folderStarEl, 'star');
    folderStarEl.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      callbacks.toggleFavorite(folder.path);
    });

    // Add arrow icon to the right for folders
    setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-arrow' }), 'chevron-right');

    itemEl.addEventListener('click', event => {
      if (!shouldHandleSelectionClick(event.detail)) return;
      callbacks.handleItemClick(itemEl, true, depth, event);
    });
    itemEl.addEventListener('dblclick', event => {
      if ((event.target as HTMLElement).closest('.notidian-favorite-star, .notidian-inline-rename')) return;
      event.preventDefault();
      event.stopPropagation();
      void callbacks.renameItem(folder.path);
    });

    // Add keydown listener for keyboard navigation
    itemEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        // Open the folder (same as click)
        itemEl.click();
        // Focus first item in newly opened column after a brief delay
        setTimeout(() => {
          const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
          const nextColumn = currentColumn?.nextElementSibling as HTMLElement;
          if (nextColumn) {
            const firstItem = getVisibleColumnItem(nextColumn);
            firstItem?.focus();
          }
        }, 50);
      } else if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        callbacks.renameItem(folder.path);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusAdjacentVisibleItem(itemEl, 'previous');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusAdjacentVisibleItem(itemEl, 'next');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        // Focus the selected item in the previous column
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const prevColumn = currentColumn?.previousElementSibling as HTMLElement;
        if (prevColumn) {
          const selectedInPrev = getVisibleColumnItem(prevColumn, true);
          if (selectedInPrev) {
            selectedInPrev.focus();
          } else {
            // Focus first item if none selected
            const firstItem = getVisibleColumnItem(prevColumn);
            firstItem?.focus();
          }
        }
      }
    });

    // --- Drag Delay and Drag/Drop Listeners for Folders ---
    itemEl.addEventListener('mousedown', (event) => {
      // Only start drag logic for left clicks
      if (event.button !== 0) return;

      clearTimeout(dragDelayTimeoutId as number); // Clear any previous timeout
      isDragAllowed = false;
      startDragPosX = event.clientX;
      startDragPosY = event.clientY;

      dragDelayTimeoutId = window.setTimeout(() => {
        // Check if mouse has moved significantly before allowing drag
        // Note: This check inside timeout might be redundant if mousemove clears it,
        // but kept for safety. The primary check is in dragstart.
        if (startDragPosX !== null && startDragPosY !== null) {
          isDragAllowed = true;
          console.log(`Drag allowed for folder: ${folder.path}`);
          // We don't programmatically start drag here, dragstart event handles it
        }
        dragDelayTimeoutId = null; // Clear the ID after timeout runs or is cleared
      }, DRAG_INITIATION_DELAY); // Use the delay constant
    });

    itemEl.addEventListener('mousemove', (event) => {
      // If button isn't pressed, or timer isn't running, do nothing
      if (event.buttons !== 1 || dragDelayTimeoutId === null || startDragPosX === null || startDragPosY === null) {
        return;
      }
      // Calculate distance moved
      const deltaX = Math.abs(event.clientX - startDragPosX);
      const deltaY = Math.abs(event.clientY - startDragPosY);

      // If moved beyond threshold before timeout, cancel drag initiation
      if (deltaX > DRAG_MOVE_THRESHOLD || deltaY > DRAG_MOVE_THRESHOLD) {
        clearTimeout(dragDelayTimeoutId);
        dragDelayTimeoutId = null;
        isDragAllowed = false;
        startDragPosX = null; // Reset start position
        startDragPosY = null;
        // console.log("Drag cancelled due to movement before delay");
      }
    });


    itemEl.addEventListener('mouseup', (event) => {
      // Clear timeout if mouse is released before it fires
      if (event.button === 0) { // Only react to left mouse button up
        clearTimeout(dragDelayTimeoutId as number);
        dragDelayTimeoutId = null;
        isDragAllowed = false;
        startDragPosX = null; // Reset start position
        startDragPosY = null;
      }
    });

    itemEl.addEventListener('dragstart', (event) => {
      // IMPORTANT: Only proceed if the delay timer allowed it
      if (!isDragAllowed) {
        event.preventDefault();
        console.log(`Drag prevented for folder (delay not met/cancelled): ${folder.path}`);
        return;
      }
      // Reset flag immediately after successful start
      isDragAllowed = false;

      if (!itemEl.hasClass('is-selected-final')) callbacks.handleItemClick(itemEl, true, depth, undefined, false);

      // Track dragged item for reordering
      draggedItemPath = folder.path;

      // Enhanced dragstart logic for Canvas/Excalidraw compatibility
      if (event.dataTransfer) {
        // Set wikilink format as primary text for Obsidian compatibility
        // Note: User holds SHIFT while DROPPING to create embed/iframe (not at dragstart)
        const wikilink = `[[${folder.path}]]`;
        event.dataTransfer.setData('text/plain', wikilink);

        // Set JSON with folder metadata for rich drop handling
        const folderData = JSON.stringify({
          type: 'folder',
          file: folder.path,
          name: folder.name
        });
        event.dataTransfer.setData('application/json', folderData);

        // Set column reorder info for same-column reordering
        event.dataTransfer.setData('text/x-column-reorder', `${folderPath}:${folder.path}`);

        // Set HTML format for rich text editors
        event.dataTransfer.setData('text/html', `<a href="${folder.path}">${folder.name}</a>`);

        // Allow all drag operations (move, copy, link)
        event.dataTransfer.effectAllowed = 'all';
      }

      itemEl.addClass('is-dragging');
      console.log(`Drag Start Folder: ${folder.path} (wikilink format)`);

      // Clear any lingering timeout just in case (should be cleared by mouseup/move)
      clearTimeout(dragDelayTimeoutId as number);
      dragDelayTimeoutId = null;
      startDragPosX = null;
      startDragPosY = null;
    });

    itemEl.addEventListener('dragend', () => {
      itemEl.removeClass('is-dragging');
      draggedItemPath = null;
      // Remove any drop indicators
      contentWrapperEl.querySelectorAll('.notidian-column-drop-indicator').forEach(el => el.remove());
    });

    // Allow dropping onto folders and reordering
    itemEl.addEventListener('dragover', (event) => {
      event.preventDefault(); // Necessary to allow drop
      event.stopPropagation(); // Prevent bubbling to column listener
      if (event.dataTransfer) event.dataTransfer.dropEffect = isExternalFileDrag(event.dataTransfer.types) ? 'copy' : 'move';

      // Check if this is a same-column reorder
      if (draggedItemPath && draggedItemPath !== folder.path && contentWrapperEl.querySelectorAll('.is-selected-final').length === 1) {
        // Remove existing drop indicators
        contentWrapperEl.querySelectorAll('.notidian-column-drop-indicator').forEach(el => el.remove());

        // Check mouse position to determine if we're in reorder zone (top/bottom 30%)
        const rect = itemEl.getBoundingClientRect();
        const relativeY = event.clientY - rect.top;
        const heightRatio = relativeY / rect.height;

        if (heightRatio < 0.3) {
          // Show drop indicator above this item
          const indicator = document.createElement('div');
          indicator.className = 'notidian-column-drop-indicator';
          itemEl.before(indicator);
          itemEl.removeClass('drag-over');
          callbacks.clearDragOverTimeout();
          return;
        } else if (heightRatio > 0.7) {
          // Show drop indicator below this item
          const indicator = document.createElement('div');
          indicator.className = 'notidian-column-drop-indicator';
          itemEl.after(indicator);
          itemEl.removeClass('drag-over');
          callbacks.clearDragOverTimeout();
          return;
        }
        // Fall through to normal folder drop behavior for middle zone
      }

      // Standard folder drop behavior (move into folder)
      // Only add class and set timeout if not already highlighted
      if (!itemEl.classList.contains('drag-over')) {
        itemEl.addClass('drag-over');
        // --- Spring-loaded folder logic ---
        // Only set timeout if delay is configured (> 0 means enabled)
        if (dragOverTimeoutDelay > 0) {
          // Clear any previous timeout for other elements
          callbacks.clearDragOverTimeout();
          // Set a new timeout to open this folder
          const timeoutId = window.setTimeout(() => {
            console.log(`Drag over timeout expired for: ${folder.path}`);
            callbacks.triggerFolderOpen(folder.path, depth);
          }, dragOverTimeoutDelay); // Use configured delay
          // Store the timeout ID and target element
          callbacks.setDragOverTimeout(timeoutId, itemEl);
        }
      }
    });

    itemEl.addEventListener('dragleave', (event) => {
      // Only remove highlight and clear timeout if the mouse truly leaves the item element
      if (!itemEl.contains(event.relatedTarget as Node)) {
        itemEl.removeClass('drag-over');
        callbacks.clearDragOverTimeout();
      }
      event.stopPropagation(); // Still prevent bubbling
    });

    itemEl.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation(); // Prevent bubbling to column listener
      itemEl.removeClass('drag-over');
      callbacks.clearDragOverTimeout(); // Clear timeout on drop

      if (handleExternalFileDrop(event.dataTransfer, itemEl.dataset.path, callbacks)) return;

      // Check if there's a drop indicator (means it's a reorder)
      const dropIndicator = contentWrapperEl.querySelector('.notidian-column-drop-indicator');

      if (dropIndicator && draggedItemPath && draggedItemPath !== folder.path && contentWrapperEl.querySelectorAll('.is-selected-final').length === 1) {
        // This is a reorder operation
        const rect = itemEl.getBoundingClientRect();
        const relativeY = event.clientY - rect.top;
        const heightRatio = relativeY / rect.height;
        const insertAfter = heightRatio > 0.5;

        // Remove drop indicator
        dropIndicator.remove();

        // Call reorder callback
        callbacks.reorderFolderItems(folderPath, draggedItemPath, folder.path, insertAfter);
        draggedItemPath = null;
        return;
      }

      // Remove any drop indicators
      contentWrapperEl.querySelectorAll('.notidian-column-drop-indicator').forEach(el => el.remove());

      // Standard move-into-folder behavior
      // Extract path from drag data (handles both wikilink and plain path formats)
      const rawPath = event.dataTransfer?.getData('text/plain');
      const sourcePath = extractPathFromDragData(rawPath);
      const targetFolderPath = itemEl.dataset.path;

      if (sourcePath && targetFolderPath && sourcePath !== targetFolderPath) {
        console.log(`Drop: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
        callbacks.handleDrop(sourcePath, targetFolderPath); // Use callback
      } else {
        console.log("Drop ignored: missing path or dropping onto self.");
      }
    });
  }

  // Render Filtered Files
  for (const file of filteredFiles) {
    // Exclusion and hidden checks already done

    // const fileName = file.name; // Removed unused variable
    // Append items to the content wrapper
    const itemEl = contentWrapperEl.createDiv({ cls: 'notidian-file-explorer-item nav-file' });
    itemEl.dataset.path = file.path;
    itemEl.draggable = true; // Make files draggable
    const customIconFilename = iconAssociations[file.path];
    const fileEmoji = emojiMap[file.path];

    if (customIconFilename) {
      // Render custom icon using getResourcePath directly
      const iconFullPath = normalizePath(`Assets/notidian-file-explorer-data/images/${customIconFilename}`);
      const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
      if (iconSrc && iconSrc !== iconFullPath) {
        itemEl.createEl('img', {
          cls: 'notidian-file-explorer-item-icon custom-icon',
          attr: { src: iconSrc, alt: file.name }
        });
      } else {
        console.warn(`Could not get resource path for file icon: ${iconFullPath}. Falling back.`);
        const iconName = getIconForFile(app, file);
        setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-file-icon' }), iconName);
      }
    } else if (fileEmoji) {
      // Render emoji
      itemEl.createSpan({ cls: 'notidian-file-explorer-item-emoji', text: fileEmoji });
      itemEl.dataset.emoji = fileEmoji;
    } else {
      // Check for Office file SVG icons first
      const officeSvg = getOfficeIcon(file.extension);
      if (officeSvg) {
        const iconSpan = itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-file-icon office-icon' });
        iconSpan.innerHTML = officeSvg;
      } else {
        // Render default file icon
        const iconName = getIconForFile(app, file);
        setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-file-icon' }), iconName);
      }
    }

    // Determine the display name:
    // - .md files: show basename (no extension)
    // - .excalidraw.md files: show name without .excalidraw.md suffix
    // - All other files: show full name with extension
    let displayFileName: string;
    const lowerFullName = file.name.toLowerCase();
    const extension = file.extension.toLowerCase();

    if (lowerFullName.endsWith('.excalidraw.md')) {
      // Special case: remove the full .excalidraw.md suffix
      displayFileName = file.name.slice(0, -'.excalidraw.md'.length);
    } else if (extension === 'md') {
      // Regular markdown: show basename (no extension)
      displayFileName = file.basename;
    } else {
      // All other files: show full name with extension
      displayFileName = file.name;
    }

    const titleEl = itemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: displayFileName });
    const renameFileName = getRenameParts(file.name, false).name;
    enableInlineRename(itemEl, titleEl, renameFileName, file.path, false, callbacks);

    // Add star icon for favorites (hover to show, always visible if favorited) - before type icon
    const isFileFavorited = callbacks.isFavorite(file.path);
    const fileStarEl = itemEl.createSpan({
      cls: `notidian-favorite-star ${isFileFavorited ? 'is-favorited' : ''}`
    });
    setIcon(fileStarEl, 'star');
    fileStarEl.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      callbacks.toggleFavorite(file.path);
    });

    // --- Add Secondary File Type Icon ---
    const fileTypeIconName = getIconForFile(app, file);
    // Only add the secondary icon if it's NOT the default 'document' icon
    if (fileTypeIconName !== 'document') {
      const typeIconEl = itemEl.createSpan({ cls: 'notidian-file-explorer-item-type-icon' });
      // Check for Office SVG icons
      const officeTypeSvg = getOfficeIcon(file.extension);
      if (officeTypeSvg) {
        typeIconEl.addClass('office-icon');
        typeIconEl.innerHTML = officeTypeSvg;
      } else {
        setIcon(typeIconEl, fileTypeIconName);
      }
    }

    itemEl.addEventListener('click', (event) => {
      if (!shouldHandleSelectionClick(event.detail)) return;
      callbacks.handleItemClick(itemEl, false, depth, event);
      if (shouldOpenFileOnClick(event.detail, event.shiftKey, event.metaKey, event.ctrlKey)) app.workspace.openLinkText(file.path, '', false);
    });
    itemEl.addEventListener('dblclick', event => {
      if ((event.target as HTMLElement).closest('.notidian-favorite-star, .notidian-inline-rename')) return;
      event.preventDefault();
      event.stopPropagation();
      void callbacks.renameItem(file.path);
    });

    // Add keydown listener for keyboard navigation
    itemEl.tabIndex = 0; // Make file focusable
    itemEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        // Open the file (same as click)
        itemEl.click();
      } else if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        callbacks.renameItem(file.path);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusAdjacentVisibleItem(itemEl, 'previous');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusAdjacentVisibleItem(itemEl, 'next');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        // Focus the selected item in the previous column
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const prevColumn = currentColumn?.previousElementSibling as HTMLElement;
        if (prevColumn) {
          const selectedInPrev = getVisibleColumnItem(prevColumn, true);
          if (selectedInPrev) {
            selectedInPrev.focus();
          } else {
            const firstItem = getVisibleColumnItem(prevColumn);
            firstItem?.focus();
          }
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        // For files, ArrowRight focuses the next column if it exists
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const nextColumn = currentColumn?.nextElementSibling as HTMLElement;
        if (nextColumn) {
          const firstItem = getVisibleColumnItem(nextColumn);
          firstItem?.focus();
        }
      }
    });

    // --- Drag Delay and Drag Listener for Files ---
    itemEl.addEventListener('mousedown', (event) => {
      // Only start drag logic for left clicks
      if (event.button !== 0) return;

      clearTimeout(dragDelayTimeoutId as number); // Clear any previous timeout
      isDragAllowed = false;
      startDragPosX = event.clientX;
      startDragPosY = event.clientY;

      dragDelayTimeoutId = window.setTimeout(() => {
        if (startDragPosX !== null && startDragPosY !== null) { // Check if not cancelled by move/up
          isDragAllowed = true;
          console.log(`Drag allowed for file: ${file.path}`);
        }
        dragDelayTimeoutId = null;
      }, DRAG_INITIATION_DELAY);
    });

    itemEl.addEventListener('mousemove', (event) => {
      if (event.buttons !== 1 || dragDelayTimeoutId === null || startDragPosX === null || startDragPosY === null) {
        return;
      }
      const deltaX = Math.abs(event.clientX - startDragPosX);
      const deltaY = Math.abs(event.clientY - startDragPosY);
      if (deltaX > DRAG_MOVE_THRESHOLD || deltaY > DRAG_MOVE_THRESHOLD) {
        clearTimeout(dragDelayTimeoutId);
        dragDelayTimeoutId = null;
        isDragAllowed = false;
        startDragPosX = null;
        startDragPosY = null;
        // console.log("Drag cancelled due to movement before delay");
      }
    });

    itemEl.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        clearTimeout(dragDelayTimeoutId as number);
        dragDelayTimeoutId = null;
        isDragAllowed = false;
        startDragPosX = null;
        startDragPosY = null;
      }
    });

    itemEl.addEventListener('dragstart', (event) => {
      // IMPORTANT: Only proceed if the delay timer allowed it
      if (!isDragAllowed) {
        event.preventDefault();
        console.log(`Drag prevented for file (delay not met/cancelled): ${file.path}`);
        return;
      }
      isDragAllowed = false; // Reset flag

      if (!itemEl.hasClass('is-selected-final')) callbacks.handleItemClick(itemEl, false, depth, undefined, false);

      // Track dragged item for reordering
      draggedItemPath = file.path;

      startVaultFileDrag(app, event, file, folderPath);

      itemEl.addClass('is-dragging');
      console.log(`Drag Start File: ${file.path} (wikilink format)`);

      // Cleanup state
      clearTimeout(dragDelayTimeoutId as number);
      dragDelayTimeoutId = null;
      startDragPosX = null;
      startDragPosY = null;
    });

    itemEl.addEventListener('dragend', () => {
      itemEl.removeClass('is-dragging');
      draggedItemPath = null;
      // Remove any drop indicators
      contentWrapperEl.querySelectorAll('.notidian-column-drop-indicator').forEach(el => el.remove());
    });

    // Allow reordering by dropping on files
    itemEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = isExternalFileDrag(event.dataTransfer.types) ? 'copy' : 'move';

      // Check if this is a same-column reorder
      if (draggedItemPath && draggedItemPath !== file.path && contentWrapperEl.querySelectorAll('.is-selected-final').length === 1) {
        // Remove existing drop indicators
        contentWrapperEl.querySelectorAll('.notidian-column-drop-indicator').forEach(el => el.remove());

        // Determine if dropping above or below
        const rect = itemEl.getBoundingClientRect();
        const relativeY = event.clientY - rect.top;
        const isAbove = relativeY < rect.height / 2;

        // Show drop indicator
        const indicator = document.createElement('div');
        indicator.className = 'notidian-column-drop-indicator';
        if (isAbove) {
          itemEl.before(indicator);
        } else {
          itemEl.after(indicator);
        }
      }
    });

    itemEl.addEventListener('dragleave', (event) => {
      if (!itemEl.contains(event.relatedTarget as Node)) {
        // Don't remove indicator on leave - let dragover on next item handle it
      }
    });

    itemEl.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (handleExternalFileDrop(event.dataTransfer, folderPath, callbacks)) return;

      // Check if there's a drop indicator (means it's a reorder)
      const dropIndicator = contentWrapperEl.querySelector('.notidian-column-drop-indicator');

      if (dropIndicator && draggedItemPath && draggedItemPath !== file.path && contentWrapperEl.querySelectorAll('.is-selected-final').length === 1) {
        // This is a reorder operation
        const rect = itemEl.getBoundingClientRect();
        const relativeY = event.clientY - rect.top;
        const insertAfter = relativeY > rect.height / 2;

        // Remove drop indicator
        dropIndicator.remove();

        // Call reorder callback
        callbacks.reorderFolderItems(folderPath, draggedItemPath, file.path, insertAfter);
        draggedItemPath = null;
      }
    });
  }

  // Add drop listeners to the content wrapper background (for dropping into this folder)
  contentWrapperEl.addEventListener('dragover', (event) => {
    event.preventDefault(); // Allow drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = isExternalFileDrag(event.dataTransfer.types) ? 'copy' : 'move';
    // Add highlight only if dragging directly over the content background
    const targetElement = event.target as HTMLElement;
    if (targetElement === contentWrapperEl) {
      contentWrapperEl.addClass('drag-over-column'); // Use the same class for visual feedback
      // If dragging onto content background, clear any item hover timeout
      callbacks.clearDragOverTimeout();
    } else {
      contentWrapperEl.removeClass('drag-over-column'); // Remove if over an item
    }
  });

  contentWrapperEl.addEventListener('dragleave', (event) => {
    contentWrapperEl.removeClass('drag-over-column');
    // Also clear item hover timeout if leaving content bounds entirely
    if (!contentWrapperEl.contains(event.relatedTarget as Node)) {
      callbacks.clearDragOverTimeout();
    }
  });

  contentWrapperEl.addEventListener('drop', (event) => {
    event.preventDefault();
    contentWrapperEl.removeClass('drag-over-column');
    callbacks.clearDragOverTimeout(); // Clear item timeout on drop
    // Ensure the drop happened directly on the content background, not on an item within it
    if (event.target !== contentWrapperEl) {
      console.log("Drop ignored: Target was an item within the content wrapper, not the background.");
      return;
    }

    if (handleExternalFileDrop(event.dataTransfer, columnEl.dataset.path, callbacks)) return;

    // Extract path from drag data (handles both wikilink and plain path formats)
    const rawPath = event.dataTransfer?.getData('text/plain');
    const sourcePath = extractPathFromDragData(rawPath);
    const targetFolderPath = columnEl.dataset.path; // Path of the folder this column represents

    if (sourcePath && targetFolderPath) {
      console.log(`Drop onto Content Background: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
      callbacks.handleDrop(sourcePath, targetFolderPath);
    }
  });

  // --- Render Stats ---
  const statsEl = columnEl.createDiv({ cls: 'notidian-file-explorer-column-stats' });
  const statsItems: string[] = [];
  if (displayedFolderCount > 0) statsItems.push(`${displayedFolderCount} folder${displayedFolderCount > 1 ? 's' : ''}`);
  if (displayedFileCount > 0) statsItems.push(`${displayedFileCount} file${displayedFileCount > 1 ? 's' : ''}`);
  if (hiddenFilesCount > 0) statsItems.push(`${hiddenFilesCount} hidden`);

  // Format size
  let sizeString = '';
  if (totalSize > 0) {
    if (totalSize < 1024) {
      sizeString = `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
      sizeString = `${(totalSize / 1024).toFixed(1)} KB`;
    } else if (totalSize < 1024 * 1024 * 1024) {
      sizeString = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      sizeString = `${(totalSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    statsItems.push(sizeString);
  }

  statsEl.setText(statsItems.join(' | '));


  return columnEl; // Return the created/updated element
  // Stats element is appended directly to columnEl, after contentWrapperEl
}
