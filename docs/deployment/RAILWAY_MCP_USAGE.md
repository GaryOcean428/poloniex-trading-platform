# Railway MCP Tools Usage Guide

## Overview

This guide shows how to use Railway MCP tools to verify and configure your Railway deployment directly.

## Prerequisites

You need Railway MCP tools installed and configured with your Railway API token.

## Step 1: List Your Projects

```bash
# List all Railway projects to find your project ID
railway-mcp-project_list
```

Expected output includes your `poloniex-trading-platform` project with its ID.

## Step 2: Get Project Details

```bash
# Get detailed project information
railway-mcp-project_info --projectId=<your-project-id>
```

This shows all services (frontend, backend, ml-worker) and their configurations.

## Step 3: List Backend Service Details

```bash
# Get backend service information
railway-mcp-service_list --projectId=<your-project-id>
```

Find the `polytrade-be` service (ID: e473a919-acf9-458b-ade3-82119e4fabf6).

## Step 4: Get Service Configuration

```bash
# Get detailed service information including current settings
railway-mcp-service_info \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id>
```

This shows current root directory, build commands, and environment variables.

## Step 5: Update Service Configuration

```bash
# Update backend service with correct settings
railway-mcp-service_update \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --rootDirectory=backend \
  --buildCommand="yarn install --immutable && yarn bundle:shared && yarn workspace backend build:railway" \
  --startCommand="node dist/src/index.js" \
  --healthcheckPath="/api/health"
```

## Step 6: List and Set Environment Variables

```bash
# List current environment variables
railway-mcp-list_service_variables \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id>

# Set required environment variables
railway-mcp-variable_set \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --name=NODE_ENV \
  --value=production

railway-mcp-variable_set \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --name=JWT_SECRET \
  --value=<your-secure-jwt-secret>

railway-mcp-variable_set \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --name=DATABASE_URL \
  --value=<your-database-url>
```

## Step 7: Trigger Deployment

```bash
# Trigger a new deployment with the updated configuration
railway-mcp-deployment_trigger \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --commitSha=<latest-commit-sha>
```

## Step 8: Monitor Deployment

```bash
# List recent deployments
railway-mcp-deployment_list \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id> \
  --limit=5

# Get deployment status
railway-mcp-deployment_status \
  --deploymentId=<deployment-id>

# Get deployment logs
railway-mcp-deployment_logs \
  --deploymentId=<deployment-id> \
  --limit=100
```

## Step 9: Verify Deployment Success

```bash
# Check service health
railway-mcp-service_info \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id>

# List domains to get the public URL
railway-mcp-domain_list \
  --projectId=<your-project-id> \
  --serviceId=e473a919-acf9-458b-ade3-82119e4fabf6 \
  --environmentId=<environment-id>

# Test health endpoint
curl https://<your-service-domain>/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-02T...",
  "environment": "production"
}
```

## Quick Reference: Service IDs

| Service | Railway Service ID |
|---------|-------------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 |

## Troubleshooting with MCP Tools

### Check Failed Deployments

```bash
# Get failed job logs for debugging
railway-mcp-get_job_logs \
  --owner=GaryOcean428 \
  --repo=poloniex-trading-platform \
  --run_id=<run-id> \
  --failed_only=true
```

### Review Workflow Runs

```bash
# List recent workflow runs
railway-mcp-list_workflow_runs \
  --owner=GaryOcean428 \
  --repo=poloniex-trading-platform \
  --workflow_id=<workflow-id> \
  --status=completed
```

## Alternative: Use Railway Dashboard

If you prefer using the Railway web dashboard:

1. Go to https://railway.app
2. Navigate to your project
3. Select the `polytrade-be` service
4. Go to Settings
5. Configure the settings as documented in RAILWAY_SERVICE_CONFIG.md

## Additional Resources

- [Railway API Documentation](https://docs.railway.com/reference/api)
- [Railway Service Configuration](./RAILWAY_SERVICE_CONFIG.md)
- [Railway Deployment Master Guide](../RAILWAY_DEPLOYMENT_MASTER.md)
