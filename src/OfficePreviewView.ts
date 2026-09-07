import { renderAsync } from 'docx-preview';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { FileView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { assertSafeZipDirectory, getOfficePreviewKind } from './explorer-utils';

export const VIEW_TYPE_NOTIDIAN_OFFICE = 'notidian-office-preview-view';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 3000;

export class OfficePreviewView extends FileView {
  private renderVersion = 0;
  private objectUrls: string[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('notidian-office-preview-view');
  }

  getViewType(): string {
    return VIEW_TYPE_NOTIDIAN_OFFICE;
  }

  getDisplayText(): string {
    return this.file?.name || 'Office preview';
  }

  getIcon(): string {
    return 'file-chart-column-increasing';
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
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.contentEl.empty();
  }

  private async renderPreview(file: TFile): Promise<void> {
    const version = ++this.renderVersion;
    const renderUrls: string[] = [];
    this.clearContent();

    const toolbar = this.contentEl.createDiv({ cls: 'notidian-office-preview-toolbar' });
    toolbar.createDiv({ cls: 'notidian-office-preview-title', text: file.name });
    const actions = toolbar.createDiv({ cls: 'notidian-office-preview-actions' });
    const refreshButton = actions.createEl('button', { attr: { type: 'button', 'aria-label': 'Refresh Office preview' } });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.createSpan({ text: 'Refresh' });
    refreshButton.addEventListener('click', () => void this.renderPreview(file));
    const openButton = actions.createEl('button', { attr: { type: 'button' } });
    setIcon(openButton, 'external-link');
    openButton.createSpan({ text: Platform.isDesktop ? 'Open externally' : 'Open original' });
    openButton.addEventListener('click', () => this.openExternally(file));

    const statusEl = this.contentEl.createDiv({
      cls: 'notidian-office-preview-status',
      text: 'Loading preview...',
      attr: { role: 'status', 'aria-live': 'polite' }
    });
    const previewEl = this.contentEl.createDiv({ cls: 'notidian-office-preview-document' });
    const previewKind = getOfficePreviewKind(file.extension);
    if (!previewKind) {
      statusEl.setText(`Preview is unavailable for legacy .${file.extension} files. Convert it to the newer Office format or open the original.`);
      return;
    }

    try {
      if (file.stat.size > MAX_FILE_SIZE) throw new Error('This file is too large for an in-app preview.');
      const data = await this.app.vault.readBinary(file);
      const archive = file.extension.toLocaleLowerCase() === 'xls' ? null : await this.loadSafeArchive(data, () => version !== this.renderVersion);
      if (version !== this.renderVersion) return;

      if (previewKind === 'document') {
        const compact = previewEl.clientWidth < 700;
        await renderAsync(data, previewEl, undefined, {
          breakPages: true,
          ignoreWidth: compact,
          ignoreHeight: compact,
          ignoreLastRenderedPageBreak: false,
          renderAltChunks: false,
          useBase64URL: true
        });
      } else if (previewKind === 'spreadsheet') {
        this.renderSpreadsheet(data, previewEl);
      } else if (archive) {
        await this.renderPresentation(archive, previewEl, renderUrls, version);
      }

      if (version !== this.renderVersion) {
        renderUrls.forEach(url => URL.revokeObjectURL(url));
        return;
      }
      this.objectUrls = renderUrls;
      statusEl.remove();
    } catch (error) {
      renderUrls.forEach(url => URL.revokeObjectURL(url));
      if (version !== this.renderVersion) return;
      console.error(`[Notidian Explorer] Office preview failed for ${file.path}:`, error);
      previewEl.empty();
      statusEl.setText(error instanceof Error ? error.message : 'Could not render this Office file.');
    }
  }

  private async loadSafeArchive(data: ArrayBuffer, isCancelled: () => boolean): Promise<JSZip> {
    assertSafeZipDirectory(data, MAX_ARCHIVE_ENTRIES);
    const archive = await JSZip.loadAsync(data);
    const entries = Object.values(archive.files);
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error('This Office archive is too large for a safe in-app preview.');
    }

    let uncompressedSize = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      await new Promise<void>((resolve, reject) => {
        const stream = (entry as typeof entry & {
          internalStream: (type: 'uint8array') => JSZip.JSZipStreamHelper<Uint8Array>;
        }).internalStream('uint8array');
        let settled = false;
        stream.on('data', chunk => {
          uncompressedSize += chunk.byteLength;
          if (!settled && (isCancelled() || uncompressedSize > MAX_ARCHIVE_SIZE)) {
            settled = true;
            stream.pause();
            reject(new Error(isCancelled() ? 'Preview cancelled.' : 'This Office archive is too large for a safe in-app preview.'));
          }
        });
        stream.on('error', error => { if (!settled) reject(error); });
        stream.on('end', () => { if (!settled) resolve(); });
        stream.resume();
      });
    }
    return archive;
  }

  private renderSpreadsheet(data: ArrayBuffer, containerEl: HTMLElement): void {
    const workbook = XLSX.read(data, { type: 'array', sheetRows: 201 });
    const tabsEl = containerEl.createDiv({ cls: 'notidian-office-sheet-tabs', attr: { role: 'tablist' } });
    const sheetEl = containerEl.createDiv({ cls: 'notidian-office-sheet' });

    const renderSheet = (name: string) => {
      tabsEl.querySelectorAll('button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.sheet === name)));
      sheetEl.empty();
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '' });
      const table = sheetEl.createEl('table');
      rows.slice(0, 200).forEach(row => {
        const tr = table.createEl('tr');
        row.slice(0, 30).forEach(value => tr.createEl('td', { text: String(value) }));
      });
      if (rows.length > 200) sheetEl.createDiv({ cls: 'notidian-office-preview-limit', text: 'Showing the first 200 rows.' });
    };

    workbook.SheetNames.forEach((name, index) => {
      const button = tabsEl.createEl('button', {
        text: name,
        attr: { type: 'button', role: 'tab', 'data-sheet': name, 'aria-selected': String(index === 0) }
      });
      button.addEventListener('click', () => renderSheet(name));
      if (index === 0) renderSheet(name);
    });
  }

  private async renderPresentation(archive: JSZip, containerEl: HTMLElement, renderUrls: string[], version: number): Promise<void> {
    const slides = Object.keys(archive.files)
      .map(name => ({ name, match: name.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
      .filter((slide): slide is { name: string; match: RegExpMatchArray } => !!slide.match)
      .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
    const parser = new DOMParser();
    const urlByPath = new Map<string, string>();

    for (const slide of slides) {
      const number = Number(slide.match[1]);
      const xmlText = await archive.file(slide.name)?.async('text');
      if (version !== this.renderVersion) throw new Error('Preview cancelled.');
      if (!xmlText) continue;
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const slideEl = containerEl.createEl('section', { cls: 'notidian-office-slide' });
      slideEl.createEl('h2', { text: `Slide ${number}` });

      const relationshipText = await archive.file(`ppt/slides/_rels/slide${number}.xml.rels`)?.async('text');
      if (version !== this.renderVersion) throw new Error('Preview cancelled.');
      if (relationshipText) {
        const relationships = parser.parseFromString(relationshipText, 'application/xml');
        const imageTargets = Array.from(relationships.getElementsByTagName('Relationship'))
          .filter(relationship => relationship.getAttribute('Type')?.endsWith('/image'))
          .map(relationship => relationship.getAttribute('Target')?.replace(/^\.\.\//, 'ppt/'))
          .filter((target): target is string => !!target);
        if (imageTargets.length) {
          const imagesEl = slideEl.createDiv({ cls: 'notidian-office-slide-images' });
          for (const target of imageTargets) {
            const image = archive.file(target);
            if (!image) continue;
            let url = urlByPath.get(target);
            if (!url) {
              const blob = await image.async('blob');
              if (version !== this.renderVersion) throw new Error('Preview cancelled.');
              url = URL.createObjectURL(blob);
              renderUrls.push(url);
              urlByPath.set(target, url);
            }
            imagesEl.createEl('img', { attr: { src: url, alt: '' } });
          }
        }
      }

      const text = Array.from(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't'))
        .map(node => node.textContent?.trim())
        .filter((value): value is string => !!value)
        .join(' ');
      slideEl.createEl('p', { text: text || 'No text on this slide.' });
    }
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
