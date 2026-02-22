/**
 * Prompd Workflow Execution Engine
 * Enterprise-grade LLM workflow chaining with OAuth, security, and RPC
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import { SecurityManager } from './security';
import { PrompdFlowDocument, FlowNode, FlowConnection, ExecutionConfiguration } from './workflow';

export interface WorkflowExecutionRequest {
  workflowId: string;
  parameters: Record<string, any>;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowExecutionResponse {
  success: boolean;
  executionId: string;
  result?: any;
  error?: string;
  metrics: ExecutionMetrics;
  logs: ExecutionLog[];
}

export interface ExecutionMetrics {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  nodesExecuted: number;
  llmCalls: number;
  totalTokens: number;
  costs: {
    totalCost: number;
    breakdown: Record<string, number>;
  };
}

export interface ExecutionLog {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  nodeId?: string;
  message: string;
  data?: any;
}

export interface NodeExecutionContext {
  nodeId: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  variables: Map<string, any>;
  metadata: {
    executionId: string;
    userId?: string;
    startTime: Date;
  };
}

export interface ExecutionPlan {
  nodes: ExecutionNode[];
  dependencies: Map<string, string[]>;
  parallelGroups: string[][];
}

export interface ExecutionNode {
  id: string;
  type: string;
  config: any;
  dependencies: string[];
  canRunInParallel: boolean;
}

/**
 * Core workflow execution engine
 */
