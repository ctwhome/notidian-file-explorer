import { Plugin, WorkspaceLeaf, Notice, TAbstractFile, TFile, MarkdownView, normalizePath } from 'obsidian';
// Import for side effects: registers the <emoji-picker> custom element
import 'emoji-picker-element';
import { ExplorerSettingsTab } from './src/SettingsTab';
import { ColumnExplorerView } from './src/column-explorer-core';
export const VIEW_TYPE_NOTIDIAN_EXPLORER = "notidian-file-explorer-view";
interface NotidianExplorerSettings {
	exclusionPatterns: string; // One pattern per line
	excalidrawTemplatePath: string;
	emojiMap: { [path: string]: string }; // Map of path -> emoji
	iconAssociations: { [path: string]: string }; // Map of path -> icon filename
	autoRevealActiveFile: boolean; // Auto-reveal active file in explorer
	columnDisplayMode: 2 | 3; // Number of columns to display at once (2 or 3)
	dragInitiationDelay: number; // Delay in ms before drag starts (0 = disabled)
	dragFolderOpenDelay: number; // Delay in ms before hovering over folder opens it during drag (0 = disabled)
}

const DEFAULT_SETTINGS: NotidianExplorerSettings = {
	exclusionPatterns: '.git\n.obsidian\nnode_modules', // Default common exclusions
	excalidrawTemplatePath: '', // Default to empty (Excalidraw might use its own default)
	emojiMap: {}, // Initialize empty emoji map
	iconAssociations: {}, // Initialize empty icon map
	autoRevealActiveFile: false, // Disable auto-reveal by default
	columnDisplayMode: 3, // Default to 3 columns
	dragInitiationDelay: 0, // Disabled by default (instant drag)
	dragFolderOpenDelay: 0 // Disabled by default (no auto-open on hover)
}

const TITLE_ICON_CLASS = 'notidian-file-explorer-title-icon'; // CSS class for the icon span

export default class NotidianExplorerPlugin extends Plugin {
	settings: NotidianExplorerSettings;
	inlineTitleUpdateTimeout: NodeJS.Timeout | null = null; // Timeout handle

