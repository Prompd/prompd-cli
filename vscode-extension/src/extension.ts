import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as yaml from 'yaml';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

// Secure command execution helper to prevent injection attacks
interface CommandResult {
    stdout: string;
    stderr: string;
}

async function executeSecureCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number }
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options?.cwd,
            shell: false, // CRITICAL: Disable shell to prevent injection
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // Set timeout if specified
        const timer = options?.timeout ? setTimeout(() => {
            timedOut = true;
            child.kill();
            reject(new Error(`Command timed out after ${options.timeout}ms`));
        }, options.timeout) : null;

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (error) => {
            if (timer) {
                clearTimeout(timer);
            }
            reject(error);
        });

        child.on('close', (code) => {
            if (timer) {
                clearTimeout(timer);
            }
            if (!timedOut) {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            }
        });
    });
}

// Content Security Policy helper
function getWebviewCSP(webview: vscode.Webview): string {
    return `
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src ${webview.cspSource} 'unsafe-inline';
        img-src ${webview.cspSource} https: data:;
        font-src ${webview.cspSource};
    `.replace(/\s+/g, ' ').trim();
}

// Helper to escape HTML to prevent XSS
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Helper to safely build prompd command arguments
function buildPrompdArgs(action: string, filePath: string, options: Record<string, any> = {}): string[] {
    const args = [action, filePath];
    
    // Add optional arguments safely
    Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            if (key === 'parameters') {
                // Handle parameters specially
                Object.entries(value as Record<string, string>).forEach(([paramKey, paramValue]) => {
                    args.push('-p', `${paramKey}=${paramValue}`);
                });
            } else if (typeof value === 'boolean' && value) {
                args.push(`--${key}`);
            } else {
                args.push(`--${key}`, String(value));
            }
        }
    });
    
    return args;
}

// Parameter table manager - removed in favor of sidebar panel
// All parameter functionality is now in the sidebar for better UX

    // Removed - functionality moved to sidebar
    /*
    private createTable(documentUri: vscode.Uri, parameters: any[]): void {
        const key = documentUri.toString();
        const fileName = path.basename(documentUri.fsPath);

        const panel = vscode.window.createWebviewPanel(
            'prompdParameterTable',
            `Parameters: ${fileName}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { 
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.dirname(documentUri.fsPath))]
            }
        );

        panel.webview.html = this.generatePostmanStyleTableHtml(parameters, fileName);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'pin':
                    this.pinnedTables.add(key);
                    this.updatePinButton(panel, true);
                    break;
                case 'unpin':
                    this.pinnedTables.delete(key);
                    this.updatePinButton(panel, false);
                    break;
                case 'close':
                    panel.dispose();
                    break;
                case 'updateParameter':
                    await this.updateYamlParameter(documentUri, message.name, message.value);
                    break;
                case 'addParameter':
                    await this.addYamlParameter(documentUri, message.parameter);
                    break;
                case 'executeWithParams':
                    await executeWithParameters(message.parameters);
                    break;
            }
        });

        // Clean up when panel is disposed
        panel.onDidDispose(() => {
            this.openTables.delete(key);
            this.pinnedTables.delete(key);
        });

        this.openTables.set(key, panel);
    }

    private updatePinButton(panel: vscode.WebviewPanel, isPinned: boolean): void {
        panel.webview.postMessage({
            command: 'updatePinState',
            isPinned: isPinned
        });
    }

    private async updateYamlParameter(documentUri: vscode.Uri, paramName: string, newValue: string): Promise<void> {
        // TODO: Implement YAML parameter update
        // This would parse the YAML, update the parameter, and save back to file
        vscode.window.showInformationMessage(`Would update ${paramName} to: ${newValue}`);
    }

    private async addYamlParameter(documentUri: vscode.Uri, parameter: any): Promise<void> {
        // TODO: Implement YAML parameter addition
        vscode.window.showInformationMessage(`Would add parameter: ${parameter.name}`);
    }

    private generatePostmanStyleTableHtml(parameters: any[], fileName: string): string {
        const isPinned = false; // Start unpinned
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parameters: ${fileName}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        
        .header {
            background: var(--vscode-titleBar-activeBackground);
            padding: 8px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h3 {
            margin: 0;
            font-size: 14px;
            color: var(--vscode-titleBar-activeForeground);
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .table-container {
            padding: 16px;
        }
        
        .parameter-table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .parameter-table th {
            background: var(--vscode-editor-selectionBackground);
            padding: 8px 12px;
            text-align: left;
            font-weight: 600;
            font-size: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .parameter-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: middle;
        }
        
        .parameter-table tr:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .param-input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 4px 8px;
            font-size: 12px;
        }
        
        .param-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .type-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 500;
        }
        
        .required-badge {
            background: var(--vscode-errorForeground);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
        }
        
        .actions {
            margin-top: 16px;
            display: flex;
            gap: 8px;
        }
        
        .execute-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .execute-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .add-param-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .pinned-indicator {
            color: var(--vscode-charts-yellow);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="header">
        <h3>📋 Parameters (${parameters.length}) ${isPinned ? '<span class="pinned-indicator">📌</span>' : ''}</h3>
        <div class="header-actions">
            <button class="btn secondary" id="pinBtn" onclick="togglePin()">
                ${isPinned ? '📌 Unpin' : '📌 Pin'}
            </button>
            <button class="btn secondary" onclick="closeTable()">✖️ Close</button>
        </div>
    </div>
    
    <div class="table-container">
        <table class="parameter-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Value</th>
                    <th>Description</th>
                </tr>
            </thead>
            <tbody>
                ${parameters.map((param, index) => `
                    <tr>
                        <td><strong>${param.name}</strong></td>
                        <td><span class="type-badge">${param.type}</span></td>
                        <td>${param.required ? '<span class="required-badge">Required</span>' : 'Optional'}</td>
                        <td>
                            <input 
                                type="text" 
                                class="param-input" 
                                value="${escapeHtml(param.default || '')}" 
                                placeholder="${param.description || param.type}"
                                onchange="updateParameter('${param.name}', this.value)"
                                id="param_${param.name}"
                            />
                        </td>
                        <td>${param.description || ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        
        <div class="actions">
            <button class="execute-btn" onclick="executeWithCurrentParams()">
                ▶️ Execute with Parameters
            </button>
            <button class="add-param-btn" onclick="addParameter()">
                ➕ Add Parameter
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isPinned = ${isPinned};
        
        function togglePin() {
            isPinned = !isPinned;
            vscode.postMessage({
                command: isPinned ? 'pin' : 'unpin'
            });
        }
        
        function closeTable() {
            vscode.postMessage({ command: 'close' });
        }
        
        function updateParameter(name, value) {
            vscode.postMessage({
                command: 'updateParameter',
                name: name,
                value: value
            });
        }
        
        function executeWithCurrentParams() {
            const parameters = {};
            ${parameters.map(param => `
                parameters['${param.name}'] = document.getElementById('param_${param.name}').value;
            `).join('')}
            
            vscode.postMessage({
                command: 'executeWithParams',
                parameters: parameters
            });
        }
        
        function addParameter() {
            const name = prompt('Parameter name:');
            if (!name) return;
            
            const type = prompt('Parameter type:', 'string');
            if (!type) return;
            
            const description = prompt('Description (optional):') || '';
            const required = confirm('Is this parameter required?');
            
            vscode.postMessage({
                command: 'addParameter',
                parameter: {
                    name: name,
                    type: type,
                    description: description,
                    required: required
                }
            });
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updatePinState':
                    isPinned = message.isPinned;
                    document.getElementById('pinBtn').textContent = 
                        isPinned ? '📌 Unpin' : '📌 Pin';
                    break;
            }
        });
    </script>
</body>
</html>
        `;
    }
    */

