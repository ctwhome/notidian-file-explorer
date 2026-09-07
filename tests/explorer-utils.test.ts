import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_TEXT_EXTENSIONS, HTML_PREVIEW_CSP, HTML_PREVIEW_EXTENSIONS, MEDIA_PREVIEW_EXTENSIONS, OFFICE_EXTENSIONS, assertSafeZipDirectory, collapseSelectedPaths, filterMatches, focusSearchInput, formatFileSize, getCodeLanguage, getMediaPreviewKind, getOfficePreviewKind, getRenameParts, getTextSearchMatch, getUpdatedSelection, getValidNavigationPaths, shouldClearExplorerSelection, shouldHandleSelectionClick, shouldOpenFileOnClick, shouldRestoreSearchFocus, validateItemName } from '../src/explorer-utils';
import { FEATURE_SUMMARY } from '../src/feature-summary';

test('validateItemName rejects unsafe names', () => {
  assert.equal(validateItemName(''), 'Name cannot be empty.');
  assert.equal(validateItemName('bad/name'), 'Name contains invalid characters.');
  assert.equal(validateItemName('Good name'), null);
});

test('filterMatches ignores case and surrounding whitespace', () => {
  assert.equal(filterMatches('Project Notes.md', '  notes '), true);
  assert.equal(filterMatches('Project Notes.md', 'archive'), false);
});

test('getValidNavigationPaths stops at the first missing folder', () => {
  const existing = new Set(['/', 'Projects', 'Projects/Active']);
  assert.deepEqual(
    getValidNavigationPaths(['/', 'Projects', 'Projects/Active', 'Projects/Active/Missing'], path => existing.has(path)),
    ['/', 'Projects', 'Projects/Active']
  );
});

test('getRenameParts preserves ordinary and Excalidraw suffixes', () => {
  assert.deepEqual(getRenameParts('Report.csv', false), { name: 'Report', suffix: '.csv' });
  assert.deepEqual(getRenameParts('Sketch.excalidraw.md', false), { name: 'Sketch', suffix: '.excalidraw.md' });
  assert.deepEqual(getRenameParts('Projects', true), { name: 'Projects', suffix: '' });
});

test('getTextSearchMatch prioritizes names and returns a content excerpt', () => {
  assert.equal(getTextSearchMatch('Projects/Notes.md', 'Quarterly plans', '   '), null);
  assert.deepEqual(getTextSearchMatch('Projects/Roadmap.md', 'Quarterly plans', 'road'), {
    score: 0,
    excerpt: 'Projects/Roadmap.md'
  });
  assert.deepEqual(getTextSearchMatch('Projects/Notes.md', 'First line\nQuarterly roadmap details\nLast line', 'roadmap'), {
    score: 3,
    excerpt: 'Quarterly roadmap details'
  });
  assert.equal(getTextSearchMatch('Projects/Notes.md', 'Quarterly plans', 'missing'), null);
});

test('focusSearchInput preserves the query and selection', () => {
  let focused = false;
  const input = {
    value: 'la con',
    selectionStart: 6,
    selectionEnd: 6,
    focus: () => { focused = true; },
    select: () => assert.fail('must not select the query')
  };

  focusSearchInput(input);

  assert.equal(focused, true);
  assert.equal(input.value, 'la con');
  assert.equal(input.selectionStart, 6);
  assert.equal(input.selectionEnd, 6);
});

test('preview focus is restored only without pointer interaction', () => {
  assert.equal(shouldRestoreSearchFocus(false), true);
  assert.equal(shouldRestoreSearchFocus(true), false);
});

test('getUpdatedSelection supports replace, toggle, and ranges', () => {
  const paths = ['a.md', 'b.md', 'c.md', 'd.md'];
  assert.deepEqual(getUpdatedSelection(paths, ['a.md'], 'a.md', 'c.md', false, false), {
    selected: ['c.md'], anchor: 'c.md'
  });
  assert.deepEqual(getUpdatedSelection(paths, ['a.md'], 'a.md', 'c.md', true, false), {
    selected: ['a.md', 'c.md'], anchor: 'c.md'
  });
  assert.deepEqual(getUpdatedSelection(paths, ['a.md', 'c.md'], 'c.md', 'a.md', true, false), {
    selected: ['c.md'], anchor: 'a.md'
  });
  assert.deepEqual(getUpdatedSelection(paths, ['d.md'], 'b.md', 'd.md', false, true), {
    selected: ['b.md', 'c.md', 'd.md'], anchor: 'b.md'
  });
});

test('collapseSelectedPaths removes descendants of selected folders', () => {
  assert.deepEqual(
    collapseSelectedPaths(['Projects', 'Projects/Note.md', 'Archive.md', 'Projects/Subfolder']),
    ['Projects', 'Archive.md']
  );
});

