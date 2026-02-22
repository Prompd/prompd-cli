/**
 * RPC API Server for Prompd Workflow Execution
 * Provides REST and gRPC endpoints for workflow execution
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { EventEmitter } from 'events';
import { WorkflowEngine, WorkflowExecutionRequest, WorkflowExecutionResponse } from './workflow-engine';
import { AuthManager, AuthMiddleware, createDefaultAuthConfig } from './auth';
import { SecurityManager } from './security';

export interface RPCServerConfig {
  port: number;
  host: string;
  cors: {
    origins: string[];
    credentials: boolean;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  auth: {
    jwtSecret: string;
    oauthClientId: string;
    oauthClientSecret: string;
  };
  security: {
    enableHttps: boolean;
    certPath?: string;
    keyPath?: string;
  };
}

export interface WorkflowExecutionAPIRequest {
  workflowId: string;
  parameters: Record<string, any>;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  options?: {
    timeout?: number;
    priority?: 'low' | 'normal' | 'high';
    retries?: number;
  };
}

export interface WorkflowListResponse {
  workflows: {
    id: string;
    name: string;
    description: string;
    version: string;
    parameters: Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
    }>;
    permissions: string[];
  }[];
  total: number;
}

/**
 * RPC API Server for workflow execution
 */
export class RPCServer extends EventEmitter {
  private app!: express.Application;
  private server: any;
  private workflowEngine: WorkflowEngine;
  private authManager: AuthManager;
  private authMiddleware: AuthMiddleware;
  private config: RPCServerConfig;

  constructor(config: RPCServerConfig) {
    super();
    this.config = config;
    
    // Initialize core components
    this.workflowEngine = new WorkflowEngine();
    this.authManager = new AuthManager({
      ...createDefaultAuthConfig(),
      jwtSecret: config.auth.jwtSecret,
      jwtExpiresIn: '24h',
      oauth: {
        clientId: config.auth.oauthClientId,
        clientSecret: config.auth.oauthClientSecret,
        redirectUri: `http://${config.host}:${config.port}/auth/callback`,
        scopes: ['openid', 'profile', 'email'],
        authorizationUrl: process.env.OAUTH_AUTH_URL || '',
        tokenUrl: process.env.OAUTH_TOKEN_URL || ''
      }
    });
    this.authMiddleware = new AuthMiddleware(this.authManager);

    this.setupExpressApp();
    this.setupRoutes();
  }