export function activate(context: vscode.ExtensionContext) {
    console.log('Prompd extension is now active');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('prompd.execute', executePrompdFile),
        vscode.commands.registerCommand('prompd.validate', validatePrompdFile),
        vscode.commands.registerCommand('prompd.bumpVersion', bumpVersion),
        vscode.commands.registerCommand('prompd.preview', previewPrompt),
        vscode.commands.registerCommand('prompd.gitAdd', gitAddFile),
        vscode.commands.registerCommand('prompd.gitCommit', gitCommitFile),
        vscode.commands.registerCommand('prompd.gitCheckout', gitCheckoutVersion),
        vscode.commands.registerCommand('prompd.versionHistory', showVersionHistory),
        vscode.commands.registerCommand('prompd.executeVersion', executeSpecificVersion),
        // Removed - using sidebar instead: vscode.commands.registerCommand('prompd.showParameterTable', showParameterTable),
        vscode.commands.registerCommand('prompd.executeWithResponseCapture', executeWithResponseCapture),
        // Removed - using sidebar instead: vscode.commands.registerCommand('prompd.toggleParameterTable', toggleParameterTable)
    );

    // Register providers
    registerDiagnosticProvider(context);
    registerCompletionProvider(context);
    registerHoverProvider(context);
    registerCodeLensProvider(context);
    registerViewProvider(context);

    // Validate on save
    vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === 'prompd') {
            const config = vscode.workspace.getConfiguration('prompd');
            if (config.get('validateOnSave')) {
                validateDocument(document);
            }
        }
    });
}

async function executePrompdFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const config = vscode.workspace.getConfiguration('prompd');
    const defaultProvider = config.get<string>('defaultProvider', 'openai');
    const defaultModel = config.get<string>('defaultModel', 'gpt-4');

    // Parse the file to get parameters
    const content = editor.document.getText();
    const parameters = await extractParameters(content);

    // Show input box for parameters
    const paramInputs: Record<string, string> = {};
    for (const param of parameters) {
        const input = await vscode.window.showInputBox({
            prompt: `Enter value for ${param.name}`,
            placeHolder: param.description || `${param.type} value`,
            value: param.default?.toString() || ''
        });
        
        if (input === undefined) {
            return; // User cancelled
        }
        paramInputs[param.name] = input;
    }

    // Show quick pick for provider
    const provider = await vscode.window.showQuickPick(
        ['openai', 'anthropic', 'ollama'],
        {
            placeHolder: 'Select LLM provider'
        }
    );

    if (!provider) {
        return;
    }

    // Show input box for model
    const model = await vscode.window.showInputBox({
        prompt: 'Enter model name',
        value: defaultModel
    });

    if (!model) {
        return;
    }

    // Execute the prompt
    const outputChannel = vscode.window.createOutputChannel('Prompd Execution');
    outputChannel.show();
    outputChannel.appendLine(`Executing ${editor.document.fileName}`);
    outputChannel.appendLine(`Provider: ${provider}, Model: ${model}`);
    outputChannel.appendLine('Parameters: ' + JSON.stringify(paramInputs, null, 2));

    try {
        // Use secure command execution
        const args = buildPrompdArgs('execute', editor.document.fileName, {
            provider,
            model,
            parameters: paramInputs
        });
        
        outputChannel.appendLine('Running: prompd ' + args.join(' '));
        const { stdout, stderr } = await executeSecureCommand('prompd', args);
        
        if (stderr) {
            outputChannel.appendLine('Error: ' + stderr);
        } else {
            outputChannel.appendLine('Response:');
            outputChannel.appendLine(stdout);
        }
    } catch (error: any) {
        outputChannel.appendLine('Error: ' + error.message);
        vscode.window.showErrorMessage('Failed to execute prompt: ' + error.message);
    }
}

