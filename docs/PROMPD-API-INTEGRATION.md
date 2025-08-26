# Prompd API Integration - Seamless Workflow-to-API Conversion

## 🎯 **Overview**

The `prompd-api` package provides seamless integration between Prompd workflows and web frameworks, enabling you to turn any `.prompd` or `.prompdflow` file into a fully functional API endpoint with minimal code.

**Core Philosophy:** One workflow file → infinite deployment possibilities with beautiful, intuitive syntax.

## 🚀 **Installation**

```bash
npm install prompd-api express
```

## 📋 **Basic Usage**

### **Simple Workflow Configuration**
```javascript
const express = require('express');
const prompd = require('prompd-api');

const app = express();
app.use(express.json());

// Configure workflow once
var registrationFlow = prompd.configure("./registration.prompdflow");

// Use directly in Express routes  
app.post('/api/register', registrationFlow.express((req, res) => {
  res.json(req.prompdResult);
}));

app.listen(3000);
```

### **One-Liner Route Creation**
```javascript
// Ultra-concise syntax
app.post('/api/register', prompd.configure("./registration.prompdflow").express());
app.post('/api/auth', prompd.configure("./auth.prompdflow").express());
app.post('/api/orders', prompd.configure("./order-processing.prompdflow").express());
```

## 🏗️ **Complete REST Auth Example**

### **Workflow Configuration**
```javascript
const express = require('express');
const prompd = require('prompd-api');

const app = express();
app.use(express.json());

// Configure workflows once - reuse everywhere
const userRegistration = prompd.configure("./workflows/user-registration.prompdflow");
const userLogin = prompd.configure("./workflows/user-login.prompdflow");
const passwordReset = prompd.configure("./workflows/password-reset.prompdflow");
const orderProcessing = prompd.configure("./workflows/order-processing.prompdflow");

// Create routes with one line each
app.post('/api/register', userRegistration.express());
app.post('/api/login', userLogin.express({ rateLimit: 5 }));
app.post('/api/forgot-password', passwordReset.express());
app.post('/api/orders', orderProcessing.express({ auth: true }));

app.listen(3000);
```

### **Advanced Usage with Custom Handlers**
```javascript
app.post('/api/register', 
  userRegistration.express({
    // Custom parameter mapping
    mapParams: (req) => ({
      email: req.body.email,
      password: req.body.password,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    }),
    
    // Custom success handling
    onSuccess: (result, req, res) => {
      // Set secure authentication cookie
      res.cookie('auth_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      
      res.status(201).json({
        success: true,
        user: {
          id: result.userId,
          email: result.email,
          name: result.name
        },
        message: 'Welcome to our platform!',
        nextStep: '/verify-email'
      });
    },
    
    // Custom error handling
    onError: (error, req, res) => {
      console.error('Registration failed:', error);
      
      // Map workflow errors to HTTP status codes
      const statusCode = error.code === 'USER_EXISTS' ? 409 : 
                        error.code === 'VALIDATION_ERROR' ? 400 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    },
    
    // Middleware options
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5 // limit each IP to 5 requests per window
    },
    
    // Authentication requirements
    auth: false, // Public endpoint
    
    // Request validation
    validateInput: true,
    
    // Response caching
    cache: {
      ttl: 0 // No caching for registration
    }
  })
);
```

## 🔧 **Configured Workflow API**

### **Framework Integration Methods**
```javascript
const workflow = prompd.configure("./my-workflow.prompdflow");

// Web Framework Integrations
app.post('/endpoint', workflow.express(options));     // Express.js
app.post('/endpoint', workflow.fastify(options));     // Fastify
app.use('/endpoint', workflow.koa(options));          // Koa.js
app.post('/endpoint', workflow.hapi(options));        // Hapi.js

// Serverless Integrations
exports.handler = workflow.lambda(options);           // AWS Lambda
exports.default = workflow.vercel(options);           // Vercel Functions
exports.azureFunction = workflow.azure(options);      // Azure Functions
exports.gcfFunction = workflow.gcp(options);          // Google Cloud Functions

// Direct Execution
const result = await workflow.execute(params);        // Manual execution

// Protocol Servers
const mcpServer = workflow.mcp({ port: 3001 });      // MCP server
const grpcServer = workflow.grpc({ port: 50051 });   // gRPC server
const wsServer = workflow.websocket({ port: 8080 }); // WebSocket server

// Code Generation
const apiSpec = workflow.openapi(options);            // OpenAPI spec
const reactComponent = workflow.react(options);       // React component
const graphqlSchema = workflow.graphql(options);      // GraphQL schema
const postmanCollection = workflow.postman(options); // Postman collection
```

