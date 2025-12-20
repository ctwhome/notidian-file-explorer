import { App, PluginSettingTab, Setting, TextAreaComponent } from 'obsidian';
import NotidianExplorerPlugin from '../main'; // Adjust path if needed

// Import version from manifest
import manifest from '../manifest.json';

export class ExplorerSettingsTab extends PluginSettingTab {
  plugin: NotidianExplorerPlugin;

  constructor(app: App, plugin: NotidianExplorerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Notidian File Explorer Settings' });

    new Setting(containerEl)
      .setName('Exclusion Patterns')
      .setDesc('Enter patterns to exclude files/folders (one per line). Uses simple string matching (case-insensitive). Examples: .git, node_modules, temporary_files')
      .addTextArea((text: TextAreaComponent) => {
        text
          .setPlaceholder('.git\n.obsidian\nnode_modules\n...')
          .setValue(this.plugin.settings.exclusionPatterns)
          .onChange(async (value) => {
            this.plugin.settings.exclusionPatterns = value;
            await this.plugin.saveSettings();
          });
        // Adjust text area size
        text.inputEl.rows = 8;
        text.inputEl.cols = 50; // Adjust width as needed
      });

    new Setting(containerEl)
      .setName('Excalidraw Template Path')
      .setDesc('Optional: Path to your Excalidraw template file (e.g., Templates/Excalidraw Template.excalidraw.md). Leave empty to use Excalidraw\'s default.')
      .addText(text => text
        .setPlaceholder('path/to/template.excalidraw.md')
        .setValue(this.plugin.settings.excalidrawTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.excalidrawTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto-reveal active file')
      .setDesc('Automatically reveal and select the currently active file in the explorer when switching between tabs.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoRevealActiveFile)
        .onChange(async (value) => {
          this.plugin.settings.autoRevealActiveFile = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Column Display Mode')
      .setDesc('Choose how many columns to display at once. Columns will resize to fit.')
      .addDropdown(dropdown => dropdown
        .addOption('2', '2 Columns (50% width each)')
        .addOption('3', '3 Columns (33% width each)')
        .setValue(String(this.plugin.settings.columnDisplayMode))
        .onChange(async (value) => {
          this.plugin.settings.columnDisplayMode = parseInt(value) as 2 | 3;
          await this.plugin.saveSettings();
          // Update all open explorer views
          this.plugin.app.workspace.getLeavesOfType('notidian-file-explorer-view').forEach(leaf => {
            if (leaf.view.getViewType() === 'notidian-file-explorer-view') {
              // Access the view and call its updateColumnDisplayMode method
              const view = leaf.view as any;
              if (view.updateColumnDisplayMode) {
                view.updateColumnDisplayMode();
              }
            }
          });
        }));

    new Setting(containerEl)
      .setName('Drag Initiation Delay')
      .setDesc('Delay in milliseconds before a drag operation starts. Set to 0 to disable (instant drag). Default: 0')
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.dragInitiationDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.dragInitiationDelay = numValue;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Drag Folder Open Delay')
      .setDesc('Delay in milliseconds before a folder automatically opens when dragging over it. Set to 0 to disable auto-open. Default: 0')
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.dragFolderOpenDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.dragFolderOpenDelay = numValue;
            await this.plugin.saveSettings();
          }
        }));

    // Version info at the bottom
    containerEl.createEl('hr');
    const versionEl = containerEl.createEl('div', { cls: 'notidian-settings-version' });
    versionEl.createEl('span', {
      text: `Version: ${manifest.version}`,
      cls: 'notidian-version-text'
    });
    versionEl.style.textAlign = 'center';
    versionEl.style.color = 'var(--text-muted)';
    versionEl.style.fontSize = 'var(--font-ui-smaller)';
    versionEl.style.marginTop = '20px';
  }
}