async function validatePrompdFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    await validateDocument(editor.document);
}

async function validateDocument(document: vscode.TextDocument) {
    try {
        const args = buildPrompdArgs('validate', document.fileName, { verbose: true });
        const { stdout } = await executeSecureCommand('prompd', args);
        
        if (stdout.includes('is valid')) {
            vscode.window.showInformationMessage('Prompd file is valid');
        } else {
            vscode.window.showWarningMessage('Validation issues found. Check Problems panel.');
            // Parse validation output and create diagnostics
            parseValidationOutput(stdout, document);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage('Validation failed: ' + error.message);
    }
}

async function bumpVersion() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const bumpType = await vscode.window.showQuickPick(
        ['patch', 'minor', 'major'],
        { placeHolder: 'Select version bump type' }
    );

    if (!bumpType) {
        return;
    }

    const message = await vscode.window.showInputBox({
        prompt: 'Enter commit message (optional)'
    });

    try {
        // Build args for: prompd version bump <file> <bump_type> [-m message]
        const args = ['version', 'bump', editor.document.fileName, bumpType];
        if (message) {
            args.push('-m', message);
        }
        const { stdout } = await executeSecureCommand('prompd', args);
        
        vscode.window.showInformationMessage(stdout);
        // Reload the document to show new version
        await vscode.commands.executeCommand('workbench.action.files.revert');
    } catch (error: any) {
        vscode.window.showErrorMessage('Version bump failed: ' + error.message);
    }
}

async function previewPrompt() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const content = editor.document.getText();
    const parameters = await extractParameters(content);
    
    // Create preview panel
    const panel = vscode.window.createWebviewPanel(
        'prompdPreview',
        'Prompd Preview',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    // Generate preview HTML with CSP
    panel.webview.html = generatePreviewHtml(content, parameters, panel.webview);
}

async function gitAddFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    try {
        // prompd git add <file>
        const args = ['git', 'add', editor.document.fileName];
        const { stdout, stderr } = await executeSecureCommand('prompd', args);
        
        if (stderr) {
            vscode.window.showErrorMessage('Git add failed: ' + stderr);
        } else {
            vscode.window.showInformationMessage('File added to git staging area');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage('Git add failed: ' + error.message);
    }
}

async function gitCommitFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const message = await vscode.window.showInputBox({
        prompt: 'Enter commit message',
        placeHolder: 'Update prompd file'
    });

    if (!message) {
        return;
    }

    try {
        // First add the file: prompd git add <file>
        const addArgs = ['git', 'add', editor.document.fileName];
        await executeSecureCommand('prompd', addArgs);
        
        // Then commit: prompd git commit -m "message"
        const commitArgs = ['git', 'commit', '-m', message];
        const { stdout, stderr } = await executeSecureCommand('prompd', commitArgs);
        
        if (stderr && !stderr.includes('nothing to commit')) {
            vscode.window.showErrorMessage('Git commit failed: ' + stderr);
        } else {
            vscode.window.showInformationMessage('Changes committed successfully');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage('Git commit failed: ' + error.message);
    }
}

async function gitCheckoutVersion() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const version = await vscode.window.showInputBox({
        prompt: 'Enter version to checkout',
        placeHolder: '1.2.3, HEAD, HEAD~1, or commit hash'
    });

    if (!version) {
        return;
    }

    const options = ['Overwrite current file', 'Save to new file'];
    const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'How do you want to checkout?'
    });

    if (!choice) {
        return;
    }

    try {
        // Build args for: prompd git checkout <file> <version> [-o output]
        const checkoutArgs = ['git', 'checkout', editor.document.fileName, version];
        if (choice === 'Save to new file') {
            const newPath = editor.document.fileName.replace('.prompd', `-${version}.prompd`);
            checkoutArgs.push('-o', newPath);
        }

        const { stdout, stderr } = await executeSecureCommand('prompd', checkoutArgs);
        
        if (stderr) {
            vscode.window.showErrorMessage('Checkout failed: ' + stderr);
        } else {
            vscode.window.showInformationMessage(`Checked out version ${version}`);
            
            // Reload the document if overwritten
            if (choice === 'Overwrite current file') {
                await vscode.commands.executeCommand('workbench.action.files.revert');
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage('Checkout failed: ' + error.message);
    }
}

async function showVersionHistory() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const outputChannel = vscode.window.createOutputChannel('Prompd Version History');
    outputChannel.show();

    try {
        // prompd version history <file>
        const args = ['version', 'history', editor.document.fileName];
        const { stdout, stderr } = await executeSecureCommand('prompd', args);
        
        if (stderr) {
            outputChannel.appendLine('Error: ' + stderr);
        } else {
            outputChannel.appendLine(stdout);
        }
    } catch (error: any) {
        outputChannel.appendLine('Error: ' + error.message);
    }
}

