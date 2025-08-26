# Prompd Workflow Engine Deployment Guide

## Quick Start - Docker Container

The Prompd Workflow Engine is distributed as a secure, production-ready Docker container that can be easily integrated into any existing CI/CD pipeline or deployment system.

```bash
# Pull and run the container
docker run -d \
  --name prompd-workflow-engine \
  -p 3000:3000 \
  -e JWT_SECRET="your-secure-jwt-secret" \
  -e OAUTH_CLIENT_ID="your-oauth-client-id" \
  -e OAUTH_CLIENT_SECRET="your-oauth-client-secret" \
  -v $(pwd)/workflows:/app/workflows:ro \
  -v $(pwd)/config:/app/config:ro \
  prompd/workflow-engine:latest
```

## Container Configuration

### Environment Variables

**Required:**
```bash
JWT_SECRET=your-256-bit-secret-key
OAUTH_CLIENT_ID=your-oauth-client-id  
OAUTH_CLIENT_SECRET=your-oauth-client-secret
```

**Optional:**
```bash
NODE_ENV=production                    # production|development
PORT=3000                             # Server port
LOG_LEVEL=info                        # error|warn|info|debug
WORKFLOW_TIMEOUT=300000               # Workflow timeout (ms)
MAX_CONCURRENT_WORKFLOWS=10           # Max parallel workflows
RATE_LIMIT_REQUESTS=100               # Requests per window
RATE_LIMIT_WINDOW=60000               # Rate limit window (ms)

# LLM Provider API Keys
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
OLLAMA_URL=http://ollama:11434

# Database (optional)
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://user:pass@host:6379

# OAuth Configuration
OAUTH_REDIRECT_URI=https://your-domain.com/auth/callback
OAUTH_AUTH_URL=https://auth-provider.com/oauth/authorize  
OAUTH_TOKEN_URL=https://auth-provider.com/oauth/token
OAUTH_SCOPES=openid,profile,email
```

### Volume Mounts

```bash
# Workflows directory (read-only recommended)
-v /path/to/workflows:/app/workflows:ro

# Configuration files
-v /path/to/config:/app/config:ro

# Persistent logs (optional)
-v /path/to/logs:/app/logs

# Temporary files (optional, uses tmpfs by default)
-v /path/to/temp:/app/temp
```

## Integration Examples

### Docker Compose

```yaml
version: '3.8'
services:
  prompd-engine:
    image: prompd/workflow-engine:latest
    ports:
      - "3000:3000"
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID}
      - OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET}
    volumes:
      - ./workflows:/app/workflows:ro
      - ./config:/app/config:ro
    restart: unless-stopped
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prompd-workflow-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: prompd-workflow-engine
  template:
    metadata:
      labels:
        app: prompd-workflow-engine
    spec:
      containers:
      - name: workflow-engine
        image: prompd/workflow-engine:latest
        ports:
        - containerPort: 3000
        env:
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: prompd-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

### CI/CD Pipeline Integration

#### GitHub Actions
```yaml
- name: Deploy Prompd Engine
  run: |
    docker pull prompd/workflow-engine:latest
    docker stop prompd-engine || true
    docker rm prompd-engine || true
    docker run -d \
      --name prompd-engine \
      -p 3000:3000 \
      -e JWT_SECRET="${{ secrets.JWT_SECRET }}" \
      -e OAUTH_CLIENT_ID="${{ secrets.OAUTH_CLIENT_ID }}" \
      -e OAUTH_CLIENT_SECRET="${{ secrets.OAUTH_CLIENT_SECRET }}" \
      -v $(pwd)/workflows:/app/workflows:ro \
      prompd/workflow-engine:latest
```

#### GitLab CI
```yaml
deploy:
  stage: deploy
  script:
    - docker pull prompd/workflow-engine:latest
    - docker run -d --name prompd-engine -p 3000:3000 
      -e JWT_SECRET="$JWT_SECRET" 
      -e OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID"
      -e OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET"
      -v $CI_PROJECT_DIR/workflows:/app/workflows:ro
      prompd/workflow-engine:latest
