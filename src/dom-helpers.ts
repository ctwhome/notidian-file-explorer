import { App, MarkdownView } from 'obsidian';

// --- Click and Drag Scrolling ---

let isDragging = false;
let startX = 0;
let scrollLeftStart = 0;

function handleMouseDown(e: MouseEvent, containerEl: HTMLElement) {
  const targetElement = e.target as HTMLElement;
  if (e.button !== 0 || targetElement.closest('.notidian-file-explorer-item')) {
    return;
  }
  isDragging = true;
  startX = e.clientX;
  scrollLeftStart = containerEl.scrollLeft;
  // containerEl.style.cursor = 'grabbing';
  containerEl.style.userSelect = 'none';
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent, containerEl: HTMLElement) {
  if (!isDragging) return;
  const x = e.clientX;
  const walk = (x - startX);
  containerEl.scrollLeft = scrollLeftStart - walk;
}

function stopDragging(containerEl: HTMLElement) {
  if (!isDragging) return;
  isDragging = false;
  // containerEl.style.cursor = 'pointer';
  containerEl.style.removeProperty('user-select');
}

export function addDragScrolling(containerEl: HTMLElement) {
  const mouseDownHandler = (e: MouseEvent) => handleMouseDown(e, containerEl);
  const mouseMoveHandler = (e: MouseEvent) => handleMouseMove(e, containerEl);
  const stopDraggingHandler = () => stopDragging(containerEl);

  containerEl.addEventListener('mousedown', mouseDownHandler);
  // Attach move/up listeners to the window to catch events outside the container
  window.addEventListener('mousemove', mouseMoveHandler);
  window.addEventListener('mouseup', stopDraggingHandler);
  // Also stop if mouse leaves the window entirely
  document.addEventListener('mouseleave', stopDraggingHandler);

  // containerEl.style.cursor = 'pointer';

  // Return a cleanup function to remove listeners
  return () => {
    containerEl.removeEventListener('mousedown', mouseDownHandler);
    window.removeEventListener('mousemove', mouseMoveHandler);
    window.removeEventListener('mouseup', stopDraggingHandler);
    document.removeEventListener('mouseleave', stopDraggingHandler);
    // containerEl.style.cursor = 'pointer'; // Reset cursor
    console.log("Drag scrolling listeners removed.");
  };
}

// --- Inline Title Focus (Experimental) ---

export function attemptInlineTitleFocus(app: App) {
  setTimeout(() => {
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const editorContainer = activeView.containerEl;
      const inlineTitleEl = editorContainer.querySelector('.inline-title, .view-header-title-container input') as HTMLElement | null;
      if (inlineTitleEl) {
        console.log("Found potential inline title element, attempting focus/click/select:", inlineTitleEl);
        inlineTitleEl.focus();
        inlineTitleEl.click();
        // Attempt to select the text
        const range = document.createRange();
        range.selectNodeContents(inlineTitleEl);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
          console.log("Attempted to select inline title text.");
        }
      } else {
        console.warn("Could not find inline title element via selectors .inline-title or .view-header-title-container input.");
      }
    } else {
      console.warn("Could not get active MarkdownView shortly after opening note for title focus.");
    }
  }, 250); // Delay might need adjustment
}