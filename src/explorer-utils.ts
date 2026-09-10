export const CODE_TEXT_EXTENSIONS = [
	'txt', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'css',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'sql', 'log', 'ini', 'conf', 'env', 'tex'
];

export const HTML_PREVIEW_EXTENSIONS = ['html', 'htm'];

export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

const AUDIO_PREVIEW_EXTENSIONS = ['m4a', 'flac', 'aac', 'wma', 'opus'];
const VIDEO_PREVIEW_EXTENSIONS = ['mov', 'avi', 'mkv', 'm4v', 'mpeg', 'mpg'];
const ARCHIVE_PREVIEW_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];
const FONT_PREVIEW_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
const GENERIC_PREVIEW_EXTENSIONS = ['mobi', 'azw', 'azw3', 'fb2', 'psd', 'ai', 'sketch'];

export const MEDIA_PREVIEW_EXTENSIONS = [
  'epub',
  ...AUDIO_PREVIEW_EXTENSIONS,
  ...VIDEO_PREVIEW_EXTENSIONS,
  ...ARCHIVE_PREVIEW_EXTENSIONS,
  ...FONT_PREVIEW_EXTENSIONS,
  ...GENERIC_PREVIEW_EXTENSIONS
];

export function getMediaPreviewKind(extension: string): 'epub' | 'audio' | 'video' | 'archive' | 'font' | 'generic' {
  const normalized = extension.toLocaleLowerCase();
  if (normalized === 'epub') return 'epub';
  if (AUDIO_PREVIEW_EXTENSIONS.includes(normalized)) return 'audio';
  if (VIDEO_PREVIEW_EXTENSIONS.includes(normalized)) return 'video';
  if (ARCHIVE_PREVIEW_EXTENSIONS.includes(normalized)) return 'archive';
  if (FONT_PREVIEW_EXTENSIONS.includes(normalized)) return 'font';
  return 'generic';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${Number((bytes / 1024 ** (unitIndex + 1)).toFixed(1))} ${units[unitIndex]}`;
}

export const HTML_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; base-uri 'none'; form-action 'none'";

export function getOfficePreviewKind(extension: string): 'document' | 'spreadsheet' | 'presentation' | null {
  switch (extension.toLocaleLowerCase()) {
    case 'docx': return 'document';
    case 'xls': case 'xlsx': return 'spreadsheet';
    case 'pptx': return 'presentation';
    default: return null;
  }
}

export function assertSafeZipDirectory(data: ArrayBuffer, maxEntries: number): void {
  const view = new DataView(data);
  const searchStart = Math.max(0, data.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let offset = data.byteLength - 22; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) throw new Error('Invalid Office archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 Office archives are not supported for in-app preview.');
  }
  if (entryCount > maxEntries) throw new Error('This Office archive has too many entries for a safe in-app preview.');
  if (directoryOffset + directorySize !== eocd || eocd + 22 + commentLength !== data.byteLength) {
    throw new Error('Invalid Office archive directory.');
  }

  let offset = directoryOffset;
  let actualEntries = 0;
  const directoryEnd = directoryOffset + directorySize;
  while (offset < directoryEnd) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid Office archive directory.');
    actualEntries++;
    if (actualEntries > maxEntries) throw new Error('This Office archive has too many entries for a safe in-app preview.');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset !== directoryEnd || actualEntries !== entryCount) throw new Error('Invalid Office archive directory.');
}

export function getCodeLanguage(extension: string): string | null {
  switch (extension.toLocaleLowerCase()) {
    case 'json': case 'jsonl': case 'js': case 'jsx': case 'ts': case 'tsx': return 'javascript';
    case 'xml': case 'html': return 'xml';
    case 'css': return 'css';
    case 'py': return 'python';
    case 'yaml': case 'yml': return 'yaml';
    case 'sql': return 'sql';
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'rb': return 'ruby';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'c': case 'h': return 'c';
    case 'cpp': case 'hpp': return 'cpp';
    case 'java': return 'java';
    case 'ini': case 'conf': case 'env': return 'properties';
    case 'toml': return 'toml';
    case 'tex': return 'tex';
    default: return null;
  }
}

export function validateItemName(name: string): string | null {
  if (!name.trim()) return 'Name cannot be empty.';
  if (/[\\/:*?"<>|]/.test(name)) return 'Name contains invalid characters.';
  return null;
}

export function filterMatches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function focusSearchInput(input: Pick<HTMLInputElement, 'focus'> | null): void {
  input?.focus();
}

export function shouldRestoreSearchFocus(previewInteractionAllowed: boolean): boolean {
  return !previewInteractionAllowed;
}

export function getRenameParts(filename: string, isFolder: boolean): { name: string; suffix: string } {
  if (isFolder) return { name: filename, suffix: '' };
  if (filename.toLocaleLowerCase().endsWith('.excalidraw.md')) {
    return { name: filename.slice(0, -'.excalidraw.md'.length), suffix: '.excalidraw.md' };
  }
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex > 0
    ? { name: filename.slice(0, extensionIndex), suffix: filename.slice(extensionIndex) }
    : { name: filename, suffix: '' };
}

export function getTextSearchMatch(path: string, content: string, query: string): { score: number; excerpt: string } | null {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return null;

  const normalizedPath = path.toLocaleLowerCase();
  const filename = path.split('/').pop()?.toLocaleLowerCase() || normalizedPath;
  if (filename.startsWith(normalizedQuery)) return { score: 0, excerpt: path };
  if (filename.includes(normalizedQuery)) return { score: 1, excerpt: path };
  if (normalizedPath.includes(normalizedQuery)) return { score: 2, excerpt: path };

  const contentIndex = content.toLocaleLowerCase().indexOf(normalizedQuery);
  if (contentIndex === -1) return null;
  const lineStart = content.lastIndexOf('\n', contentIndex - 1) + 1;
  const lineEnd = content.indexOf('\n', contentIndex);
  return { score: 3, excerpt: content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 180) };
}

export function getValidNavigationPaths(paths: string[], exists: (path: string) => boolean): string[] {
  const validPaths: string[] = [];
  for (const path of paths) {
    if (!exists(path)) break;
    validPaths.push(path);
  }
  return validPaths;
}

export function getUpdatedSelection(
  visiblePaths: string[],
  selectedPaths: string[],
  anchorPath: string | null,
  clickedPath: string,
  toggle: boolean,
  range: boolean
): { selected: string[]; anchor: string } {
  if (range && anchorPath) {
    const anchorIndex = visiblePaths.indexOf(anchorPath);
    const clickedIndex = visiblePaths.indexOf(clickedPath);
    if (anchorIndex !== -1 && clickedIndex !== -1) {
      return {
        selected: visiblePaths.slice(Math.min(anchorIndex, clickedIndex), Math.max(anchorIndex, clickedIndex) + 1),
        anchor: anchorPath
      };
    }
  }

  if (toggle) {
    const selected = new Set(selectedPaths);
    if (selected.has(clickedPath)) selected.delete(clickedPath);
    else selected.add(clickedPath);
    return { selected: visiblePaths.filter(path => selected.has(path)), anchor: clickedPath };
  }

  return { selected: [clickedPath], anchor: clickedPath };
}

export function collapseSelectedPaths(paths: string[]): string[] {
  const uniquePaths = [...new Set(paths)];
  return uniquePaths.filter(path => !uniquePaths.some(parent => parent !== path && path.startsWith(`${parent}/`)));
}

export function shouldOpenFileOnClick(detail: number, shift: boolean, meta: boolean, ctrl: boolean): boolean {
  return shouldHandleSelectionClick(detail) && !shift && !meta && !ctrl;
}

export function shouldHandleSelectionClick(detail: number): boolean {
  return detail < 2;
}

export function shouldClearExplorerSelection(isInsideItem: boolean): boolean {
  return !isInsideItem;
}

export function isExternalFileDrag(types: ArrayLike<string>): boolean {
  return Array.from(types).includes('Files');
}

export function isPathHidden(path: string, hiddenPaths: string[]): boolean {
  return hiddenPaths.some(hiddenPath => path === hiddenPath || path.startsWith(`${hiddenPath}/`));
}

export function normalizeHiddenPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((path): path is string => typeof path === 'string')
    .map(path => path.trim())
    .filter(path => path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(segment => segment === '.' || segment === '..'))
  )];
}

export function isAssetPath(path: string): boolean {
  return path.split('/').slice(0, -1).some(segment => segment.toLocaleLowerCase() === 'assets');
}

export function reorderFolderPaths(currentPaths: string[], savedOrder: string[] | undefined, fromPath: string, toPath: string, insertAfter: boolean): string[] {
  const current = new Set(currentPaths);
  const order = [...new Set([...(savedOrder || []).filter(path => current.has(path)), ...currentPaths])];
  if (fromPath === toPath || !current.has(fromPath) || !current.has(toPath)) return order;
  order.splice(order.indexOf(fromPath), 1);
  order.splice(order.indexOf(toPath) + (insertAfter ? 1 : 0), 0, fromPath);
  return order;
}
