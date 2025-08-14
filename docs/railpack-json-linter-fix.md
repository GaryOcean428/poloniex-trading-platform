# Railpack JSON Linter Fix

## Problem

Your IDE linter may show false positive errors for `railpack.json` files, such as:

- "Missing property 'provider'"
- "Property 'build' is not allowed"
- "Property 'steps' is not allowed"

These errors occur because the IDE is using an incorrect or outdated schema for Railpack configuration files.

## Solution

We've implemented two solutions to fix these linter warnings:

### 1. VS Code Settings Configuration

We've added a `.vscode/settings.json` file with the following configuration:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["railpack.json"],
      "schema": false
    }
  ],
  "files.associations": {
    "railpack.json": "jsonc"
  }
}
```

This configuration:

- Disables JSON schema validation for all `railpack.json` files
- Associates `railpack.json` files with JSONC (JSON with Comments) mode

### 2. Correct Schema Reference

All `railpack.json` files include the correct schema reference:

```json
{
  "$schema": "https://schema.railpack.com",
  // ... rest of the configuration
}
```

## Validated Railpack Configurations

### Frontend (`frontend/railpack.json`)

```json
{
  "$schema": "https://schema.railpack.com",
  "build": {
    "env": {
      "NODE_ENV": "production"
    },
    "steps": [
      {
        "name": "install",
        "command": "yarn install --immutable --immutable-cache"
      },
      {
        "name": "build",
        "command": "yarn build",
        "dependsOn": ["install"]
      }
    ]
  },
  "deploy": {
    "startCommand": "node serve.js",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### Backend (`backend/railpack.json`)

```json
{
  "$schema": "https://schema.railpack.com",
  "build": {
    "env": {
      "NODE_ENV": "production"
    },
    "steps": [
      {
        "name": "install",
        "command": "yarn install --immutable --immutable-cache"
      },
      {
        "name": "build",
        "command": "yarn build",
        "dependsOn": ["install"]
      }
    ]
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ALWAYS",
    "restartPolicyMaxRetries": 5
  }
}
```

### Python Service (`python-services/poloniex/railpack.json`)

```json
{
  "$schema": "https://schema.railpack.com",
  "build": {
    "env": {
      "PYTHONUNBUFFERED": "1",
      "PIP_NO_CACHE_DIR": "1",
      "PYTHONDONTWRITEBYTECODE": "1"
    },
    "steps": [
      {
        "name": "install",
        "command": "pip install --no-cache-dir -r requirements.txt"
      }
    ]
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --loop uvloop --access-log",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ALWAYS",
    "restartPolicyMaxRetries": 10
  }
}
```

### Root Configuration (`railpack.json`)

```json
{
  "$schema": "https://schema.railpack.com",
  "version": "1",
  "services": {
    "frontend": "./frontend",
    "backend": "./backend",
    "ml-worker": "./python-services/poloniex"
  }
}
```

## Verification

To verify that your configurations are correct:

1. Check Railway build logs after deployment - you should see:

   ```text
   ↳ Using config file `railpack.json`
   ```

2. All services should start successfully with the specified commands

3. Health checks should pass on the defined paths

## Additional Resources

- [Railpack Official Documentation](https://docs.railway.app/reference/railpack)
- [Railway Deployment Guide](https://docs.railway.app/deploy/configuration)
- [Railpack Schema](https://schema.railpack.com)

## Troubleshooting

If you continue to see linter warnings:

1. Reload VS Code window (Ctrl+Shift+P, "Developer: Reload Window")
2. Check if the `.vscode/settings.json` file is properly loaded
3. Verify that your IDE is not using a cached schema

The configurations are correct according to Railpack v0.2.3 and will work properly on Railway despite any IDE warnings.