async function executeSpecificVersion() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const version = await vscode.window.showInputBox({
        prompt: 'Enter version to execute',
        placeHolder: '1.2.3, HEAD, or commit hash'
    });

    if (!version) {
        return;
    }

    const config = vscode.workspace.getConfiguration('prompd');
    const defaultProvider = config.get<string>('defaultProvider', 'openai');
    const defaultModel = config.get<string>('defaultModel', 'gpt-4');

    // Parse the file to get parameters
    const content = editor.document.getText();
    const parameters = await extractParameters(content);

    // Show input box for parameters
    const paramInputs: Record<string, string> = {};
    for (const param of parameters) {
        const input = await vscode.window.showInputBox({
            prompt: `Enter value for ${param.name}`,
            placeHolder: param.description || `${param.type} value`,
            value: param.default?.toString() || ''
        });
        
        if (input === undefined) {
            return; // User cancelled
        }
        paramInputs[param.name] = input;
    }

    // Show quick pick for provider
    const provider = await vscode.window.showQuickPick(
        ['openai', 'anthropic', 'ollama'],
        {
            placeHolder: 'Select LLM provider'
        }
    );

    if (!provider) {
        return;
    }

    // Show input box for model
    const model = await vscode.window.showInputBox({
        prompt: 'Enter model name',
        value: defaultModel
    });

    if (!model) {
        return;
    }

    // Execute the prompt with version
    const outputChannel = vscode.window.createOutputChannel('Prompd Execution');
    outputChannel.show();
    outputChannel.appendLine(`Executing ${editor.document.fileName} @ version ${version}`);
    outputChannel.appendLine(`Provider: ${provider}, Model: ${model}`);
    outputChannel.appendLine('Parameters: ' + JSON.stringify(paramInputs, null, 2));

    try {
        // Use secure command execution
        const args = buildPrompdArgs('execute', editor.document.fileName, {
            provider,
            model,
            version,
            parameters: paramInputs
        });
        
        outputChannel.appendLine('Running: prompd ' + args.join(' '));
        const { stdout, stderr } = await executeSecureCommand('prompd', args);
        
        if (stderr) {
            outputChannel.appendLine('Error: ' + stderr);
        } else {
            outputChannel.appendLine('Response:');
            outputChannel.appendLine(stdout);
        }
    } catch (error: any) {
        outputChannel.appendLine('Error: ' + error.message);
        vscode.window.showErrorMessage('Failed to execute prompt: ' + error.message);
    }
}

// Removed showParameterTable - functionality moved to sidebar

async function executeWithResponseCapture() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        vscode.window.showErrorMessage('Please open a .prompd file');
        return;
    }

    const config = vscode.workspace.getConfiguration('prompd');
    const defaultProvider = config.get<string>('defaultProvider', 'openai');
    const defaultModel = config.get<string>('defaultModel', 'gpt-4');

    // Parse the file to get parameters
    const content = editor.document.getText();
    const parameters = await extractParameters(content);

    // Show parameter input form in webview
    const panel = vscode.window.createWebviewPanel(
        'prompdExecute',
        'Execute Prompd',
        vscode.ViewColumn.Beside,
        { 
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = generateExecutionFormHtml(parameters, defaultProvider, defaultModel, panel.webview);
    
    // Handle execution
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'execute':
                    await executeAndCaptureResponse(
                        editor.document.fileName,
                        message.provider,
                        message.model,
                        message.parameters,
                        message.version,
                        panel
                    );
                    return;
            }
        }
    );
}

async function executeWithParameters(parameters: Record<string, string>) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'prompd') {
        return;
    }

    const config = vscode.workspace.getConfiguration('prompd');
    const defaultProvider = config.get<string>('defaultProvider', 'openai');
    const defaultModel = config.get<string>('defaultModel', 'gpt-4');

    // Show quick pick for provider
    const provider = await vscode.window.showQuickPick(
        ['openai', 'anthropic', 'ollama'],
        {
            placeHolder: 'Select LLM provider'
        }
    );

    if (!provider) {
        return;
    }

    const model = await vscode.window.showInputBox({
        prompt: 'Enter model name',
        value: defaultModel
    });

    if (!model) {
        return;
    }

    await executeAndCaptureResponse(
        editor.document.fileName,
        provider,
        model,
        parameters,
        undefined,
        undefined
    );
}

async function executeAndCaptureResponse(
    fileName: string,
    provider: string,
    model: string,
    parameters: Record<string, string>,
    version?: string,
    panel?: vscode.WebviewPanel
) {
    try {
        // Use secure command execution
        const options: any = {
            provider,
            model,
            parameters
        };
        if (version) {
            options.version = version;
        }
        
        const args = buildPrompdArgs('execute', fileName, options);
        
        // Update panel status
        if (panel) {
            panel.webview.postMessage({
                command: 'executing',
                message: 'Executing prompt...'
            });
        }

        const { stdout, stderr } = await executeSecureCommand('prompd', args);
        
        if (stderr) {
            vscode.window.showErrorMessage('Execution failed: ' + stderr);
            return;
        }

        // Show response capture options
        const responseOptions = [
            'Create new document',
            'Insert at cursor',
            'Save to file',
            'Show in panel only'
        ];

        const choice = await vscode.window.showQuickPick(responseOptions, {
            placeHolder: 'How do you want to capture the response?'
        });

        switch (choice) {
            case 'Create new document':
                const newDoc = await vscode.workspace.openTextDocument({
                    content: stdout,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(newDoc);
                break;

            case 'Insert at cursor':
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const position = editor.selection.active;
                    await editor.edit(editBuilder => {
                        editBuilder.insert(position, '\n\n<!-- Response -->\n' + stdout + '\n');
                    });
                }
                break;

            case 'Save to file':
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(`response-${Date.now()}.md`),
                    filters: {
                        markdown: ['md'],
                        text: ['txt'],
                        allFiles: ['*']
                    }
                });
                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(stdout));
                    vscode.window.showInformationMessage(`Response saved to ${uri.fsPath}`);
                }
                break;

            case 'Show in panel only':
            default:
                // Already shown in panel or output channel
                break;
        }

        // Update panel with response
        if (panel) {
            panel.webview.postMessage({
                command: 'response',
                response: stdout
            });
        } else {
            // Show in output channel as fallback
            const outputChannel = vscode.window.createOutputChannel('Prompd Response');
            outputChannel.clear();
            outputChannel.appendLine(stdout);
            outputChannel.show();
        }

    } catch (error: any) {
        vscode.window.showErrorMessage('Execution failed: ' + error.message);
        if (panel) {
            panel.webview.postMessage({
                command: 'error',
                error: error.message
            });
        }
    }
}