test('shouldOpenFileOnClick only opens an unmodified single click', () => {
  assert.equal(shouldOpenFileOnClick(0, false, false, false), true);
  assert.equal(shouldOpenFileOnClick(1, false, false, false), true);
  assert.equal(shouldOpenFileOnClick(2, false, false, false), false);
  assert.equal(shouldOpenFileOnClick(1, true, false, false), false);
  assert.equal(shouldOpenFileOnClick(1, false, true, false), false);
  assert.equal(shouldOpenFileOnClick(1, false, false, true), false);
});

test('shouldHandleSelectionClick ignores the second click of a double-click', () => {
  assert.equal(shouldHandleSelectionClick(0), true);
  assert.equal(shouldHandleSelectionClick(1), true);
  assert.equal(shouldHandleSelectionClick(2), false);
});

test('shouldClearExplorerSelection only clears outside items', () => {
  assert.equal(shouldClearExplorerSelection(false), true);
  assert.equal(shouldClearExplorerSelection(true), false);
});

test('CODE_TEXT_EXTENSIONS includes code files without overriding native views', () => {
  assert.equal(CODE_TEXT_EXTENSIONS.includes('json'), true);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('js'), true);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('xml'), true);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('html'), false);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('md'), false);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('canvas'), false);
  assert.equal(CODE_TEXT_EXTENSIONS.includes('base'), false);
});

test('HTML_PREVIEW_EXTENSIONS routes web documents to rendered previews', () => {
  assert.deepEqual(HTML_PREVIEW_EXTENSIONS, ['html', 'htm']);
});

test('HTML preview policy blocks scripts and outbound requests', () => {
  assert.match(HTML_PREVIEW_CSP, /default-src 'none'/);
  assert.match(HTML_PREVIEW_CSP, /form-action 'none'/);
});

test('media preview routing covers books, playback, archives, fonts, and generic files', () => {
  assert.equal(MEDIA_PREVIEW_EXTENSIONS.includes('epub'), true);
  assert.equal(getMediaPreviewKind('epub'), 'epub');
  assert.equal(getMediaPreviewKind('flac'), 'audio');
  assert.equal(getMediaPreviewKind('mkv'), 'video');
  assert.equal(getMediaPreviewKind('zip'), 'archive');
  assert.equal(getMediaPreviewKind('woff2'), 'font');
  assert.equal(getMediaPreviewKind('psd'), 'generic');
});

test('formatFileSize returns compact metadata labels', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5 MB');
});

test('getCodeLanguage maps common extensions to syntax modes', () => {
  assert.equal(getCodeLanguage('json'), 'javascript');
  assert.equal(getCodeLanguage('ts'), 'javascript');
  assert.equal(getCodeLanguage('xml'), 'xml');
  assert.equal(getCodeLanguage('py'), 'python');
  assert.equal(getCodeLanguage('yml'), 'yaml');
  assert.equal(getCodeLanguage('sh'), 'shell');
  assert.equal(getCodeLanguage('TOML'), 'toml');
  assert.equal(getCodeLanguage('tex'), 'tex');
  assert.equal(getCodeLanguage('unknown'), null);
});

test('Office preview formats include modern and legacy files', () => {
  assert.deepEqual(OFFICE_EXTENSIONS, ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
  assert.equal(getOfficePreviewKind('docx'), 'document');
  assert.equal(getOfficePreviewKind('xlsx'), 'spreadsheet');
  assert.equal(getOfficePreviewKind('xls'), 'spreadsheet');
  assert.equal(getOfficePreviewKind('pptx'), 'presentation');
  assert.equal(getOfficePreviewKind('doc'), null);
  assert.equal(getOfficePreviewKind('ppt'), null);
});

test('assertSafeZipDirectory rejects excessive entries before extraction', () => {
  const emptyZip = new ArrayBuffer(22);
  const emptyView = new DataView(emptyZip);
  emptyView.setUint32(0, 0x06054b50, true);
  assert.doesNotThrow(() => assertSafeZipDirectory(emptyZip, 3000));

  const excessiveZip = emptyZip.slice(0);
  const excessiveView = new DataView(excessiveZip);
  excessiveView.setUint16(8, 3001, true);
  excessiveView.setUint16(10, 3001, true);
  assert.throws(() => assertSafeZipDirectory(excessiveZip, 3000), /too many entries/i);

  const trailingDataZip = new ArrayBuffer(23);
  new DataView(trailingDataZip).setUint32(0, 0x06054b50, true);
  assert.throws(() => assertSafeZipDirectory(trailingDataZip, 3000), /invalid/i);
});

test('FEATURE_SUMMARY covers the plugin feature groups', () => {
  const titles = FEATURE_SUMMARY.map(feature => feature.title);
  assert.equal(FEATURE_SUMMARY.length, 9);
  assert.equal(titles.includes('Organize in bulk'), true);
  assert.equal(titles.includes('Edit code and text'), true);
  assert.equal(titles.includes('Preview Office files'), true);
  assert.equal(FEATURE_SUMMARY.every(feature => feature.icon && feature.description.length < 110), true);
});
