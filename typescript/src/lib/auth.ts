/**
 * OAuth 2.0 Authentication System for Prompd Workflows
 * Enterprise-grade authentication with security best practices
 */

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { EventEmitter } from 'events';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  bcryptRounds: number;
  oauth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    authorizationUrl: string;
    tokenUrl: string;
  };
  sessionConfig: {
    maxAge: number;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastAccessAt: Date;
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    workflowAccess?: string[];
  };
}

export interface OAuth2Token {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  issuedAt: Date;
}

export interface WorkflowPermission {
  workflowId: string;
  userId: string;
  permissions: ('read' | 'execute' | 'modify' | 'admin')[];
  grantedAt: Date;
  grantedBy: string;
}

/**
 * Core authentication manager
 */
export class AuthManager extends EventEmitter {
  private config: AuthConfig;
  private sessions: Map<string, AuthSession> = new Map();
  private users: Map<string, User> = new Map();
  private workflowPermissions: Map<string, WorkflowPermission[]> = new Map();
  private oauthStates: Map<string, { state: string; codeVerifier: string; createdAt: Date }> = new Map();

  constructor(config: AuthConfig) {
    super();
    this.config = config;
    this.setupSessionCleanup();
  }

  /**
   * Generate OAuth 2.0 authorization URL with PKCE
   */
  generateAuthUrl(userId?: string): { authUrl: string; state: string; codeVerifier: string } {
    // Generate PKCE parameters
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = this.generateSecureToken();

    // Store state for validation
    this.oauthStates.set(state, {
      state,
      codeVerifier,
      createdAt: new Date()
    });

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.oauth.clientId,
      redirect_uri: this.config.oauth.redirectUri,
      scope: this.config.oauth.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${this.config.oauth.authorizationUrl}?${params.toString()}`;

    this.emit('authUrlGenerated', { authUrl, state, userId });

    return { authUrl, state, codeVerifier };
  }

  /**
   * Exchange OAuth code for tokens
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<OAuth2Token> {
    // Validate state
    const stateData = this.oauthStates.get(state);
    if (!stateData) {
      throw new Error('Invalid or expired OAuth state');
    }

    // Check state expiration (10 minutes)
    const stateAge = Date.now() - stateData.createdAt.getTime();
    if (stateAge > 10 * 60 * 1000) {
      this.oauthStates.delete(state);
      throw new Error('OAuth state expired');
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await this.requestTokens(code, stateData.codeVerifier);
      
      // Clean up state
      this.oauthStates.delete(state);

      this.emit('tokensExchanged', { code, state });

      return tokenResponse;
    } catch (error) {
      this.emit('tokenExchangeFailed', { code, state, error });
      throw error;
    }
  }

  /**
   * Create authenticated session
   */
  async createSession(user: User, metadata: AuthSession['metadata'] = {}): Promise<AuthSession> {
    const sessionId = this.generateSecureToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionConfig.maxAge);

    const session: AuthSession = {
      sessionId,
      userId: user.id,
      createdAt: now,
      expiresAt,
      lastAccessAt: now,
      metadata
    };

    this.sessions.set(sessionId, session);
    this.emit('sessionCreated', { sessionId, userId: user.id });

    return session;
  }

  /**
   * Validate and refresh session
   */
  async validateSession(sessionId: string): Promise<AuthSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      this.sessions.delete(sessionId);
      this.emit('sessionExpired', { sessionId, userId: session.userId });
      return null;
    }

    // Update last access
    session.lastAccessAt = new Date();
    this.emit('sessionAccessed', { sessionId, userId: session.userId });

    return session;
  }

  /**
   * Generate JWT token for API access
   */
  generateJWT(user: User, permissions: string[] = []): string {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: [...user.permissions, ...permissions],
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn || '24h',
      issuer: 'prompd-workflow-engine',
      audience: 'prompd-api'
    } as jwt.SignOptions);
  }

  /**
   * Verify JWT token
   */
  verifyJWT(token: string): any {
    try {
      return jwt.verify(token, this.config.jwtSecret, {
        issuer: 'prompd-workflow-engine',
        audience: 'prompd-api'
      });
    } catch (error) {
      this.emit('jwtVerificationFailed', { token: token.substring(0, 10), error });
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Check workflow permissions
   */
  async checkWorkflowPermission(
    userId: string, 
    workflowId: string, 
    permission: 'read' | 'execute' | 'modify' | 'admin'
  ): Promise<boolean> {
    const workflowPerms = this.workflowPermissions.get(workflowId) || [];
    const userPerms = workflowPerms.find(p => p.userId === userId);

    if (!userPerms) {
      return false;
    }

    // Admin permission includes all others
    if (userPerms.permissions.includes('admin')) {
      return true;
    }

    return userPerms.permissions.includes(permission);
  }

  /**
   * Grant workflow permissions
   */
  async grantWorkflowPermission(
    workflowId: string,
    userId: string,
    permissions: ('read' | 'execute' | 'modify' | 'admin')[],
    grantedBy: string
  ): Promise<void> {
    const existing = this.workflowPermissions.get(workflowId) || [];
    const existingIndex = existing.findIndex(p => p.userId === userId);

    const permission: WorkflowPermission = {
      workflowId,
      userId,
      permissions,
      grantedAt: new Date(),
      grantedBy
    };

    if (existingIndex >= 0) {
      existing[existingIndex] = permission;
    } else {
      existing.push(permission);
    }

    this.workflowPermissions.set(workflowId, existing);
    this.emit('workflowPermissionGranted', { workflowId, userId, permissions, grantedBy });
  }

  /**
   * Revoke workflow permissions
   */
  async revokeWorkflowPermission(workflowId: string, userId: string, revokedBy: string): Promise<void> {
    const existing = this.workflowPermissions.get(workflowId) || [];
    const filtered = existing.filter(p => p.userId !== userId);
    
    this.workflowPermissions.set(workflowId, filtered);
    this.emit('workflowPermissionRevoked', { workflowId, userId, revokedBy });
  }

  /**
   * Create or update user
   */
  async createUser(userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = {
      id: this.generateSecureToken(),
      ...userData,
      createdAt: new Date()
    };

    this.users.set(user.id, user);
    this.emit('userCreated', { userId: user.id, email: user.email });

    return user;
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) || null;
  }

  /**
   * Hash password securely
   */
  async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, this.config.bcryptRounds);
  }

  /**
   * Verify password
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Destroy session
   */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    
    if (session) {
      this.emit('sessionDestroyed', { sessionId, userId: session.userId });
    }
  }

  private async requestTokens(code: string, codeVerifier: string): Promise<OAuth2Token> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.oauth.redirectUri,
      client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret,
      code_verifier: codeVerifier
    });

    // In a real implementation, this would make an HTTP request
    // For now, return a mock token
    return {
      accessToken: this.generateSecureToken(),
      refreshToken: this.generateSecureToken(),
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: this.config.oauth.scopes.join(' '),
      issuedAt: new Date()
    };
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private setupSessionCleanup(): void {
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
      const now = new Date();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now > session.expiresAt) {
          this.sessions.delete(sessionId);
          this.emit('sessionExpired', { sessionId, userId: session.userId });
        }
      }

      // Clean up expired OAuth states (older than 10 minutes)
      for (const [state, stateData] of this.oauthStates.entries()) {
        const stateAge = now.getTime() - stateData.createdAt.getTime();
        if (stateAge > 10 * 60 * 1000) {
          this.oauthStates.delete(state);
        }
      }
    }, 5 * 60 * 1000);
  }
}

/**
 * Authentication middleware for workflow execution
 */
export class AuthMiddleware {
  constructor(private authManager: AuthManager) {}

  /**
   * Middleware for session-based authentication
   */
  async authenticateSession(sessionId: string): Promise<User | null> {
    const session = await this.authManager.validateSession(sessionId);
    if (!session) {
      return null;
    }

    return await this.authManager.getUser(session.userId);
  }

  /**
   * Middleware for JWT-based authentication
   */
  async authenticateJWT(token: string): Promise<User | null> {
    try {
      const payload = this.authManager.verifyJWT(token);
      return await this.authManager.getUser(payload.sub);
    } catch {
      return null;
    }
  }

  /**
   * Authorize workflow execution
   */
  async authorizeWorkflowExecution(
    userId: string,
    workflowId: string
  ): Promise<boolean> {
    return await this.authManager.checkWorkflowPermission(userId, workflowId, 'execute');
  }

  /**
   * Authorize workflow modification
   */
  async authorizeWorkflowModification(
    userId: string,
    workflowId: string
  ): Promise<boolean> {
    return await this.authManager.checkWorkflowPermission(userId, workflowId, 'modify');
  }
}

/**
 * Default authentication configuration
 */
export const createDefaultAuthConfig = (): AuthConfig => ({
  jwtSecret: '',
  jwtExpiresIn: '24h',
  bcryptRounds: 12,
  oauth: {
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scopes: ['openid', 'profile', 'email'],
    authorizationUrl: '',
    tokenUrl: ''
  },
  sessionConfig: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict'
  }
});