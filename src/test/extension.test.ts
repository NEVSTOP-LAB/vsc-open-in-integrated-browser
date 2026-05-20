import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  getAutoAssociateExtnames,
  getIntegratedBrowserWebviewHtml,
  getLocalResourceRootPaths,
  getMigratedAssociations,
  getNextAutoAssociations,
  getNextDeactivationAssociations,
  getNextHtmlEditorAssociations,
  getSupportedExtnames,
  openInIntegratedBrowser,
} from '../extension';
import { vscodeApi } from '../vscodeApi';

const EXT_ID = 'NEVSTOP-LAB.vsc-open-in-integrated-browser';
const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';
const CONFIG_DEFAULT_HTML_EDITOR_KEY = 'setHtmlAsDefaultEditor';
const CONFIG_AUTO_ASSOCIATE_KEY = 'autoAssociateExtensions';
const SIMPLE_BROWSER_VIEW_TYPE = 'simpleBrowser.view';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';

const DEFAULT_EXTENSIONS = [
  'html', 'htm', 'pdf', 'svg', 'xml', 'xsl',
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
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_AUTO_ASSOCIATE_KEY, undefined, vscode.ConfigurationTarget.Global);
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

  test('default autoAssociateExtensions configuration is empty', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = cfg.get<string[]>(CONFIG_AUTO_ASSOCIATE_KEY);
    assert.deepStrictEqual(value, []);
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

  test('configuration changes update supported extensions deterministically', async () => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    // Force a known pre-state to avoid no-op updates in CI.
    await config.update(CONFIG_KEY, ['pdf'], vscode.ConfigurationTarget.Global);
    assert.deepStrictEqual(getSupportedExtnames(), ['.pdf']);

    await config.update(CONFIG_KEY, ['html'], vscode.ConfigurationTarget.Global);

    const timeoutAt = Date.now() + 10_000;
    let current = getSupportedExtnames();
    while (Date.now() < timeoutAt && current.join(',') !== '.html') {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      current = getSupportedExtnames();
    }

    assert.deepStrictEqual(current, ['.html']);
  });

  test('openInIntegratedBrowser invokes simpleBrowser.api.open with the URI', async () => {
    const original = vscodeApi.executeCommand;
    const calls: Array<{ command: string; args: unknown[] }> = [];

    vscodeApi.executeCommand = (async (command: string, ...args: unknown[]) => {
      calls.push({ command, args });
      if (command === 'simpleBrowser.api.open') {
        return undefined;
      }
      return original(command, ...args);
    }) as typeof vscodeApi.executeCommand;

    try {
      const uri = vscode.Uri.file(path.join(__dirname, 'fixture.html'));
      await openInIntegratedBrowser(uri);
    } finally {
      vscodeApi.executeCommand = original;
    }

    const call = calls.find((c) => c.command === 'simpleBrowser.api.open');
    assert.ok(call, 'simpleBrowser.api.open should be invoked');
    assert.strictEqual(
      (call!.args[0] as vscode.Uri).fsPath.endsWith('fixture.html'),
      true,
    );
  });

  test('openInIntegratedBrowser falls back to vscode.openWith when Simple Browser fails', async () => {
    const original = vscodeApi.executeCommand;
    const calls: string[] = [];

    vscodeApi.executeCommand = (async (command: string, ...args: unknown[]) => {
      calls.push(command);
      if (command === 'simpleBrowser.api.open') {
        throw new Error('simulated failure');
      }
      if (command === 'vscode.openWith') {
        return undefined;
      }
      return original(command, ...args);
    }) as typeof vscodeApi.executeCommand;

    try {
      const uri = vscode.Uri.file(path.join(__dirname, 'fixture.html'));
      await openInIntegratedBrowser(uri);
    } finally {
      vscodeApi.executeCommand = original;
    }

    assert.ok(calls.includes('simpleBrowser.api.open'));
    assert.ok(calls.includes('vscode.openWith'));
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

  test('getAutoAssociateExtnames normalizes user-configured extensions', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_AUTO_ASSOCIATE_KEY,
        ['PDF', '.SVG', ' html ', 'html', ''],
        vscode.ConfigurationTarget.Global,
      );

    const result = getAutoAssociateExtnames();
    assert.deepStrictEqual(result, ['pdf', 'svg', 'html']);
  });

  test('getNextAutoAssociations adds associations for new extensions', () => {
    const current = { '*.htm': 'simpleBrowser.view' };
    const next = getNextAutoAssociations(current, [], ['pdf', 'svg']);
    assert.deepStrictEqual(next, {
      '*.htm': 'simpleBrowser.view',
      '*.pdf': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.svg': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
    });
  });

  test('getNextAutoAssociations removes associations for extensions no longer in list', () => {
    const current = {
      '*.pdf': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.svg': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.htm': 'simpleBrowser.view',
    };
    const next = getNextAutoAssociations(current, ['pdf', 'svg'], ['pdf']);
    assert.deepStrictEqual(next, {
      '*.pdf': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.htm': 'simpleBrowser.view',
    });
  });

  test('getNextAutoAssociations does not remove associations pointing to another editor', () => {
    const current = {
      '*.pdf': 'some.other.editor',
      '*.svg': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
    };
    const next = getNextAutoAssociations(current, ['pdf', 'svg'], []);
    assert.deepStrictEqual(next, {
      '*.pdf': 'some.other.editor',
    });
  });

  test('getMigratedAssociations rewrites managed simple browser mappings to integrated browser editor', () => {
    const current = {
      '*.html': SIMPLE_BROWSER_VIEW_TYPE,
      '*.pdf': SIMPLE_BROWSER_VIEW_TYPE,
      '*.xml': 'default',
    };
    const managedPatterns = new Set(['*.html']);
    const next = getMigratedAssociations(current, managedPatterns);
    assert.deepStrictEqual(next, {
      '*.html': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.pdf': SIMPLE_BROWSER_VIEW_TYPE,
      '*.xml': 'default',
    });
  });

  test('getIntegratedBrowserWebviewHtml uses a safe iframe sandbox', () => {
    const html = getIntegratedBrowserWebviewHtml('https://example.invalid/');
    assert.ok(html.includes('sandbox="allow-scripts allow-forms"'));
    assert.ok(!html.includes('allow-same-origin'));
  });

  test('getIntegratedBrowserWebviewHtml escapes iframe src attribute', () => {
    const html = getIntegratedBrowserWebviewHtml(
      'https://example.invalid/?q="><script>alert(1)</script>',
    );
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test('getLocalResourceRootPaths returns the file dir and its parent', () => {
    const file = path.join('a', 'b', 'c', 'file.html');
    assert.deepStrictEqual(getLocalResourceRootPaths(file), [
      path.join('a', 'b', 'c'),
      path.join('a', 'b'),
    ]);
  });

  test('getNextDeactivationAssociations removes only managed associations', () => {
    const current = {
      '*.html': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.pdf': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.xsl': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.svg': 'some.other.editor',
    };
    const next = getNextDeactivationAssociations(current, true, ['pdf', 'svg', 'xsl']);
    assert.deepStrictEqual(next, {
      '*.svg': 'some.other.editor',
    });
  });
});