### **Workflow Introspection**
```javascript
const workflow = prompd.configure("./complex-workflow.prompdflow");

// Get workflow metadata
const metadata = workflow.getMetadata();
console.log(metadata);
// {
//   name: "user-registration",
//   description: "Complete user registration flow",
//   version: "1.0.0",
//   parameters: [...],
//   nodes: 15,
//   complexity: "medium"
// }

// Get parameter schema
const schema = workflow.getSchema();
// Returns JSON Schema for validation

// Get required parameters
const params = workflow.getParameters();
// [
//   { name: "email", type: "string", required: true },
//   { name: "password", type: "string", required: true },
//   ...
// ]

// Get workflow statistics
const stats = workflow.getStats();
// {
//   estimatedExecutionTime: "2.5s",
//   averageCost: "$0.003",
//   successRate: 0.98,
//   nodeCount: 15
// }
```

## ⚙️ **Configuration Options**

### **Express Integration Options**
```javascript
interface ExpressOptions {
  // Request/Response Handling
  mapParams?: (req: Request) => Record<string, any>;
  onSuccess?: (result: any, req: Request, res: Response) => void;
  onError?: (error: Error, req: Request, res: Response) => void;
  
  // Authentication & Security
  auth?: boolean | AuthConfig;
  rateLimit?: RateLimitConfig;
  cors?: CorsConfig;
  validateInput?: boolean;
  sanitizeInput?: boolean;
  
  // Performance & Caching  
  cache?: CacheConfig;
  timeout?: number;
  retries?: number;
  
  // Monitoring & Logging
  metrics?: boolean;
  logging?: LoggingConfig;
  
  // Workflow Execution
  provider?: string;          // LLM provider override
  model?: string;            // Model override
  executionMode?: 'sync' | 'async' | 'streaming';
}

// Example usage
app.post('/api/secure-endpoint', 
  workflow.express({
    auth: {
      required: true,
      type: 'jwt',
      secret: process.env.JWT_SECRET
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      max: 100
    },
    cache: {
      ttl: 300, // 5 minutes
      key: (req) => `workflow:${req.user.id}:${JSON.stringify(req.body)}`
    },
    onSuccess: (result, req, res) => {
      res.json({
        success: true,
        data: result,
        executionTime: result.metadata.executionTime,
        cost: result.metadata.cost
      });
    }
  })
);
```

### **Auto-Route Discovery**
```javascript
// Auto-discover all workflows in directory
app.use('/api', await prompd.autoRoutes('./workflows/', {
  authRequired: true,
  rateLimit: 100,
  prefix: '/v1',
  
  // Route naming strategy
  routeNaming: (filename) => filename.replace('.prompdflow', '').replace(/-/g, '/'),
  
  // Global error handling
  onError: (error, req, res) => {
    console.error(`Workflow ${req.workflowName} failed:`, error);
    res.status(500).json({ error: 'Internal server error' });
  },
  
  // Route filtering
  include: ['user-*', 'auth-*'],
  exclude: ['internal-*', 'test-*']
}));

// Creates routes like:
// POST /api/v1/user/registration  (from user-registration.prompdflow)
// POST /api/v1/user/login         (from user-login.prompdflow)  
// POST /api/v1/auth/reset         (from auth-reset.prompdflow)
```

## 🌐 **Multi-Framework Example**

### **Same Workflow, Multiple Deployments**
```javascript
// Configure once
const orderFlow = prompd.configure("./order-processing.prompdflow");

// Deploy to Express
app.post('/api/orders', orderFlow.express());

// Deploy as AWS Lambda
exports.processOrder = orderFlow.lambda({
  timeout: 30000,
  memory: 512
});

// Deploy as Vercel Function  
export default orderFlow.vercel({
  maxDuration: 30
});

// Create MCP server for Claude Desktop
const mcpServer = orderFlow.mcp({
  name: "order-processor",
  port: 3001
});

// Generate OpenAPI documentation
const apiDocs = orderFlow.openapi({
  title: "Order Processing API",
  version: "1.0.0",
  servers: [
    { url: "https://api.example.com", description: "Production" },
    { url: "https://staging-api.example.com", description: "Staging" }
  ]
});

// Generate React form component
const OrderForm = orderFlow.react({
  componentName: "OrderForm",
  styling: "tailwind",
  validation: true,
  typescript: true
});
```

## 📊 **Enterprise Production Example**

