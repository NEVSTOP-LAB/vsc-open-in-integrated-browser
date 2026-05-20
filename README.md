# Open in Integrated Browser

A lightweight VS Code extension that adds an **"Open in Integrated Browser"** command to the Explorer and editor tab context menus, opening the selected file in VS Code's built-in **Simple Browser** (instead of an external browser).

Originally motivated by how cumbersome it is to preview HTML files inside VS Code's integrated browser — now it's a single right-click.

## Features

- Right-click any supported file in the **Explorer**, on an **editor tab**, or in the **editor area** → **Open in Integrated Browser**.
- Opens the file using VS Code's built-in [Simple Browser](https://code.visualstudio.com/api/extension-guides/webview#simple-browser) via `simpleBrowser.api.open` (falls back to `vscode.open` when unavailable).
- Per-extension checkboxes control both menu visibility and whether default-open association is applied.
- Localized in **English** and **简体中文**.

## Default supported file extensions

```
html, htm, pdf, svg, xml, xsl
```

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `openInIntegratedBrowser.autoAssociateAsDefaultByExtension` | `Record<string, boolean>` | `{ html: true, htm: true, pdf: true, svg: true, xml: true, xsl: true }` | Per-extension checkboxes. Key = extension (without dot). `true`: show context menu and set default-open association to this extension. `false`: show context menu only, no forced default-open. |

Example `settings.json`:

```jsonc
{
  "openInIntegratedBrowser.autoAssociateAsDefaultByExtension": {
    "html": true,
    "htm": true,
    "pdf": true,
    "svg": true,
    "xml": false,
    "xsl": true
  }
}
```

## Commands

| Command | Title |
| --- | --- |
| `openInIntegratedBrowser.open` | Open in Integrated Browser |

## License

[MIT](./LICENSE) © NEVSTOP-LAB
