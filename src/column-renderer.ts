import { App, TFile, TFolder, TAbstractFile, setIcon, Notice, normalizePath } from 'obsidian';
import NotidianExplorerPlugin from '../main'; // Import plugin type for settings

// Callback type for handling item clicks in the main view
type ItemClickCallback = (itemEl: HTMLElement, isFolder: boolean, depth: number, isManualClick?: boolean) => void;
type ItemDropCallback = (sourcePath: string, targetFolderPath: string) => void;
// Callbacks for drag-over timeout
type SetDragOverTimeoutCallback = (id: number, target: HTMLElement) => void;
type ClearDragOverTimeoutCallback = () => void;
type TriggerFolderOpenCallback = (folderPath: string, depth: number) => void;
type RenameItemCallback = (itemPath: string, isFolder: boolean) => Promise<void>; // Added rename callback type
type CreateNewNoteCallback = (folderPath: string, fileExtension?: string) => Promise<void>;
type CreateNewFolderCallback = (folderPath: string) => Promise<void>;

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
// Helper function to get icon based on file extension
function getIconForFile(app: App, file: TFile): string { // Added app parameter
  // Check frontmatter for Excalidraw first
  const fileCache = app.metadataCache.getFileCache(file);
  if (fileCache?.frontmatter?.['excalidraw-plugin']) {
    return 'lucide-pencil'; // Excalidraw icon based on frontmatter
  }

  // Handle compound extensions first
  const lowerName = file.name.toLowerCase();
  // console.log(`getIconForFile: Checking file: ${file.path}`); // DEBUG LOG - Removed
  // const isExcalidraw = lowerName.endsWith('.excalidraw.md'); // Keep this check as a fallback
  // console.log(`getIconForFile: lowerName=${lowerName}, isExcalidraw=${isExcalidraw}`); // DEBUG LOG - Removed
  if (lowerName.endsWith('.excalidraw.md')) { // Keep fallback check
    return 'lucide-pencil'; // Excalidraw icon
  }

  // Then check the simple extension
  const extension = file.extension.toLowerCase();
  switch (extension) {
    case 'md':
      return 'document'; // Standard markdown
    case 'canvas':
      return 'lucide-layout-dashboard'; // Obsidian canvas icon
    case 'png': // Image types
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
      return 'image-file'; // Generic image icon
    case 'pdf':
      return 'pdf-file'; // PDF icon
    case 'doc': // Word
    case 'docx':
      return 'file-text'; // Word document icon
    case 'xls': // Excel
    case 'xlsx':
      return 'file-spreadsheet'; // Excel spreadsheet icon
    case 'ppt': // PowerPoint
    case 'pptx':
      return 'file-presentation'; // PowerPoint presentation icon
    case 'zip': // Archives
    case 'rar':
    case '7z':
      return 'archive'; // Archive icon
    case 'mp3': // Audio
    case 'wav':
    case 'ogg':
      return 'audio-file'; // Audio file icon
    case 'mp4': // Video
    case 'mov':
    case 'avi':
      return 'video-file'; // Video file icon
    // Add more common extensions if needed
    default:
      return 'document'; // Default icon for other files
  }
}


