import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  getAutoAssociateExtnames,
  getEffectiveAutoAssociateExtnames,
  getIntegratedBrowserWebviewHtml,
  getLocalResourceRootPaths,
  getAutoAssociateAsDefaultMap,
  getMigratedAssociations,
  getNextAutoAssociations,
  getNextDeactivationAssociations,
  getSupportedExtnames,
  openInIntegratedBrowser,
} from '../extension';
import { vscodeApi } from '../vscodeApi';

const EXT_ID = 'NEVSTOP-LAB.vsc-open-in-integrated-browser';
const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_ASSOCIATE_BY_EXTENSION_KEY =
  'autoAssociateAsDefaultByExtension';
const SIMPLE_BROWSER_VIEW_TYPE = 'simpleBrowser.view';
const INTEGRATED_BROWSER_EDITOR_VIEW_TYPE =
  'openInIntegratedBrowser.integratedBrowserEditor';

const DEFAULT_AUTO_ASSOCIATE_DEFAULT_MAP = {
  html: true,
  htm: true,
  svg: true,
  xml: true,
  xsl: true,
};

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
      .update(
        CONFIG_ASSOCIATE_BY_EXTENSION_KEY,
        undefined,
        vscode.ConfigurationTarget.Global,
      );
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

  test('default autoAssociateAsDefaultByExtension setting is enabled per extension', () => {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const value = cfg.get<Record<string, boolean>>(CONFIG_ASSOCIATE_BY_EXTENSION_KEY);
    assert.deepStrictEqual(value, DEFAULT_AUTO_ASSOCIATE_DEFAULT_MAP);
  });

  test('getSupportedExtnames normalizes map keys to extnames used in context key', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_ASSOCIATE_BY_EXTENSION_KEY,
        { HTML: true, '.pdf': false, ' svg ': true, '': false, json: true },
        vscode.ConfigurationTarget.Global,
      );

    const result = getSupportedExtnames();
    assert.deepStrictEqual(
      [...result].sort(),
      ['.html', '.htm', '.svg', '.xml', '.xsl', '.pdf', '.json'].sort(),
    );
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

  test('getAutoAssociateExtnames returns normalized map keys', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_ASSOCIATE_BY_EXTENSION_KEY,
        { PDF: false, '.SVG': true, ' html ': true, '': false },
        vscode.ConfigurationTarget.Global,
      );

    const result = getAutoAssociateExtnames();
    assert.deepStrictEqual(result, ['html', 'htm', 'svg', 'xml', 'xsl', 'pdf']);
  });

  test('getAutoAssociateAsDefaultMap normalizes user-configured extension map', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(
        CONFIG_ASSOCIATE_BY_EXTENSION_KEY,
        {
          HTML: true,
          '.PDF': false,
          ' svg ': true,
          '': false,
          xml: true,
          bad: 'x',
        },
        vscode.ConfigurationTarget.Global,
      );

    const result = getAutoAssociateAsDefaultMap();
    assert.deepStrictEqual(result, {
      htm: true,
      html: true,
      pdf: false,
      svg: true,
      xml: true,
      xsl: true,
    });
  });

  test('getEffectiveAutoAssociateExtnames filters by per-extension checkbox map', () => {
    const result = getEffectiveAutoAssociateExtnames(
      ['html', 'pdf', 'xml'],
      { html: true, pdf: false },
    );
    assert.deepStrictEqual(result, ['html', 'xml']);
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
    const next = getNextDeactivationAssociations(current, ['pdf', 'svg', 'xsl']);
    assert.deepStrictEqual(next, {
      '*.html': INTEGRATED_BROWSER_EDITOR_VIEW_TYPE,
      '*.svg': 'some.other.editor',
    });
  });
});
