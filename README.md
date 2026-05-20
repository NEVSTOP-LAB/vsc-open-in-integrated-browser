# Open in Integrated Browser

A lightweight VS Code extension for opening files directly in VS Code's integrated browser.

## Features

- Adds **Open in Integrated Browser** to right-click menus.
- Supports Explorer, editor tab, and editor context menus.
- Lets you control each file extension with a checkbox-like setting.
- Can make selected file types open in the integrated browser by default.
- Localized in **English** and **简体中文**.

## How To Use

1. In Explorer or an opened editor, right-click a supported file.
2. Choose **Open in Integrated Browser**.
3. The file opens in VS Code's integrated browser view.

## Default supported file extensions

```
html, htm, pdf, svg, xml, xsl
```

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `openInIntegratedBrowser.autoAssociateAsDefaultByExtension` | `Record<string, boolean>` | `{ html: true, htm: true, pdf: true, svg: true, xml: true, xsl: true }` | Per-extension options. Key = extension (without dot). `true`: include this extension and make it open in the integrated browser by default. `false`: include this extension but do not force default open behavior. |

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
