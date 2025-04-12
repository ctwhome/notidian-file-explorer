import { App, Modal, Notice, TFile, normalizePath } from "obsidian";

/**
 * Modal for picking or uploading a custom image from Assets/notidian-file-explorer-data/images.
 * - Lists all images in the folder with previews.
 * - Allows selecting an existing image.
 * - Provides a button to upload a new image (triggers file input).
 */
export class ImagePickerModal extends Modal {
  onSubmit: (imagePath: string | null, fileObj?: File) => void;
  imagesDir: string;

  constructor(app: App, onSubmit: (imagePath: string | null, fileObj?: File) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.imagesDir = "Assets/notidian-file-explorer-data/images";
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Select or Upload Image" });

    // List images in the directory
    const files = this.app.vault.getFiles();
    const imageFiles = files.filter(
      (f) =>
        f.path.startsWith(this.imagesDir) &&
        /\.(png|jpe?g|gif|svg|webp)$/i.test(f.name)
    );

    if (imageFiles.length > 0) {
      const grid = contentEl.createDiv({ cls: "notidian-image-picker-grid" });
      imageFiles.forEach((file) => {
        const imgWrapper = grid.createDiv({ cls: "notidian-image-picker-item" });
        const img = imgWrapper.createEl("img", {
          attr: {
            src: this.app.vault.adapter.getResourcePath(file.path),
            alt: file.name,
            title: file.name,
            width: "64",
            height: "64",
            style: "object-fit:contain;max-width:64px;max-height:64px;cursor:pointer;"
          }
        });
        imgWrapper.onclick = () => {
          this.onSubmit(file.path);
          this.close();
        };
      });
    } else {
      contentEl.createDiv({ text: "No images found in Assets/notidian-file-explorer-data/images." });
    }

    // Divider
    contentEl.createEl("hr");

    // Upload new image button
    const uploadBtn = contentEl.createEl("button", { text: "Upload New Image" });
    uploadBtn.onclick = () => {
      // Create a hidden file input
      const fileInput = createEl("input", {
        type: "file",
        attr: {
          accept: "image/png, image/jpeg, image/gif, image/svg+xml, image/webp",
          style: "display:none;"
        }
      });
      document.body.appendChild(fileInput);
      fileInput.onchange = (event) => {
        const files = (event.target as HTMLInputElement).files;
        if (!files || files.length === 0) {
          document.body.removeChild(fileInput);
          return;
        }
        const file = files[0];
        // Pass null for imagePath, and the File object for upload handling
        this.onSubmit(null, file);
        document.body.removeChild(fileInput);
        this.close();
      };
      fileInput.click();
    };

    // Optional: Cancel button
    const cancelBtn = contentEl.createEl("button", { text: "Cancel" });
    cancelBtn.style.marginLeft = "10px";
    cancelBtn.onclick = () => this.close();

    // Style grid (minimal, can be moved to CSS)
    const style = document.createElement("style");
    style.textContent = `
      .notidian-image-picker-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 12px;
      }
      .notidian-image-picker-item {
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        padding: 4px;
        background: var(--background-secondary);
        cursor: pointer;
        transition: box-shadow 0.2s;
      }
      .notidian-image-picker-item:hover {
        box-shadow: 0 0 0 2px var(--interactive-accent);
      }
    `;
    contentEl.appendChild(style);
  }

  onClose() {
    this.contentEl.empty();
  }
}