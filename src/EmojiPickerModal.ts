import { App, Modal } from 'obsidian';
// Import the Picker class directly. The library should handle registering the custom element.
import { Picker } from 'emoji-picker-element';

// Define the structure of the event detail we expect from emoji-picker-element
interface EmojiClickEventDetail {
  unicode: string;
  // Add other properties if needed based on library documentation (e.g., emoji object)
}

// Define a type for the custom event fired by the picker
type EmojiClickEvent = CustomEvent<EmojiClickEventDetail>;

export class EmojiPickerModal extends Modal {
  onSubmit: (emoji: string) => void;
  picker: Picker | null = null; // Use the imported Picker type

  constructor(app: App, onSubmit: (emoji: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty(); // Ensure clean state

    contentEl.createEl('h2', { text: 'Select Emoji' });

    // Create the emoji picker web component using document.createElement
    // The library registers the 'emoji-picker' tag when imported.
    try {
      this.picker = document.createElement('emoji-picker') as Picker; // Use createElement and cast
      this.picker.classList.add('emoji-picker-component'); // Add class for potential styling

      // Listen for the emoji selection event
      this.picker.addEventListener('emoji-click', (event: Event) => {
        // Cast the event to our specific type to access detail
        const customEvent = event as EmojiClickEvent;
        if (customEvent.detail?.unicode) {
          this.onSubmit(customEvent.detail.unicode);
          this.close();
        } else {
          console.warn("Emoji click event did not contain expected unicode detail:", customEvent.detail);
        }
      });

      // Append the picker to the modal
      contentEl.appendChild(this.picker);

      // Optional: Add a button to remove the emoji
      const removeButton = contentEl.createEl('button', { text: 'Remove Emoji' });
      removeButton.style.marginTop = '10px'; // Add some spacing
      removeButton.onclick = () => {
        this.onSubmit(''); // Submit empty string to indicate removal
        this.close();
      };

    } catch (error) {
      console.error("Error creating or appending emoji picker:", error);
      contentEl.createDiv({ text: "Error loading emoji picker. Please check the console." });
    }
  }

  onClose() {
    const { contentEl } = this; // Ensure contentEl is defined in this scope
    // Optional: Explicitly remove event listeners if they were added in a way that requires manual removal
    // if (this.picker) {
    //     // Example: this.picker.removeEventListener(...)
    // }
    this.picker = null; // Clear the reference to the picker instance
    contentEl.empty(); // Clear the modal content
  }
}