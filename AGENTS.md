# Agent Configuration Standards

## Railway + Railpack Deployment Best Practices ✅

This agent configuration follows **verified best practices** for Railway + Railpack monorepo deployments.

### Verified Architecture ✅
```
polytrade/
├── railpack.json                           # ✅ Root coordination file  
├── frontend/railpack.json                  # ✅ Service-specific config
├── backend/railpack.json                   # ✅ Service-specific config
└── python-services/poloniex/railpack.json  # ✅ Service-specific config
```

## Agent Railway Configuration Requirements

### Critical Settings (Manual Configuration):
1. **✅ Root Directory**: Set to service-specific path:
   - Frontend Agent: `./frontend` 
   - Backend Agent: `./backend`
   - ML Agent: `./python-services/poloniex`

2. **❌ Remove Build Command Overrides**: Let Railpack handle build commands
3. **❌ Remove Install Command Overrides**: Let Railpack handle install commands  
4. **✅ Keep Environment Variables**: PORT, NODE_ENV, DATABASE_URL, API_KEYS, etc.
5. **❌ Clear Root Directory Overrides**: Only use service-specific paths

### Agent Service Configuration Matrix

| Agent Service | Railway Service ID | Root Directory | Config File | Agent Type |
|--------------|-------------------|----------------|-------------|------------|
| polytrade-fe | c81963d4-f110-49cf-8dc0-311d1e3dcf7e | `./frontend` | `frontend/railpack.json` | UI/Frontend |
| polytrade-be | e473a919-acf9-458b-ade3-82119e4fabf6 | `./backend` | `backend/railpack.json` | API/Backend |
| ml-worker | 86494460-6c19-4861-859b-3f4bd76cb652 | `./python-services/poloniex` | `python-services/poloniex/railpack.json` | ML/Analytics |

### Railway Master Cheat Sheet (Summary)
- Use Railpack v1 per service with `provider: "railway"`.
- Do not set Install/Build/Start overrides in Railway UI; Railpack is source of truth.
- Bind to `0.0.0.0` and read `$PORT` (Node: `process.env.PORT`; Python: `os.getenv('PORT')`).
- Commit per-service lockfiles: `frontend/yarn.lock`, `backend/yarn.lock`.
- Health endpoints: Backend `/api/health`, Frontend static serve 200 on `/health` or `/`, Python FastAPI `/health`.
- Use `${{service.RAILWAY_PUBLIC_DOMAIN}}` for inter-service URLs. Avoid hardcoded domains.
- Backend entry after build: `node dist/index.js` (tsc outDir `./dist`, flattened by `flatten-dist.mjs`).
- Preflight: validate JSON (`jq -e .`), check no `install.inputs` schema violations.
- Clear any existing Railway UI overrides when switching to Railpack.
Full checklist: see `.agent-os/specs/railway-deployment-cheatsheet.md`.

## Agent-Specific Railway Configuration

### Frontend Agent (React/TypeScript)
```javascript
// Agent port configuration
app.listen(process.env.PORT || 5675, '0.0.0.0');

// Agent service communication
const backendUrl = process.env.BACKEND_URL || `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`;
const mlServiceUrl = process.env.ML_SERVICE_URL || `https://${{ml-worker.RAILWAY_PUBLIC_DOMAIN}}`;
```

### Backend Agent (Node.js/Express)  
```javascript
// Agent port binding
app.listen(process.env.PORT || 8765, '0.0.0.0');

// Agent CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    `https://${{polytrade-fe.RAILWAY_PUBLIC_DOMAIN}}`
  ],
  credentials: true
}));
```

### ML Agent (Python/FastAPI)
```python
# Agent port configuration
port = int(os.getenv('PORT', 9080))
uvicorn.run(app, host='0.0.0.0', port=port)

# Agent service communication
backend_url = os.getenv('BACKEND_URL', '${{api.RAILWAY_PUBLIC_DOMAIN}}')
```

## Agent Deployment Success Indicators

### ✅ Agent Deployment Success Patterns:
- "Successfully prepared Railpack plan" for each agent service
- Agent-specific builds complete without errors
- Service mesh communication established between agents
- No schema violations in agent configurations
- Agent health checks pass

### ❌ Agent Deployment Error Patterns:
- "Install inputs must be an image or step input" (schema violation)
- "No project found in /app" (root directory misconfiguration)
- Path resolution errors in agent dependencies
- Agent communication timeouts or connection failures
- Missing environment variables for agent coordination

## Agent Configuration Validation Checklist

### Pre-Deployment Agent Checks:
- [ ] **Root Directory**: Each agent has correct root directory in Railway UI
- [ ] **Railpack Config**: Service-specific railpack.json exists and is valid
- [ ] **Port Configuration**: Agents bind to `0.0.0.0:$PORT`
- [ ] **Service Discovery**: Agents can discover and communicate with other agents
- [ ] **Environment Variables**: All required agent config variables are set
- [ ] **Schema Compliance**: No local inputs in install steps

### Post-Deployment Agent Validation:
- [ ] **Health Endpoints**: All agent health checks return 200
- [ ] **Service Mesh**: Inter-agent communication working
- [ ] **Logging**: Agent logs show successful startup messages
- [ ] **Performance**: Agents responding within acceptable latency
- [ ] **Error Handling**: Graceful degradation when agents are unavailable

## Agent Orchestration Patterns

### Agent-to-Agent Communication
```javascript
// Secure agent communication pattern
const callAgent = async (agentEndpoint, payload) => {
  const response = await fetch(`https://${{agent-service.RAILWAY_PUBLIC_DOMAIN}}${agentEndpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AGENT_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  return response.json();
};
```

### Agent State Management
```typescript
// Shared agent state interface
interface AgentState {
  id: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  lastHeartbeat: Date;
  capabilities: string[];
  currentTasks: Task[];
}
```

## Agent Monitoring and Observability

### Agent Health Check Endpoints
```javascript
// Standard health check for all agents
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    agent: process.env.AGENT_NAME,
    version: process.env.AGENT_VERSION,
    dependencies: checkDependencies()
  });
});
```

### Agent Metrics Collection
```javascript
// Agent performance metrics
const metrics = {
  requests_total: new Counter('agent_requests_total'),
  response_time: new Histogram('agent_response_duration_seconds'),
  active_connections: new Gauge('agent_active_connections')
};
```

## Agent Security Configuration

### Agent Authentication
```javascript
// Inter-agent authentication middleware
const agentAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !validateAgentToken(token)) {
    return res.status(401).json({ error: 'Invalid agent credentials' });
  }
  next();
};
```

### Agent Environment Security
```bash
# Agent-specific environment variables
AGENT_API_KEY=<secure-key-per-agent>
AGENT_NAME=<unique-agent-identifier>  
AGENT_CLUSTER=<cluster-identifier>
DATABASE_URL=<shared-database-connection>
```

## Conclusion

**VERDICT**: ✅ **Agent configuration follows verified Railway + Railpack best practices**

This multi-agent architecture with Railway deployment provides:
- **Service Isolation**: Each agent runs independently
- **Scalable Communication**: Railway's service mesh enables agent coordination  
- **Configuration Management**: Railpack handles agent-specific build requirements
- **Monitoring**: Health checks and metrics for each agent
- **Security**: Secure inter-agent communication patterns

**Action Required**: Ensure Railway UI settings match agent configuration requirements.