	async onload() {
		console.log('Loading Notidian Explorer plugin');

		// Add a command to open the view via the command palette
		this.addCommand({
			id: 'open-notidian-file-explorer',
			name: 'Open Notidian Explorer',
			callback: () => {
				this.activateView();
			}
		});

		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('columns', 'Open Notidian Explorer', () => {
			this.activateView();
		});

		// Register the view
		this.registerView(
			VIEW_TYPE_NOTIDIAN_EXPLORER,
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
		console.log('Unloading Notidian Explorer plugin');
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
		// Optional: Refresh any open Notidian Explorer views to show the change immediately
		this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTIDIAN_EXPLORER).forEach(leaf => {
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
					console.log("[Notidian Explorer] Timeout: Inline title element not found.");
					const oldIconEl = contentEl.querySelector(`.${TITLE_ICON_CLASS}`);
					oldIconEl?.remove();
					return;
				}

				console.log(`[Notidian Explorer] Timeout: Found inline title. IconPath: ${iconPath}, Emoji: ${emoji}`);

				const parentEl = inlineTitleEl.parentElement;
				if (!parentEl) {
					console.warn("[Notidian Explorer] Timeout: Could not find parent element of inline title.");
					return;
				}

				const existingIconEl = parentEl.querySelector(`:scope > .${TITLE_ICON_CLASS}`) as HTMLElement | null;
				console.log(`[Notidian Explorer] Timeout: Existing icon element found in parent: ${!!existingIconEl} (Type: ${existingIconEl?.tagName})`);

				let desiredType: 'icon' | 'emoji' | 'none' = 'none';
				let desiredValue: string | null = null;

				if (iconPath) {
					const vaultRelativePath = normalizePath(`.notidian-file-explorer-data/icons/${iconPath}`);
					// Use adapter.getResourcePath directly, as the icon file is not a standard TFile
					const resourcePath = this.app.vault.adapter.getResourcePath(vaultRelativePath);

					// Check if getResourcePath returned a valid URL/path
					if (resourcePath && resourcePath !== vaultRelativePath) {
						desiredValue = resourcePath;
						desiredType = 'icon';
						console.log(`[Notidian Explorer] Timeout: Using icon. Resource path: ${desiredValue}`);
					} else {
						console.warn(`[Notidian Explorer] Timeout: Could not get resource path for icon: ${vaultRelativePath}. Falling back.`);
						desiredType = 'none';
					}

					if (desiredType === 'none' && emoji) {
						desiredType = 'emoji';
						desiredValue = emoji;
						console.log(`[Notidian Explorer] Timeout: Falling back to emoji: ${desiredValue}`);
					}

				} else if (emoji) {
					desiredType = 'emoji';
					desiredValue = emoji;
					console.log(`[Notidian Explorer] Timeout: Using emoji (no icon path defined): ${desiredValue}`);
				} else {
					desiredType = 'none';
					desiredValue = null;
					console.log(`[Notidian Explorer] Timeout: No icon or emoji defined.`);
				}

				this.applyIconChanges(parentEl, inlineTitleEl, existingIconEl, desiredType, desiredValue);
			} catch (error) { // <-- Add catch block
				console.error("[Notidian Explorer] Error during inline title icon update:", error);
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
						console.log("[Notidian Explorer] ApplyChanges: Updating existing image src.");
						existingIconEl.src = desiredValue;
					} else {
						console.log("[Notidian Explorer] ApplyChanges: Existing image src matches.");
					}
				} else if (desiredType === 'emoji' && existingIconEl instanceof HTMLSpanElement) {
					if (existingIconEl.textContent !== desiredValue) {
						console.log("[Notidian Explorer] ApplyChanges: Updating existing span text.");
						existingIconEl.textContent = desiredValue;
					} else {
						console.log("[Notidian Explorer] ApplyChanges: Existing span text matches.");
					}
				} else {
					console.log(`[Notidian Explorer] ApplyChanges: Type mismatch (Existing: ${existingIconEl.tagName}, Desired: ${desiredType}). Removing old.`);
					existingIconEl.remove();
					const newIconEl = this.createIconElement(desiredType, desiredValue);
					if (newIconEl) {
						console.log("[Notidian Explorer] ApplyChanges: Creating new element after type mismatch.");
						parentEl.insertBefore(newIconEl, inlineTitleEl);
					}
				}
			} else {
				const newIconEl = this.createIconElement(desiredType, desiredValue);
				if (newIconEl) {
					console.log("[Notidian Explorer] ApplyChanges: Creating new element.");
					parentEl.insertBefore(newIconEl, inlineTitleEl);
				}
			}
		} else {
			if (existingIconEl) {
				console.log("[Notidian Explorer] ApplyChanges: Removing existing icon (no icon/emoji needed).");
				existingIconEl.remove();
			} else {
				console.log("[Notidian Explorer] ApplyChanges: No icon needed and none exists.");
			}
		}
	}

	// Helper function to create the icon/emoji element (value is resource path URL for icon)
	createIconElement(type: 'icon' | 'emoji', value: string): HTMLElement | null {
		if (type === 'icon') {
			const img = document.createElement('img');
			img.addClass(TITLE_ICON_CLASS);
			img.src = value; // value is the resource path URL
			console.log(`[Notidian Explorer] createIconElement: Setting image src to: ${value}`);
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
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTIDIAN_EXPLORER);
		if (existingLeaves.length > 0) {
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_NOTIDIAN_EXPLORER,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		} else {
			new Notice("Could not open Notidian Explorer view.");
		}
	}

	async loadSettings() {
		// Define paths: New preferred path first, then potential old locations for migration
		const assetsPath = `Assets/notidian-file-explorer-data/notidian-file-explorer.json`; // New preferred path
		const standardPluginPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`; // Previous standard path
		const vaultRootHiddenPath = `.notidian-file-explorer-data/notidian-file-explorer.json`; // Old hidden path
		const previousObsidianPath = `${this.app.vault.configDir}/notidian-file-explorer/notidian-file-explorer.json`; // Older paths...
		const olderObsidianPath = `${this.app.vault.configDir}/notidian-file-explorer.json`;

		console.log(`Attempting to load settings from preferred path: ${assetsPath}`);

		try {
			let settingsData = null;
			let loadedFromPath = '';

			// 1. Try reading from the new Assets location first
			if (await this.app.vault.adapter.exists(normalizePath(assetsPath))) {
				console.log('Settings file found at Assets location.');
				settingsData = await this.app.vault.adapter.read(normalizePath(assetsPath));
				loadedFromPath = assetsPath;
			}
			// 2. If not found, try migrating from the standard plugin data location
			else if (await this.app.vault.adapter.exists(normalizePath(standardPluginPath))) {
				console.log(`Settings file not found at Assets path. Attempting migration from standard plugin path: ${standardPluginPath}`);
				settingsData = await this.app.vault.adapter.read(normalizePath(standardPluginPath));
				loadedFromPath = standardPluginPath;
			}
			// 3. If not found, try migrating from the vault root hidden location
			else if (await this.app.vault.adapter.exists(normalizePath(vaultRootHiddenPath))) {
				console.log(`Settings file not found at Assets or standard plugin path. Attempting migration from vault root hidden path: ${vaultRootHiddenPath}`);
				settingsData = await this.app.vault.adapter.read(normalizePath(vaultRootHiddenPath));
				loadedFromPath = vaultRootHiddenPath;
			}
			// 4. If not found, try migrating from the previous .obsidian location
			else if (await this.app.vault.adapter.exists(normalizePath(previousObsidianPath))) {
				console.log(`Settings file not found elsewhere. Attempting migration from previous .obsidian path: ${previousObsidianPath}`);
				settingsData = await this.app.vault.adapter.read(normalizePath(previousObsidianPath));
				loadedFromPath = previousObsidianPath;
			}
			// 5. If not found, try migrating from the older .obsidian location
			else if (await this.app.vault.adapter.exists(normalizePath(olderObsidianPath))) {
				console.log(`Settings file not found elsewhere. Attempting migration from older .obsidian path: ${olderObsidianPath}`);
				settingsData = await this.app.vault.adapter.read(normalizePath(olderObsidianPath));
				loadedFromPath = olderObsidianPath;
			}

			// Process loaded data or use defaults
			if (settingsData) {
				console.log(`Successfully read data from: ${loadedFromPath}`);
				this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(settingsData));

				// If loaded from a non-preferred path, save immediately to migrate to Assets path
				if (loadedFromPath !== assetsPath) {
					console.log(`Migrating settings from ${loadedFromPath} to ${assetsPath}.`);
					await this.saveSettings(); // This will now save to the Assets path
					// Optional: Consider removing the old file after successful migration
					// try { await this.app.vault.adapter.remove(normalizePath(loadedFromPath)); } catch (e) { console.warn(`Could not remove old settings file: ${loadedFromPath}`, e); }
				} else {
					console.log('Settings loaded successfully from Assets location.');
				}

			} else {
				console.log('No settings file found at any known location. Using defaults.');
				this.settings = DEFAULT_SETTINGS;
				// Optionally save defaults immediately to the new path: await this.saveSettings();
			}

		} catch (e: any) {
			console.error('Error loading or migrating settings. Using defaults.', e);
			this.settings = DEFAULT_SETTINGS;
		}
	}

	async saveSettings() {
		// Always save to the Assets location
		const settingsPath = `Assets/notidian-file-explorer-data/notidian-file-explorer.json`;
		try {
			const normalizedSettingsPath = normalizePath(settingsPath);
			// Ensure the parent directory exists
			const parentDir = normalizedSettingsPath.substring(0, normalizedSettingsPath.lastIndexOf('/'));
			if (!(await this.app.vault.adapter.exists(parentDir))) {
				console.log(`Creating data directory: ${parentDir}`);
				// Need to create intermediate 'Assets' directory too if it doesn't exist
				const assetsDir = parentDir.substring(0, parentDir.indexOf('/'));
				if (assetsDir && !(await this.app.vault.adapter.exists(assetsDir))) {
					console.log(`Creating base directory: ${assetsDir}`);
					await this.app.vault.adapter.mkdir(assetsDir);
				}
				await this.app.vault.adapter.mkdir(parentDir);
			}

			console.log(`Saving settings to Assets path: ${normalizedSettingsPath}`);
			await this.app.vault.adapter.write(normalizedSettingsPath, JSON.stringify(this.settings, null, 2));
		} catch (e: any) {
			console.error('Error saving Notidian Explorer settings:', e);
			new Notice('Error saving Notidian Explorer settings.');
		}
	}
}

