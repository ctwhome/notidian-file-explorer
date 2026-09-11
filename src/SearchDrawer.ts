import { App, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { focusSearchInput, getSearchResultDestination, getTextSearchMatch, isAssetPath, shouldRestoreSearchFocus } from './explorer-utils';

const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'sql', 'log', 'ini', 'conf', 'env', 'tex', 'canvas', 'base'
]);

interface SearchResult {
  file: TFile;
  score: number;
  excerpt: string;
}

export class SearchDrawer {
  private files: TFile[] = [];
  private results: SearchResult[] = [];
  private selectedIndex = -1;
  private panelEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private previewMountEl: HTMLElement | null = null;
  private previewTabsEl: HTMLElement | null = null;
  private previewPlaceholder: Comment | null = null;
  private originalLeaf: WorkspaceLeaf | null = null;
  private previewLeaf: WorkspaceLeaf | null = null;
  private previewedFile: TFile | null = null;
  private contentCache = new Map<string, string>();
  private readsInFlight = new Map<string, Promise<string>>();
  private searchTimeout: number | null = null;
  private searchVersion = 0;
  private keepPreview = false;
  private closed = false;
  private previewQueue: Promise<void> = Promise.resolve();
  private searchPromise: Promise<void> = Promise.resolve();
  private previewInteractionAllowed = false;
  private searchScope: 'files' | 'assets' = 'files';
  private preserveScopeTabFocus = false;

  constructor(private app: App, private exclusionPatterns: string, private openResultsInNewTab: boolean, private onClosed: () => void) {}

