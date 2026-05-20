import * as path from 'path';
import * as vscode from 'vscode';
import { statSync } from 'fs';

import { vscodeApi } from './vscodeApi';

const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_ASSOCIATE_BY_EXTENSION_KEY =
  'autoAssociateAsDefaultByExtension';
const CONTEXT_KEY = 'openInIntegratedBrowser.supportedExtnames';
const WORKBENCH_CONFIG_SECTION = 'workbench';
const WORKBENCH_EDITOR_ASSOCIATIONS_KEY = 'editorAssociations';
const SIMPLE_BROWSER_VIEW_TYPE = 'simpleBrowser.view';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';
const AUTO_ASSOC_EDITOR_VIEW_TYPE = INTEGRATED_BROWSER_EDITOR_VIEW_TYPE;
const MANAGED_AUTO_ASSOC_STATE_KEY =
  'openInIntegratedBrowser.managedAutoAssociations';
const OUTPUT_CHANNEL_NAME = 'Open in Integrated Browser';

/** Module-level context reference, set during activation and used in deactivate. */
let moduleContext: vscode.ExtensionContext | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function getBuildStamp(): string {
  try {
    const mtime = statSync(__filename).mtime;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${mtime.getFullYear()}${pad(mtime.getMonth() + 1)}${pad(mtime.getDate())}-${pad(mtime.getHours())}${pad(mtime.getMinutes())}${pad(mtime.getSeconds())}`;
  } catch {
    return 'unknown';
  }
}

function logDevBuildInfo(context: vscode.ExtensionContext): void {
  if (context.extensionMode !== vscode.ExtensionMode.Development) {
    return;
  }

  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(outputChannel);
  }

  const build = getBuildStamp();
  const message = vscode.l10n.t(
    'Open in Integrated Browser loaded (dev build {0}).',
    build,
  );
  outputChannel.appendLine(message);
  void vscode.window.showInformationMessage(message);
}

/**
 * Read user-configured file extensions and normalize them to the form
 * `resourceExtname` uses in `when` clauses (lowercase, leading dot).
 */
export function getSupportedExtnames(): string[] {
  const raw = getAutoAssociateAsDefaultMap();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Object.keys(raw)) {
    const trimmed = item.toLowerCase();
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
 * Read managed file extensions from per-extension checkbox map and normalize
 * them to plain lowercase extension names without a leading dot.
 */
export function getAutoAssociateExtnames(): string[] {
  return Object.keys(getAutoAssociateAsDefaultMap());
}

export function getAutoAssociateAsDefaultMap(): Record<string, boolean> {
  const raw = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<Record<string, unknown>>(CONFIG_ASSOCIATE_BY_EXTENSION_KEY, {});

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'boolean') {
      continue;
    }
    const normalized = key.trim().toLowerCase().replace(/^\./, '');
    if (!normalized) {
      continue;
    }
    result[normalized] = value;
  }
  return result;
}

export function getEffectiveAutoAssociateExtnames(
  extnames: string[],
  asDefaultMap: Record<string, boolean>,
): string[] {
  return extnames.filter((ext) => asDefaultMap[ext] ?? true);
}

function getPreferredConfigTarget(key: string): vscode.ConfigurationTarget {
  const inspected = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .inspect<unknown>(key);

  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  if (inspected?.globalValue !== undefined) {
    return vscode.ConfigurationTarget.Global;
  }

  return vscode.ConfigurationTarget.Workspace;
}

function getAssociatedExtnamesForViewType(
  associations: Record<string, string>,
  viewType: string,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const [pattern, value] of Object.entries(associations)) {
    if (value !== viewType) {
      continue;
    }

    const match = pattern.match(/^\*\.([a-z0-9_+-]+)$/i);
    if (!match) {
      continue;
    }

    const ext = match[1].toLowerCase();
    if (!seen.has(ext)) {
      seen.add(ext);
      result.push(ext);
    }
  }

  return result;
}

async function syncAutoAssociateSettingFromEditorAssociations(): Promise<void> {
  const associations = getEditorAssociations();
  const associatedExtnames = getAssociatedExtnamesForViewType(
    associations,
    INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
  );
  const currentMap = getAutoAssociateAsDefaultMap();
  const nextMap = { ...currentMap };
  let mapChanged = false;
  for (const ext of associatedExtnames) {
    if (nextMap[ext] !== true) {
      nextMap[ext] = true;
      mapChanged = true;
    }
  }

  if (mapChanged) {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_ASSOCIATE_BY_EXTENSION_KEY,
        nextMap,
        getPreferredConfigTarget(CONFIG_ASSOCIATE_BY_EXTENSION_KEY),
      );
  }
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
    if (
      !newPatterns.has(pattern) &&
      (next[pattern] === AUTO_ASSOC_EDITOR_VIEW_TYPE ||
        next[pattern] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE)
    ) {
      delete next[pattern];
    }
  }

  for (const pattern of newPatterns) {
    next[pattern] = AUTO_ASSOC_EDITOR_VIEW_TYPE;
  }

  return next;
}

function getManagedAssociationPatterns(autoAssociateExtnames: string[]): Set<string> {
  const patterns = new Set(autoAssociateExtnames.map((ext) => `*.${ext}`));
  return patterns;
}

export function getMigratedAssociations(
  current: Record<string, string>,
  managedPatterns: Set<string>,
): Record<string, string> {
  const next = { ...current };
  for (const [pattern, viewType] of Object.entries(current)) {
    if (managedPatterns.has(pattern) && viewType === SIMPLE_BROWSER_VIEW_TYPE) {
      next[pattern] = INTEGRATED_BROWSER_EDITOR_VIEW_TYPE;
    }
  }
  return next;
}

async function migrateLegacyEditorAssociations(): Promise<void> {
  const defaultMap = getAutoAssociateAsDefaultMap();
  const managedPatterns = getManagedAssociationPatterns(
    getEffectiveAutoAssociateExtnames(getAutoAssociateExtnames(), defaultMap),
  );

  const currentAssociations = getEditorAssociations();
  const nextAssociations = getMigratedAssociations(
    currentAssociations,
    managedPatterns,
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

async function applyAutoAssociations(context: vscode.ExtensionContext): Promise<void> {
  const asDefaultMap = getAutoAssociateAsDefaultMap();
  const newExtnames = Object.keys(asDefaultMap);
  const prevExtnames = context.globalState.get<string[]>(MANAGED_AUTO_ASSOC_STATE_KEY, []);
  const effectiveExtnames = getEffectiveAutoAssociateExtnames(newExtnames, asDefaultMap);

  const currentAssociations = getEditorAssociations();
  const nextAssociations = getNextAutoAssociations(
    currentAssociations,
    prevExtnames,
    effectiveExtnames,
  );

  if (hasAssociationChanges(currentAssociations, nextAssociations)) {
    await vscode.workspace
      .getConfiguration(WORKBENCH_CONFIG_SECTION)
      .update(
        WORKBENCH_EDITOR_ASSOCIATIONS_KEY,
        nextAssociations,
        vscode.ConfigurationTarget.Global,
      );
  }

  await context.globalState.update(MANAGED_AUTO_ASSOC_STATE_KEY, effectiveExtnames);
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

export function getLocalResourceRootPaths(fileFsPath: string): string[] {
  const fileDir = path.dirname(fileFsPath);
  const parentDir = path.dirname(fileDir);
  if (parentDir && parentDir !== fileDir) {
    return [fileDir, parentDir];
  }
  return [fileDir];
}

function getLocalResourceRoots(uri: vscode.Uri): vscode.Uri[] {
  if (uri.scheme !== 'file') {
    return [];
  }

  // Restrict to the file's directory (and its direct parent) instead of the
  // whole workspace. This reduces exposure in multi-root workspaces while still
  // allowing typical relative asset loads (e.g. `./assets/...` and `../...`).
  return getLocalResourceRootPaths(uri.fsPath).map((root) =>
    vscode.Uri.file(root),
  );
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

export function getIntegratedBrowserWebviewHtml(src: string): string {
  const escapedSrc = escapeHtml(src);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body, iframe { width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: var(--vscode-editor-background); }
  </style>
</head>
<body>
  <iframe title="Integrated Browser Preview" src="${escapedSrc}" allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-forms"></iframe>
</body>
</html>`;
}

export function getNextDeactivationAssociations(
  current: Record<string, string>,
  managedAutoExtnames: string[],
): Record<string, string> {
  const next = { ...current };

  for (const ext of managedAutoExtnames) {
    const pattern = `*.${ext}`;
    if (
      next[pattern] === AUTO_ASSOC_EDITOR_VIEW_TYPE ||
      next[pattern] === INTEGRATED_BROWSER_EDITOR_VIEW_TYPE
    ) {
      delete next[pattern];
    }
  }

  return next;
}

function registerIntegratedBrowserEditor(context: vscode.ExtensionContext): void {
  const provider: vscode.CustomReadonlyEditorProvider<IntegratedBrowserDocument> = {
    openCustomDocument: async (uri: vscode.Uri) =>
      createIntegratedBrowserDocument(uri),
    resolveCustomEditor: async (
      document: IntegratedBrowserDocument,
      webviewPanel: vscode.WebviewPanel,
    ) => {
      // Keep behavior consistent with the command: if Simple Browser is available,
      // open there and close this custom editor panel immediately.
      const opened = await openInSimpleBrowser(document.uri);
      if (opened) {
        webviewPanel.dispose();
        return;
      }

      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: getLocalResourceRoots(document.uri),
      };

      const src = getIntegratedBrowserSourceUri(document.uri, webviewPanel.webview);
      webviewPanel.webview.html = getIntegratedBrowserWebviewHtml(src);
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

async function openInSimpleBrowser(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscodeApi.executeCommand('simpleBrowser.api.open', uri, {
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
    return true;
  } catch (err) {
    console.error('[OpenInIntegratedBrowser] simpleBrowser.api.open failed:', err);
    return false;
  }
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

  const opened = await openInSimpleBrowser(target);
  if (!opened) {
    console.error('[OpenInIntegratedBrowser] falling back to vscode.open.');
    // Avoid recursive fallback when this extension is the default editor.
    await vscodeApi.executeCommand('vscode.openWith', target, 'default');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  moduleContext = context;
  logDevBuildInfo(context);
  registerIntegratedBrowserEditor(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, openInIntegratedBrowser),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_ASSOCIATE_BY_EXTENSION_KEY}`)) {
        void updateContextKey();
        void applyAutoAssociations(context);
      }
      if (
        e.affectsConfiguration(
          `${WORKBENCH_CONFIG_SECTION}.${WORKBENCH_EDITOR_ASSOCIATIONS_KEY}`,
        )
      ) {
        void syncAutoAssociateSettingFromEditorAssociations();
        void migrateLegacyEditorAssociations();
      }
    }),
  );

  void updateContextKey();
  void syncAutoAssociateSettingFromEditorAssociations();
  void migrateLegacyEditorAssociations();
  void applyAutoAssociations(context);
}

export async function deactivate(): Promise<void> {
  moduleContext = undefined;
}
