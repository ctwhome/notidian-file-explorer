#!/usr/bin/env node
/**
 * Version bump script for Notidian File Explorer
 * Increments the patch version in manifest.json and package.json
 * Usage: node bump-version.mjs [major|minor|patch]
 * Default: patch
 */

import { readFileSync, writeFileSync } from 'fs';

const bumpType = process.argv[2] || 'patch';

// Read manifest.json
const manifestPath = './manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Read package.json
const packagePath = './package.json';
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

// Parse current version
const [major, minor, patch] = manifest.version.split('.').map(Number);

// Calculate new version
let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

console.log(`Bumping version: ${manifest.version} -> ${newVersion}`);

// Update manifest.json
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`Updated ${manifestPath}`);

// Update package.json
pkg.version = newVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, '\t') + '\n');
console.log(`Updated ${packagePath}`);

console.log(`\nVersion bumped to ${newVersion}`);
console.log('Run "bun run build" to rebuild with new version.');
