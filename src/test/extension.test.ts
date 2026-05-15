import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  getNextHtmlEditorAssociations,
  getSupportedExtnames,
  openInIntegratedBrowser,
} from '../extension';

const EXT_ID = 'NEVSTOP-LAB.vsc-open-in-integrated-browser';
const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';
const CONFIG_DEFAULT_HTML_EDITOR_KEY = 'setHtmlAsDefaultEditor';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';

const DEFAULT_EXTENSIONS = [
  'html', 'htm', 'pdf', 'svg', 'xml', 'xsl', 'txt', 'md',
];

suite('Open in Integrated Browser', () => {
  suiteSetup(async () => {
    // Activate the extension explicitly so subsequent tests don't depend on
    // Mocha's test-ordering for activation side-effects.
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_KEY, undefined, vscode.ConfigurationTarget.Global);
  });

  test('extension is present and activates', () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    assert.strictEqual(ext!.isActive, true);
  });

  test('command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes(COMMAND_ID),
      `command ${COMMAND_ID} should be registered`,
    );
  });

  test('default extensions configuration matches expected list', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = cfg.get<string[]>(CONFIG_KEY);
    assert.deepStrictEqual(value, DEFAULT_EXTENSIONS);
  });

  test('default html editor association setting is enabled', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = cfg.get<boolean>(CONFIG_DEFAULT_HTML_EDITOR_KEY);
    assert.strictEqual(value, true);
  });

  test('getSupportedExtnames normalizes user-configured extensions', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_KEY,
        ['HTML', '.pdf', ' svg ', 'pdf', '', 'json'],
        vscode.ConfigurationTarget.Global,
      );

    const result = getSupportedExtnames();
    assert.deepStrictEqual(result, ['.html', '.pdf', '.svg', '.json']);
  });

  test('configuration changes push updated extensions into the setContext key', async () => {
    const original = vscode.commands.executeCommand;
    const setContextCalls: unknown[][] = [];

    (vscode.commands as unknown as {
      executeCommand: typeof vscode.commands.executeCommand;
    }).executeCommand = (async (command: string, ...args: unknown[]) => {
      if (command === 'setContext') {
        setContextCalls.push(args);
        return undefined;
      }
      return original.call(vscode.commands, command, ...args);
    }) as typeof vscode.commands.executeCommand;

    try {
      // Wait for the onDidChangeConfiguration listener (which calls setContext)
      // to fire as a result of the config update.
      const fired = new Promise<void>((resolve) => {
        const sub = vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
          if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) {
            sub.dispose();
            // Defer one tick so the extension's own listener runs first.
            setImmediate(resolve);
          }
        });
      });

      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(CONFIG_KEY, ['html'], vscode.ConfigurationTarget.Global);
      await fired;
    } finally {
      (vscode.commands as unknown as {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = original;
    }

    const lastSetContext = setContextCalls.find(
      (args) => args[0] === 'openInIntegratedBrowser.supportedExtnames',
    );
    assert.ok(
      lastSetContext,
      'setContext should be invoked for openInIntegratedBrowser.supportedExtnames',
    );
    assert.deepStrictEqual(lastSetContext![1], ['.html']);
    assert.deepStrictEqual(getSupportedExtnames(), ['.html']);
  });

  test('openInIntegratedBrowser invokes simpleBrowser.api.open with the URI', async () => {
    const original = vscode.commands.executeCommand;
    const calls: Array<{ command: string; args: unknown[] }> = [];

    (vscode.commands as unknown as {
      executeCommand: typeof vscode.commands.executeCommand;
    }).executeCommand = (async (command: string, ...args: unknown[]) => {
      calls.push({ command, args });
      if (command === 'simpleBrowser.api.open') {
        return undefined;
      }
      return original.call(vscode.commands, command, ...args);
    }) as typeof vscode.commands.executeCommand;

    try {
      const uri = vscode.Uri.file(path.join(__dirname, 'fixture.html'));
      await openInIntegratedBrowser(uri);
    } finally {
      (vscode.commands as unknown as {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = original;
    }

    const call = calls.find((c) => c.command === 'simpleBrowser.api.open');
    assert.ok(call, 'simpleBrowser.api.open should be invoked');
    assert.strictEqual(
      (call!.args[0] as vscode.Uri).fsPath.endsWith('fixture.html'),
      true,
    );
  });

  test('openInIntegratedBrowser falls back to vscode.open when Simple Browser fails', async () => {
    const original = vscode.commands.executeCommand;
    const calls: string[] = [];

    (vscode.commands as unknown as {
      executeCommand: typeof vscode.commands.executeCommand;
    }).executeCommand = (async (command: string, ...args: unknown[]) => {
      calls.push(command);
      if (command === 'simpleBrowser.api.open') {
        throw new Error('simulated failure');
      }
      if (command === 'vscode.open') {
        return undefined;
      }
      return original.call(vscode.commands, command, ...args);
    }) as typeof vscode.commands.executeCommand;

    try {
      const uri = vscode.Uri.file(path.join(__dirname, 'fixture.html'));
      await openInIntegratedBrowser(uri);
    } finally {
      (vscode.commands as unknown as {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = original;
    }

    assert.ok(calls.includes('simpleBrowser.api.open'));
    assert.ok(calls.includes('vscode.open'));
  });

  test('getNextHtmlEditorAssociations sets *.html to integrated browser editor when enabled', () => {
    const current = { '*.htm': 'simpleBrowser.view' };
    const next = getNextHtmlEditorAssociations(current, true);
    assert.deepStrictEqual(next, {
      '*.htm': 'simpleBrowser.view',
      '*.html': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
    });
  });

  test('getNextHtmlEditorAssociations removes *.html only when it points to integrated browser editor', () => {
    const current = {
      '*.html': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.htm': 'simpleBrowser.view',
    };
    const next = getNextHtmlEditorAssociations(current, false);
    assert.deepStrictEqual(next, {
      '*.htm': 'simpleBrowser.view',
    });
  });

  test('getNextHtmlEditorAssociations keeps *.html when it is configured to another editor', () => {
    const current = {
      '*.html': 'default',
      '*.htm': 'simpleBrowser.view',
    };
    const next = getNextHtmlEditorAssociations(current, false);
    assert.deepStrictEqual(next, current);
  });
});
