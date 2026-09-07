import JSZip from 'jszip';
import { FileView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { assertSafeZipDirectory, formatFileSize, getMediaPreviewKind } from './explorer-utils';

export const VIEW_TYPE_NOTIDIAN_MEDIA = 'notidian-media-preview-view';

const MAX_EPUB_SIZE = 40 * 1024 * 1024;
const MAX_METADATA_SIZE = 1024 * 1024;
const MAX_COVER_SIZE = 10 * 1024 * 1024;

export class MediaPreviewView extends FileView {
  private renderVersion = 0;
  private objectUrl: string | null = null;
  private loadedFont: FontFace | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('notidian-media-preview-view');
  }

  getViewType(): string {
    return VIEW_TYPE_NOTIDIAN_MEDIA;
  }

  getDisplayText(): string {
    return this.file?.name || 'File preview';
  }

  getIcon(): string {
    return 'scan-eye';
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.renderPreview(file);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.renderVersion++;
    this.clearContent();
    await super.onUnloadFile(file);
  }

  private clearContent(): void {
    this.contentEl.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => {
      media.pause();
      media.removeAttribute('src');
      media.load();
    });
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if (this.loadedFont) {
      (this.contentEl.ownerDocument.fonts as unknown as { delete: (font: FontFace) => boolean }).delete(this.loadedFont);
    }
    this.objectUrl = null;
    this.loadedFont = null;
    this.contentEl.empty();
  }

  private async renderPreview(file: TFile): Promise<void> {
    const version = ++this.renderVersion;
    this.clearContent();

    const toolbar = this.contentEl.createDiv({ cls: 'notidian-media-preview-toolbar' });
    toolbar.createDiv({ cls: 'notidian-media-preview-title', text: file.name });
    const openButton = toolbar.createEl('button', { attr: { type: 'button' } });
    setIcon(openButton, 'external-link');
    openButton.createSpan({ text: Platform.isDesktop ? 'Open externally' : 'Open original' });
    openButton.addEventListener('click', () => this.openExternally(file));

    const body = this.contentEl.createDiv({ cls: 'notidian-media-preview-body' });
    const kind = getMediaPreviewKind(file.extension);
    try {
      if (kind === 'epub') await this.renderEpub(file, body, version);
      else if (kind === 'audio') this.renderPlayback(file, body, 'audio');
      else if (kind === 'video') this.renderPlayback(file, body, 'video');
      else if (kind === 'font') await this.renderFont(file, body, version);
      else this.renderGeneric(file, body, kind);
    } catch (error) {
      if (version !== this.renderVersion) return;
      console.error(`[Notidian Explorer] File preview failed for ${file.path}:`, error);
      body.empty();
      this.renderGeneric(file, body, kind, error instanceof Error ? error.message : 'Preview unavailable.');
    }
  }

  private renderPlayback(file: TFile, body: HTMLElement, kind: 'audio' | 'video'): void {
    const media = body.createEl(kind, {
      cls: `notidian-media-preview-${kind}`,
      attr: { controls: '', preload: 'metadata', src: this.app.vault.getResourcePath(file) }
    });
    media.createSpan({ text: `This browser cannot play .${file.extension} files.` });
    this.renderMetadata(file, body, kind === 'audio' ? 'Audio' : 'Video');
  }

  private async renderFont(file: TFile, body: HTMLElement, version: number): Promise<void> {
    const font = new FontFace(`NotidianPreview${version}`, `url("${this.app.vault.getResourcePath(file)}")`);
    await font.load();
    if (version !== this.renderVersion) return;
    (this.contentEl.ownerDocument.fonts as unknown as { add: (font: FontFace) => void }).add(font);
    this.loadedFont = font;
    const sample = body.createDiv({ cls: 'notidian-media-preview-font' });
    sample.style.fontFamily = font.family;
    sample.createDiv({ text: 'Aa Bb Cc 123' });
    sample.createDiv({ text: 'The quick brown fox jumps over the lazy dog.' });
    this.renderMetadata(file, body, 'Font');
  }

  private renderGeneric(file: TFile, body: HTMLElement, kind: string, message?: string): void {
    const icon = body.createDiv({ cls: 'notidian-media-preview-icon' });
    setIcon(icon, kind === 'archive' ? 'archive' : kind === 'epub' ? 'book-open' : 'file');
    if (message) body.createDiv({ cls: 'notidian-media-preview-message', text: message });
    this.renderMetadata(file, body, kind === 'archive' ? 'Archive' : 'File');
  }

  private renderMetadata(file: TFile, body: HTMLElement, type: string, extra: Array<[string, string]> = []): void {
    const metadata = body.createEl('dl', { cls: 'notidian-media-preview-metadata' });
    for (const [label, value] of [
      ...extra,
      ['Type', `${type} (.${file.extension})`],
      ['Size', formatFileSize(file.stat.size)],
      ['Modified', new Date(file.stat.mtime).toLocaleString()],
      ['Location', file.parent?.path || '/']
    ]) {
      metadata.createEl('dt', { text: label });
      metadata.createEl('dd', { text: value });
    }
  }

  private async renderEpub(file: TFile, body: HTMLElement, version: number): Promise<void> {
    if (file.stat.size > MAX_EPUB_SIZE) throw new Error('This EPUB is too large for an in-app preview.');
    const data = await this.app.vault.readBinary(file);
    assertSafeZipDirectory(data, 3000);
    const archive = await JSZip.loadAsync(data);
    const container = await this.readZipText(archive.file('META-INF/container.xml'), MAX_METADATA_SIZE);
    const containerXml = new DOMParser().parseFromString(container, 'application/xml');
    const packagePath = containerXml.querySelector('rootfile')?.getAttribute('full-path');
    if (!packagePath) throw new Error('Could not find this EPUB package metadata.');

    const packageXml = new DOMParser().parseFromString(
      await this.readZipText(archive.file(packagePath), MAX_METADATA_SIZE),
      'application/xml'
    );
    if (version !== this.renderVersion) return;

    const metadataValue = (name: string) => packageXml.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() || '';
    const title = metadataValue('title') || file.basename;
    const author = metadataValue('creator');
    const publisher = metadataValue('publisher');
    const language = metadataValue('language');
    const manifestItems = Array.from(packageXml.getElementsByTagNameNS('*', 'item'));
    const coverId = Array.from(packageXml.getElementsByTagNameNS('*', 'meta'))
      .find(meta => meta.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = manifestItems.find(item => item.getAttribute('properties')?.split(/\s+/).includes('cover-image'))
      || manifestItems.find(item => coverId && item.getAttribute('id') === coverId);
    const coverHref = coverItem?.getAttribute('href');

    const hero = body.createDiv({ cls: 'notidian-epub-preview' });
    if (coverHref) {
      const coverPath = this.resolveArchivePath(packagePath, coverHref);
      const coverData = await this.readZipBytes(archive.file(coverPath), MAX_COVER_SIZE);
      if (version !== this.renderVersion) return;
      this.objectUrl = URL.createObjectURL(new Blob([coverData], { type: coverItem?.getAttribute('media-type') || 'image/jpeg' }));
      hero.createEl('img', { cls: 'notidian-epub-cover', attr: { src: this.objectUrl, alt: `Cover of ${title}` } });
    } else {
      const icon = hero.createDiv({ cls: 'notidian-media-preview-icon' });
      setIcon(icon, 'book-open');
    }
    const details = hero.createDiv({ cls: 'notidian-epub-details' });
    details.createEl('h1', { text: title });
    if (author) details.createEl('p', { cls: 'notidian-epub-author', text: author });
    this.renderMetadata(file, details, 'EPUB book', [
      ...(publisher ? [['Publisher', publisher] as [string, string]] : []),
      ...(language ? [['Language', language] as [string, string]] : [])
    ]);
  }

  private async readZipText(entry: JSZip.JSZipObject | null, maxSize: number): Promise<string> {
    return new TextDecoder().decode(await this.readZipBytes(entry, maxSize));
  }

  private async readZipBytes(entry: JSZip.JSZipObject | null, maxSize: number): Promise<Uint8Array> {
    if (!entry) throw new Error('This EPUB is missing required preview data.');
    return new Promise<Uint8Array>((resolve, reject) => {
      const stream = (entry as JSZip.JSZipObject & {
        internalStream: (type: 'uint8array') => JSZip.JSZipStreamHelper<Uint8Array>;
      }).internalStream('uint8array');
      const chunks: Uint8Array[] = [];
      let size = 0;
      let settled = false;
      stream.on('data', chunk => {
        size += chunk.byteLength;
        if (size > maxSize) {
          settled = true;
          stream.pause();
          reject(new Error('This EPUB preview resource is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', error => { if (!settled) reject(error); });
      stream.on('end', () => {
        if (settled) return;
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(data);
      });
      stream.resume();
    });
  }

  private resolveArchivePath(packagePath: string, href: string): string {
    const base = packagePath.slice(0, packagePath.lastIndexOf('/') + 1);
    const parts: string[] = [];
    for (const part of `${base}${decodeURIComponent(href.split('#')[0])}`.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }

  private openExternally(file: TFile): void {
    if (Platform.isDesktop) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const shell = require('electron').shell as { openPath: (path: string) => Promise<string> };
        const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
        if (basePath) {
          void shell.openPath(`${basePath}/${file.path}`).then(error => { if (error) new Notice(error); });
          return;
        }
      } catch {
        // Fall through to the vault resource URL.
      }
    }
    window.open(this.app.vault.getResourcePath(file));
  }
}