  open(): void {
    if (Platform.isMobile) {
      new Notice('Native search preview is currently available on desktop only.');
      this.close();
      return;
    }
    this.originalLeaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    if (!this.originalLeaf) {
      new Notice('Open a workspace pane before searching.');
      this.close();
      return;
    }

    const document = this.originalLeaf.view.containerEl.ownerDocument;
    this.containerEl = document.body.createDiv({ cls: 'modal-container notidian-search-drawer-container' });
    const backdrop = this.containerEl.createDiv({ cls: 'modal-bg' });
    backdrop.addEventListener('click', () => this.close());
    const modalEl = this.containerEl.createDiv({
      cls: 'modal notidian-search-drawer-modal',
      attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search vault' }
    });
    this.panelEl = modalEl.createDiv({ cls: 'modal-content notidian-search-drawer-panel' });
    this.previewMountEl = modalEl.createDiv({ cls: 'notidian-search-drawer-preview' });
    this.panelEl.addEventListener('pointerdown', () => {
      this.previewInteractionAllowed = false;
      this.preserveScopeTabFocus = false;
    }, true);
    this.previewMountEl.addEventListener('pointerdown', () => { this.previewInteractionAllowed = true; }, true);
    this.previewMountEl.addEventListener('focusin', () => {
      if (shouldRestoreSearchFocus(this.previewInteractionAllowed)) this.restoreControlFocus();
    });
    this.panelEl.addEventListener('keydown', event => {
      if (event.key === 'Tab' && !event.shiftKey && event.target === this.inputEl) this.previewInteractionAllowed = true;
    });

    const header = this.panelEl.createDiv({ cls: 'notidian-search-drawer-header' });
    header.createDiv({ cls: 'notidian-search-drawer-title', text: 'Search vault' });
    const closeButton = header.createEl('button', { attr: { type: 'button', 'aria-label': 'Close search drawer' } });
    setIcon(closeButton, 'x');
    closeButton.addEventListener('click', () => this.close());

    const searchBox = this.panelEl.createDiv({ cls: 'notidian-search-drawer-input' });
    setIcon(searchBox.createSpan(), 'search');
    this.inputEl = searchBox.createEl('input', {
      attr: {
        type: 'search',
        placeholder: 'Search files and contents...',
        'aria-label': 'Search files and contents',
        role: 'combobox',
        'aria-controls': 'notidian-search-results',
        'aria-expanded': 'true',
        'aria-autocomplete': 'list'
      }
    });
    const scopeTabs = this.panelEl.createDiv({ cls: 'notidian-search-scope-tabs', attr: { role: 'tablist', 'aria-label': 'Search scope' } });
    const tabs = ([['files', 'Files'], ['assets', 'Assets']] as const).map(([scope, label]) => {
      const button = scopeTabs.createEl('button', {
        text: label,
        cls: scope === 'files' ? 'is-active' : '',
        attr: {
          type: 'button',
          role: 'tab',
          'aria-controls': 'notidian-search-results',
          'aria-selected': String(scope === 'files'),
          tabindex: scope === 'files' ? '0' : '-1'
        }
      });
      button.addEventListener('click', () => setScope(scope));
      return { scope, button };
    });
    const setScope = (scope: 'files' | 'assets') => {
      this.searchScope = scope;
      this.preserveScopeTabFocus = true;
      tabs.forEach(tab => {
        const active = tab.scope === scope;
        tab.button.setAttribute('aria-selected', String(active));
        tab.button.tabIndex = active ? 0 : -1;
        tab.button.toggleClass('is-active', active);
      });
      this.results = [];
      this.resultsEl?.empty();
      this.statusEl?.setText('Searching...');
      this.clearPreview();
      this.searchPromise = this.search(this.inputEl?.value || '');
    };
    scopeTabs.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setScope(this.searchScope === 'files' ? 'assets' : 'files');
      tabs.find(tab => tab.scope === this.searchScope)?.button.focus();
    });
    this.statusEl = this.panelEl.createDiv({ cls: 'notidian-search-drawer-status', attr: { 'aria-live': 'polite' } });
    this.resultsEl = this.panelEl.createDiv({
      cls: 'notidian-search-drawer-results',
      attr: { id: 'notidian-search-results', role: 'listbox' }
    });
    this.panelEl.createDiv({ cls: 'notidian-search-drawer-hint', text: '↑↓ Preview  ·  Click preview to interact  ·  Enter Open  ·  Esc Close' });

    const excluded = this.exclusionPatterns.split('\n').map(pattern => pattern.trim().toLocaleLowerCase()).filter(Boolean);
    this.files = this.app.vault.getFiles()
      .filter(file => !excluded.some(pattern => file.path.toLocaleLowerCase().includes(pattern)))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    this.inputEl.addEventListener('input', () => {
      this.preserveScopeTabFocus = false;
      if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.searchTimeout = null;
        this.searchPromise = this.search(this.inputEl?.value || '');
      }, 140);
    });
    this.panelEl.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if ((event.target as HTMLElement).closest('.notidian-search-scope-tabs')) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        void this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void this.keepSelectedOpen();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    this.searchPromise = this.search('');
    window.setTimeout(() => this.focusSearch(), 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.searchVersion++;
    if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
    this.restorePreviewTabs();
    this.containerEl?.remove();

    if (this.keepPreview && this.previewLeaf) {
      void this.app.workspace.revealLeaf(this.previewLeaf);
    } else {
      this.previewLeaf?.detach();
      if (this.originalLeaf) void this.app.workspace.revealLeaf(this.originalLeaf);
    }
    this.panelEl = null;
    this.containerEl = null;
    this.previewMountEl = null;
    this.previewLeaf = null;
    this.onClosed();
  }

  focusSearch(): void {
    this.previewInteractionAllowed = false;
    this.preserveScopeTabFocus = false;
    focusSearchInput(this.inputEl);
  }

  private restoreControlFocus(): void {
    if (this.preserveScopeTabFocus) {
      this.panelEl?.querySelector<HTMLElement>('.notidian-search-scope-tabs button.is-active')?.focus();
    } else {
      focusSearchInput(this.inputEl);
    }
  }

  private clearPreview(): void {
    this.previewedFile = null;
    this.restorePreviewTabs();
    this.previewLeaf?.detach();
    this.previewLeaf = null;
  }

  private async readFile(file: TFile): Promise<string> {
    const cached = this.contentCache.get(file.path);
    if (cached !== undefined) {
      this.contentCache.delete(file.path);
      this.contentCache.set(file.path, cached);
      return cached;
    }

    const existingRead = this.readsInFlight.get(file.path);
    if (existingRead) return existingRead;
    const read = this.app.vault.cachedRead(file).then(content => {
      this.contentCache.set(file.path, content);
      if (this.contentCache.size > 120) {
        const oldestPath = this.contentCache.keys().next().value;
        if (oldestPath) this.contentCache.delete(oldestPath);
      }
      return content;
    }).finally(() => this.readsInFlight.delete(file.path));
    this.readsInFlight.set(file.path, read);
    return read;
  }

  private async search(query: string): Promise<void> {
    if (!this.statusEl) return;
    const version = ++this.searchVersion;
    const normalizedQuery = query.trim();
    this.statusEl.setText(normalizedQuery.length === 1 ? 'Filename matches · type 2+ characters to search contents' : normalizedQuery ? 'Searching...' : 'Type to search');

    if (!normalizedQuery) {
      this.results = [];
      this.renderResults(0, 'Type to search');
      if (this.preserveScopeTabFocus) this.restoreControlFocus();
      else this.focusSearch();
      return;
    }

    const matches: SearchResult[] = [];
    const scopedFiles = this.files.filter(file => this.searchScope === 'assets' ? isAssetPath(file.path) : !isAssetPath(file.path));
    let nextFile = 0;
    const worker = async () => {
      while (version === this.searchVersion && nextFile < scopedFiles.length) {
        const file = scopedFiles[nextFile++];
        let match = getTextSearchMatch(file.path, '', normalizedQuery);
        if (!match && normalizedQuery.length > 1 && TEXT_EXTENSIONS.has(file.extension.toLocaleLowerCase())) {
          try {
            match = getTextSearchMatch(file.path, await this.readFile(file), normalizedQuery);
          } catch {
            match = null;
          }
        }
        if (match) matches.push({ file, ...match });
      }
    };

    await Promise.all(Array.from({ length: Math.min(8, scopedFiles.length) }, worker));
    if (version !== this.searchVersion) return;
    matches.sort((a, b) => a.score - b.score || b.file.stat.mtime - a.file.stat.mtime);
    this.results = matches.slice(0, 200);
    this.renderResults(matches.length);
  }

  private renderResults(total = this.results.length, emptyStatus = 'No matches'): void {
    if (!this.resultsEl || !this.statusEl) return;
    this.resultsEl.empty();
    this.selectedIndex = this.results.length ? 0 : -1;
    this.statusEl.setText(this.results.length ? `${this.results.length}${total > this.results.length ? ` of ${total}` : ''} results` : emptyStatus);

    this.results.forEach((result, index) => {
      const item = this.resultsEl?.createEl('button', {
        cls: `notidian-search-result${index === 0 ? ' is-selected' : ''}`,
        attr: {
          id: `notidian-search-result-${index}`,
          type: 'button',
          role: 'option',
          tabindex: '-1',
          'aria-selected': index === 0 ? 'true' : 'false'
        }
      });
      if (!item) return;
      item.createDiv({ cls: 'notidian-search-result-name', text: result.file.name });
      item.createDiv({ cls: 'notidian-search-result-path', text: result.file.parent?.path || '/' });
      item.createDiv({ cls: 'notidian-search-result-excerpt', text: result.excerpt });
      item.addEventListener('click', () => void this.selectResult(index, false));
      item.addEventListener('dblclick', () => void this.selectResult(index, false).then(() => this.keepSelectedOpen()));
    });

    if (this.selectedIndex === -1) {
      this.inputEl?.removeAttribute('aria-activedescendant');
      this.clearPreview();
    } else {
      void this.selectResult(0, true);
    }
  }

  private async moveSelection(change: number): Promise<void> {
    if (!this.results.length) return;
    const index = Math.max(0, Math.min(this.results.length - 1, this.selectedIndex + change));
    await this.selectResult(index, true);
  }

  private async selectResult(index: number, keepSearchFocus: boolean): Promise<void> {
    const result = this.results[index];
    const searchVersion = this.searchVersion;
    if (!result || !this.resultsEl || !this.originalLeaf) return;
    this.selectedIndex = index;
    Array.from(this.resultsEl.children).forEach((item, itemIndex) => {
      item.toggleClass('is-selected', itemIndex === index);
      item.setAttribute('aria-selected', itemIndex === index ? 'true' : 'false');
    });
    this.inputEl?.setAttribute('aria-activedescendant', `notidian-search-result-${index}`);
    (this.resultsEl.children[index] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });

    const originalLeaf = this.originalLeaf;
    this.previewedFile = null;
    this.previewQueue = this.previewQueue.then(async () => {
      if (this.closed || searchVersion !== this.searchVersion || this.results[index] !== result || this.selectedIndex !== index) return;
      try {
        const previewLeaf = this.previewLeaf ??= this.app.workspace.createLeafBySplit(originalLeaf, 'vertical');
        const previewMountEl = this.previewMountEl;
        if (!this.previewTabsEl && previewMountEl) {
          const tabsEl = (previewLeaf.parent as unknown as { containerEl: HTMLElement }).containerEl;
          const placeholder = previewMountEl.ownerDocument.createComment('notidian-search-preview');
          tabsEl.before(placeholder);
          tabsEl.addClass('notidian-search-embedded-editor');
          previewMountEl.appendChild(tabsEl);
          this.previewTabsEl = tabsEl;
          this.previewPlaceholder = placeholder;
        }
        await previewLeaf.openFile(result.file, { active: false });
        if (searchVersion === this.searchVersion && this.results[index] === result && this.selectedIndex === index) this.previewedFile = result.file;
      } catch {
        if (!this.closed) new Notice(`Could not preview ${result.file.name}.`);
      } finally {
        if (keepSearchFocus && !this.closed && searchVersion === this.searchVersion && shouldRestoreSearchFocus(this.previewInteractionAllowed)) this.restoreControlFocus();
      }
    });
    await this.previewQueue;
  }

  private async keepSelectedOpen(): Promise<void> {
    if (this.searchTimeout !== null) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
      this.searchPromise = this.search(this.inputEl?.value || '');
    }
    await this.searchPromise;
    if (this.selectedIndex === -1) return;
    await this.previewQueue;
    if (!this.previewedFile) return;
    if (getSearchResultDestination(this.openResultsInNewTab) === 'new') {
      this.keepPreview = true;
    } else if (this.originalLeaf) {
      await this.originalLeaf.openFile(this.previewedFile);
    }
    this.close();
  }

  private restorePreviewTabs(): void {
    if (this.previewTabsEl && this.previewPlaceholder?.parentNode) {
      this.previewTabsEl.removeClass('notidian-search-embedded-editor');
      this.previewPlaceholder.replaceWith(this.previewTabsEl);
    }
    this.previewTabsEl = null;
    this.previewPlaceholder = null;
  }
}
