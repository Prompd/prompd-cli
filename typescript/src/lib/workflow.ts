/**
 * Prompd Workflow execution support for MCP integration
 * Handles .prmdflow files from prompd-IDE
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';

// Import flow types from prompd-IDE (simplified versions for CLI)
export interface PrompdFlowDocument {
    version: string;
    metadata: FlowMetadata;
    nodes: FlowNode[];
    connections: FlowConnection[];
    variables: FlowVariable[];
    executionConfig: ExecutionConfiguration;
}

export interface FlowMetadata {
    id: string;
    name: string;
    description?: string;
    version: string;
    parameters?: FlowParameter[];
}

export interface FlowParameter {
    name: string;
    type: string;
    required?: boolean;
    description?: string;
    default?: any;
}

export interface FlowNode {
    id: string;
    type: string;
    data: NodeData;
    inputPorts: Port[];
    outputPorts: Port[];
}

export interface NodeData {
    label: string;
    description?: string;
    enabled: boolean;
    config: any; // Node-specific configuration
}

export interface Port {
    id: string;
    name: string;
    dataType: string;
    required: boolean;
    description?: string;
}

export interface FlowConnection {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
}

export interface FlowVariable {
    name: string;
    type: string;
    value?: any;
    scope: 'global' | 'local';
    description?: string;
}

export interface ExecutionConfiguration {
    parallelism: {
        enabled: boolean;
        maxConcurrency: number;
    };
    errorHandling: {
        continueOnError: boolean;
        retryPolicy: {
            enabled: boolean;
            maxRetries: number;
        };
    };
}

export interface WorkflowExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
    nodesExecuted: number;
    errors: Array<{
        nodeId: string;
        message: string;
    }>;
}

export class WorkflowExecutor {
    private workflows: Map<string, PrompdFlowDocument> = new Map();

    async loadWorkflow(filePath: string): Promise<PrompdFlowDocument> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            let workflow: PrompdFlowDocument;

            if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
                workflow = yaml.parse(content);
            } else if (filePath.endsWith('.json')) {
                workflow = JSON.parse(content);
            } else if (filePath.endsWith('.prmdflow')) {
                // .prmdflow files are JSON format
                workflow = JSON.parse(content);
            } else {
                throw new Error(`Unsupported workflow file format: ${path.extname(filePath)}`);
            }

            // Validate workflow structure
            this.validateWorkflow(workflow);
            
            return workflow;
        } catch (error) {
            throw new Error(`Failed to load workflow from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private validateWorkflow(workflow: PrompdFlowDocument): void {
        if (!workflow.metadata) {
            throw new Error('Workflow metadata is required');
        }
        if (!workflow.metadata.name) {
            throw new Error('Workflow name is required');
        }
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow must contain at least one node');
        }

        // Validate node references in connections
        const nodeIds = new Set(workflow.nodes.map(n => n.id));
        for (const connection of workflow.connections || []) {
            if (!nodeIds.has(connection.sourceNodeId)) {
                throw new Error(`Connection references unknown source node: ${connection.sourceNodeId}`);
            }
            if (!nodeIds.has(connection.targetNodeId)) {
                throw new Error(`Connection references unknown target node: ${connection.targetNodeId}`);
            }
        }
    }

    getWorkflowParameters(workflow: PrompdFlowDocument): FlowParameter[] {
        // Extract parameters from metadata if available
        if (workflow.metadata.parameters) {
            return workflow.metadata.parameters;
        }

        // Otherwise, extract from parameter nodes
        const parameterNodes = workflow.nodes.filter(node => node.type === 'parameter');
        return parameterNodes.map(node => ({
            name: node.data.config.parameterName || node.data.label,
            type: node.data.config.dataType || 'string',
            required: node.data.config.required || false,
            description: node.data.description,
            default: node.data.config.defaultValue
        }));
    }

    async executeWorkflow(workflow: PrompdFlowDocument, parameters: Record<string, any>): Promise<WorkflowExecutionResult> {
        const startTime = Date.now();
        const executionContext = {
            variables: new Map<string, any>(),
            nodeOutputs: new Map<string, any>(),
            errors: [] as Array<{ nodeId: string; message: string }>
        };

        // Initialize variables from parameters
        for (const [key, value] of Object.entries(parameters)) {
            executionContext.variables.set(key, value);
        }

        // Initialize global variables
        for (const variable of workflow.variables || []) {
            if (variable.scope === 'global' && variable.value !== undefined) {
                executionContext.variables.set(variable.name, variable.value);
            }
        }

        try {
            // Simple sequential execution for now
            // In a full implementation, this would handle the complex execution graph
            const result = await this.executeNodes(workflow, executionContext);
            
            const executionTime = Date.now() - startTime;
            
            return {
                success: executionContext.errors.length === 0,
                result,
                executionTime,
                nodesExecuted: workflow.nodes.length,
                errors: executionContext.errors
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown execution error',
                executionTime: Date.now() - startTime,
                nodesExecuted: 0,
                errors: executionContext.errors
            };
        }
    }

    private async executeNodes(workflow: PrompdFlowDocument, context: any): Promise<any> {
        // This is a simplified sequential execution
        // A full implementation would:
        // 1. Build execution graph from connections
        // 2. Handle parallel execution based on dependencies
        // 3. Support all node types (condition, loop, etc.)
        // 4. Integrate with LLM providers for prompt nodes
        
        let finalResult = 'Workflow executed successfully';
        
        for (const node of workflow.nodes) {
            try {
                const result = await this.executeNode(node, context);
                context.nodeOutputs.set(node.id, result);
                
                // If this is an output node, capture its result
                if (node.type === 'output') {
                    finalResult = result;
                }
            } catch (error) {
                context.errors.push({
                    nodeId: node.id,
                    message: error instanceof Error ? error.message : 'Unknown node execution error'
                });
                
                // Stop execution on error unless configured to continue
                if (!workflow.executionConfig?.errorHandling?.continueOnError) {
                    throw error;
                }
            }
        }
        
        return finalResult;
    }

    private async executeNode(node: FlowNode, context: any): Promise<any> {
        // Simplified node execution - in reality this would handle each node type differently
        switch (node.type) {
            case 'parameter':
                // Parameter nodes just provide their configured value
                const paramName = node.data.config.parameterName;
                return context.variables.get(paramName) || node.data.config.defaultValue;
                
            case 'prompt':
                // For now, return a placeholder - would integrate with PrompdExecutor
                return `Executed prompt: ${node.data.label}`;
                
            case 'output':
                // Format output based on template
                const template = node.data.config.template || '{result}';
                return template.replace('{result}', 'Workflow completed');
                
            case 'transformer':
                // Apply transformation - simplified
                return `Transformed data from ${node.data.label}`;
                
            default:
                return `Executed ${node.type} node: ${node.data.label}`;
        }
    }

    registerWorkflow(name: string, workflow: PrompdFlowDocument): void {
        this.workflows.set(name, workflow);
    }

    getWorkflow(name: string): PrompdFlowDocument | undefined {
        return this.workflows.get(name);
    }

    listWorkflows(): string[] {
        return Array.from(this.workflows.keys());
    }

    async discoverWorkflows(directory: string): Promise<Array<{name: string, path: string, workflow: PrompdFlowDocument}>> {
        const glob = await import('glob');
        const pattern = path.join(directory, '**/*.prmdflow');
        const files = glob.sync(pattern);
        
        const workflows: Array<{name: string, path: string, workflow: PrompdFlowDocument}> = [];
        
        for (const file of files) {
            try {
                const workflow = await this.loadWorkflow(file);
                const name = workflow.metadata.name || path.basename(file, '.prmdflow');
                workflows.push({ name, path: file, workflow });
            } catch (error) {
                console.warn(`Skipping invalid workflow file ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        
        return workflows;
    }
}