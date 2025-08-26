#!/usr/bin/env node

/**
 * Prompd Workflow Engine Server
 * Entry point for running the RPC API server
 */

import { RPCServer, createDefaultRPCConfig } from './lib/rpc-server';
import { SecurityManager } from './lib/security';

async function main() {
  try {
    console.log('🚀 Starting Prompd Workflow Engine...');

    // Validate required environment variables
    const requiredEnvVars = ['JWT_SECRET'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars.join(', '));
      console.error('Please set the following environment variables:');
      console.error('- JWT_SECRET: A secure random string for JWT token signing');
      console.error('- OAUTH_CLIENT_ID: OAuth 2.0 client ID (optional)');
      console.error('- OAUTH_CLIENT_SECRET: OAuth 2.0 client secret (optional)');
      process.exit(1);
    }

    // Create server configuration
    const config = {
      ...createDefaultRPCConfig(),
      auth: {
        jwtSecret: process.env.JWT_SECRET!,
        oauthClientId: process.env.OAUTH_CLIENT_ID || '',
        oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || ''
      }
    };

    // Initialize security manager
    SecurityManager.initialize();

    // Create and start server
    const server = new RPCServer(config as any);

    // Event listeners
    server.on('started', (info) => {
      console.log(`✅ Prompd Workflow Engine started successfully`);
      console.log(`🌐 Server listening on http://${info.host}:${info.port}`);
      console.log(`🔒 Security features enabled`);
      console.log(`📊 Health check: http://${info.host}:${info.port}/health`);
      console.log(`📈 Metrics: http://${info.host}:${info.port}/metrics`);
      console.log(`🆔 Process ID: ${info.pid}`);
      
      if (config.auth.oauthClientId) {
        console.log(`🔐 OAuth authentication enabled`);
        console.log(`🔑 Login endpoint: http://${info.host}:${info.port}/auth/login`);
      }
    });

    server.on('error', (error) => {
      console.error('❌ Server error:', error);
    });

    server.on('workflowExecuted', (info) => {
      console.log(`✅ Workflow executed: ${info.workflowId} (${info.executionId}) by user ${info.userId}`);
    });

    server.on('workflowExecutionFailed', (info) => {
      console.error(`❌ Workflow execution failed: ${info.workflowId} by user ${info.userId} - ${info.error}`);
    });

    server.on('requestCompleted', (info) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`📡 ${info.method} ${info.url} - ${info.status} (${info.duration}ms)`);
      }
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      
      try {
        await server.stop();
        console.log('✅ Server stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Start server
    await server.start();

    // Log environment info
    console.log('\n📋 Environment Information:');
    console.log(`   Node.js: ${process.version}`);
    console.log(`   Platform: ${process.platform} ${process.arch}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used`);
    console.log(`   Uptime: ${Math.round(process.uptime())}s`);

    if (process.env.NODE_ENV === 'development') {
      console.log('\n🧪 Development Mode Features:');
      console.log('   - Detailed error messages');
      console.log('   - Request logging');
      console.log('   - Auto-reload on file changes');
    }

    console.log('\n🎯 API Endpoints:');
    console.log(`   POST /workflows/execute - Execute a workflow`);
    console.log(`   GET  /workflows/executions/:id - Get execution status`);
    console.log(`   GET  /workflows - List available workflows`);
    console.log(`   GET  /auth/login - Initialize OAuth login`);
    console.log(`   POST /auth/callback - OAuth callback handler`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /ready - Readiness check`);
    console.log(`   GET  /metrics - Prometheus metrics`);

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n💡 Example API Usage:');
      console.log(`curl -X POST http://${config.host}:${config.port}/workflows/execute \\`);
      console.log(`  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"workflowId": "example-workflow", "parameters": {"input": "Hello World"}}'`);
    }

    console.log('\n🚀 Prompd Workflow Engine is ready to process workflows!');

  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Failed to start:', error);
    process.exit(1);
  });
}

export { main };