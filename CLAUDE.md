# Railway + Railpack Configuration Standards

## Railway + Railpack Deployment Best Practices ✅

Your current configuration follows **verified best practices** for Railway + Railpack monorepo deployments:

### Verified Architecture ✅
```
polytrade/
├── railpack.json                           # ✅ Root coordination file  
├── frontend/railpack.json                  # ✅ Service-specific config
├── backend/railpack.json                   # ✅ Service-specific config
└── python-services/poloniex/railpack.json  # ✅ Service-specific config
```

### Official Documentation Confirmation ✅

**Railway Documentation confirms**:
- Use "isolated monorepo pattern"
- Set root directory per service in Railway UI  
- Each service gets independent builds/deployments

**Railpack Documentation confirms**:
- Supports service-specific configuration files
- Root coordination files are valid patterns
- Production deployments should use service isolation

## Railway UI Configuration Requirements

### Critical Settings (Manual Configuration):
1. **✅ Root Directory**: Set to service-specific path:
   - Frontend: `./frontend` 
   - Backend: `./backend`
   - Python Service: `./python-services/poloniex`

2. **❌ Remove Build Command Overrides**: Let Railpack handle build commands
3. **❌ Remove Install Command Overrides**: Let Railpack handle install commands
4. **✅ Keep Environment Variables**: PORT, NODE_ENV, DATABASE_URL, etc.
5. **❌ Clear Root Directory Overrides**: Only use service-specific paths

### Service Configuration Checklist

| Service | Railway Service ID | Root Directory | Config File |
|---------|-------------------|----------------|-------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` | `frontend/railpack.json` |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `./backend` | `backend/railpack.json` |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` | `python-services/poloniex/railpack.json` |

## Deployment Success Indicators

### ✅ Expected Success Indicators:
- "Successfully prepared Railpack plan"
- Service-specific builds complete successfully
- No schema violations

### ❌ Error Patterns (Should NOT appear):
- "Install inputs must be an image or step input" 
- "No project found in /app"
- Path resolution errors in yarn/npm commands

## Key Benefits of Current Setup

### ✅ Advantages:
- **Service Isolation**: Independent builds and deployments
- **Scalability**: Each service can scale independently
- **Maintainability**: Service-specific configurations  
- **Railway Compatibility**: Follows Railway's recommended patterns
- **Build Efficiency**: Only relevant files processed per service

### Configuration Validation Status:
- ✅ Root `railpack.json` exists and references services
- ✅ Each service has own `railpack.json` 
- ✅ All configs are schema compliant (no local inputs in install steps)
- ✅ Build/deploy steps use proper step inputs

## Railway Config Quick-Check for Railpack

### 1. Verify Root Directory Settings
```bash
# Check Railway service configuration
railway status
railway service
```

### 2. Validate Railpack Configuration
```bash
# Test railpack configuration locally
railpack build --dry-run
```

### 3. Deploy and Monitor
```bash
railway up
# Monitor logs for:
# - "Successfully prepared Railpack plan"
# - Service-specific build completion
# - No schema violations
```

## Additional Railway Best Practices

### Port Management (from .clinerules)
- **Frontend**: 5675-5699 (avoid default 3000, 5173)
- **Backend**: 8765-8799 (avoid default 8080)  
- **Services**: 9080-9099 (Firebase and other services)
- **Always bind to**: `0.0.0.0` with `process.env.PORT`

### Service Communication
- Use Railway reference variables: `${{service.RAILWAY_PRIVATE_DOMAIN}}`
- Internal traffic: `http://` + `.railway.internal` names
- Public traffic: `https://` + `RAILWAY_PUBLIC_DOMAIN`

### CORS Configuration
```javascript
app.use(cors({
  origin: [process.env.FRONTEND_URL],
  credentials: true
}));
```

## Conclusion

**VERDICT**: ✅ **Your current Railpack + Railway configuration is OPTIMAL**

The combination of:
- Root coordination file
- Service-specific railpack.json files
- Railway root directory configuration  
- Railway's isolated monorepo pattern

...represents the **verified best practice** for Railway + Railpack monorepo deployments.

**Action Required**: Ensure Railway UI settings match the checklist above.