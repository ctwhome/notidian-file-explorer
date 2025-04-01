import { Plugin, WorkspaceLeaf, Notice, TAbstractFile, TFile, MarkdownView, normalizePath } from 'obsidian';
import { ExplorerSettingsTab } from './src/SettingsTab';
import { ColumnExplorerView } from './src/ColumnExplorerView';

export const VIEW_TYPE_ONENOTE_EXPLORER = "onenote-explorer-view";
interface OneNoteExplorerSettings {
	exclusionPatterns: string; // One pattern per line
	excalidrawTemplatePath: string;
	emojiMap: { [path: string]: string }; // Map of path -> emoji
	iconAssociations: { [path: string]: string }; // Map of path -> icon filename
}

const DEFAULT_SETTINGS: OneNoteExplorerSettings = {
	exclusionPatterns: '.git\n.obsidian\nnode_modules', // Default common exclusions
	excalidrawTemplatePath: '', // Default to empty (Excalidraw might use its own default)
	emojiMap: {}, // Initialize empty emoji map
	iconAssociations: {} // Initialize empty icon map
}

const TITLE_ICON_CLASS = 'onenote-explorer-title-icon'; // CSS class for the icon span

export default class OneNoteExplorerPlugin extends Plugin {
	settings: OneNoteExplorerSettings;
	inlineTitleUpdateTimeout: NodeJS.Timeout | null = null; // Timeout handle

	async onload() {
		console.log('Loading OneNote Explorer plugin');
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('columns', 'Open OneNote Explorer', () => {
			this.activateView();
		});

		// Register the view
		this.registerView(
			VIEW_TYPE_ONENOTE_EXPLORER,
			// Pass the plugin instance to the view
			(leaf: WorkspaceLeaf) => new ColumnExplorerView(leaf, this)
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ExplorerSettingsTab(this.app, this));

		// Register event listener for file/folder renames (includes moves)
		this.registerEvent(
			this.app.vault.on('rename', this.handleRename)
		);

		// Register event listener for file opens
		this.registerEvent(
			this.app.workspace.on('file-open', this.handleFileOpen)
		);
	}

	onunload() {
		console.log('Unloading OneNote Explorer plugin');
		if (this.inlineTitleUpdateTimeout) {
			clearTimeout(this.inlineTitleUpdateTimeout);
		}
	}

	// Event handler for file/folder renames
	handleRename = async (file: TAbstractFile, oldPath: string) => {
		console.log(`File renamed/moved: ${oldPath} -> ${file.path}`);
		let settingsChanged = false;

		// Handle Emoji Renaming
		if (this.settings.emojiMap && oldPath in this.settings.emojiMap) {
			const emoji = this.settings.emojiMap[oldPath];
			console.log(`Found associated emoji "${emoji}" for old path.`);
			delete this.settings.emojiMap[oldPath];
			this.settings.emojiMap[file.path] = emoji;
			settingsChanged = true;
			console.log(`Updated emoji map for new path: ${file.path}`);
		}

		// Handle Icon Renaming
		if (this.settings.iconAssociations && oldPath in this.settings.iconAssociations) {
			const iconFile = this.settings.iconAssociations[oldPath];
			console.log(`Found associated icon "${iconFile}" for old path.`);
			delete this.settings.iconAssociations[oldPath];
			this.settings.iconAssociations[file.path] = iconFile;
			settingsChanged = true;
			console.log(`Updated icon association map for new path: ${file.path}`);
		}

		// Save settings if anything changed
		if (settingsChanged) {
			await this.saveSettings();
		}
		// Optional: Refresh any open OneNote Explorer views to show the change immediately
		this.app.workspace.getLeavesOfType(VIEW_TYPE_ONENOTE_EXPLORER).forEach(leaf => {
			if (leaf.view instanceof ColumnExplorerView) {
				console.log('Requesting view refresh (implementation needed in ColumnExplorerView)');
				// Consider adding a refresh method to ColumnExplorerView if needed
				// leaf.view.refreshView();
			}
		});
	}

