import * as path from 'path';
import * as vscode from 'vscode';

import { vscodeApi } from './vscodeApi';

const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';
const CONFIG_DEFAULT_HTML_EDITOR_KEY = 'setHtmlAsDefaultEditor';
const CONFIG_AUTO_ASSOCIATE_KEY = 'autoAssociateExtensions';
const CONTEXT_KEY = 'openInIntegratedBrowser.supportedExtnames';
const WORKBENCH_CONFIG_SECTION = 'workbench';
const WORKBENCH_EDITOR_ASSOCIATIONS_KEY = 'editorAssociations';
const SIMPLE_BROWSER_VIEW_TYPE = 'simpleBrowser.view';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';
const HTML_FILE_PATTERN = '*.html';
const INITIALIZED_DEFAULT_ASSOCIATION_KEY =
  'openInIntegratedBrowser.defaultHtmlAssociationInitialized';
const MANAGED_AUTO_ASSOC_STATE_KEY =
  'openInIntegratedBrowser.managedAutoAssociations';

/** Module-level context reference, set during activation and used in deactivate. */
let moduleContext: vscode.ExtensionContext | undefined;

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

/**
 * Read user-configured auto-associate extensions and normalize them to plain
 * lowercase extension names without a leading dot (e.g. `['html', 'pdf']`).
 */
export function getAutoAssociateExtnames(): string[] {
  const raw = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string[]>(CONFIG_AUTO_ASSOCIATE_KEY, []);

  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim().toLowerCase().replace(/^\./, '');
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Compute the next editor associations after updating the auto-associate list.
 * Extensions in `prevExtnames` that are no longer in `newExtnames` have their
 * association removed (provided it still points to this extension's editor).
 * Extensions in `newExtnames` are mapped to this extension's editor.
 */
export function getNextAutoAssociations(
  current: Record<string, string>,
  prevExtnames: string[],
  newExtnames: string[],
): Record<string, string> {
  const next = { ...current };
  const newPatterns = new Set(newExtnames.map((ext) => `*.${ext}`));
  const prevPatterns = new Set(prevExtnames.map((ext) => `*.${ext}`));

  for (const pattern of prevPatterns) {
    if (!newPatterns.has(pattern) && next[pattern] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE) {
      delete next[pattern];
    }
  }

  for (const pattern of newPatterns) {
    next[pattern] = INTEGRATED_BROWSER_EDITOR_VIEW_TYPE;
  }

  return next;
}

async function applyAutoAssociations(context: vscode.ExtensionContext): Promise<void> {
  const newExtnames = getAutoAssociateExtnames();
  const prevExtnames = context.globalState.get<string[]>(MANAGED_AUTO_ASSOC_STATE_KEY, []);

  const currentAssociations = getEditorAssociations();
  const nextAssociations = getNextAutoAssociations(currentAssociations, prevExtnames, newExtnames);

  if (hasAssociationChanges(currentAssociations, nextAssociations)) {
    await vscode.workspace
      .getConfiguration(WORKBENCH_CONFIG_SECTION)
      .update(
        WORKBENCH_EDITOR_ASSOCIATIONS_KEY,
        nextAssociations,
        vscode.ConfigurationTarget.Global,
      );
  }

  await context.globalState.update(MANAGED_AUTO_ASSOC_STATE_KEY, newExtnames);
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
  await vscodeApi.executeCommand(
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

  // Restrict to the file's directory (and its direct parent) instead of the
  // whole workspace. This reduces exposure in multi-root workspaces while still
  // allowing typical relative asset loads (e.g. `./assets/...` and `../...`).
  const fileDir = vscode.Uri.file(path.dirname(uri.fsPath));
  const parentDir = vscode.Uri.file(path.dirname(fileDir.fsPath));
  if (parentDir.fsPath && parentDir.fsPath !== fileDir.fsPath) {
    return [fileDir, parentDir];
  }
  return [fileDir];
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
  <iframe title="Integrated Browser Preview" src="${src}" allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-forms"></iframe>
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
        supportsMultipleEditorsPerDocument: false,
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
      vscode.l10n.t('Open in Integrated Browser: no file selected.'),
    );
    return;
  }

  try {
    // simpleBrowser.api.open accepts a URI/string and opens it in a webview.
    await vscodeApi.executeCommand('simpleBrowser.api.open', target, {
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (err) {
    console.error('[OpenInIntegratedBrowser] simpleBrowser.api.open failed, falling back to vscode.open:', err);
    // Fallback: vscode.open opens with the default editor for the resource.
    await vscodeApi.executeCommand('vscode.open', target);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  moduleContext = context;
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
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_AUTO_ASSOCIATE_KEY}`)) {
        void applyAutoAssociations(context);
      }
    }),
  );

  void updateContextKey();
  void initializeDefaultHtmlAssociation(context);
  void applyAutoAssociations(context);
}

export async function deactivate(): Promise<void> {
  const context = moduleContext;
  if (!context) {
    return;
  }

  try {
    const currentAssociations = getEditorAssociations();
    const nextAssociations = { ...currentAssociations };

    const initializedDefaultHtml = context.globalState.get<boolean>(
      INITIALIZED_DEFAULT_ASSOCIATION_KEY,
      false,
    );
    if (
      initializedDefaultHtml &&
      nextAssociations[HTML_FILE_PATTERN] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE
    ) {
      delete nextAssociations[HTML_FILE_PATTERN];
    }

    const managedAutoExtnames = context.globalState.get<string[]>(
      MANAGED_AUTO_ASSOC_STATE_KEY,
      [],
    );
    for (const ext of managedAutoExtnames) {
      const pattern = `*.${ext}`;
      if (nextAssociations[pattern] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE) {
        delete nextAssociations[pattern];
      }
    }

    if (hasAssociationChanges(currentAssociations, nextAssociations)) {
      await vscode.workspace
        .getConfiguration(WORKBENCH_CONFIG_SECTION)
        .update(
          WORKBENCH_EDITOR_ASSOCIATIONS_KEY,
          nextAssociations,
          vscode.ConfigurationTarget.Global,
        );
    }

    await context.globalState.update(MANAGED_AUTO_ASSOC_STATE_KEY, []);
    await context.globalState.update(INITIALIZED_DEFAULT_ASSOCIATION_KEY, false);
  } catch (err) {
    console.error(
      '[OpenInIntegratedBrowser] Failed to clean editor associations during deactivate:',
      err,
    );
  }
}
