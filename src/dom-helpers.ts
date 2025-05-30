import { App, MarkdownView } from 'obsidian';

// --- Click and Drag Scrolling ---

let isDragging = false;
let startX = 0;
let scrollLeftStart = 0;

// Function to check if horizontal scrolling is needed and update cursor
export function updateScrollCursor(containerEl: HTMLElement) {
  if (!containerEl) return;

  const hasHorizontalScroll = containerEl.scrollWidth > containerEl.clientWidth;

  if (hasHorizontalScroll) {
    containerEl.classList.add('has-horizontal-scroll');
  } else {
    containerEl.classList.remove('has-horizontal-scroll');
  }
}

function handleMouseDown(e: MouseEvent, containerEl: HTMLElement) {
  const targetElement = e.target as HTMLElement;

  // Don't start drag if clicking on items or if not left click
  if (e.button !== 0 || targetElement.closest('.notidian-file-explorer-item')) {
    return;
  }

  // More comprehensive check for valid drag targets
  const isValidDragTarget = targetElement === containerEl ||
    targetElement.classList.contains('notidian-file-explorer-column-content') ||
    targetElement.classList.contains('notidian-file-explorer-columns-wrapper') ||
    targetElement.classList.contains('notidian-file-explorer-column') ||
    targetElement.classList.contains('notidian-file-explorer-column-stats') ||
    // Also check if the target is within a valid drag area (event delegation)
    targetElement.closest('.notidian-file-explorer-columns-wrapper') === containerEl ||
    targetElement.closest('.notidian-file-explorer-column-content') !== null ||
    targetElement.closest('.notidian-file-explorer-column-stats') !== null;

  if (!isValidDragTarget) {
    return;
  }

  // Ensure we're not already dragging (defensive programming)
  if (isDragging) {
    stopDragging(containerEl);
  }

  isDragging = true;
  startX = e.clientX;
  scrollLeftStart = containerEl.scrollLeft;
  containerEl.classList.add('is-panning');
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
  containerEl.classList.remove('is-panning');
  containerEl.style.removeProperty('user-select');

  // Reset position tracking
  startX = 0;
  scrollLeftStart = 0;
}

export function addDragScrolling(containerEl: HTMLElement) {
  const mouseDownHandler = (e: MouseEvent) => handleMouseDown(e, containerEl);
  const mouseMoveHandler = (e: MouseEvent) => handleMouseMove(e, containerEl);
  const stopDraggingHandler = () => stopDragging(containerEl);

  // Initial scroll cursor check
  updateScrollCursor(containerEl);

  // Observer to watch for content changes that might affect scrollability
  const resizeObserver = new ResizeObserver(() => {
    updateScrollCursor(containerEl);
  });
  resizeObserver.observe(containerEl);

  // Also check when content changes (columns added/removed)
  const mutationObserver = new MutationObserver(() => {
    updateScrollCursor(containerEl);
  });
  mutationObserver.observe(containerEl, { childList: true, subtree: true });

  containerEl.addEventListener('mousedown', mouseDownHandler);
  // Attach move/up listeners to the window to catch events outside the container
  window.addEventListener('mousemove', mouseMoveHandler);
  window.addEventListener('mouseup', stopDraggingHandler);
  // Also stop if mouse leaves the window entirely
  document.addEventListener('mouseleave', stopDraggingHandler);

  // Add additional listeners to handle edge cases
  containerEl.addEventListener('mouseleave', stopDraggingHandler);
  containerEl.addEventListener('blur', stopDraggingHandler);

  // Return a cleanup function to remove listeners
  return () => {
    containerEl.removeEventListener('mousedown', mouseDownHandler);
    window.removeEventListener('mousemove', mouseMoveHandler);
    window.removeEventListener('mouseup', stopDraggingHandler);
    document.removeEventListener('mouseleave', stopDraggingHandler);
    containerEl.removeEventListener('mouseleave', stopDraggingHandler);
    containerEl.removeEventListener('blur', stopDraggingHandler);

    // Cleanup observers
    resizeObserver.disconnect();
    mutationObserver.disconnect();

    // Clean up any panning state and scroll class
    stopDragging(containerEl);
    containerEl.classList.remove('has-horizontal-scroll');
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