	// Event handler for file opens
	handleFileOpen = (file: TFile | null) => {
		if (this.inlineTitleUpdateTimeout) {
			clearTimeout(this.inlineTitleUpdateTimeout);
		}

		if (!file) {
			return;
		}

		const emoji = this.settings.emojiMap?.[file.path];
		const iconPath = this.settings.iconAssociations?.[file.path]; // Filename

		const activeLeaf = this.app.workspace.activeLeaf;
		if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) {
			return;
		}
		const markdownView = activeLeaf.view as MarkdownView;

		this.inlineTitleUpdateTimeout = setTimeout(() => {
			this.inlineTitleUpdateTimeout = null;

			try { // <-- Add try block
				const currentLeaf = this.app.workspace.activeLeaf;
				if (!currentLeaf || !(currentLeaf.view instanceof MarkdownView) || currentLeaf.view !== markdownView) {
					return;
				}
				const currentMarkdownView = currentLeaf.view as MarkdownView;
				const contentEl = currentMarkdownView.contentEl;
				const inlineTitleEl = contentEl.querySelector('.inline-title') as HTMLElement | null;

				if (!inlineTitleEl) {
					console.log("[OneNote Explorer] Timeout: Inline title element not found.");
					const oldIconEl = contentEl.querySelector(`.${TITLE_ICON_CLASS}`);
					oldIconEl?.remove();
					return;
				}

				console.log(`[OneNote Explorer] Timeout: Found inline title. IconPath: ${iconPath}, Emoji: ${emoji}`);

				const parentEl = inlineTitleEl.parentElement;
				if (!parentEl) {
					console.warn("[OneNote Explorer] Timeout: Could not find parent element of inline title.");
					return;
				}

				const existingIconEl = parentEl.querySelector(`:scope > .${TITLE_ICON_CLASS}`) as HTMLElement | null;
				console.log(`[OneNote Explorer] Timeout: Existing icon element found in parent: ${!!existingIconEl} (Type: ${existingIconEl?.tagName})`);

				let desiredType: 'icon' | 'emoji' | 'none' = 'none';
				let desiredValue: string | null = null;

				if (iconPath) {
					const vaultRelativePath = normalizePath(`.onenote-explorer-data/icons/${iconPath}`);
					const iconFile = this.app.vault.getAbstractFileByPath(vaultRelativePath);

					if (iconFile instanceof TFile) {
						desiredValue = this.app.vault.getResourcePath(iconFile);
						desiredType = 'icon';
						console.log(`[OneNote Explorer] Timeout: Using icon. Found TFile for path: ${vaultRelativePath}, Resource path: ${desiredValue}`);
					} else {
						console.warn(`[OneNote Explorer] Timeout: Could not find TFile for icon path: ${vaultRelativePath}. Falling back.`);
						desiredType = 'none';
					}

					if (desiredType === 'none' && emoji) {
						desiredType = 'emoji';
						desiredValue = emoji;
						console.log(`[OneNote Explorer] Timeout: Falling back to emoji: ${desiredValue}`);
					}

				} else if (emoji) {
					desiredType = 'emoji';
					desiredValue = emoji;
					console.log(`[OneNote Explorer] Timeout: Using emoji (no icon path defined): ${desiredValue}`);
				} else {
					desiredType = 'none';
					desiredValue = null;
					console.log(`[OneNote Explorer] Timeout: No icon or emoji defined.`);
				}

				this.applyIconChanges(parentEl, inlineTitleEl, existingIconEl, desiredType, desiredValue);
			} catch (error) { // <-- Add catch block
				console.error("[OneNote Explorer] Error during inline title icon update:", error);
			}

		}, 50);
	}

	// Helper function to apply the icon/emoji changes to the DOM
	applyIconChanges(
		parentEl: HTMLElement,
		inlineTitleEl: HTMLElement,
		existingIconEl: HTMLElement | null,
		desiredType: 'icon' | 'emoji' | 'none',
		desiredValue: string | null
	) {
		if (desiredType !== 'none' && desiredValue) {
			if (existingIconEl) {
				if (desiredType === 'icon' && existingIconEl instanceof HTMLImageElement) {
					if (existingIconEl.src !== desiredValue) {
						console.log("[OneNote Explorer] ApplyChanges: Updating existing image src.");
						existingIconEl.src = desiredValue;
					} else {
						console.log("[OneNote Explorer] ApplyChanges: Existing image src matches.");
					}
				} else if (desiredType === 'emoji' && existingIconEl instanceof HTMLSpanElement) {
					if (existingIconEl.textContent !== desiredValue) {
						console.log("[OneNote Explorer] ApplyChanges: Updating existing span text.");
						existingIconEl.textContent = desiredValue;
					} else {
						console.log("[OneNote Explorer] ApplyChanges: Existing span text matches.");
					}
				} else {
					console.log(`[OneNote Explorer] ApplyChanges: Type mismatch (Existing: ${existingIconEl.tagName}, Desired: ${desiredType}). Removing old.`);
					existingIconEl.remove();
					const newIconEl = this.createIconElement(desiredType, desiredValue);
					if (newIconEl) {
						console.log("[OneNote Explorer] ApplyChanges: Creating new element after type mismatch.");
						parentEl.insertBefore(newIconEl, inlineTitleEl);
					}
				}
			} else {
				const newIconEl = this.createIconElement(desiredType, desiredValue);
				if (newIconEl) {
					console.log("[OneNote Explorer] ApplyChanges: Creating new element.");
					parentEl.insertBefore(newIconEl, inlineTitleEl);
				}
			}
		} else {
			if (existingIconEl) {
				console.log("[OneNote Explorer] ApplyChanges: Removing existing icon (no icon/emoji needed).");
				existingIconEl.remove();
			} else {
				console.log("[OneNote Explorer] ApplyChanges: No icon needed and none exists.");
			}
		}
	}

	// Helper function to create the icon/emoji element (value is resource path URL for icon)
	createIconElement(type: 'icon' | 'emoji', value: string): HTMLElement | null {
		if (type === 'icon') {
			const img = document.createElement('img');
			img.addClass(TITLE_ICON_CLASS);
			img.src = value; // value is the resource path URL
			console.log(`[OneNote Explorer] createIconElement: Setting image src to: ${value}`);
			return img;
		} else if (type === 'emoji') {
			const span = document.createElement('span');
			span.addClass(TITLE_ICON_CLASS);
			span.textContent = value;
			return span;
		}
		return null;
	}

	async activateView() {
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ONENOTE_EXPLORER);
		if (existingLeaves.length > 0) {
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ONENOTE_EXPLORER,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		} else {
			new Notice("Could not open OneNote Explorer view.");
		}
	}

	async loadSettings() {
		// New desired path: .onenote-explorer-data/onenote-explorer.json (relative to vault root)
		const newSettingsPath = `.onenote-explorer-data/onenote-explorer.json`;
		// Previous path: .obsidian/onenote-explorer/onenote-explorer.json
		const previousObsidianPath = `${this.app.vault.configDir}/onenote-explorer/onenote-explorer.json`;
		// Older path: .obsidian/onenote-explorer.json
		const olderObsidianPath = `${this.app.vault.configDir}/onenote-explorer.json`;
		// Oldest path (plugin data folder)
		const oldestPluginDataPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;

		console.log(`Attempting to load settings from new path: ${newSettingsPath}`);

		try {
			// 1. Try reading from the new vault location first
			if (await this.app.vault.adapter.exists(normalizePath(newSettingsPath))) { // Normalize for adapter
				console.log('Settings file found at new location.');
				const data = await this.app.vault.adapter.read(normalizePath(newSettingsPath));
				this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(data));
				console.log('Settings loaded successfully from new location.');
			}
			// 2. If not found, try migrating from the previous .obsidian location (.obsidian/onenote-explorer/onenote-explorer.json)
			else if (await this.app.vault.adapter.exists(normalizePath(previousObsidianPath))) { // Normalize for adapter
				console.log(`Settings file not found at new vault location. Attempting migration from previous .obsidian path: ${previousObsidianPath}`);
				try {
					const prevData = await this.app.vault.adapter.read(normalizePath(previousObsidianPath)); // Normalize for adapter
					this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(prevData));
					console.log('Successfully read data from previous settings file.');
					await this.saveSettings(); // This will now save to the new path
					console.log('Migrated settings saved to new location.');
					// await this.app.vault.adapter.remove(normalizePath(previousObsidianPath));
				} catch (migrationError: any) {
					console.error('Error migrating settings from previous .obsidian path. Using defaults.', migrationError);
					this.settings = DEFAULT_SETTINGS;
				}
			}
			// 3. If not found, try migrating from the older .obsidian location (.obsidian/onenote-explorer.json)
			else if (await this.app.vault.adapter.exists(normalizePath(olderObsidianPath))) { // Normalize for adapter
				console.log(`Settings file not found at new vault or previous .obsidian path. Attempting migration from older .obsidian path: ${olderObsidianPath}`);
				try {
					const olderData = await this.app.vault.adapter.read(normalizePath(olderObsidianPath)); // Normalize for adapter
					this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(olderData));
					console.log('Successfully read data from very old settings file.');
					await this.saveSettings(); // Use the class method
					console.log('Migrated settings saved to new location.');
					// await this.app.vault.adapter.remove(normalizePath(olderObsidianPath));
				} catch (migrationError: any) {
					console.error('Error migrating settings from older .obsidian path. Using defaults.', migrationError);
					this.settings = DEFAULT_SETTINGS;
				}
			}
			// 4. If not found, try migrating from the oldest plugin data folder location
			else if (await this.app.vault.adapter.exists(normalizePath(oldestPluginDataPath))) { // Normalize for adapter
				console.log(`Settings file not found anywhere else. Attempting migration from oldest plugin data path: ${oldestPluginDataPath}`);
				try {
					const oldestData = await this.app.vault.adapter.read(normalizePath(oldestPluginDataPath)); // Normalize for adapter
					this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(oldestData));
					console.log('Successfully read data from oldest settings file.');
					await this.saveSettings(); // Save to new vault location
					console.log('Migrated settings saved to new vault location.');
					// await this.app.vault.adapter.remove(normalizePath(oldestPluginDataPath));
				} catch (migrationError: any) {
					console.error('Error migrating settings from oldest plugin data path. Using defaults.', migrationError);
					this.settings = DEFAULT_SETTINGS;
				}
			}
			// 5. If none exist, use defaults
			else {
				console.log('Neither new nor old settings file found. Using defaults.');
				this.settings = DEFAULT_SETTINGS;
			}
		} catch (e: any) { // Added type annotation for catch
			console.error('Error loading settings. Using defaults.', e);
			this.settings = DEFAULT_SETTINGS;
		}
	}

	async saveSettings() {
		// Save to the new vault location: .onenote-explorer-data/onenote-explorer.json
		const settingsPath = `.onenote-explorer-data/onenote-explorer.json`; // Relative to vault root
		try {
			// Ensure the directory exists before writing
			const dataDir = `.onenote-explorer-data`; // Relative to vault root
			const normalizedDataDir = normalizePath(dataDir);
			const normalizedSettingsPath = normalizePath(settingsPath);

			if (!(await this.app.vault.adapter.exists(normalizedDataDir))) {
				console.log(`Creating data directory: ${normalizedDataDir}`);
				await this.app.vault.adapter.mkdir(normalizedDataDir);
			}
			await this.app.vault.adapter.write(normalizedSettingsPath, JSON.stringify(this.settings, null, 2));
		} catch (e: any) { // Added type annotation for catch
			console.error('Error saving OneNote Explorer settings:', e);
			new Notice('Error saving OneNote Explorer settings.');
		}
	}
}