```

#### Jenkins Pipeline
```groovy
stage('Deploy') {
    steps {
        sh '''
            docker pull prompd/workflow-engine:latest
            docker run -d --name prompd-engine -p 3000:3000 \
              -e JWT_SECRET="${JWT_SECRET}" \
              -e OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID}" \
              -e OAUTH_CLIENT_SECRET="${OAUTH_CLIENT_SECRET}" \
              -v ${WORKSPACE}/workflows:/app/workflows:ro \
              prompd/workflow-engine:latest
        '''
    }
}
```

### Cloud Platform Examples

#### AWS ECS Task Definition
```json
{
  "family": "prompd-workflow-engine",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "prompd-engine",
      "image": "prompd/workflow-engine:latest",
      "portMappings": [{"containerPort": 3000}],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3000"}
      ],
      "secrets": [
        {"name": "JWT_SECRET", "valueFrom": "arn:aws:ssm:region:account:parameter/prompd/jwt-secret"},
        {"name": "OAUTH_CLIENT_ID", "valueFrom": "arn:aws:ssm:region:account:parameter/prompd/oauth-client-id"}
      ]
    }
  ]
}
```

#### Google Cloud Run
```bash
gcloud run deploy prompd-workflow-engine \
  --image prompd/workflow-engine:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,PORT=3000 \
  --set-secrets JWT_SECRET=jwt-secret:latest,OAUTH_CLIENT_ID=oauth-client-id:latest
```

#### Azure Container Instances
```bash
az container create \
  --resource-group prompd-rg \
  --name prompd-workflow-engine \
  --image prompd/workflow-engine:latest \
  --ports 3000 \
  --environment-variables NODE_ENV=production PORT=3000 \
  --secure-environment-variables JWT_SECRET=$JWT_SECRET OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID
```

## Health Checks & Monitoring

The container exposes standard health check endpoints:

```bash
# Health check
curl http://localhost:3000/health

# Readiness check  
curl http://localhost:3000/ready

# Metrics (Prometheus format)
curl http://localhost:3000/metrics
```

## Security Considerations

1. **Secrets Management**: Never hardcode secrets in environment variables
2. **Network Security**: Run behind a reverse proxy/load balancer
3. **File Permissions**: Mount workflow directories as read-only
4. **Resource Limits**: Set appropriate memory and CPU limits
5. **Updates**: Regularly update to latest container version

## Scaling & Load Balancing

The container is stateless and can be horizontally scaled:

```bash
# Scale with Docker Compose
docker-compose up --scale prompd-engine=3

# Scale in Kubernetes
kubectl scale deployment prompd-workflow-engine --replicas=5
```

## Configuration Files

Create a `config/` directory with:

**config/workflows.json** - Workflow permissions and settings
```json
{
  "defaultTimeout": 300000,
  "maxConcurrent": 10,
  "allowedWorkflows": ["*"],
  "permissions": {
    "admin": ["read", "execute", "modify", "admin"],
    "user": ["read", "execute"]
  }
}
```

**config/providers.json** - LLM provider configurations
```json
{
  "providers": {
    "openai": {
      "models": ["gpt-4", "gpt-3.5-turbo"],
      "timeout": 30000
    },
    "anthropic": {
      "models": ["claude-3-opus", "claude-3-sonnet"],
      "timeout": 30000
    }
  }
}
```

## Support & Documentation

- **Container Registry**: `prompd/workflow-engine` on Docker Hub
- **Health Status**: All endpoints return JSON with status information
- **Logs**: Structured JSON logs to stdout/stderr
- **Metrics**: Prometheus-compatible metrics at `/metrics`

This approach gives you maximum flexibility to integrate into any existing infrastructure while maintaining security and scalability.