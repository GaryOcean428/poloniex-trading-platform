# Railway Configuration Files - Reference

## Current Configuration Strategy

After monorepo migration, Railway services use **service-level** railpack.json files located in each service's directory.

## Active Configuration Files

### 1. Frontend Service (polytrade-fe)
**Location:** `apps/web/railpack.json`
**Railway Root Directory:** `apps/web`
**Purpose:** Builds and deploys the React + Vite frontend

### 2. Backend Service (polytrade-be)  
**Location:** `apps/api/railpack.json`
**Railway Root Directory:** `apps/api`
**Purpose:** Builds and deploys the Node.js + Express backend

### 3. ML Worker Service (ml-worker)
**Location:** `kernels/core/railpack.json`
**Railway Root Directory:** `kernels/core`
**Purpose:** Deploys the Python FastAPI ML worker

## Railway Configuration Files

Each service also has a `railway.json` file for Railway-specific settings:
- `apps/web/railway.json`
- `kernels/core/railway.json`

## How Railway Finds Configuration

Railway looks for configuration files in this order:
1. Service-level settings in Railway Dashboard (highest priority)
2. `railway.json` in the root directory specified in service settings
3. `railpack.json` in the root directory specified in service settings

## Required Railway Dashboard Settings

For each service, set the **Root Directory** in Railway Dashboard → Service → Settings:

| Service | Root Directory |
|---------|---------------|
| polytrade-fe | `apps/web` |
| polytrade-be | `apps/api` |
| ml-worker | `kernels/core` |

Once set, Railway will use the railpack.json file in that directory.

## Deprecated Files (Will Be Removed)

These root-level files are no longer needed and create confusion:
- ❌ `railpack-backend.json` - Use `apps/api/railpack.json` instead
- ❌ `railpack-frontend.json` - Use `apps/web/railpack.json` instead
- ❌ `railpack-ml-worker.json` - Use `kernels/core/railpack.json` instead

## Summary

**One railpack.json per service, located in that service's directory.**

This approach:
- ✅ Aligns with monorepo structure
- ✅ Keeps configuration close to the code
- ✅ Eliminates duplication and confusion
- ✅ Works seamlessly once Railway Root Directory is updated
