# Railway Deployment Configuration

## Monorepo Structure

This project uses a yarn workspace monorepo with three services:

1. **Frontend** (React/TypeScript) - `./frontend`
2. **Backend** (Node.js/TypeScript) - `./backend`
3. **ML Worker** (Python/FastAPI) - `./python-services/poloniex`

## Service Configuration

### Frontend Service
- **Root Directory**: `frontend`
- **Build Command**: Handled by railpack.json
- **Start Command**: `node serve.js`
- **Port**: Automatically assigned by Railway

### Backend Service
- **Root Directory**: `backend`
- **Build Command**: Handled by railpack.json
- **Start Command**: `node dist/backend/src/index.js`
- **Port**: Automatically assigned by Railway

### ML Worker Service
- **Root Directory**: `python-services/poloniex`
- **Build Command**: Not required
- **Start Command**: `uvicorn health:app --host 0.0.0.0 --port ${PORT:-8000}`
- **Port**: Automatically assigned by Railway

## Railway UI Configuration

For each service in Railway:

1. Set the **Root Directory** to the service folder
2. Clear any custom build/start commands (let railpack.json handle it)
3. Ensure environment variables are set appropriately

## Railpack Configuration

Each service has its own `railpack.json` that:
- References the root yarn.lock for JavaScript services
- Uses workspace commands for builds
- Specifies exact start commands

## TypeScript Shared Modules

The backend service uses `@shared/*` imports that reference the `shared/` directory at the repository root. The build process handles this through TypeScript path mapping.

## Troubleshooting

### Yarn Lock File Issues
- The root `yarn.lock` is committed and should be accessible
- Services use `--no-immutable` flag to prevent strict lockfile checks

### TypeScript Path Resolution
- Backend tsconfig.json maps `@shared/*` to `../shared/*`
- Build process includes shared directory in compilation

### Python Service Discovery
- Main entry point exists at repository root (`main.py`)
- Actual service code in `python-services/poloniex/`
- Railpack.json in Python service directory handles deployment

## Environment Variables

Required environment variables per service:

### Frontend
- `NODE_ENV`: production
- `VITE_API_URL`: Backend service URL

### Backend
- `NODE_ENV`: production
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Authentication secret

### ML Worker
- `POLONIEX_API_KEY`: API credentials
- `POLONIEX_API_SECRET`: API credentials
- `PORT`: Automatically set by Railway

## Deployment Checklist

- [ ] All services have railpack.json files
- [ ] yarn.lock is committed at repository root
- [ ] TypeScript builds successfully locally
- [ ] Python requirements.txt is up to date
- [ ] Environment variables configured in Railway
- [ ] Root directories set correctly in Railway UI