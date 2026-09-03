export function validateItemName(name: string): string | null {
  if (!name.trim()) return 'Name cannot be empty.';
  if (/[\\/:*?"<>|]/.test(name)) return 'Name contains invalid characters.';
  return null;
}

export function filterMatches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
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
  if (!normalizedQuery) return { score: 4, excerpt: path };

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
