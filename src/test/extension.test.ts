import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { getSupportedExtnames, openInIntegratedBrowser } from '../extension';

const EXT_ID = 'NEVSTOP-LAB.vsc-open-in-integrated-browser';
const COMMAND_ID = 'openInIntegratedBrowser.open';
const CONFIG_SECTION = 'openInIntegratedBrowser';
const CONFIG_KEY = 'extensions';

const DEFAULT_EXTENSIONS = [
  'html', 'htm', 'pdf', 'svg', 'xml', 'xsl', 'txt', 'md',
  'webp', 'jpg', 'jpeg', 'png', 'gif', 'bmp',
];

suite('Open in Integrated Browser', () => {
  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_KEY, undefined, vscode.ConfigurationTarget.Global);
  });

  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
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

  test('configuration changes update the supported extension context', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(CONFIG_KEY, ['html'], vscode.ConfigurationTarget.Global);

    await new Promise((r) => setTimeout(r, 100));

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
});
