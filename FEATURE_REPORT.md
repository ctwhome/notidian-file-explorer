# Notidian File Explorer - Complete Feature & Implementation Report

This document provides a comprehensive overview of all features, techniques, and implementation details of the Notidian File Explorer Obsidian plugin. This report is intended to serve as a reference for porting these features to a different application.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Features](#core-features)
3. [UI Components](#ui-components)
4. [Data Structures & Settings](#data-structures--settings)
5. [Key Techniques](#key-techniques)
6. [File-by-File Breakdown](#file-by-file-breakdown)
7. [CSS Styling Patterns](#css-styling-patterns)

---

## Architecture Overview

### Design Pattern: Manager-Based Architecture

The plugin uses a **manager pattern** where specialized classes handle different concerns:

```
main.ts (Plugin Entry)
    └── ColumnExplorerCore (Main View)
            ├── DragManager (Drag & Drop)
            ├── NavigationManager (File Navigation)
            ├── IconManager (Icons & Emojis)
            └── column-renderer.ts (Column Rendering)
```

### Key Architectural Decisions

1. **Callback-Based Communication**: Components communicate via callbacks rather than direct method calls, enabling loose coupling.

2. **Interface-Based View Access**: `IColumnExplorerView` interface defines the contract for view access, allowing managers to interact with the view without tight coupling.

3. **Settings Stored in Custom Location**: Settings are stored in `Assets/notidian-file-explorer-data/notidian-file-explorer.json` rather than the default `.obsidian/plugins/*/data.json`.

4. **Column-Based Navigation**: macOS Finder-style column navigation where each folder opens in a new column to the right.

---

## Core Features

### 1. Column-Based File Navigation

**Location**: `src/column-explorer-core.ts`, `src/column-renderer.ts`

**Description**: Files and folders are displayed in a multi-column layout similar to macOS Finder's column view.

**Implementation Details**:
- Each column represents a folder's contents
- Clicking a folder opens its contents in the next column to the right
- Clicking a file:
  - Opens the file in the editor
  - Keeps all columns to the right intact (clears their content but doesn't remove them)
  - Does NOT auto-scroll (prevents jarring visual jumps)
- Selection states: `is-selected-path` (dimmer, path highlight) and `is-selected-final` (brightest, current selection)

**Key Code** (`column-explorer-core.ts:246-320`):
```typescript
handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number) {
  // 1. Clear previous selections
  // 2. Mark path selections (is-selected-path)
  // 3. Mark final selection (is-selected-final)
  // 4. For folders: render next column with replace strategy
  // 5. For files: clear column content but keep column elements
  // 6. Auto-scroll only for folders
}
```

**Technique: Column Replacement Without Flicker**:
- `renderAndReplaceNextColumn()` renders new content into an existing column element
- Columns are removed AFTER new content is rendered, not before
- This prevents layout jumps during navigation

---

### 2. Favorites System

**Location**: `src/column-renderer.ts:193-386`, `src/column-explorer-core.ts`

**Description**: Users can mark files/folders as favorites, which appear in a collapsible section at the top of the first column.

**Features**:
- Collapsible favorites section with chevron toggle
- Star icon on hover for any item (grid column 3)
- Click star to toggle favorite status
- Favorites are drag-reorderable within the section
- Click favorite to navigate to its location and open it

**Data Structure**:
```typescript
favorites: string[]  // Array of file/folder paths
favoritesCollapsed: boolean  // Collapse state
```

**Key Callbacks**:
```typescript
toggleFavoriteCallback: (itemPath: string) => Promise<void>
isFavoriteCallback: (itemPath: string) => boolean
navigateToFavoriteCallback: (itemPath: string) => Promise<void>
reorderFavoritesCallback: (fromIndex: number, toIndex: number) => Promise<void>
```

**Navigate to Favorite Logic** (`column-explorer-core.ts:629-649`):
```typescript
async navigateToFavorite(itemPath: string) {
  if (file) {
    this.findAndSelectFile(file);  // Navigate to show in explorer
    this.app.workspace.openLinkText(file.path, '', false);  // Open file
  } else if (folder) {
    this.navigateToFolder(folder);  // Navigate to folder
  }
}
```

---

### 3. Drag and Drop System

**Location**: `src/drag-handlers.ts`, `src/column-renderer.ts:615-832`

**Features**:
- **Move files/folders into other folders**
- **Reorder items within a column** (custom sort order)
- **Spring-loaded folders**: Hover over folder for 500ms during drag to open it
- **External file drops**: Drop files from OS file explorer into vault
- **Wikilink format**: Drag data uses `[[path]]` format for Obsidian compatibility

**Drag Delay Mechanism** (`column-renderer.ts:616-668`):
```typescript
// Prevents accidental drags - must hold for DRAG_INITIATION_DELAY ms
let dragDelayTimeoutId: number | null = null;
let isDragAllowed = false;
const DRAG_MOVE_THRESHOLD = 5;  // Cancel drag if moved > 5px before delay

itemEl.addEventListener('mousedown', (event) => {
  dragDelayTimeoutId = window.setTimeout(() => {
    isDragAllowed = true;
  }, DRAG_INITIATION_DELAY);
});

itemEl.addEventListener('dragstart', (event) => {
  if (!isDragAllowed) {
    event.preventDefault();
    return;
  }
  // ... proceed with drag
});
```

**Spring-Loaded Folder Opening** (`drag-handlers.ts:36-72`):
```typescript
async triggerFolderOpenFromDrag(folderPath: string, depth: number) {
  // Render new column FIRST (reuse existing element to avoid flicker)
  await this.view.renderAndReplaceNextColumn(folderPath, depth, existingColumnAtDepth);
  // THEN remove extra columns
  // This prevents layout jumps
}
```

**Zone-Based Reordering** (`column-renderer.ts:728-761`):
- Top/bottom 30% of folder = reorder zone (shows drop indicator)
- Middle 40% of folder = move-into-folder zone
- Files use 50/50 split for above/below placement

**Drag Data Format**:
```typescript
event.dataTransfer.setData('text/plain', `[[${folder.path}]]`);  // Wikilink
event.dataTransfer.setData('application/json', JSON.stringify({type, file, name}));
event.dataTransfer.setData('text/x-column-reorder', `${folderPath}:${itemPath}`);
```

---

### 4. Custom Item Order (Per-Folder)

**Location**: `src/column-explorer-core.ts`, `src/column-renderer.ts:450-479`

**Description**: Users can drag-reorder items within a column, and this order is persisted per-folder.

**Data Structure**:
```typescript
customFolderOrder: { [folderPath: string]: string[] }
// Example: { "Projects": ["Projects/A", "Projects/B", "Projects/C"] }
```

**Sorting Logic**:
```typescript
const customOrder = getCustomFolderOrderCallback(folderPath);
if (customOrder && customOrder.length > 0) {
  // Items in customOrder appear first in that order
  // Items not in customOrder appear last, alphabetically
  const orderMap = new Map(customOrder.map((path, idx) => [path, idx]));
  items.sort((a, b) => {
    const aIdx = orderMap.get(a.path);
    const bIdx = orderMap.get(b.path);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}
```

---

### 5. Custom Icons and Emojis

**Location**: `src/icon-handlers.ts`, `src/EmojiPickerModal.ts`, `src/ImagePickerModal.ts`

**Features**:
- Set emoji for any file/folder (via emoji picker)
- Set custom image icon (from vault or uploaded)
- Icons stored in `Assets/notidian-file-explorer-data/images/`
- Emoji/icon displayed instead of default folder/file icon

**Data Structures**:
```typescript
emojiMap: { [path: string]: string }  // path -> emoji unicode
iconAssociations: { [path: string]: string }  // path -> image filename
```

**Icon Priority**:
1. Custom image icon (if set)
2. Emoji (if set)
3. Default icon based on file type

**File Type Icons** (`column-renderer.ts:55-112`):
```typescript
function getIconForFile(app: App, file: TFile): string {
  // Check frontmatter for Excalidraw
  // Check compound extensions (.excalidraw.md)
  // Match extension: md, canvas, png, jpg, pdf, etc.
  return iconName;
}
```

---

### 6. Context Menu

**Location**: `src/context-menu.ts`

**File Context Menu Items**:
- Open in new tab
- Rename (F2 shortcut)
- Delete (moves to trash)
- Move to Folder (folder picker)
- Set Emoji
- Set Custom Icon
- Add to / Remove from Favorites
- Reveal in Finder/Explorer

**Folder Context Menu Items**:
- New Note (.md)
- New Excalidraw Note
- New Canvas Note
- New Folder
- Rename / Delete / Move to Folder
- Set Emoji / Set Custom Icon
- Add to / Remove from Favorites
- Reveal in Finder/Explorer

**Empty Area Context Menu**:
- New Note (.md)
- New Excalidraw Note
- New Canvas Note
- New Folder

**Reveal in System Explorer** (`context-menu.ts:117-127`):
```typescript
const { shell } = require('electron');
const vaultPath = (app.vault.adapter as { basePath?: string }).basePath;
const absolutePath = `${vaultPath}/${file.path}`;
shell.showItemInFolder(absolutePath);
```

---

### 7. File Operations

**Location**: `src/file-operations.ts`

**Operations**:
- **Create Note**: Supports .md, .excalidraw.md, .canvas
- **Create Folder**: Auto-generates unique name
- **Rename**: Via modal with validation
- **Delete**: Moves to system trash with icon cleanup
- **Move**: Via drag-drop or folder picker
- **Copy External Files**: Drop from OS into vault

**Unique Path Generation**:
```typescript
async function findUniquePath(app, folderPath, baseName, extension): Promise<string> {
  let counter = 0;
  let newPath = normalizePath(`${folderPath}/${baseName}${extension}`);
  while (await adapter.exists(newPath)) {
    counter++;
    newPath = normalizePath(`${folderPath}/${baseName} ${counter}${extension}`);
  }
  return newPath;
}
```

---

### 8. Keyboard Navigation

**Location**: `src/column-renderer.ts:566-613, 912-960`

**Keys**:
- **Enter**: Open file/folder
- **Arrow Right**: Open folder / focus next column
- **Arrow Left**: Focus previous column
- **Arrow Up/Down**: Navigate within column
- **F2**: Rename item

**Focus Management**:
```typescript
itemEl.tabIndex = 0;  // Make focusable
itemEl.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    const nextColumn = currentColumn.nextElementSibling;
    nextColumn?.querySelector('.notidian-file-explorer-item')?.focus();
  }
});
```

---

### 9. Pan/Scroll Navigation

**Location**: `src/dom-helpers.ts`

**Description**: Click and drag on empty areas to pan horizontally through columns.

**Implementation**:
```typescript
function addDragScrolling(containerEl: HTMLElement) {
  // Only enable grab cursor when content overflows horizontally
  const hasHorizontalScroll = containerEl.scrollWidth > containerEl.clientWidth;

  containerEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.notidian-file-explorer-item')) return;
    isDragging = true;
    startX = e.clientX;
    scrollLeftStart = containerEl.scrollLeft;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    containerEl.scrollLeft = scrollLeftStart - (e.clientX - startX);
  });
}
```

**Visual Feedback**:
- `.has-horizontal-scroll` class enables `cursor: grab`
- `.is-panning` class shows `cursor: grabbing`

---

### 10. Auto-Reveal Current File

**Location**: `src/navigators.ts`

**Description**: Navigate the column view to show the currently open file.

**Algorithm** (`navigators.ts:31-181`):
1. Get file's parent folder path
2. Split path into segments: `["", "Projects", "MyProject"]`
3. Clear all columns, render root
4. For each segment, render that folder's column
5. Find and select the file in the final column
6. Scroll column container and file into view

---

### 11. File Exclusion Patterns

**Location**: `main.ts`, `src/column-renderer.ts:441-447`

**Description**: Hide files/folders matching patterns.

**Data Structure**:
```typescript
exclusionPatterns: string  // Newline-separated patterns
// Example: ".git\n.obsidian\nnode_modules"
```

**Filter Logic**:
```typescript
function isExcluded(path: string, patterns: string[]): boolean {
  const lowerPath = path.toLowerCase();
  return patterns.some(pattern => lowerPath.includes(pattern));
}
```

---

### 12. Column Stats

**Location**: `src/column-renderer.ts:1164-1186`

**Description**: Shows folder statistics at the bottom of each column.

**Stats Displayed**:
- Number of folders
- Number of files
- Number of hidden files
- Total size (formatted: B/KB/MB/GB)

---

## UI Components

### Modals

1. **InputModal** (`src/InputModal.ts`): Text input for rename/create operations
2. **EmojiPickerModal** (`src/EmojiPickerModal.ts`): Emoji picker using `emoji-picker-element` library
3. **ImagePickerModal** (`src/ImagePickerModal.ts`): Image gallery + upload for custom icons

### Top Bar

Each column has a top bar with quick-action buttons:
- New Note
- New Canvas
- New Drawing (Excalidraw)
- New Folder

---

## Data Structures & Settings

### Settings Interface

```typescript
interface NotidianExplorerSettings {
  // Display
  defaultRootFolder: string;         // Starting folder path
  exclusionPatterns: string;         // Newline-separated exclusion patterns
  columnDisplayMode: 'auto' | '2' | '3';  // Fixed column widths

  // Drag & Drop
  dragInitiationDelay: number;       // ms to hold before drag starts (default: 150)
  dragFolderOpenDelay: number;       // ms to hover before folder opens (default: 500)

  // Icons
  emojiMap: { [path: string]: string };           // path -> emoji
  iconAssociations: { [path: string]: string };   // path -> icon filename

  // Favorites
  favorites: string[];               // Array of favorited paths
  favoritesCollapsed: boolean;       // Collapse state

  // Custom Order
  customFolderOrder: { [folderPath: string]: string[] };  // folder -> ordered items

  // Templates
  excalidrawTemplatePath: string;    // Path to Excalidraw template
}
```

### Settings Path Updates

When files are renamed or deleted, settings are updated:

```typescript
// On rename: Update all path-based settings
if (favorites.includes(oldPath)) {
  favorites[favorites.indexOf(oldPath)] = newPath;
}
if (emojiMap[oldPath]) {
  emojiMap[newPath] = emojiMap[oldPath];
  delete emojiMap[oldPath];
}
// ... same for iconAssociations, customFolderOrder
```

---

## Key Techniques

### 1. Render-First, Remove-Later Pattern

**Problem**: Removing DOM elements before adding new ones causes layout shifts.

**Solution**: Render new content into existing elements, then remove extras.

```typescript
// BAD: Remove then add
columns.slice(depth + 1).forEach(col => col.remove());
containerEl.appendChild(newColumn);

// GOOD: Add/replace then remove
await renderAndReplaceNextColumn(path, depth, existingColumn);
columnsToRemove.forEach(col => col.remove());
```

### 2. Debounced/Delayed Actions

**Problem**: Accidental triggers during fast interactions.

**Solution**: Require holding for a delay before action.

```typescript
// Drag initiation delay
let dragDelayTimeoutId = setTimeout(() => {
  isDragAllowed = true;
}, DRAG_INITIATION_DELAY);

// Cancel if moved too much
if (deltaX > THRESHOLD || deltaY > THRESHOLD) {
  clearTimeout(dragDelayTimeoutId);
  isDragAllowed = false;
}
```

### 3. Zone-Based Drag Detection

**Problem**: Same drag operation needs different behaviors.

**Solution**: Use mouse position within element to determine action.

```typescript
const rect = itemEl.getBoundingClientRect();
const heightRatio = (event.clientY - rect.top) / rect.height;

if (heightRatio < 0.3) {
  // Top zone: reorder above
} else if (heightRatio > 0.7) {
  // Bottom zone: reorder below
} else {
  // Middle zone: drop into folder
}
```

### 4. Wikilink Drag Data Format

**Problem**: Obsidian expects wikilink format for internal links.

**Solution**: Use `[[path]]` format as primary drag data.

```typescript
const wikilink = `[[${file.path}]]`;
event.dataTransfer.setData('text/plain', wikilink);
```

### 5. CSS Grid for Item Layout

**Problem**: Need flexible layout with multiple optional elements.

**Solution**: 4-column CSS grid.

```css
.notidian-file-explorer-item {
  display: grid;
  grid-template-columns: 1.5rem 1fr auto auto;
  /* Icon, Title, Star, Arrow/TypeIcon */
}
```

### 6. ResizeObserver + MutationObserver for Dynamic Cursor

**Problem**: Grab cursor should only appear when content overflows.

**Solution**: Observe size and content changes.

```typescript
const resizeObserver = new ResizeObserver(() => {
  const hasScroll = containerEl.scrollWidth > containerEl.clientWidth;
  containerEl.classList.toggle('has-horizontal-scroll', hasScroll);
});
resizeObserver.observe(containerEl);
```

---

## File-by-File Breakdown

| File | Purpose | Lines |
|------|---------|-------|
| `main.ts` | Plugin entry, settings, event handlers | ~220 |
| `src/column-explorer-core.ts` | Main view class, navigation, selection | ~750 |
| `src/column-renderer.ts` | Column DOM rendering, item creation | ~1190 |
| `src/drag-handlers.ts` | Drag manager, spring-loaded folders | ~102 |
| `src/file-operations.ts` | CRUD operations for files/folders | ~412 |
| `src/context-menu.ts` | Right-click menu builder | ~240 |
| `src/navigators.ts` | Auto-reveal file navigation | ~182 |
| `src/icon-handlers.ts` | Emoji/icon management | ~203 |
| `src/dom-helpers.ts` | Pan scrolling, inline title focus | ~155 |
| `src/types.ts` | TypeScript interfaces | ~50 |
| `src/SettingsTab.ts` | Settings UI | ~100 |
| `src/EmojiPickerModal.ts` | Emoji picker modal | ~73 |
| `src/ImagePickerModal.ts` | Image picker modal | ~118 |
| `src/InputModal.ts` | Text input modal | ~77 |
| `styles.css` | All CSS styling | ~647 |

---

## CSS Styling Patterns

### Selection States

```css
.is-selected-final {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
}

.is-selected-path {
  background-color: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

### Drag Over States

```css
.nav-folder.drag-over {
  background-color: var(--interactive-accent-hover);
  outline: 2px dashed var(--interactive-accent);
}

.drag-over-column {
  background-color: var(--background-secondary-alt);
}
```

### Drop Indicators

```css
.notidian-favorites-drop-indicator,
.notidian-column-drop-indicator {
  height: 2px;
  background-color: var(--interactive-accent);
  border-radius: 1px;
  pointer-events: none;
}
```

### Hover-Reveal Elements

```css
.notidian-favorite-star {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.notidian-file-explorer-item:hover .notidian-favorite-star {
  opacity: 0.6;
}

.notidian-favorite-star.is-favorited {
  opacity: 1 !important;
  color: var(--text-accent);
}
```

### Column Layout Modes

```css
/* Auto mode */
.notidian-file-explorer-column {
  min-width: 150px;
  max-width: 250px;
}

/* Fixed 2-column mode */
.columns-2 .notidian-file-explorer-column {
  width: 50%;
  min-width: 50%;
  max-width: 50%;
}

/* Fixed 3-column mode */
.columns-3 .notidian-file-explorer-column {
  width: 33.333%;
}
```

---

## Summary

This plugin implements a sophisticated file explorer with macOS Finder-style column navigation. Key architectural patterns include:

1. **Manager pattern** for separation of concerns
2. **Callback-based communication** for loose coupling
3. **Render-first pattern** for smooth UI transitions
4. **Zone-based drag detection** for multi-purpose interactions
5. **Debounced actions** to prevent accidental triggers
6. **Path-based settings** with automatic updates on rename/delete

The codebase is well-structured for feature extraction and porting to other frameworks.