### **Complete Production-Ready Setup**
```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const prompd = require('prompd-api');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Global Prompd configuration
prompd.globalConfig({
  provider: process.env.LLM_PROVIDER || 'openai',
  apiKey: process.env.LLM_API_KEY,
  defaultModel: process.env.LLM_MODEL || 'gpt-4',
  cache: {
    enabled: true,
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD
    },
    ttl: 300
  },
  monitoring: {
    enabled: true,
    provider: 'datadog',
    apiKey: process.env.DATADOG_API_KEY
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json'
  }
});

// Load workflow configurations
const workflows = {
  userAuth: prompd.configure("./workflows/auth/user-authentication.prompdflow"),
  userReg: prompd.configure("./workflows/auth/user-registration.prompdflow"),
  passwordReset: prompd.configure("./workflows/auth/password-reset.prompdflow"),
  orderProcess: prompd.configure("./workflows/orders/order-processing.prompdflow"),
  paymentProcess: prompd.configure("./workflows/payments/payment-processing.prompdflow"),
  emailNotify: prompd.configure("./workflows/notifications/email-notification.prompdflow")
};

// Authentication endpoints
app.post('/api/v1/auth/login', workflows.userAuth.express({
  rateLimit: { windowMs: 15 * 60 * 1000, max: 5 },
  onSuccess: (result, req, res) => {
    res.cookie('session', result.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user: result.user });
  }
}));

app.post('/api/v1/auth/register', workflows.userReg.express({
  rateLimit: { windowMs: 60 * 60 * 1000, max: 3 },
  validateInput: true,
  sanitizeInput: true
}));

app.post('/api/v1/auth/forgot-password', workflows.passwordReset.express({
  rateLimit: { windowMs: 60 * 60 * 1000, max: 2 }
}));

// Protected routes middleware
app.use('/api/v1/orders', async (req, res, next) => {
  try {
    const token = req.cookies.session || req.headers.authorization?.split(' ')[1];
    const authResult = await workflows.userAuth.execute({ token });
    req.user = authResult.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication required' });
  }
});

// Business logic endpoints
app.post('/api/v1/orders', workflows.orderProcess.express({
  auth: true,
  mapParams: (req) => ({
    ...req.body,
    userId: req.user.id,
    userEmail: req.user.email
  }),
  onSuccess: async (result, req, res) => {
    // Trigger notification workflow
    workflows.emailNotify.execute({
      type: 'order_confirmation',
      email: req.user.email,
      orderId: result.orderId
    }).catch(console.error); // Fire and forget
    
    res.status(201).json({
      success: true,
      orderId: result.orderId,
      status: result.status,
      estimatedDelivery: result.estimatedDelivery
    });
  }
}));

app.post('/api/v1/payments', workflows.paymentProcess.express({
  auth: true,
  timeout: 30000, // 30 second timeout for payment processing
  retries: 2
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    workflows: {
      loaded: Object.keys(workflows).length,
      healthy: true
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Production API server running on port ${PORT}`);
  console.log(`📋 ${Object.keys(workflows).length} workflows configured`);
  console.log(`🔒 Security: ${process.env.NODE_ENV === 'production' ? 'Enabled' : 'Development'}`);
});
```

## 🧪 **Testing Integration**

### **Workflow Testing**
```javascript
const request = require('supertest');
const prompd = require('prompd-api');

describe('User Registration Workflow', () => {
  const workflow = prompd.configure("./workflows/user-registration.prompdflow");
  
  beforeEach(() => {
    // Configure test environment
    prompd.configure({
      provider: 'mock', // Use mock LLM for testing
      cache: false
    });
  });
  
  test('should register new user successfully', async () => {
    const result = await workflow.execute({
      email: 'test@example.com',
      password: 'securePassword123',
      name: 'Test User'
    });
    
    expect(result.success).toBe(true);
    expect(result.userId).toBeDefined();
    expect(result.user.email).toBe('test@example.com');
  });
  
  test('should handle duplicate email error', async () => {
    await expect(workflow.execute({
      email: 'existing@example.com',
      password: 'password123',
      name: 'Duplicate User'  
    })).rejects.toThrow('User already exists');
  });
  
  test('should validate password requirements', async () => {
    await expect(workflow.execute({
      email: 'test@example.com',
      password: '123', // Too short
      name: 'Test User'
    })).rejects.toThrow('Password must be at least 8 characters');
  });
});