export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, PrompdFlowDocument> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private nodeExecutors: Map<string, NodeExecutor> = new Map();

  constructor() {
    super();
    this.setupNodeExecutors();
  }

  /**
   * Register a workflow for execution
   */
  async registerWorkflow(workflow: PrompdFlowDocument): Promise<void> {
    // Security validation
    SecurityManager.validateWorkflowComplexity(workflow);
    
    // Validate workflow structure
    this.validateWorkflowStructure(workflow);
    
    this.workflows.set(workflow.metadata.id, workflow);
    this.emit('workflowRegistered', workflow.metadata.id);
  }

  /**
   * Execute a workflow with parameters
   */
  async executeWorkflow(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResponse> {
    const executionId = this.generateExecutionId();
    const startTime = new Date();
    
    try {
      // Get workflow
      const workflow = this.workflows.get(request.workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${request.workflowId}`);
      }

      // Create execution context
      const execution = new WorkflowExecution(
        executionId,
        workflow,
        request.parameters,
        request.userId,
        request.sessionId
      );

      this.executions.set(executionId, execution);
      this.emit('executionStarted', executionId);

      // Build execution plan
      const plan = this.buildExecutionPlan(workflow);
      
      // Execute workflow
      const result = await this.executeWorkflowPlan(execution, plan);
      
      const endTime = new Date();
      const metrics: ExecutionMetrics = {
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
        nodesExecuted: execution.getCompletedNodes().size,
        llmCalls: execution.getLLMCallCount(),
        totalTokens: execution.getTotalTokens(),
        costs: execution.getCosts()
      };

      this.emit('executionCompleted', executionId);
      
      return {
        success: true,
        executionId,
        result,
        metrics,
        logs: execution.getLogs()
      };

    } catch (error) {
      this.emit('executionFailed', executionId, error);
      
      const execution = this.executions.get(executionId);
      return {
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          startTime,
          endTime: new Date(),
          durationMs: Date.now() - startTime.getTime(),
          nodesExecuted: execution?.getCompletedNodes().size || 0,
          llmCalls: execution?.getLLMCallCount() || 0,
          totalTokens: execution?.getTotalTokens() || 0,
          costs: execution?.getCosts() || { totalCost: 0, breakdown: {} }
        },
        logs: execution?.getLogs() || []
      };
    } finally {
      // Cleanup execution after delay
      setTimeout(() => {
        this.executions.delete(executionId);
      }, 5 * 60 * 1000); // Keep for 5 minutes
    }
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): any {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return null;
    }

    return {
      executionId,
      status: execution.getStatus(),
      progress: execution.getProgress(),
      currentNode: execution.getCurrentNode(),
      logs: execution.getLogs()
    };
  }

  private setupNodeExecutors(): void {
    this.nodeExecutors.set('prompt', new PromptNodeExecutor());
    this.nodeExecutors.set('parameter', new ParameterNodeExecutor());
    this.nodeExecutors.set('condition', new ConditionNodeExecutor());
    this.nodeExecutors.set('loop', new LoopNodeExecutor());
    this.nodeExecutors.set('output', new OutputNodeExecutor());
    this.nodeExecutors.set('api', new APINodeExecutor());
    this.nodeExecutors.set('transformer', new TransformerNodeExecutor());
  }

  private validateWorkflowStructure(workflow: PrompdFlowDocument): void {
    // Check for cycles
    if (this.hasCycles(workflow)) {
      throw new Error('Workflow contains cycles');
    }

    // Validate node references
    const nodeIds = new Set(workflow.nodes.map(n => n.id));
    for (const connection of workflow.connections) {
      if (!nodeIds.has(connection.sourceNodeId)) {
        throw new Error(`Invalid connection: source node ${connection.sourceNodeId} not found`);
      }
      if (!nodeIds.has(connection.targetNodeId)) {
        throw new Error(`Invalid connection: target node ${connection.targetNodeId} not found`);
      }
    }
  }

  private hasCycles(workflow: PrompdFlowDocument): boolean {
    // Simple cycle detection using DFS
    const graph = this.buildDependencyGraph(workflow);
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleDFS = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const dependencies = graph.get(nodeId) || [];
      for (const dep of dependencies) {
        if (!visited.has(dep)) {
          if (hasCycleDFS(dep)) return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycleDFS(nodeId)) return true;
      }
    }

    return false;
  }

  private buildDependencyGraph(workflow: PrompdFlowDocument): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    // Initialize nodes
    for (const node of workflow.nodes) {
      graph.set(node.id, []);
    }

    // Add dependencies from connections
    for (const connection of workflow.connections) {
      const dependencies = graph.get(connection.targetNodeId) || [];
      dependencies.push(connection.sourceNodeId);
      graph.set(connection.targetNodeId, dependencies);
    }

    return graph;
  }

  private buildExecutionPlan(workflow: PrompdFlowDocument): ExecutionPlan {
    const dependencyGraph = this.buildDependencyGraph(workflow);
    const nodes: ExecutionNode[] = [];
    const parallelGroups: string[][] = [];

    // Convert workflow nodes to execution nodes
    for (const node of workflow.nodes) {
      nodes.push({
        id: node.id,
        type: node.type,
        config: node.data.config,
        dependencies: dependencyGraph.get(node.id) || [],
        canRunInParallel: this.canNodeRunInParallel(node)
      });
    }

    // Build parallel execution groups
    const levels = this.topologicalSort(dependencyGraph);
    for (const level of levels) {
      parallelGroups.push(level);
    }

    return {
      nodes,
      dependencies: dependencyGraph,
      parallelGroups
    };
  }

  private canNodeRunInParallel(node: FlowNode): boolean {
    // Nodes that can safely run in parallel with others at same level
    const parallelSafeTypes = ['prompt', 'transformer', 'api'];
    return parallelSafeTypes.includes(node.type);
  }

  private topologicalSort(graph: Map<string, string[]>): string[][] {
    const levels: string[][] = [];
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees
    for (const nodeId of graph.keys()) {
      inDegree.set(nodeId, 0);
    }
    
    for (const dependencies of graph.values()) {
      for (const dep of dependencies) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }

    // Find nodes with no dependencies
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    while (queue.length > 0) {
      const currentLevel: string[] = [...queue];
      levels.push(currentLevel);
      queue.length = 0;

      for (const nodeId of currentLevel) {
        const dependencies = graph.get(nodeId) || [];
        for (const dep of dependencies) {
          const newDegree = (inDegree.get(dep) || 0) - 1;
          inDegree.set(dep, newDegree);
          
          if (newDegree === 0) {
            queue.push(dep);
          }
        }
      }
    }

    return levels;
  }

  private async executeWorkflowPlan(execution: WorkflowExecution, plan: ExecutionPlan): Promise<any> {
    let finalResult = null;

    // Execute nodes level by level
    for (const level of plan.parallelGroups) {
      const levelPromises: Promise<any>[] = [];

      for (const nodeId of level) {
        const node = plan.nodes.find(n => n.id === nodeId);
        if (!node) continue;

        const executor = this.nodeExecutors.get(node.type);
        if (!executor) {
          throw new Error(`No executor found for node type: ${node.type}`);
        }

        const context: NodeExecutionContext = {
          nodeId: node.id,
          inputs: execution.getNodeInputs(nodeId),
          outputs: {},
          variables: execution.getVariables(),
          metadata: {
            executionId: execution.getId(),
            userId: execution.getUserId(),
            startTime: new Date()
          }
        };

        levelPromises.push(executor.execute(node, context));
      }

      // Wait for all nodes in level to complete
      const results = await Promise.all(levelPromises);
      
      // Store results
      for (let i = 0; i < level.length; i++) {
        const nodeId = level[i];
        execution.setNodeOutput(nodeId, results[i]);
        
        // Check if this is a final output node
        const node = plan.nodes.find(n => n.id === nodeId);
        if (node && node.type === 'output') {
          finalResult = results[i];
        }
      }
    }

    return finalResult || 'Workflow completed';
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
}

/**
 * Individual workflow execution instance
 */
export class WorkflowExecution {
  private status: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
  private nodeOutputs = new Map<string, any>();
  private variables = new Map<string, any>();
  private logs: ExecutionLog[] = [];
  private completedNodes = new Set<string>();
  private currentNode?: string;
  private llmCallCount = 0;
  private totalTokens = 0;
  private costs = { totalCost: 0, breakdown: {} as Record<string, number> };

  constructor(
    private executionId: string,
    private workflow: PrompdFlowDocument,
    private parameters: Record<string, any>,
    private userId?: string,
    private sessionId?: string
  ) {
    // Initialize variables with parameters
    for (const [key, value] of Object.entries(parameters)) {
      this.variables.set(key, SecurityManager.sanitizeParameters({ [key]: value })[key]);
    }
  }

  getId(): string { return this.executionId; }
  getUserId(): string | undefined { return this.userId; }
  getStatus(): string { return this.status; }
  getCurrentNode(): string | undefined { return this.currentNode; }
  getCompletedNodes(): Set<string> { return this.completedNodes; }
  getLogs(): ExecutionLog[] { return this.logs; }
  getLLMCallCount(): number { return this.llmCallCount; }
  getTotalTokens(): number { return this.totalTokens; }
  getCosts(): { totalCost: number; breakdown: Record<string, number> } { return this.costs; }
  getVariables(): Map<string, any> { return this.variables; }

  setNodeOutput(nodeId: string, output: any): void {
    this.nodeOutputs.set(nodeId, output);
    this.completedNodes.add(nodeId);
  }

  getNodeInputs(nodeId: string): Record<string, any> {
    const inputs: Record<string, any> = {};
    
    // Find connections to this node
    const incomingConnections = this.workflow.connections.filter(c => c.targetNodeId === nodeId);
    
    for (const connection of incomingConnections) {
      const sourceOutput = this.nodeOutputs.get(connection.sourceNodeId);
      if (sourceOutput !== undefined) {
        inputs[connection.targetPortId] = sourceOutput;
      }
    }

    return inputs;
  }

  getProgress(): number {
    const totalNodes = this.workflow.nodes.length;
    const completed = this.completedNodes.size;
    return totalNodes > 0 ? (completed / totalNodes) * 100 : 0;
  }

  log(level: ExecutionLog['level'], message: string, nodeId?: string, data?: any): void {
    this.logs.push({
      timestamp: new Date(),
      level,
      nodeId,
      message,
      data
    });
  }
}

/**
 * Base class for node executors
 */
export abstract class NodeExecutor {
  abstract execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any>;
}

/**
 * Specific node executors
 */
export class PromptNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    // This would integrate with LLM providers
    // For now, return a placeholder
    return `Executed prompt: ${node.config.template || 'Default prompt'}`;
  }
}

export class ParameterNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    const paramName = node.config.parameterName;
    return context.variables.get(paramName) || node.config.defaultValue;
  }
}

export class ConditionNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    // Simple condition evaluation - would be more sophisticated in production
    return true;
  }
}

export class LoopNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    // Loop execution logic
    return 'Loop completed';
  }
}

export class OutputNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    const template = node.config.template || '{result}';
    let output = template;
    
    // Simple template replacement
    for (const [key, value] of Object.entries(context.inputs)) {
      output = output.replace(`{${key}}`, String(value));
    }
    
    return output;
  }
}

export class APINodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    // API call logic - would make actual HTTP requests
    return `API call result for ${node.config.endpoint}`;
  }
}

export class TransformerNodeExecutor extends NodeExecutor {
  async execute(node: ExecutionNode, context: NodeExecutionContext): Promise<any> {
    // Data transformation logic
    return `Transformed data using ${node.config.transformationType}`;
  }
}