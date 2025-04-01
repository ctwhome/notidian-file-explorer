import { App, Modal, Setting, TextComponent, Notice } from 'obsidian';

export class InputModal extends Modal {
  private inputValue: string;
  private inputComponent: TextComponent;
  private onSubmit: (value: string) => void;
  private placeholder: string;
  private initialValue: string;

  constructor(app: App, title: string, placeholder: string = '', initialValue: string = '', onSubmit: (value: string) => void) {
    super(app);
    this.titleEl.setText(title);
    this.placeholder = placeholder;
    this.initialValue = initialValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty(); // Clear previous content just in case

    // Create the input field
    new Setting(contentEl)
      .setName("Name") // Label for the input
      .addText((text) => {
        this.inputComponent = text; // Store reference
        text.setPlaceholder(this.placeholder)
          .setValue(this.initialValue)
          .onChange((value) => {
            this.inputValue = value;
          });
        // Allow submitting with Enter key
        text.inputEl.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault(); // Prevent default Enter behavior (like adding newline)
            this.submit();
          }
        });
      });

    // Create submit button
    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Submit")
          .setCta() // Makes it stand out
          .onClick(() => {
            this.submit();
          }));

    // Focus the input field when the modal opens
    // Use setTimeout to ensure the element is ready
    setTimeout(() => {
      this.inputComponent?.inputEl?.focus();
      // Select the initial value if present (useful for rename)
      if (this.initialValue) {
        this.inputComponent.inputEl.select();
      }
    }, 50); // Small delay
  }

  submit() {
    const value = this.inputValue?.trim() ?? '';
    if (value) { // Only submit if there's a non-empty value
      this.onSubmit(value);
      this.close();
    } else {
      // Optionally show a notice if the input is empty
      new Notice("Name cannot be empty.");
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}