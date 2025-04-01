import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ColumnExplorerView } from './src/ColumnExplorerView'; // Adjusted path

export const VIEW_TYPE_ONENOTE_EXPLORER = "onenote-explorer-view";

export default class OneNoteExplorerPlugin extends Plugin {

	async onload() {
		console.log('Loading OneNote Explorer plugin');

		// This creates an icon in the left ribbon.
		// This creates an icon in the left ribbon. We will modify this later to activate the view.
		this.addRibbonIcon('columns', 'Open OneNote Explorer', () => {
			this.activateView();
		});

		// Register the view
		this.registerView(
			VIEW_TYPE_ONENOTE_EXPLORER,
			(leaf: WorkspaceLeaf) => new ColumnExplorerView(leaf)
		);
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
}