// Removed generateParameterTableHtml - consolidated into sidebar
/*
function generateParameterTableHtml(parameters: any[]): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompd Parameters</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .parameter-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        .parameter-table th,
        .parameter-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .parameter-table th {
            background: var(--vscode-editor-selectionBackground);
            font-weight: bold;
        }
        .parameter-table tr:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .type-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.8em;
        }
        .required {
            color: var(--vscode-errorForeground);
            font-weight: bold;
        }
        .execute-form {
            margin-top: 20px;
            padding: 20px;
            background: var(--vscode-input-background);
            border-radius: 4px;
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-group input {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .execute-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .execute-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <h2>Parameters (${parameters.length})</h2>
    
    <table class="parameter-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Default</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            ${parameters.map(param => `
                <tr>
                    <td><strong>${param.name}</strong></td>
                    <td><span class="type-badge">${param.type}</span></td>
                    <td>${param.required ? '<span class="required">Yes</span>' : 'No'}</td>
                    <td><code>${param.default || ''}</code></td>
                    <td>${param.description || ''}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <div class="execute-form">
        <h3>Quick Execute</h3>
        ${parameters.map(param => `
            <div class="form-group">
                <label for="${param.name}">${param.name} ${param.required ? '<span class="required">*</span>' : ''}</label>
                <input type="text" id="${param.name}" placeholder="${param.description || param.type}" value="${param.default || ''}">
            </div>
        `).join('')}
        
        <button class="execute-btn" onclick="executeWithCurrentParams()">
            Execute with Parameters
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function executeWithCurrentParams() {
            const parameters = {};
            ${parameters.map(param => `
                parameters['${param.name}'] = document.getElementById('${param.name}').value;
            `).join('')}
            
            vscode.postMessage({
                command: 'executeWithParams',
                parameters: parameters
            });
        }
    </script>
</body>
</html>
    `;
}
*/

function generateExecutionFormHtml(parameters: any[], defaultProvider: string, defaultModel: string, webview: vscode.Webview): string {
    const csp = getWebviewCSP(webview);
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>Execute Prompd</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .form-group input, .form-group select {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .execute-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        .execute-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .execute-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 4px;
            display: none;
        }
        .status.executing {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            display: block;
        }
        .status.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            display: block;
        }
        .response {
            margin-top: 20px;
            padding: 15px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family);
            display: none;
        }
        .section-title {
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 18px;
            font-weight: bold;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 5px;
        }
        .required {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <h2>Execute Prompd</h2>
    
    <div class="section-title">Provider Configuration</div>
    
    <div class="form-group">
        <label for="provider">Provider</label>
        <select id="provider">
            <option value="openai" ${defaultProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="anthropic" ${defaultProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
            <option value="ollama" ${defaultProvider === 'ollama' ? 'selected' : ''}>Ollama</option>
        </select>
    </div>
    
    <div class="form-group">
        <label for="model">Model</label>
        <input type="text" id="model" value="${defaultModel}" placeholder="Enter model name">
    </div>
    
    <div class="form-group">
        <label for="version">Version (optional)</label>
        <input type="text" id="version" placeholder="1.2.3, HEAD, or commit hash">
    </div>

    <div class="section-title">Parameters</div>
    
    ${parameters.map(param => `
        <div class="form-group">
            <label for="param_${param.name}">${param.name} ${param.required ? '<span class="required">*</span>' : ''}</label>
            <input type="text" id="param_${param.name}" placeholder="${param.description || param.type}" value="${param.default || ''}">
        </div>
    `).join('')}
    
    <button class="execute-btn" onclick="executePrompt()" id="executeBtn">
        Execute Prompt
    </button>
    
    <div class="status" id="status"></div>
    <div class="response" id="response"></div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function executePrompt() {
            const provider = document.getElementById('provider').value;
            const model = document.getElementById('model').value;
            const version = document.getElementById('version').value;
            
            if (!model.trim()) {
                alert('Please enter a model name');
                return;
            }
            
            const parameters = {};
            ${parameters.map(param => `
                const ${param.name}Value = document.getElementById('param_${param.name}').value;
                if ('${param.required}' === 'true' && !${param.name}Value.trim()) {
                    alert('Parameter ${param.name} is required');
                    return;
                }
                parameters['${param.name}'] = ${param.name}Value;
            `).join('')}
            
            document.getElementById('executeBtn').disabled = true;
            document.getElementById('status').className = 'status executing';
            document.getElementById('status').textContent = 'Executing prompt...';
            document.getElementById('response').style.display = 'none';
            
            vscode.postMessage({
                command: 'execute',
                provider: provider,
                model: model,
                version: version || undefined,
                parameters: parameters
            });
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'executing':
                    document.getElementById('status').className = 'status executing';
                    document.getElementById('status').textContent = message.message;
                    break;
                    
                case 'response':
                    document.getElementById('executeBtn').disabled = false;
                    document.getElementById('status').style.display = 'none';
                    document.getElementById('response').style.display = 'block';
                    document.getElementById('response').textContent = message.response;
                    break;
                    
                case 'error':
                    document.getElementById('executeBtn').disabled = false;
                    document.getElementById('status').className = 'status error';
                    document.getElementById('status').textContent = 'Error: ' + message.error;
                    break;
            }
        });
    </script>
</body>
</html>
    `;
}

// Removed toggleParameterTable - functionality moved to sidebar

async function extractParameters(content: string): Promise<any[]> {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
        return [];
    }

    try {
        const metadata = yaml.parse(frontmatterMatch[1]);
        return metadata.parameters || [];
    } catch {
        return [];
    }
}

function generatePreviewHtml(content: string, parameters: any[], webview: vscode.Webview): string {
    const csp = getWebviewCSP(webview);
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>Prompd Preview</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            line-height: 1.6;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .frontmatter {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .parameter {
            background: var(--vscode-editor-selectionBackground);
            border-left: 3px solid var(--vscode-button-background);
            padding: 10px;
            margin: 10px 0;
        }
        .variable {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        h1, h2, h3 {
            color: var(--vscode-foreground);
            margin-top: 20px;
        }
        .section-header {
            color: var(--vscode-button-background);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Prompd Preview</h1>
    
    <div class="frontmatter">
        <h2>Parameters</h2>
        ${parameters.map(p => `
            <div class="parameter">
                <strong>${p.name}</strong> (${p.type})
                ${p.required ? '<span style="color: red;">*required</span>' : ''}
                <br>
                ${p.description || ''}
                ${p.default ? `<br>Default: ${p.default}` : ''}
            </div>
        `).join('')}
    </div>

    <div class="content">
        <h2>Prompt Content</h2>
        ${content.replace(/^---[\s\S]*?---\n/, '')
            .replace(/\{([^}]+)\}/g, '<span class="variable">{$1}</span>')
            .replace(/^#\s+(.+)$/gm, '<h3 class="section-header">$1</h3>')
            .replace(/\n/g, '<br>')}
    </div>
</body>
</html>
    `;
}

