# Railway Redis Deployment Guide

## 🚨 Redis Service Setup Required

### **Current Status**: ❌ Redis Service Not Found

The Redis Stack service is not yet configured in Railway. This guide provides the exact steps to set up Redis for the PolyTrade trading platform.

---

## **📋 Quick Setup Steps**

### **1. Add Redis Service to Railway**

```bash
# Method 1: Using Railway CLI
railway add --service redis

# Method 2: Using Railway Dashboard
# 1. Go to https://railway.com/project/[PROJECT-ID]
# 2. Click "New" → "Database" → "Redis"
# 3. Name it "redis-stack"
```

### **2. Environment Variables Required**

Once Redis is added, Railway will automatically inject these environment variables:

```bash
# These will be automatically provided by Railway
REDIS_URL=redis://default:PASSWORD@redis-stack.railway.internal:6379
REDIS_PRIVATE_DOMAIN=redis-stack.railway.internal
REDIS_PASSWORD=YOUR_PASSWORD_HERE
```

### **3. Verify Redis Connection**

```bash
# Test Redis connection
railway run -- redis-cli -u $REDIS_URL ping

# Expected output: PONG
```

---

## **🔧 Application Configuration**

### **Redis Service Check**

The application has been updated to gracefully handle missing Redis configuration:

```javascript
// Backend will log when Redis is unavailable
if (!process.env.REDIS_PRIVATE_DOMAIN || !process.env.REDIS_PASSWORD) {
  logger.warn('⚠️ Redis not configured - features gracefully disabled');
}
```

### **Features That Work Without Redis**

- ✅ All API endpoints function normally
- ✅ Rate limiting falls back to allowing requests
- ✅ Caching is bypassed (direct API calls)
- ✅ Session management uses in-memory storage
- ✅ Trading platform remains fully functional

---

## **🎯 Step-by-Step Deployment**

### **Step 1: Add Redis Service**

1. Login to Railway Dashboard: <https://railway.com>
2. Navigate to your project
3. Click "New" → "Database" → "Redis"
4. Name the service "redis-stack"
5. Wait for deployment (2-3 minutes)

### **Step 2: Update Environment**

```bash
# Pull latest environment variables
railway login
railway link
railway variables
```

### **Step 3: Test Redis Integration**

```bash
# Deploy with Redis
cd backend
railway up

# Test Redis connectivity
railway run -- yarn node test-redis-integration.js
```

### **Step 4: Verify Features**

- ✅ Redis rate limiting active
- ✅ Market data caching enabled
- ✅ Session persistence working
- ✅ Enhanced logging active

---

## **📊 Redis Service Details**

| Service | Railway Plan | Cost | Features |
|---------|--------------|------|----------|
| Redis Stack | Starter | $5/month | 512MB RAM, persistence, RedisInsight |

---

## **🚨 Troubleshooting**

### **Redis Not Connecting**

```bash
# Check if Redis service exists
railway services

# Check environment variables
railway variables | grep -i redis

# Restart service
railway restart
```

### **Connection Errors**

If you see `ENOTFOUND redis-stack.railway.internal`:

1. Ensure Redis service is deployed
2. Check service name is "redis-stack"
3. Verify environment variables are set

---

## **✅ Expected Output After Setup**

When Redis is properly configured, you should see:

```
🧪 Testing Redis Integration...
1. Testing Redis connection...
✅ Redis connected successfully
2. Testing basic operations...
✅ Redis SET operation successful
✅ Redis GET operation successful
3. Testing rate limiting...
✅ Rate limiting configured
4. Testing caching...
✅ Caching mechanism active
🎉 All Redis tests passed!
```

---

## **🚀 Next Steps**

1. **Add Redis Service** to Railway (takes 2-3 minutes)
2. **Redeploy** backend service
3. **Test** Redis functionality
4. **Monitor** performance improvements

---

## **📞 Support**

If Redis setup fails:

- Check Railway documentation
- Verify service deployment status
- Ensure correct service name ("redis-stack")
- Check environment variable injection

**Status**: Ready to deploy once Redis service is added to Railway project.
