import { Plugin, WorkspaceLeaf, Notice, App } from 'obsidian'; // Added App back for settings tab
import { ExplorerSettingsTab } from './src/SettingsTab';
import { ColumnExplorerView } from './src/ColumnExplorerView'; // Adjusted path

export const VIEW_TYPE_ONENOTE_EXPLORER = "onenote-explorer-view";
interface OneNoteExplorerSettings {
	exclusionPatterns: string; // One pattern per line
}

const DEFAULT_SETTINGS: OneNoteExplorerSettings = {
	exclusionPatterns: '.git\n.obsidian\nnode_modules' // Default common exclusions
}

export default class OneNoteExplorerPlugin extends Plugin {
	settings: OneNoteExplorerSettings;

	async onload() {
		console.log('Loading OneNote Explorer plugin');
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		// This creates an icon in the left ribbon. We will modify this later to activate the view.
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
	}

	onunload() {
		console.log('Unloading OneNote Explorer plugin');

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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
