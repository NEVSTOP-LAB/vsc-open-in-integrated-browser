import * as vscode from 'vscode';

export const vscodeApi = {
  executeCommand: vscode.commands.executeCommand.bind(vscode.commands),
};

