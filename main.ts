import { Plugin, WorkspaceLeaf, Notice, TAbstractFile } from 'obsidian'; // Removed App
import { ExplorerSettingsTab } from './src/SettingsTab';
import { ColumnExplorerView } from './src/ColumnExplorerView'; // Adjusted path

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

export default class OneNoteExplorerPlugin extends Plugin {
	settings: OneNoteExplorerSettings;

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
	}

	onunload() {
		console.log('Unloading OneNote Explorer plugin');
		// No need to explicitly unregister 'rename' event if using this.registerEvent
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
				// Add a refresh method to ColumnExplorerView if needed, or re-render specific parts
				// For simplicity, we might just trigger a general refresh if available
				// leaf.view.renderView(); // Example: You'd need to implement renderView() or similar
				console.log('Requesting view refresh (implementation needed in ColumnExplorerView)');
			}
		});
	}

	async activateView() {
		// Check if the view is already open
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ONENOTE_EXPLORER);
		if (existingLeaves.length > 0) {
			// If already open, reveal it
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		// If not open, create a new leaf in the right sidebar
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ONENOTE_EXPLORER,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		} else {
			// Fallback if right leaf doesn't exist (should be rare)
			new Notice("Could not open OneNote Explorer view.");
		}
	}

	async loadSettings() {
		const configDir = this.app.vault.configDir;
		const newSettingsPath = `${configDir}/onenote-explorer.json`;
		// Deprecated path used by loadData()/saveData()
		const oldSettingsPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;

		console.log(`Attempting to load settings from new path: ${newSettingsPath}`);

		try {
			// 1. Try reading from the new location first
			if (await this.app.vault.adapter.exists(newSettingsPath)) {
				console.log('New settings file found.');
				const data = await this.app.vault.adapter.read(newSettingsPath);
				this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(data));
				console.log('Settings loaded successfully from new path.');
			}
			// 2. If new file doesn't exist, try migrating from the old location
			else if (await this.app.vault.adapter.exists(oldSettingsPath)) {
				console.log(`New settings file not found. Attempting migration from old path: ${oldSettingsPath}`);
				try {
					const oldData = await this.app.vault.adapter.read(oldSettingsPath);
					this.settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(oldData));
					console.log('Successfully read data from old settings file.');
					// Save the migrated settings to the new location immediately
					await this.saveSettings(); // Use the class method
					console.log('Migrated settings saved to new path.');
					// Optionally, attempt to remove the old file - use with caution
					// try {
					// 	await this.app.vault.adapter.remove(oldSettingsPath);
					// 	console.log('Old settings file removed after migration.');
					// } catch (removeError) {
					// 	console.error('Could not remove old settings file after migration:', removeError);
					// }
				} catch (migrationError: any) { // Added type annotation for catch
					console.error('Error migrating settings from old path. Using defaults.', migrationError);
					this.settings = DEFAULT_SETTINGS;
				}
			}
			// 3. If neither exists, use defaults
			else {
				console.log('Neither new nor old settings file found. Using defaults.');
				this.settings = DEFAULT_SETTINGS;
			}
		} catch (e: any) { // Added type annotation for catch
			// Catch any unexpected error during loading/parsing
			console.error('Error loading settings. Using defaults.', e);
			this.settings = DEFAULT_SETTINGS;
		}
	}

	async saveSettings() {
		const configDir = this.app.vault.configDir;
		const settingsPath = `${configDir}/onenote-explorer.json`;
		// console.log(`Saving OneNote Explorer settings to: ${settingsPath}`); // Log path (can be noisy)
		try {
			await this.app.vault.adapter.write(settingsPath, JSON.stringify(this.settings, null, 2));
			// console.log('Settings saved successfully.'); // Log path (can be noisy)
		} catch (e: any) { // Added type annotation for catch
			console.error('Error saving OneNote Explorer settings:', e);
			new Notice('Error saving OneNote Explorer settings.');
		}
	}
}
