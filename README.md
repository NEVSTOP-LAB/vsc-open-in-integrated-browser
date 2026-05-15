# Open in Integrated Browser

A lightweight VS Code extension that adds an **"Open in Integrated Browser"** command to the Explorer and editor tab context menus, opening the selected file in VS Code's built-in **Simple Browser** (instead of an external browser).

Originally motivated by how cumbersome it is to preview HTML files inside VS Code's integrated browser — now it's a single right-click.

## Features

- Right-click any supported file in the **Explorer**, on an **editor tab**, or in the **editor area** → **Open in Integrated Browser**.
- Opens the file using VS Code's built-in [Simple Browser](https://code.visualstudio.com/api/extension-guides/webview#simple-browser) via `simpleBrowser.api.open` (falls back to `vscode.open` when unavailable).
- After installation, `*.html` files are set to open in the built-in browser by default (can be turned off or turned on again from Settings).
- **Fully configurable file types** via the `openInIntegratedBrowser.extensions` setting.
- Localized in **English** and **简体中文**.

## Default supported file extensions

```
html, htm, pdf, xml, xsl, txt, md
```

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `openInIntegratedBrowser.extensions` | `string[]` | see above | File extensions (without leading dot) that show the command in the context menu. |
| `openInIntegratedBrowser.setHtmlAsDefaultEditor` | `boolean` | `true` | Controls whether `*.html` uses the built-in browser as default editor. Applied automatically after installation, and can be toggled later in Settings. |

Example `settings.json`:

```jsonc
{
  "openInIntegratedBrowser.extensions": [
    "html", "htm", "pdf", "svg", "md"
  ]
}
```

## Commands

| Command | Title |
| --- | --- |
| `openInIntegratedBrowser.open` | Open in Integrated Browser |

## License

[MIT](./LICENSE) © NEVSTOP-LAB
