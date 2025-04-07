# Notidian File Explorer - Development Guide

This document provides information for developers interested in contributing to or modifying the Notidian File Explorer plugin.

## Development Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/notidian-file-explorer.git
   ```

2. Install dependencies:
   ```bash
   cd notidian-file-explorer
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. For development with hot-reload:
   ```bash
   npm run dev
   ```

## Project Structure

- `main.ts` - The main entry point of the plugin
- `src/` - Source code directory
  - `components/` - UI components
  - `utils/` - Helper utilities
  - `styles/` - CSS styles
- `manifest.json` - Plugin manifest file
- `versions.json` - Version information
- `styles.css` - Main CSS file

## Building and Testing

- Run `npm run build` to create a production build
- Run `npm run test` to execute tests
- Use `npm run lint` to check for code style issues

## Contribution Guidelines

1. Fork the repository and create a feature branch
2. Make your changes following the project's code style
3. Add tests for your changes where appropriate
4. Submit a pull request with a clear description of the changes

## Architecture

The plugin uses [describe the architecture, patterns, etc., used in the project]

## API Documentation

[Include or link to any API documentation if applicable]

## Release Process

1. Update version in `manifest.json` and `versions.json`
2. Update the changelog
3. Create a new GitHub release
4. Build and attach the release files

## Debugging Tips

[Include any specific debugging tips or common issues]

## References

- [Obsidian Plugin API Documentation](https://github.com/obsidianmd/obsidian-api)
- [Related resources or libraries]