function registerDiagnosticProvider(context: vscode.ExtensionContext) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('prompd');
    context.subscriptions.push(diagnosticCollection);

    // Validate open documents
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'prompd') {
            updateDiagnostics(document, diagnosticCollection);
        }
    });

    // Validate on change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === 'prompd') {
                updateDiagnostics(e.document, diagnosticCollection);
            }
        })
    );
}

function updateDiagnostics(
    document: vscode.TextDocument,
    diagnosticCollection: vscode.DiagnosticCollection
) {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    // Check for frontmatter
    if (!text.startsWith('---')) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            'Missing YAML frontmatter',
            vscode.DiagnosticSeverity.Error
        ));
    }

    // Check for undefined variables
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
        try {
            const metadata = yaml.parse(frontmatterMatch[1]);
            const definedParams = new Set(
                (metadata.parameters || []).map((p: any) => p.name)
            );

            // Find variable references
            const variableRegex = /\{([^}]+)\}/g;
            let match;
            while ((match = variableRegex.exec(text)) !== null) {
                const varName = match[1].split('.')[0];
                if (!definedParams.has(varName) && !varName.startsWith('inputs')) {
                    const position = document.positionAt(match.index);
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(position, position.translate(0, match[0].length)),
                        `Undefined variable: ${varName}`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        } catch (e) {
            // YAML parse error
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(1, 0, 1, 0),
                'Invalid YAML in frontmatter',
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

function registerCompletionProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        'prompd',
        {
            provideCompletionItems(document, position) {
                const line = document.lineAt(position);
                const text = line.text.substring(0, position.character);

                // Variable completion
                if (text.includes('{')) {
                    return getVariableCompletions(document);
                }

                // Parameter type completion
                if (text.includes('type:')) {
                    return getTypeCompletions();
                }

                return undefined;
            }
        },
        '{', ':'
    );

    context.subscriptions.push(provider);
}

function getVariableCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
    const completions: vscode.CompletionItem[] = [];
    const content = document.getText();
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (frontmatterMatch) {
        try {
            const metadata = yaml.parse(frontmatterMatch[1]);
            (metadata.parameters || []).forEach((param: any) => {
                const item = new vscode.CompletionItem(
                    param.name,
                    vscode.CompletionItemKind.Variable
                );
                item.detail = `Type: ${param.type}`;
                item.documentation = param.description || '';
                completions.push(item);
            });
        } catch {}
    }

    return completions;
}

function getTypeCompletions(): vscode.CompletionItem[] {
    const types = ['string', 'integer', 'float', 'boolean', 'array', 'object'];
    return types.map(type => {
        const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Value);
        item.detail = `Parameter type: ${type}`;
        return item;
    });
}

function registerHoverProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerHoverProvider('prompd', {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position, /\{([^}]+)\}/);
            if (!range) {
                return undefined;
            }

            const word = document.getText(range);
            const varName = word.slice(1, -1); // Remove { }

            // Find parameter definition
            const content = document.getText();
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

            if (frontmatterMatch) {
                try {
                    const metadata = yaml.parse(frontmatterMatch[1]);
                    const param = (metadata.parameters || []).find(
                        (p: any) => p.name === varName
                    );

                    if (param) {
                        const markdown = new vscode.MarkdownString();
                        markdown.appendMarkdown(`**${param.name}** *(${param.type})*\n\n`);
                        if (param.description) {
                            markdown.appendMarkdown(param.description + '\n\n');
                        }
                        if (param.required) {
                            markdown.appendMarkdown('**Required**\n\n');
                        }
                        if (param.default !== undefined) {
                            markdown.appendMarkdown(`Default: \`${param.default}\`\n`);
                        }
                        return new vscode.Hover(markdown);
                    }
                } catch {}
            }

            return undefined;
        }
    });

    context.subscriptions.push(provider);
}

function registerCodeLensProvider(context: vscode.ExtensionContext) {
    // Disabled CodeLens to reduce UI clutter - using sidebar instead
    // If you want to re-enable, set prompd.showCodeLens to true in settings
    const provider = vscode.languages.registerCodeLensProvider('prompd', {
        provideCodeLenses(document) {
            const config = vscode.workspace.getConfiguration('prompd');
            if (!config.get('showCodeLens')) {
                return [];
            }
            // Return empty array - all functionality moved to sidebar
            return [];
        }
    });

    context.subscriptions.push(provider);
}

