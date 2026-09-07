import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { HTML_PREVIEW_CSP } from './explorer-utils';

export const VIEW_TYPE_NOTIDIAN_HTML = 'notidian-html-preview-view';

export class HtmlPreviewView extends TextFileView {
  private html = '';
  private iframe: HTMLIFrameElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('notidian-html-preview-view');
    this.iframe = this.contentEl.createEl('iframe', {
      cls: 'notidian-html-preview-frame',
      attr: { sandbox: '', referrerpolicy: 'no-referrer', title: 'HTML preview' }
    });
  }

  getViewType(): string {
    return VIEW_TYPE_NOTIDIAN_HTML;
  }

  getDisplayText(): string {
    return this.file?.name || 'HTML preview';
  }

  getIcon(): string {
    return 'file-code-2';
  }

  getViewData(): string {
    return this.html;
  }

  setViewData(data: string): void {
    this.html = data;
    const document = new DOMParser().parseFromString(data, 'text/html');
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = HTML_PREVIEW_CSP;
    document.head.prepend(policy);
    this.iframe.srcdoc = `<!doctype html>${document.documentElement.outerHTML}`;
  }

  clear(): void {
    this.html = '';
    this.iframe.srcdoc = '';
  }
}
