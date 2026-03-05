import { App, Modal, Setting, Notice } from 'obsidian';

interface TagModalResult {
	name: string;
	color: string;
}

export class TagModal extends Modal {
	private name: string;
	private color: string;
	private onSubmit: (result: TagModalResult) => void;

	constructor(
		app: App,
		onSubmit: (result: TagModalResult) => void,
		initialName = '',
		initialColor = '#4ea8de'
	) {
		super(app);
		this.name = initialName;
		this.color = initialColor;
		this.onSubmit = onSubmit;
		this.titleEl.setText(initialName ? 'Edit Tag' : 'Create Tag');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Tag Name')
			.addText(text => {
				text.setPlaceholder('e.g. Researching, Review')
					.setValue(this.name)
					.onChange(value => { this.name = value; });
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') { evt.preventDefault(); this.submit(); }
				});
				setTimeout(() => { text.inputEl.focus(); text.inputEl.select(); }, 50);
			});

		new Setting(contentEl)
			.setName('Color')
			.addColorPicker(picker => {
				picker.setValue(this.color)
					.onChange(value => { this.color = value; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(this.name ? 'Save' : 'Create')
				.setCta()
				.onClick(() => this.submit()));
	}

	private submit() {
		const name = this.name.trim();
		if (!name) { new Notice('Tag name cannot be empty.'); return; }
		this.onSubmit({ name, color: this.color });
		this.close();
	}

	onClose() { this.contentEl.empty(); }
}