function parseValidationOutput(output: string, document: vscode.TextDocument) {
    // This would parse the CLI validation output and create diagnostics
    // For now, just a simple implementation
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('prompd-validation');
    const diagnostics: vscode.Diagnostic[] = [];

    if (output.includes('ERROR')) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            'Validation errors found',
            vscode.DiagnosticSeverity.Error
        ));
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

// Webview provider for the Parameters & Execution view
class PrompdWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'prompdParameters';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this.updateContent();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'execute':
                    await this.executePromptWithSettings(data.provider, data.model, data.parameters);
                    break;
                case 'executeAdhoc':
                    await this.executeAdhocPrompt(data.prompt, data.provider, data.model, data.parameters);
                    break;
                case 'updateParameter':
                    // Handle parameter updates
                    break;
            }
        });

        // Update content when active editor changes
        vscode.window.onDidChangeActiveTextEditor(() => {
            this.updateContent();
        });

        // Update content when .prompd files are saved
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'prompd') {
                this.updateContent();
            }
        });
    }

    private async updateContent() {
        if (this._view) {
            this._view.webview.html = await this.getHtmlForWebview();
        }
    }

    private async getHtmlForWebview(): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        let parameters: any[] = [];
        let fileName = 'No .prompd file open';

        if (editor && editor.document.languageId === 'prompd') {
            parameters = await extractParameters(editor.document.getText());
            fileName = path.basename(editor.document.fileName);
        }

        // Cache busting for webview updates
        const cacheId = Date.now();
        const csp = this._view ? getWebviewCSP(this._view.webview) : '';

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}
    <title>Prompd Parameters</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-size: 13px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .main-content {
            flex: 1;
            padding: 8px;
            overflow-y: auto;
        }
        
        .bottom-section {
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
            padding: 8px;
            margin-top: auto;
        }
        
        .header-section {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        
        .provider-model-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .current-file {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
        }
        
        .execute-btn {
            width: 100%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            margin-bottom: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease;
            position: relative;
        }
        
        .execute-btn:hover {
            background: var(--vscode-button-hoverBackground);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            transform: translateY(-1px);
        }
        
        .execute-btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        .execute-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .parameters-section {
            margin-bottom: 16px;
        }
        
        .section-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            opacity: 0.9;
        }
        
        .parameter {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 10px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            transition: all 0.2s ease;
        }
        
        .parameter:hover {
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
            border-color: var(--vscode-focusBorder, var(--vscode-input-border));
        }
        
        .parameter-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        
        .parameter-name {
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        
        .parameter-type {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
        }
        
        .parameter-required {
            color: var(--vscode-errorForeground);
            font-size: 11px;
        }
        
        .parameter-input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 12px;
            box-sizing: border-box;
            transition: all 0.2s ease;
        }
        
        .parameter-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(14, 99, 156, 0.15);
        }
        
        .parameter-description {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        
        .provider-section {
            margin-bottom: 12px;
        }
        
        .provider-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .provider-select, .model-select {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 12px;
            transition: all 0.2s ease;
        }
        
        .provider-select:focus, .model-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(14, 99, 156, 0.15);
        }
        
        .play-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 44px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            gap: 8px;
            margin-bottom: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .play-button:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .play-button:active {
            transform: translateY(0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .play-icon {
            font-size: 18px;
            margin-left: 2px;
        }
        
        .textarea-container {
            position: relative;
        }
        
        .docked-execute-btn {
            position: absolute;
            bottom: 8px;
            right: 8px;
            width: 36px;
            height: 28px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            transition: all 0.2s ease;
            z-index: 10;
        }
        
        .docked-execute-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.05);
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
        }
        
        .docked-execute-btn:active {
            transform: scale(0.95);
        }
        
        .adhoc-section {
            margin-bottom: 8px;
        }
        
        .adhoc-toggle {
            width: 100%;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            margin-bottom: 8px;
            text-align: left;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            transition: all 0.2s ease;
        }
        
        .adhoc-toggle:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            border-color: var(--vscode-focusBorder);
        }
        
        .adhoc-content {
            display: none;
        }
        
        .adhoc-content.expanded {
            display: block;
        }
        
        .adhoc-textarea {
            width: 100%;
            min-height: 100px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 10px;
            padding-right: 50px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
            transition: all 0.2s ease;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        
        .adhoc-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(14, 99, 156, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1);
        }
        
        .no-file {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body data-cache="${cacheId}">
    ${editor && editor.document.languageId === 'prompd' ? `
        <div class="header-section">
            <div class="provider-model-row">
                <select class="provider-select" id="provider-select" onchange="updateModels()">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="ollama">Ollama</option>
                </select>
                <select class="model-select" id="model-select">
                    <option value="gpt-4">gpt-4</option>
                    <option value="gpt-4-turbo">gpt-4-turbo</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                </select>
            </div>
            <button class="play-button" onclick="executePrompt()" style="margin-bottom: 8px;">
                <span class="play-icon">▶</span>
                <span>Execute .prompd File</span>
            </button>
            <div class="current-file">📄 ${escapeHtml(fileName)}</div>
        </div>
        
        <div class="main-content">
            <div class="parameters-section">
                ${parameters.length > 0 ? `
                    <div class="section-title">Parameters (${parameters.length})</div>
                    ${parameters.map(param => `
                        <div class="parameter">
                            <div class="parameter-header">
                                <span class="parameter-name">${escapeHtml(param.name)}</span>
                                <div>
                                    <span class="parameter-type">${escapeHtml(param.type || 'string')}</span>
                                    ${param.required ? '<span class="parameter-required">*</span>' : ''}
                                </div>
                            </div>
                            <input 
                                type="text" 
                                class="parameter-input" 
                                placeholder="${escapeHtml(param.description || 'Enter value')}"
                                value="${escapeHtml(param.default || '')}"
                                data-param="${escapeHtml(param.name)}"
                            />
                            ${param.description ? `<div class="parameter-description">${escapeHtml(param.description)}</div>` : ''}
                        </div>
                    `).join('')}
                ` : '<div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 32px 16px;">No parameters defined</div>'}
            </div>
        </div>
        
        <div class="bottom-section">
            <div class="adhoc-section">
                <button class="adhoc-toggle" onclick="toggleAdhoc()">
                    <span>📝 Adhoc Prompt</span>
                    <span id="adhoc-toggle-icon">▼</span>
                </button>
                <div class="adhoc-content" id="adhoc-content">
                    <div class="textarea-container">
                        <textarea 
                            class="adhoc-textarea" 
                            placeholder="Type your prompt here... You can use {parameter_name} syntax to reference parameters from above.&#10;&#10;Tip: Use Ctrl+Enter to execute"
                            id="adhoc-prompt"
                        ></textarea>
                        <button class="docked-execute-btn" onclick="executeAdhocPrompt()" title="Execute Adhoc Prompt (Ctrl+Enter)">
                            ▶
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ` : `
        <div class="header-section">
            <div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 16px;">
                Open a .prompd file to get started
            </div>
        </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();
        
        // Model lists for each provider
        const models = {
            openai: [
                { value: 'gpt-4', label: 'GPT-4' },
                { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
                { value: 'gpt-4o', label: 'GPT-4o' },
                { value: 'gpt-4o-mini', label: 'GPT-4o Mini' }
            ],
            anthropic: [
                { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
                { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
                { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
                { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' }
            ],
            ollama: [
                { value: 'llama2', label: 'Llama 2' },
                { value: 'llama2:13b', label: 'Llama 2 13B' },
                { value: 'mistral', label: 'Mistral 7B' },
                { value: 'codellama', label: 'Code Llama' },
                { value: 'mixtral', label: 'Mixtral 8x7B' }
            ]
        };
        
        function updateModels() {
            const provider = document.getElementById('provider-select').value;
            const modelSelect = document.getElementById('model-select');
            
            // Clear existing options
            modelSelect.innerHTML = '';
            
            // Add new options based on provider
            models[provider].forEach(model => {
                const option = document.createElement('option');
                option.value = model.value;
                option.textContent = model.label;
                modelSelect.appendChild(option);
            });
        }
        
        function executePrompt() {
            const provider = document.getElementById('provider-select').value;
            const model = document.getElementById('model-select').value;
            
            const parameters = {};
            document.querySelectorAll('.parameter-input').forEach(input => {
                parameters[input.dataset.param] = input.value;
            });
            
            vscode.postMessage({
                type: 'execute',
                provider: provider,
                model: model,
                parameters: parameters
            });
        }
        
        function toggleAdhoc() {
            const content = document.getElementById('adhoc-content');
            const toggleIcon = document.getElementById('adhoc-toggle-icon');
            
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                toggleIcon.textContent = '▼';
            } else {
                content.classList.add('expanded');
                toggleIcon.textContent = '▲';
            }
        }
        
        function executeAdhocPrompt() {
            const prompt = document.getElementById('adhoc-prompt').value;
            if (!prompt.trim()) {
                return;
            }
            
            const provider = document.getElementById('provider-select').value;
            const model = document.getElementById('model-select').value;
            
            const parameters = {};
            document.querySelectorAll('.parameter-input').forEach(input => {
                parameters[input.dataset.param] = input.value;
            });
            
            vscode.postMessage({
                type: 'executeAdhoc',
                prompt: prompt,
                provider: provider,
                model: model,
                parameters: parameters
            });
        }
        
        // Initialize and add event listeners
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize models on load
            updateModels();
            
            // Add Ctrl+Enter functionality to textarea
            const textarea = document.getElementById('adhoc-prompt');
            if (textarea) {
                textarea.addEventListener('keydown', function(e) {
                    if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        executeAdhocPrompt();
                    }
                });
            }
        });
    </script>
</body>
</html>`;
    }

    private async executePrompt(parameters: Record<string, string>) {
        // Reuse existing execute logic
        await executeWithParameters(parameters);
    }

    private async executePromptWithSettings(provider: string, model: string, parameters: Record<string, string>) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'prompd') {
            return;
        }

        await executeAndCaptureResponse(
            editor.document.fileName,
            provider,
            model,
            parameters,
            undefined,
            undefined
        );
    }

    private async executeAdhocPrompt(prompt: string, provider: string, model: string, parameters: Record<string, string>) {
        // Create temporary file with adhoc prompt
        const tempContent = `---
name: adhoc-prompt
description: Temporary adhoc prompt
parameters: []
---

${prompt}`;

        // Save to temp file with secure random name
        const randomId = randomBytes(16).toString('hex');
        const tempUri = vscode.Uri.file(path.join(require('os').tmpdir(), `prompd-adhoc-${randomId}.prompd`));
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(tempContent));
        
        await executeAndCaptureResponse(
            tempUri.fsPath,
            provider,
            model,
            parameters,
            undefined,
            undefined
        );

        // Clean up temp file
        try {
            await vscode.workspace.fs.delete(tempUri);
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}

function registerViewProvider(context: vscode.ExtensionContext) {
    const provider = new PrompdWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('prompdParameters', provider)
    );
}

export function deactivate() {
    // Clean up
}