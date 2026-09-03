import { App } from 'obsidian';
import NotidianExplorerPlugin from '../main';

// Interface to represent the core explorer view capabilities
// This allows us to avoid circular dependencies between managers
export interface IColumnExplorerView {
  app: App;
  plugin: NotidianExplorerPlugin;
  columnsContainerEl: HTMLElement | null;

  // Navigation methods
  handleItemClick(clickedItemEl: HTMLElement, isFolder: boolean, depth: number): void;
  renderAndReplaceNextColumn(folderPath: string, currentDepth: number, existingColumnEl?: HTMLElement): Promise<void>;
  renderColumn(folderPath: string, depth: number, existingColumnEl?: HTMLElement): Promise<HTMLElement | null>;
  refreshColumnByPath(folderPath: string): Promise<HTMLElement | null>;
  renderColumns(startFolderPath?: string): Promise<void>;
  startInlineRename(itemPath: string): Promise<void>;
  remapColumnState(oldPath: string, newPath: string): void;
}
