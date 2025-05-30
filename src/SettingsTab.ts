import { App, PluginSettingTab, Setting, TextAreaComponent } from 'obsidian';
import NotidianExplorerPlugin from '../main'; // Adjust path if needed

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
  }
}