describe('Registration API Endpoint', () => {
  const app = express();
  const workflow = prompd.configure("./workflows/user-registration.prompdflow");
  
  app.use(express.json());
  app.post('/register', workflow.express());
  
  test('should return 201 for successful registration', async () => {
    const response = await request(app)
      .post('/register')
      .send({
        email: 'newuser@example.com',
        password: 'securePassword123',
        name: 'New User'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBeDefined();
  });
  
  test('should return 400 for invalid input', async () => {
    const response = await request(app)
      .post('/register')
      .send({
        email: 'invalid-email',
        password: '123'
      });
    
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
```

## 🔍 **Monitoring and Debugging**

### **Built-in Monitoring**
```javascript
const workflow = prompd.configure("./complex-workflow.prompdflow");

app.post('/api/endpoint', workflow.express({
  // Enable detailed monitoring
  monitoring: {
    enabled: true,
    metrics: ['execution_time', 'cost', 'success_rate', 'error_rate'],
    
    // Custom metric handlers
    onMetric: (metric, value, context) => {
      console.log(`Metric ${metric}: ${value}`, context);
      
      // Send to monitoring service
      if (metric === 'execution_time' && value > 5000) {
        console.warn(`Slow execution detected: ${value}ms`);
      }
    }
  },
  
  // Detailed logging  
  logging: {
    level: 'debug',
    includeParams: process.env.NODE_ENV !== 'production',
    includeResult: false, // Don't log sensitive results
    
    // Custom log handler
    onLog: (level, message, context) => {
      // Send to centralized logging
      logger.log(level, message, {
        workflow: context.workflowName,
        requestId: context.requestId,
        userId: context.userId
      });
    }
  }
}));
```

## 📚 **Package API Reference**

### **Core Methods**
```typescript
// Main configuration function
prompd.configure(workflowPath: string, options?: ConfigOptions): ConfiguredWorkflow

// Global configuration
prompd.globalConfig(config: GlobalConfig): void

// Auto-route generation
prompd.autoRoutes(directory: string, options?: AutoRouteOptions): Promise<Router>

// Utility functions
prompd.utils.validateWorkflow(workflowPath: string): ValidationResult
prompd.utils.getWorkflowMetadata(workflowPath: string): WorkflowMetadata
prompd.utils.testWorkflow(workflowPath: string, testCases: TestCase[]): TestResult
```

### **ConfiguredWorkflow Interface**
```typescript
interface ConfiguredWorkflow {
  // Framework integrations
  express(options?: ExpressOptions): RequestHandler;
  fastify(options?: FastifyOptions): FastifyHandler;
  koa(options?: KoaOptions): KoaHandler;
  lambda(options?: LambdaOptions): LambdaHandler;
  vercel(options?: VercelOptions): VercelHandler;
  
  // Direct execution
  execute(params: Record<string, any>): Promise<WorkflowResult>;
  
  // Code generation
  openapi(options?: OpenAPIOptions): OpenAPISpec;
  react(options?: ReactOptions): ReactComponent;
  graphql(options?: GraphQLOptions): GraphQLSchema;
  
  // Server creation
  mcp(options?: MCPOptions): MCPServer;
  grpc(options?: GRPCOptions): GRPCServer;
  
  // Introspection
  getMetadata(): WorkflowMetadata;
  getSchema(): JSONSchema;
  getParameters(): Parameter[];
  getStats(): WorkflowStats;
}
```

---

## 🚀 **Getting Started**

### **Quick Start Guide**

1. **Install the package:**
   ```bash
   npm install prompd-api express
   ```

2. **Create a simple workflow:**
   ```yaml
   # hello-world.prompd
   ---
   name: "hello-world"
   parameters:
     - name: name
       type: string
       required: true
   ---
   
   Hello, {name}! Welcome to Prompd API integration.
   ```

3. **Create your server:**
   ```javascript
   // server.js
   const express = require('express');
   const prompd = require('prompd-api');
   
   const app = express();
   app.use(express.json());
   
   const helloFlow = prompd.configure("./hello-world.prompd");
   app.post('/api/hello', helloFlow.express());
   
   app.listen(3000, () => {
     console.log('🚀 Server running on port 3000');
   });
   ```

4. **Test your API:**
   ```bash
   curl -X POST http://localhost:3000/api/hello \
     -H "Content-Type: application/json" \
     -d '{"name": "World"}'
   ```

**That's it!** You now have a fully functional API endpoint powered by Prompd workflows.

## 🎯 **Next Steps**

- **Explore Examples**: Check out the `/examples` directory for complete applications
- **Read the Guides**: Learn about authentication, error handling, and monitoring
- **Join the Community**: Share your workflows and get help from other developers
- **Contribute**: Help build the next generation of workflow-driven APIs

---

*The `prompd-api` package transforms your Prompd workflows into production-ready APIs with enterprise-grade features, beautiful syntax, and minimal configuration.*