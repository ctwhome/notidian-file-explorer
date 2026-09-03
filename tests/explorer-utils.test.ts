import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMatches, getRenameParts, getTextSearchMatch, getValidNavigationPaths, validateItemName } from '../src/explorer-utils';

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
