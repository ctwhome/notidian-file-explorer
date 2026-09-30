type Embed = { id: string; type: string; locked?: boolean; isDeleted?: boolean };
type PointerState = {
  hit: { element: Embed | null; hasBeenDuplicated: boolean };
  drag: { hasOccurred: boolean };
  resize: { isResizing: boolean; handleType: string | false | null };
};
type PointerHook = (tool: { type: string }, state: PointerState, event: PointerEvent) => void;

export interface EmbedInteractionAPI {
  getAppState: () => { activeTool: { type: string } };
  onPointerDown: (callback: PointerHook) => () => void;
  onPointerUp: (callback: PointerHook) => () => void;
  updateScene: (scene: { appState: { activeEmbeddable: { element: Embed; state: 'active' }; selectedElementIds: Record<string, boolean> }; captureUpdate: 'NEVER' }) => void;
}

export function enableFullEmbedInteraction(api: EmbedInteractionAPI, host?: HTMLElement): () => void {
  let down: { state: PointerState; event: PointerEvent } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unmodified = (event: PointerEvent) => !event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey;
  let hovered: HTMLElement | null = null;
  const clearHover = () => {
    hovered?.classList.remove('notidian-embed-hover');
    hovered = null;
  };
  const onMove = (event: PointerEvent) => {
    clearHover();
    if (event.buttons || !unmodified(event) || api.getAppState().activeTool.type !== 'selection'
      || !(event.target as Element)?.matches('canvas.interactive')) return;
    const inners = Array.from(host!.querySelectorAll<HTMLElement>('.excalidraw__embeddable-container__inner'));
    for (const inner of inners.reverse()) {
      const style = inner.ownerDocument.defaultView!.getComputedStyle(inner);
      if (style.pointerEvents !== 'none') continue; // Active embeds already handle their own pointer input.
      const rect = inner.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(style.transform);
      const angle = Math.atan2(matrix.b, matrix.a);
      const width = inner.offsetWidth, height = inner.offsetHeight;
      const scale = rect.width / (width * Math.abs(Math.cos(angle)) + height * Math.abs(Math.sin(angle)));
      if (!scale || !Number.isFinite(scale)) continue;
      if (isInsideEmbed(event.clientX, event.clientY, rect.x + rect.width / 2, rect.y + rect.height / 2,
        width * scale, height * scale, angle)) {
        hovered = inner;
        inner.classList.add('notidian-embed-hover');
        break;
      }
    }
  };
  host?.addEventListener('pointermove', onMove);
  host?.addEventListener('pointerleave', clearHover);
  host?.addEventListener('pointerdown', clearHover);
  const offDown = api.onPointerDown((tool, state, event) => {
    clearHover();
    clearTimeout(timer);
    down = tool.type === 'selection' && event.button === 0 && unmodified(event)
      ? { state, event } : null;
  });
  const offUp = api.onPointerUp((tool, state, event) => {
    const start = down;
    down = null;
    const element = state.hit.element;
    if (!start || start.state !== state || tool.type !== 'selection' || !unmodified(event)
      || event.pointerId !== start.event.pointerId || event.button !== 0
      || event.timeStamp - start.event.timeStamp > 300
      || Math.hypot(event.clientX - start.event.clientX, event.clientY - start.event.clientY) > 4
      || state.drag.hasOccurred || state.resize.isResizing || state.resize.handleType
      || state.hit.hasBeenDuplicated || !element || element.locked || element.isDeleted
      || !['embeddable', 'iframe'].includes(element.type)) return;

    // Match Excalidraw's delay: the activation click must not also operate the embed.
    timer = setTimeout(() => {
      clearHover();
      api.updateScene({
        appState: { activeEmbeddable: { element, state: 'active' }, selectedElementIds: { [element.id]: true } },
        captureUpdate: 'NEVER'
      });
    }, 100);
  });
  return () => {
    clearTimeout(timer); down = null; offDown(); offUp(); clearHover();
    host?.removeEventListener('pointermove', onMove);
    host?.removeEventListener('pointerleave', clearHover);
    host?.removeEventListener('pointerdown', clearHover);
  };
}

export function isInsideEmbed(x: number, y: number, cx: number, cy: number, width: number, height: number, angle: number): boolean {
  const dx = x - cx, dy = y - cy;
  return Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) <= width / 2
    && Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle)) <= height / 2;
}
