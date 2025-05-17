// This file has been refactored and split into multiple modules for better maintainability.
// The functionality has been replaced by these files:
//  - column-explorer-core.ts (main view implementation)
//  - navigators.ts (file navigation)
//  - icon-handlers.ts (emoji and icon handling)
//  - file-operations-view.ts (file operations)
//  - drag-handlers.ts (drag and drop functionality)
//  - vault-event-handlers.ts (vault event handling)
//  - types.ts (shared interfaces)

// This file is kept only for backward compatibility.
// Please use the new modules for any new functionality.

// Re-export the ColumnExplorerView from the new location
export { ColumnExplorerView } from './column-explorer-core';
