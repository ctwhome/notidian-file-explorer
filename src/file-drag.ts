import type { App, TFile } from 'obsidian';

export function startVaultFileDrag(app: App, event: DragEvent, file: TFile, folderPath: string): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;

  // Obsidian's internal drag API lets Canvas/Excalidraw receive the TFile, not text.
  const manager = (app as App & { dragManager: {
    dragFile(event: DragEvent, file: TFile): { type: string; file: TFile };
    onDragStart(event: DragEvent, draggable: { type: string; file: TFile }): void;
  } }).dragManager;
  manager.onDragStart(event, manager.dragFile(event, file));

  // Keep the wikilink payload used by the explorer's own move/drop handlers.
  transfer.setData('text/plain', `[[${file.path}]]`);
  transfer.setData('application/json', JSON.stringify({
    type: 'file', file: file.path, basename: file.basename, extension: file.extension
  }));
  transfer.setData('text/x-column-reorder', `${folderPath}:${file.path}`);
  transfer.setData('text/html', `<a href="${file.path}">${file.basename}</a>`);
  transfer.effectAllowed = 'all';
}
