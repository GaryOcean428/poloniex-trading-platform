# Railpack Configuration for Poloniex Trading Platform

This directory contains services that must be built with specific providers:

## Service Provider Map
- `frontend/` - Node.js 22 with Yarn 4.9.2
- `backend/` - Node.js 22 with Yarn 4.9.2  
- `python-services/` - Python 3.11 with UV

## Critical: Python File Location
**NEVER place Python files in the repository root.** Railpack's auto-detection will misidentify the entire project as Python, causing Node.js services to fail.

## Provider Override
If Railpack misdetects the language, set these environment variables in Railway:
- `RAILPACK_PROVIDER=node`
- `RAILPACK_NODE_VERSION=22`
- `RAILPACK_PACKAGEMANAGER=yarn`

## Build Commands
All services use Yarn workspaces from the root:
- Frontend: `yarn build:frontend`
- Backend: `yarn build:backend`
