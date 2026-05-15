import * as path from 'path';
import * as vscode from 'vscode';

const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';
const CONFIG_DEFAULT_HTML_EDITOR_KEY = 'setHtmlAsDefaultEditor';
const CONTEXT_KEY = 'openInIntegratedBrowser.supportedExtnames';
const WORKBENCH_CONFIG_SECTION = 'workbench';
const WORKBENCH_EDITOR_ASSOCIATIONS_KEY = 'editorAssociations';
const SIMPLE_BROWSER_VIEW_TYPE = 'simpleBrowser.view';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';
const HTML_FILE_PATTERN = '*.html';
const INITIALIZED_DEFAULT_ASSOCIATION_KEY =
  'openInIntegratedBrowser.defaultHtmlAssociationInitialized';

/**
 * Read user-configured file extensions and normalize them to the form
 * `resourceExtname` uses in `when` clauses (lowercase, leading dot).
 */
export function getSupportedExtnames(): string[] {
  const raw = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>(CONFIG_KEY, []);

  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    if (!seen.has(withDot)) {
      seen.add(withDot);
      result.push(withDot);
    }
  }
  return result;
}

function getEditorAssociations(): Record<string, string> {
  const raw = vscode.workspace
    .getConfiguration(WORKBENCH_CONFIG_SECTION)
    .get<unknown>(WORKBENCH_EDITOR_ASSOCIATIONS_KEY, {});

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

export function getNextHtmlEditorAssociations(
  current: Record<string, string>,
  useIntegratedBrowser: boolean,
): Record<string, string> {
  const next = { ...current };

  if (useIntegratedBrowser) {
    next[HTML_FILE_PATTERN] = INTEGRATED_BROWSER_EDITOR_VIEW_TYPE;
    return next;
  }

  if (next[HTML_FILE_PATTERN] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE) {
    delete next[HTML_FILE_PATTERN];
  }
  return next;
}

function hasAssociationChanges(
  current: Record<string, string>,
  next: Record<string, string>,
): boolean {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) {
    return true;
  }
  return nextKeys.some((key) => current[key] !== next[key]);
}

async function applyHtmlEditorAssociationFromSetting(): Promise<void> {
  const useIntegratedBrowser = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(CONFIG_DEFAULT_HTML_EDITOR_KEY, true);

  const currentAssociations = getEditorAssociations();
  const nextAssociations = getNextHtmlEditorAssociations(
    currentAssociations,
    useIntegratedBrowser,
  );
  if (!hasAssociationChanges(currentAssociations, nextAssociations)) {
    return;
  }

  await vscode.workspace
    .getConfiguration(WORKBENCH_CONFIG_SECTION)
    .update(
      WORKBENCH_EDITOR_ASSOCIATIONS_KEY,
      nextAssociations,
      vscode.ConfigurationTarget.Global,
    );
}

async function initializeDefaultHtmlAssociation(
  context: vscode.ExtensionContext,
): Promise<void> {
  const initialized = context.globalState.get<boolean>(
    INITIALIZED_DEFAULT_ASSOCIATION_KEY,
    false,
  );
  if (initialized) {
    return;
  }

  await applyHtmlEditorAssociationFromSetting();
  await context.globalState.update(INITIALIZED_DEFAULT_ASSOCIATION_KEY, true);
}

async function updateContextKey(): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    CONTEXT_KEY,
    getSupportedExtnames(),
  );
}

interface IntegratedBrowserDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

function createIntegratedBrowserDocument(
  uri: vscode.Uri,
): IntegratedBrowserDocument {
  return {
    uri,
    dispose(): void {
      // no-op
    },
  };
}

function getLocalResourceRoots(uri: vscode.Uri): vscode.Uri[] {
  if (uri.scheme !== 'file') {
    return [];
  }

  const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
  roots.push(vscode.Uri.file(path.dirname(uri.fsPath)));
  return roots;
}

function getIntegratedBrowserSourceUri(
  uri: vscode.Uri,
  webview: vscode.Webview,
): string {
  if (uri.scheme === 'file') {
    return webview.asWebviewUri(uri).toString();
  }
  return uri.toString(true);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function registerIntegratedBrowserEditor(context: vscode.ExtensionContext): void {
  const provider: vscode.CustomReadonlyEditorProvider<IntegratedBrowserDocument> = {
    openCustomDocument: async (uri: vscode.Uri) =>
      createIntegratedBrowserDocument(uri),
    resolveCustomEditor: async (
      document: IntegratedBrowserDocument,
      webviewPanel: vscode.WebviewPanel,
    ) => {
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: getLocalResourceRoots(document.uri),
      };

      const src = escapeHtml(
        getIntegratedBrowserSourceUri(document.uri, webviewPanel.webview),
      );
      webviewPanel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body, iframe { width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: var(--vscode-editor-background); }
  </style>
</head>
<body>
  <iframe title="Integrated Browser Preview" src="${src}" allow="clipboard-read; clipboard-write" sandbox="allow-same-origin allow-scripts allow-forms"></iframe>
</body>
</html>`;
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: true,
      },
    ),
  );
}

/**
 * Open the given resource in the VS Code built-in Simple Browser.
 * Falls back to `vscode.open` if the Simple Browser API is unavailable.
 */
export async function openInIntegratedBrowser(
  uri: vscode.Uri | undefined,
): Promise<void> {
  let target = uri;
  if (!target) {
    target = vscode.window.activeTextEditor?.document.uri;
  }
  if (!target) {
    void vscode.window.showWarningMessage(
      'Open in Integrated Browser: no file selected.',
    );
    return;
  }

  try {
    // simpleBrowser.api.open accepts a URI/string and opens it in a webview.
    await vscode.commands.executeCommand('simpleBrowser.api.open', target, {
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch {
    // Fallback: vscode.open opens with the default editor for the resource.
    await vscode.commands.executeCommand('vscode.open', target);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  registerIntegratedBrowserEditor(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, openInIntegratedBrowser),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) {
        void updateContextKey();
      }
      if (
        e.affectsConfiguration(
          `${CONFIG_SECTION}.${CONFIG_DEFAULT_HTML_EDITOR_KEY}`,
        )
      ) {
        void applyHtmlEditorAssociationFromSetting();
      }
    }),
  );

  void updateContextKey();
  void initializeDefaultHtmlAssociation(context);
}

export function deactivate(): void {
  // nothing to clean up
}
