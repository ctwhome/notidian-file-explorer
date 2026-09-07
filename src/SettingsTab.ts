import { App, PluginSettingTab, Setting, setIcon, TextAreaComponent } from 'obsidian';
import NotidianExplorerPlugin, { TagDefinition } from '../main';
import { TagModal } from './TagModal';
import { FEATURE_SUMMARY } from './feature-summary';

// Import version from manifest
import manifest from '../manifest.json';

function settingName(icon: string, text: string): DocumentFragment {
  const name = document.createDocumentFragment();
  const iconEl = document.createElement('span');
  iconEl.className = 'notidian-settings-name-icon';
  setIcon(iconEl, icon);
  name.append(iconEl, text);
  return name;
}

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
    containerEl.createEl('h3', { text: 'Configuration' });

    new Setting(containerEl)
      .setName(settingName('folder-x', 'Exclusion Patterns'))
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
      .setName(settingName('shapes', 'Excalidraw Template Path'))
      .setDesc('Optional: Path to your Excalidraw template file (e.g., Templates/Excalidraw Template.excalidraw.md). Leave empty to use Excalidraw\'s default.')
      .addText(text => text
        .setPlaceholder('path/to/template.excalidraw.md')
        .setValue(this.plugin.settings.excalidrawTemplatePath)
        .onChange(async (value) => {
          this.plugin.settings.excalidrawTemplatePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(settingName('locate-fixed', 'Auto-reveal active file'))
      .setDesc('Automatically reveal and select the currently active file in the explorer when switching between tabs.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoRevealActiveFile)
        .onChange(async (value) => {
          this.plugin.settings.autoRevealActiveFile = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(settingName('mouse-pointer-2', 'Drag Initiation Delay'))
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
      .setName(settingName('folder-input', 'Drag Folder Open Delay'))
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

    // --- Tags Management Section ---
    containerEl.createEl('h3', { text: 'Tags' });

    new Setting(containerEl)
      .setName(settingName('tags', 'Manage Tags'))
      .setDesc('Create tags to categorize files and folders. Assign tags via the right-click context menu.')
      .addButton(btn => btn
        .setButtonText('Add Tag')
        .onClick(() => {
          new TagModal(this.app, async (result) => {
            const newTag: TagDefinition = {
              id: crypto.randomUUID(),
              name: result.name,
              color: result.color,
            };
            if (!this.plugin.settings.tagDefinitions) {
              this.plugin.settings.tagDefinitions = [];
            }
            this.plugin.settings.tagDefinitions.push(newTag);
            await this.plugin.saveSettings();
            this.display();
          }).open();
        }));

    for (const tag of (this.plugin.settings.tagDefinitions || [])) {
      const setting = new Setting(containerEl)
        .setName(tag.name)
        .addExtraButton(btn => btn
          .setIcon('pencil')
          .setTooltip('Edit')
          .onClick(() => {
            new TagModal(this.app, async (result) => {
              tag.name = result.name;
              tag.color = result.color;
              await this.plugin.saveSettings();
              this.display();
            }, tag.name, tag.color).open();
          }))
        .addExtraButton(btn => btn
          .setIcon('trash')
          .setTooltip('Delete')
          .onClick(async () => {
            this.plugin.settings.tagDefinitions = this.plugin.settings.tagDefinitions.filter(t => t.id !== tag.id);
            for (const path in this.plugin.settings.tagAssignments) {
              this.plugin.settings.tagAssignments[path] = this.plugin.settings.tagAssignments[path].filter(id => id !== tag.id);
              if (this.plugin.settings.tagAssignments[path].length === 0) {
                delete this.plugin.settings.tagAssignments[path];
              }
            }
            await this.plugin.saveSettings();
            this.display();
          }));

      // Prepend colored dot to the setting name
      const nameEl = setting.settingEl.querySelector('.setting-item-name');
      if (nameEl) {
        const dot = document.createElement('span');
        dot.style.display = 'inline-block';
        dot.style.width = '10px';
        dot.style.height = '10px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = tag.color;
        dot.style.marginRight = '6px';
        dot.style.verticalAlign = 'middle';
        nameEl.prepend(dot);
      }
    }

    const featureDetailsEl = containerEl.createEl('details', { cls: 'notidian-settings-feature-details' });
    featureDetailsEl.open = true;
    featureDetailsEl.createEl('summary', { text: 'What Notidian Explorer does' });
    featureDetailsEl.createEl('p', {
      cls: 'notidian-settings-feature-intro',
      text: 'Your main file tools, at a glance.'
    });
    const featureSummaryEl = featureDetailsEl.createDiv({ cls: 'notidian-settings-feature-summary' });
    for (const feature of FEATURE_SUMMARY) {
      new Setting(featureSummaryEl)
        .setName(settingName(feature.icon, feature.title))
        .setDesc(feature.description);
    }

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
