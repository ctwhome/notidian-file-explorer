import { Notice, normalizePath } from 'obsidian';
import { IColumnExplorerView } from './types';
import { EmojiPickerModal } from './EmojiPickerModal';
import { ImagePickerModal } from './ImagePickerModal';

export class IconManager {
  private view: IColumnExplorerView;

  constructor(view: IColumnExplorerView) {
    this.view = view;
  }

  async handleSetEmoji(itemPath: string, isFolder: boolean) {
    // Use the EmojiPickerModal
    new EmojiPickerModal(this.view.app, async (selectedEmoji) => {
      const currentEmoji = this.view.plugin.settings.emojiMap[itemPath];
      let changed = false;

      if (selectedEmoji) { // User selected an emoji
        if (currentEmoji !== selectedEmoji) {
          // Clear any existing custom icon first
          await this.clearCustomIcon(itemPath);
          this.view.plugin.settings.emojiMap[itemPath] = selectedEmoji;
          changed = true;
        }
      } else { // User clicked "Remove Emoji"
        if (itemPath in this.view.plugin.settings.emojiMap) {
          delete this.view.plugin.settings.emojiMap[itemPath];
          // Note: We don't clear the custom icon when *removing* an emoji.
          // The user might want to remove the emoji but keep the icon.
          changed = true;
        }
      }

      if (changed) {
        await this.view.plugin.saveSettings();
        // Refresh the column containing the item
        const abstractItem = this.view.app.vault.getAbstractFileByPath(itemPath);
        const parentPath = abstractItem?.parent?.path || '/';
        await this.view.refreshColumnByPath(parentPath);
        // Also refresh the item's own column if it's a folder and was open
        if (isFolder) {
          // Check if the folder's column exists before trying to refresh
          const folderColumnSelector = `.notidian-file-explorer-column[data-path="${itemPath}"]`;
          if (this.view.columnsContainerEl?.querySelector(folderColumnSelector)) {
            await this.view.refreshColumnByPath(itemPath);
          }
        }
      }
    }).open();
  }

  async handleSetIcon(itemPath: string, isFolder: boolean) {
    console.log(`Setting custom icon for: ${itemPath}`);

    new ImagePickerModal(this.view.app, async (imagePath: string | null, fileObj?: File) => {
      if (imagePath) {
        // User picked an existing image from the vault
        // Set the icon for the item using the selected image path
        await this.setCustomIconForItem(itemPath, imagePath, isFolder);
      } else if (fileObj) {
        // User uploaded a new image, handle upload and then set as icon
        await this.uploadAndSetCustomIcon(itemPath, fileObj, isFolder);
      }
    }).open();
  }

  async setCustomIconForItem(itemPath: string, imagePath: string, isFolder: boolean) {
    // Extract just the filename from the image path
    const filename = imagePath.split('/').pop() ?? imagePath;

    // Clean up any existing emoji association
    if (itemPath in this.view.plugin.settings.emojiMap) {
      delete this.view.plugin.settings.emojiMap[itemPath];
      console.log(`[SetCustomIcon] Removed existing emoji for ${itemPath}`);
    }

    // Set the icon association to the filename
    this.view.plugin.settings.iconAssociations[itemPath] = filename;
    await this.view.plugin.saveSettings();
    console.log(`[SetCustomIcon] Set icon for ${itemPath} (${isFolder ? "folder" : "file"}): ${filename}`);

    new Notice("Custom icon set from existing image.");
    await this.view.renderColumns();
  }

