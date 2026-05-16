# Change Log

## 0.0.2

- **Security**: Removed `allow-same-origin` from iframe `sandbox` attribute; combining it with `allow-scripts` renders the sandbox ineffective.
- **Security**: Restricted `localResourceRoots` to the workspace folder containing the opened file (was all workspace folders), reducing exposure in multi-root workspaces.
- **Fix**: Changed `supportsMultipleEditorsPerDocument` to `false` to prevent duplicate iframe instances and state inconsistencies.
- **Fix**: Expanded `customEditors.selector` to `*` wildcard so user-added extensions work as custom editors without requiring manual selector maintenance.
- **Fix**: `openInIntegratedBrowser` catch block now logs errors via `console.error` instead of silently swallowing them.
- **Fix**: `deactivate()` now cleans up auto-associated editor associations that were written by this extension.
- **i18n**: "No file selected" warning message is now wrapped with `vscode.l10n.t()` for future translation support.
- **Performance**: Changed activation events from `onStartupFinished` to targeted `onCustomEditor:…` and `onCommand:…` events to avoid unconditional startup activation.
- **Tooling**: Added `@vscode/vsce` to `devDependencies` for locked version during packaging.
- **Tooling**: esbuild now emits `dist/metafile.json` during development builds for bundle analysis.
- **Meta**: Added `"Visualization"` to extension categories.

## 0.0.1

- Initial release.
- Add `Open in Integrated Browser` command to Explorer / editor tab / editor context menus.
- Configurable file extensions via `openInIntegratedBrowser.extensions`.
- English and Simplified Chinese localization.
