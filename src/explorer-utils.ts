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

export function getValidNavigationPaths(paths: string[], exists: (path: string) => boolean): string[] {
  const validPaths: string[] = [];
  for (const path of paths) {
    if (!exists(path)) break;
    validPaths.push(path);
  }
  return validPaths;
}