  async uploadAndSetCustomIcon(itemPath: string, file: File, isFolder: boolean) {
    try {
      // Read file content as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Define the target directory (within Assets, relative to vault root)
      const dataDir = `Assets/notidian-file-explorer-data`;
      const iconsDir = `${dataDir}/images`;
      const normalizedIconsDir = normalizePath(iconsDir);

      // Ensure the base data directory exists
      const normalizedDataDir = normalizePath(dataDir);
      try {
        if (!await this.view.app.vault.adapter.exists(normalizedDataDir)) {
          console.log(`[Icon Save] Data directory not found, attempting creation: ${normalizedDataDir}`);
          await this.view.app.vault.adapter.mkdir(normalizedDataDir);
          console.log(`[Icon Save] Data directory created successfully: ${normalizedDataDir}`);
        } else {
          console.log(`[Icon Save] Data directory already exists: ${normalizedDataDir}`);
        }
      } catch (mkdirError) {
        console.error(`[Icon Save] Error ensuring data directory exists: ${normalizedDataDir}`, mkdirError);
        new Notice(`Error creating data directory: ${mkdirError.message}`);
        return;
      }

      // Check if the icons directory exists
      try {
        if (!await this.view.app.vault.adapter.exists(normalizedIconsDir)) {
          console.log(`[Icon Save] Icons directory not found, attempting creation: ${normalizedIconsDir}`);
          await this.view.app.vault.adapter.mkdir(normalizedIconsDir);
          console.log(`[Icon Save] Icons directory created successfully: ${normalizedIconsDir}`);
        } else {
          console.log(`[Icon Save] Icons directory already exists: ${normalizedIconsDir}`);
        }
      } catch (mkdirError) {
        console.error(`[Icon Save] Error ensuring icons directory exists: ${normalizedIconsDir}`, mkdirError);
        new Notice(`Error creating icons directory: ${mkdirError.message}`);
        return;
      }

      // Generate a unique filename
      const timestamp = Date.now();
      const safeOriginalName = file.name.replace(/[^a-zA-Z0-9.]/g, '_'); // Sanitize
      const uniqueFilename = `${timestamp}-${safeOriginalName}`;
      const iconPathInVault = normalizePath(`${normalizedIconsDir}/${uniqueFilename}`);

      console.log(`[Icon Save] Attempting to save icon to vault path: ${iconPathInVault}`);

      // Save the file to the vault
      await this.view.app.vault.adapter.writeBinary(iconPathInVault, arrayBuffer);
      console.log(`[Icon Save] Icon saved successfully to: ${iconPathInVault}`);

      // Clean up old icon if it exists
      const oldIconFilename = this.view.plugin.settings.iconAssociations[itemPath];
      if (oldIconFilename && oldIconFilename !== uniqueFilename) {
        const oldIconPath = normalizePath(`${normalizedIconsDir}/${oldIconFilename}`);
        try {
          // Safeguard: Ensure the path is within the expected directory
          if (!oldIconPath.startsWith(normalizedIconsDir + '/')) {
            console.error(`[Icon Save] CRITICAL: Attempted to delete file outside designated icon directory! Path: ${oldIconPath}. Deletion aborted.`);
            new Notice("Error: Prevented deletion outside of icon directory. Please check logs.");
          } else if (await this.view.app.vault.adapter.exists(oldIconPath)) {
            console.log(`[Icon Save] Preparing to remove old icon file: ${oldIconPath}`);
            await this.view.app.vault.adapter.remove(oldIconPath);
            console.log(`[Icon Save] Successfully removed old icon file: ${oldIconPath}`);
          } else {
            console.log(`[Icon Save] Old icon file not found, skipping removal: ${oldIconPath}`);
          }
        } catch (removeError) {
          console.error(`[Icon Save] Failed to remove old icon file ${oldIconPath}:`, removeError);
        }
      }

      // Clear any existing emoji first
      if (itemPath in this.view.plugin.settings.emojiMap) {
        delete this.view.plugin.settings.emojiMap[itemPath];
        console.log(`[Icon Save] Removed existing emoji for ${itemPath}`);
      }

      // Update settings
      this.view.plugin.settings.iconAssociations[itemPath] = uniqueFilename; // Store only the filename
      await this.view.plugin.saveSettings();
      console.log(`[Icon Save] Settings updated. Association: ${itemPath} -> ${uniqueFilename}`);

      // Refresh the relevant column
      const abstractItem = this.view.app.vault.getAbstractFileByPath(itemPath);
      const parentPath = abstractItem?.parent?.path || '/';
      await this.view.refreshColumnByPath(parentPath);

      // Also refresh the item's own column if it's a folder and was open
      if (isFolder) {
        const folderColumnSelector = `.notidian-file-explorer-column[data-path="${itemPath}"]`;
        if (this.view.columnsContainerEl?.querySelector(folderColumnSelector)) {
          await this.view.refreshColumnByPath(itemPath);
        }
      }

      new Notice(`Icon set for ${isFolder ? 'folder' : 'file'} "${abstractItem?.name || itemPath}"`);
    } catch (error) {
      console.error("Error in uploadAndSetCustomIcon:", error);
      new Notice("Failed to upload and set custom icon.");
    }
  }

  async clearCustomIcon(itemPath: string) {
    const oldIconFilename = this.view.plugin.settings.iconAssociations[itemPath];
    if (oldIconFilename) {
      // Only remove the association, do NOT delete the image file
      delete this.view.plugin.settings.iconAssociations[itemPath];
      await this.view.plugin.saveSettings();
      console.log(`[clearCustomIcon] Removed icon association for ${itemPath}`);
      await this.view.renderColumns();
    }
  }
}
