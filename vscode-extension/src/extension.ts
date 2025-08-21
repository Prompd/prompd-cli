import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'yaml';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    console.log('Prompd extension is now active');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('prompd.execute', executePrompdFile),
        vscode.commands.registerCommand('prompd.validate', validatePrompdFile),
        vscode.commands.registerCommand('prompd.bumpVersion', bumpVersion),
        vscode.commands.registerCommand('prompd.preview', previewPrompt)
    );

    // Register providers
    registerDiagnosticProvider(context);
    registerCompletionProvider(context);
    registerHoverProvider(context);
    registerCodeLensProvider(context);

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
            placeHolder: 'Select LLM provider',
            activeItem: defaultProvider
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
        const paramArgs = Object.entries(paramInputs)
            .map(([key, value]) => `-p ${key}="${value}"`)
            .join(' ');

        const command = `prompd execute "${editor.document.fileName}" --provider ${provider} --model ${model} ${paramArgs}`;
        
        outputChannel.appendLine('Running: ' + command);
        const { stdout, stderr } = await execAsync(command);
        
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
        const { stdout } = await execAsync(`prompd validate "${document.fileName}" --verbose`);
        
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
        const messageArg = message ? `-m "${message}"` : '';
        const { stdout } = await execAsync(
            `prompd version bump "${editor.document.fileName}" ${bumpType} ${messageArg}`
        );
        
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

    // Generate preview HTML
    const html = generatePreviewHtml(content, parameters);
    panel.webview.html = html;
}

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

function generatePreviewHtml(content: string, parameters: any[]): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompd Preview</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            padding: 20px;
            line-height: 1.6;
        }
        .frontmatter {
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .parameter {
            background: #e8f4f8;
            border-left: 3px solid #0066cc;
            padding: 10px;
            margin: 10px 0;
        }
        .variable {
            background: #fff3cd;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }
        h1, h2, h3 {
            color: #333;
            margin-top: 20px;
        }
        .section-header {
            color: #0066cc;
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
    const provider = vscode.languages.registerCodeLensProvider('prompd', {
        provideCodeLenses(document) {
            const config = vscode.workspace.getConfiguration('prompd');
            if (!config.get('showCodeLens')) {
                return [];
            }

            const codeLenses: vscode.CodeLens[] = [];

            // Add code lens at the top of the file
            const topOfDocument = new vscode.Range(0, 0, 0, 0);
            
            codeLenses.push(new vscode.CodeLens(topOfDocument, {
                title: '$(play) Execute',
                command: 'prompd.execute'
            }));

            codeLenses.push(new vscode.CodeLens(topOfDocument, {
                title: '$(check) Validate',
                command: 'prompd.validate'
            }));

            codeLenses.push(new vscode.CodeLens(topOfDocument, {
                title: '$(eye) Preview',
                command: 'prompd.preview'
            }));

            return codeLenses;
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

export function deactivate() {
    // Clean up
}