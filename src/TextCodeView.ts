import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { javascript as javascriptLanguage } from '@codemirror/lang-javascript';
import { c, cpp, java } from '@codemirror/legacy-modes/mode/clike';
import { css } from '@codemirror/legacy-modes/mode/css';
import { go } from '@codemirror/legacy-modes/mode/go';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { python } from '@codemirror/legacy-modes/mode/python';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { tags } from '@lezer/highlight';
import { TextFileView, TFile, WorkspaceLeaf } from 'obsidian';
import { getCodeLanguage } from './explorer-utils';

export const VIEW_TYPE_NOTIDIAN_TEXT_CODE = 'notidian-text-code-view';

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--code-comment)' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-value)' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--code-important)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--code-operator)' }
]);

export class TextCodeView extends TextFileView {
  private editor: EditorView;
  private extension = '';
  private filename = 'Text file';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass('notidian-text-code-view');
    this.editor = new EditorView({ state: this.createState(''), parent: this.contentEl });
    this.register(() => this.editor.destroy());
  }

  getViewType(): string {
    return VIEW_TYPE_NOTIDIAN_TEXT_CODE;
  }

  getDisplayText(): string {
    return this.file?.name || 'Text file';
  }

  getIcon(): string {
    return 'file-code-2';
  }

  getViewData(): string {
    return this.editor.state.doc.toString();
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.extension = file.extension;
    this.filename = file.name;
    await super.onLoadFile(file);
  }

  setViewData(data: string): void {
    this.editor.setState(this.createState(data));
  }

  clear(): void {
    this.editor.setState(this.createState(''));
  }

  private createState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        syntaxHighlighting(highlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ 'aria-label': `${this.filename} editor` }),
        EditorView.updateListener.of(update => { if (update.docChanged) this.requestSave(); }),
        this.getLanguageExtension(this.extension)
      ]
    });
  }

  private getLanguageExtension(extension: string): Extension {
    const normalizedExtension = extension.toLocaleLowerCase();
    switch (getCodeLanguage(normalizedExtension)) {
      case 'javascript':
        return javascriptLanguage({
          jsx: normalizedExtension === 'jsx' || normalizedExtension === 'tsx',
          typescript: normalizedExtension === 'ts' || normalizedExtension === 'tsx'
        });
      case 'xml': return StreamLanguage.define(normalizedExtension === 'html' ? html : xml);
      case 'css': return StreamLanguage.define(css);
      case 'python': return StreamLanguage.define(python);
      case 'yaml': return StreamLanguage.define(yaml);
      case 'sql': return StreamLanguage.define(standardSQL);
      case 'shell': return StreamLanguage.define(shell);
      case 'ruby': return StreamLanguage.define(ruby);
      case 'go': return StreamLanguage.define(go);
      case 'rust': return StreamLanguage.define(rust);
      case 'c': return StreamLanguage.define(c);
      case 'cpp': return StreamLanguage.define(cpp);
      case 'java': return StreamLanguage.define(java);
      case 'properties': return StreamLanguage.define(properties);
      case 'toml': return StreamLanguage.define(toml);
      case 'tex': return StreamLanguage.define(stex);
      default: return [];
    }
  }
}