  private setupExpressApp(): void {
    this.app = express();

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS
    this.app.use(cors({
      origin: this.config.cors.origins,
      credentials: this.config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID']
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.config.rateLimit.windowMs,
      max: this.config.rateLimit.max,
      message: {
        error: 'Too many requests',
        retryAfter: Math.ceil(this.config.rateLimit.windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    
    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.emit('requestCompleted', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration,
          userAgent: req.get('user-agent')
        });
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoints
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '0.2.3',
        uptime: process.uptime()
      });
    });

    this.app.get('/ready', (req, res) => {
      // Check if all required services are available
      const checks = {
        workflowEngine: true, // Add actual health checks here
        auth: true,
        database: true // If using database
      };
      
      const allHealthy = Object.values(checks).every(check => check);
      res.status(allHealthy ? 200 : 503).json({
        ready: allHealthy,
        checks,
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint (Prometheus format)
    this.app.get('/metrics', (req, res) => {
      res.set('Content-Type', 'text/plain');
      res.send(`
# HELP prompd_workflows_total Total number of workflow executions
# TYPE prompd_workflows_total counter
prompd_workflows_total 0

# HELP prompd_workflows_active Currently executing workflows  
# TYPE prompd_workflows_active gauge
prompd_workflows_active 0

# HELP prompd_http_requests_total Total HTTP requests
# TYPE prompd_http_requests_total counter
prompd_http_requests_total 0
`.trim());
    });

    // Authentication routes
    this.app.get('/auth/login', async (req, res) => {
      try {
        const userId = req.query.user_id as string;
        const { authUrl, state } = this.authManager.generateAuthUrl(userId);
        res.json({ authUrl, state });
      } catch (error) {
        res.status(500).json({ error: 'Authentication initialization failed' });
      }
    });

    this.app.post('/auth/callback', async (req, res) => {
      try {
        const { code, state } = req.body;
        const tokens = await this.authManager.exchangeCodeForTokens(code, state);
        
        // In a real implementation, you'd create/lookup user from OAuth provider
        const user = await this.authManager.createUser({
          email: 'user@example.com',
          name: 'OAuth User',
          roles: ['user'],
          permissions: ['workflow:execute']
        });

        const session = await this.authManager.createSession(user, {
          userAgent: req.get('user-agent'),
          ipAddress: req.ip
        });

        const jwt = this.authManager.generateJWT(user);

        res.json({
          success: true,
          sessionId: session.sessionId,
          token: jwt,
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      } catch (error) {
        res.status(400).json({ 
          error: 'Authentication failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Authentication middleware for protected routes
    const authenticate = async (req: any, res: any, next: any) => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const sessionId = req.headers['x-session-id'];

        let user = null;
        
        if (token) {
          user = await this.authMiddleware.authenticateJWT(token);
        } else if (sessionId) {
          user = await this.authMiddleware.authenticateSession(sessionId);
        }

        if (!user) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        req.user = user;
        next();
      } catch (error) {
        res.status(401).json({ error: 'Invalid authentication' });
      }
    };

    // Workflow execution endpoints
    this.app.post('/workflows/execute', authenticate, async (req: any, res) => {
      try {
        const requestData: WorkflowExecutionAPIRequest = req.body;
        
        // Validate request
        if (!requestData.workflowId) {
          return res.status(400).json({ error: 'workflowId is required' });
        }

        // Check permissions
        const hasPermission = await this.authMiddleware.authorizeWorkflowExecution(
          req.user.id,
          requestData.workflowId
        );

        if (!hasPermission) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }

        // Security validation
        const sanitizedParameters = SecurityManager.sanitizeParameters(requestData.parameters || {});

        // Execute workflow
        const executionRequest: WorkflowExecutionRequest = {
          workflowId: requestData.workflowId,
          parameters: sanitizedParameters,
          userId: req.user.id,
          sessionId: requestData.sessionId,
          metadata: {
            ...requestData.metadata,
            apiEndpoint: 'POST /workflows/execute',
            userAgent: req.get('user-agent'),
            ipAddress: req.ip
          }
        };

        const result = await this.workflowEngine.executeWorkflow(executionRequest);

        this.emit('workflowExecuted', {
          workflowId: requestData.workflowId,
          executionId: result.executionId,
          userId: req.user.id,
          success: result.success
        });

        res.json(result);

      } catch (error) {
        this.emit('workflowExecutionFailed', {
          workflowId: req.body.workflowId,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        res.status(500).json({
          error: 'Workflow execution failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Get workflow execution status
    this.app.get('/workflows/executions/:executionId', authenticate, async (req: any, res) => {
      try {
        const { executionId } = req.params;
        const status = this.workflowEngine.getExecutionStatus(executionId);

        if (!status) {
          return res.status(404).json({ error: 'Execution not found' });
        }

        res.json(status);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get execution status',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // List available workflows
    this.app.get('/workflows', authenticate, async (req: any, res) => {
      try {
        // In a real implementation, filter workflows based on user permissions
        const workflows: any[] = []; // Get from workflow registry
        
        const response: WorkflowListResponse = {
          workflows: workflows.map((workflow: any) => ({
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            version: workflow.version,
            parameters: workflow.parameters,
            permissions: ['read', 'execute'] // Based on user permissions
          })),
          total: workflows.length
        };

        res.json(response);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to list workflows',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Workflow permissions management
    this.app.post('/workflows/:workflowId/permissions', authenticate, async (req: any, res) => {
      try {
        const { workflowId } = req.params;
        const { userId, permissions } = req.body;

        // Check if current user can grant permissions (admin)
        const hasAdminPermission = await this.authMiddleware.authorizeWorkflowModification(
          req.user.id,
          workflowId
        );

        if (!hasAdminPermission) {
          return res.status(403).json({ error: 'Admin permissions required' });
        }

        await this.authManager.grantWorkflowPermission(
          workflowId,
          userId,
          permissions,
          req.user.id
        );

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to grant permissions',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Error handling
    this.app.use((error: any, req: any, res: any, next: any) => {
      this.emit('error', { error, url: req.url, method: req.method });
      
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        message: `${req.method} ${req.url} not found`
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.emit('started', {
            host: this.config.host,
            port: this.config.port,
            pid: process.pid
          });
          resolve();
        });

        this.server.on('error', (error: any) => {
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((error: any) => {
          if (error) {
            reject(error);
          } else {
            this.emit('stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}

/**
 * Default RPC server configuration
 */
export const createDefaultRPCConfig = (): Partial<RPCServerConfig> => ({
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') || ['*'],
    credentials: true
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
    max: parseInt(process.env.RATE_LIMIT_REQUESTS || '100')
  },
  security: {
    enableHttps: process.env.ENABLE_HTTPS === 'true',
    certPath: process.env.SSL_CERT_PATH,
    keyPath: process.env.SSL_KEY_PATH
  }
});