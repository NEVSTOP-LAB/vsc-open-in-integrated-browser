import * as vscode from 'vscode';

const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';
const CONTEXT_KEY = 'openInIntegratedBrowser.supportedExtnames';

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

async function updateContextKey(): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    CONTEXT_KEY,
    getSupportedExtnames(),
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
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, openInIntegratedBrowser),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) {
        void updateContextKey();
      }
    }),
  );

  void updateContextKey();
}

export function deactivate(): void {
  // nothing to clean up
}