export async function renderColumnElement(
  app: App,
  plugin: NotidianExplorerPlugin, // Pass plugin for settings
  folderPath: string,
  depth: number,
  existingColumnEl: HTMLElement | null, // Pass existing element to update
  handleItemClickCallback: ItemClickCallback, // Callback for item clicks
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>, // Callback to render next column
  handleDropCallback: ItemDropCallback, // Callback for drop events
  // Add new callbacks for drag-over folder opening
  setDragOverTimeoutCallback: SetDragOverTimeoutCallback,
  clearDragOverTimeoutCallback: ClearDragOverTimeoutCallback,
  triggerFolderOpenCallback: TriggerFolderOpenCallback,
  dragOverTimeoutDelay: number, // Pass delay from main view
  renameItemCallback: RenameItemCallback, // Added rename callback parameter
  createNewNoteCallback: CreateNewNoteCallback, // Callback to create new note
  createNewFolderCallback: CreateNewFolderCallback // Callback to create new folder
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

  // Create top bar with quick action buttons
  const topBarEl = columnEl.createDiv({ cls: 'notidian-file-explorer-column-topbar' });

  // New Note button
  const newNoteBtn = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn',
    attr: { 'aria-label': 'New Note' }
  });
  setIcon(newNoteBtn, 'file-plus');
  newNoteBtn.addEventListener('click', () => createNewNoteCallback(folderPath, '.md'));

  // New Canvas button
  const newCanvasBtn = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn',
    attr: { 'aria-label': 'New Canvas' }
  });
  setIcon(newCanvasBtn, 'layout-dashboard');
  newCanvasBtn.addEventListener('click', () => createNewNoteCallback(folderPath, '.canvas'));

  // New Drawing button
  const newDrawingBtn = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn',
    attr: { 'aria-label': 'New Drawing' }
  });
  setIcon(newDrawingBtn, 'pencil');
  newDrawingBtn.addEventListener('click', () => createNewNoteCallback(folderPath, '.excalidraw.md'));

  // New Folder button
  const newFolderBtn = topBarEl.createEl('button', {
    cls: 'notidian-file-explorer-topbar-btn',
    attr: { 'aria-label': 'New Folder' }
  });
  setIcon(newFolderBtn, 'folder-plus');
  newFolderBtn.addEventListener('click', () => createNewFolderCallback(folderPath));

  // Create the content wrapper for items
  const contentWrapperEl = columnEl.createDiv({ cls: 'notidian-file-explorer-column-content' });

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

  // --- Sort ---
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  // --- Filter based on Exclusions & Hidden ---
  const exclusionPatterns = plugin.settings.exclusionPatterns
    .split('\n')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  const filteredFolders = folders.filter(folder => !isExcluded(folder.path, exclusionPatterns));
  const filteredFiles = files.filter(file => !isExcluded(file.path, exclusionPatterns) && !file.name.startsWith('.'));

  const displayedFolderCount = filteredFolders.length;
  const displayedFileCount = filteredFiles.length;

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
    itemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: folderName });
    // Add arrow icon to the right for folders
    setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-arrow' }), 'chevron-right');

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
            const firstItem = nextColumn.querySelector('.notidian-file-explorer-item') as HTMLElement;
            firstItem?.focus();
          }
        }, 50);
      } else if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        renameItemCallback(folder.path, true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prevItem = itemEl.previousElementSibling as HTMLElement;
        if (prevItem?.classList.contains('notidian-file-explorer-item')) {
          prevItem.focus();
        }
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextItem = itemEl.nextElementSibling as HTMLElement;
        if (nextItem?.classList.contains('notidian-file-explorer-item')) {
          nextItem.focus();
        }
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        // Focus the selected item in the previous column
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const prevColumn = currentColumn?.previousElementSibling as HTMLElement;
        if (prevColumn) {
          const selectedInPrev = prevColumn.querySelector('.is-selected-path, .is-selected-final') as HTMLElement;
          if (selectedInPrev) {
            selectedInPrev.focus();
          } else {
            // Focus first item if none selected
            const firstItem = prevColumn.querySelector('.notidian-file-explorer-item') as HTMLElement;
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

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
      // Re-select the dragged item to maintain visual context
      handleItemClickCallback(itemEl, true, depth);
    });

    // Allow dropping onto folders
    itemEl.addEventListener('dragover', (event) => {
      event.preventDefault(); // Necessary to allow drop
      event.stopPropagation(); // Prevent bubbling to column listener
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      // Only add class and set timeout if not already highlighted
      if (!itemEl.classList.contains('drag-over')) {
        itemEl.addClass('drag-over');
        // --- Spring-loaded folder logic ---
        // Clear any previous timeout for other elements
        clearDragOverTimeoutCallback();
        // Set a new timeout to open this folder
        const timeoutId = window.setTimeout(() => {
          console.log(`Drag over timeout expired for: ${folder.path}`);
          triggerFolderOpenCallback(folder.path, depth);
        }, dragOverTimeoutDelay); // Use configured delay
        // Store the timeout ID and target element
        setDragOverTimeoutCallback(timeoutId, itemEl);
      }
    });

    itemEl.addEventListener('dragleave', (event) => {
      // Only remove highlight and clear timeout if the mouse truly leaves the item element
      if (!itemEl.contains(event.relatedTarget as Node)) {
        itemEl.removeClass('drag-over');
        clearDragOverTimeoutCallback();
      }
      event.stopPropagation(); // Still prevent bubbling
    });

    itemEl.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation(); // Prevent bubbling to column listener
      itemEl.removeClass('drag-over');
      clearDragOverTimeoutCallback(); // Clear timeout on drop

      // Extract path from drag data (handles both wikilink and plain path formats)
      const rawPath = event.dataTransfer?.getData('text/plain');
      const sourcePath = extractPathFromDragData(rawPath);
      const targetFolderPath = itemEl.dataset.path;

      if (sourcePath && targetFolderPath && sourcePath !== targetFolderPath) {
        console.log(`Drop: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
        handleDropCallback(sourcePath, targetFolderPath); // Use callback
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
      const iconFullPath = normalizePath(`Assets/notidian-file-explorer-data/images/${customIconFilename}`); // Updated path
      // Use adapter.getResourcePath which works for files not indexed as TFiles
      const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
      // Basic check if resource path generation worked (it might return the input path on failure)
      if (iconSrc && iconSrc !== iconFullPath) {
        itemEl.createEl('img', {
          cls: 'notidian-file-explorer-item-icon custom-icon',
          attr: { src: iconSrc, alt: file.name }
        });
      } else {
        // Fallback if getResourcePath fails or returns the original path
        console.warn(`Could not get resource path for file icon: ${iconFullPath}. Falling back.`);
        const iconName = getIconForFile(app, file); // Pass app
        setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-file-icon' }), iconName);
      }
    } else if (fileEmoji) {
      // Render emoji
      itemEl.createSpan({ cls: 'notidian-file-explorer-item-emoji', text: fileEmoji });
      itemEl.dataset.emoji = fileEmoji; // Store for potential use
    } else {
      // Render default file icon
      const iconName = getIconForFile(app, file); // Pass app
      setIcon(itemEl.createSpan({ cls: 'notidian-file-explorer-item-icon nav-file-icon' }), iconName);
    }

    // Determine the display name: Use basename, but correct for .excalidraw.md
    let displayFileName = file.basename; // Default to basename (e.g., "filename.excalidraw" or "filename")
    const lowerFullName = file.name.toLowerCase();

    // Specifically handle .excalidraw.md to remove the full suffix
    if (lowerFullName.endsWith('.excalidraw.md')) {
      displayFileName = file.name.slice(0, -'.excalidraw.md'.length); // Correct to "filename"
    }
    // No H1 check needed for other files, basename is already correct.
    // For non-markdown files: displayFileName remains file.basename (already set)

    itemEl.createSpan({ cls: 'notidian-file-explorer-item-title', text: displayFileName });

    // --- Add Secondary File Type Icon ---
    const fileTypeIconName = getIconForFile(app, file); // Get the definitive type icon
    // Only add the secondary icon if it's NOT the default 'document' icon
    if (fileTypeIconName !== 'document') {
      const typeIconEl = itemEl.createSpan({ cls: 'notidian-file-explorer-item-type-icon' });
      setIcon(typeIconEl, fileTypeIconName);
    }
    itemEl.addEventListener('click', (event) => {
      handleItemClickCallback(itemEl, false, depth, true); // Mark as manual click
      app.workspace.openLinkText(file.path, '', false);
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
        renameItemCallback(file.path, false);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prevItem = itemEl.previousElementSibling as HTMLElement;
        if (prevItem?.classList.contains('notidian-file-explorer-item')) {
          prevItem.focus();
        }
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextItem = itemEl.nextElementSibling as HTMLElement;
        if (nextItem?.classList.contains('notidian-file-explorer-item')) {
          nextItem.focus();
        }
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        // Focus the selected item in the previous column
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const prevColumn = currentColumn?.previousElementSibling as HTMLElement;
        if (prevColumn) {
          const selectedInPrev = prevColumn.querySelector('.is-selected-path, .is-selected-final') as HTMLElement;
          if (selectedInPrev) {
            selectedInPrev.focus();
          } else {
            const firstItem = prevColumn.querySelector('.notidian-file-explorer-item') as HTMLElement;
            firstItem?.focus();
          }
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        // For files, ArrowRight focuses the next column if it exists
        const currentColumn = itemEl.closest('.notidian-file-explorer-column') as HTMLElement;
        const nextColumn = currentColumn?.nextElementSibling as HTMLElement;
        if (nextColumn) {
          const firstItem = nextColumn.querySelector('.notidian-file-explorer-item') as HTMLElement;
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

      // Enhanced dragstart logic for Canvas/Excalidraw compatibility
      if (event.dataTransfer) {
        // Set wikilink format as primary text for Obsidian compatibility
        // Note: User holds SHIFT while DROPPING to create embed/iframe (not at dragstart)
        const wikilink = `[[${file.path}]]`;
        event.dataTransfer.setData('text/plain', wikilink);

        // Set JSON with file metadata for rich drop handling
        const fileData = JSON.stringify({
          type: 'file',
          file: file.path,
          basename: file.basename,
          extension: file.extension
        });
        event.dataTransfer.setData('application/json', fileData);

        // Set HTML format for rich text editors
        event.dataTransfer.setData('text/html', `<a href="${file.path}">${file.basename}</a>`);

        // Allow all drag operations (move, copy, link)
        event.dataTransfer.effectAllowed = 'all';
      }

      itemEl.addClass('is-dragging');
      console.log(`Drag Start File: ${file.path} (wikilink format)`);

      // Cleanup state
      clearTimeout(dragDelayTimeoutId as number);
      dragDelayTimeoutId = null;
      startDragPosX = null;
      startDragPosY = null;
    });

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
      // Re-select the dragged item to maintain visual context
      handleItemClickCallback(itemEl, false, depth);
    });
  }

  // Add drop listeners to the content wrapper background (for dropping into this folder)
  contentWrapperEl.addEventListener('dragover', (event) => {
    event.preventDefault(); // Allow drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // Add highlight only if dragging directly over the content background
    const targetElement = event.target as HTMLElement;
    if (targetElement === contentWrapperEl) {
      contentWrapperEl.addClass('drag-over-column'); // Use the same class for visual feedback
      // If dragging onto content background, clear any item hover timeout
      clearDragOverTimeoutCallback();
    } else {
      contentWrapperEl.removeClass('drag-over-column'); // Remove if over an item
    }
  });

  contentWrapperEl.addEventListener('dragleave', (event) => {
    contentWrapperEl.removeClass('drag-over-column');
    // Also clear item hover timeout if leaving content bounds entirely
    if (!contentWrapperEl.contains(event.relatedTarget as Node)) {
      clearDragOverTimeoutCallback();
    }
  });

  contentWrapperEl.addEventListener('drop', (event) => {
    event.preventDefault();
    contentWrapperEl.removeClass('drag-over-column');
    clearDragOverTimeoutCallback(); // Clear item timeout on drop
    // Ensure the drop happened directly on the content background, not on an item within it
    if (event.target !== contentWrapperEl) {
      console.log("Drop ignored: Target was an item within the content wrapper, not the background.");
      return;
    }

    // Extract path from drag data (handles both wikilink and plain path formats)
    const rawPath = event.dataTransfer?.getData('text/plain');
    const sourcePath = extractPathFromDragData(rawPath);
    const targetFolderPath = columnEl.dataset.path; // Path of the folder this column represents

    if (sourcePath && targetFolderPath) {
      console.log(`Drop onto Content Background: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
      handleDropCallback(sourcePath, targetFolderPath);
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