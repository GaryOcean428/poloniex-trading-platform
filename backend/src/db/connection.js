import pkg from 'pg';
import dotenv from 'dotenv';
import { parse } from 'pg-connection-string';

dotenv.config();

const { Pool } = pkg;

// Validate and parse DATABASE_URL environment variable
const validateAndParseDatabaseUrl = (url) => {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    console.warn('❌ DATABASE_URL is empty or not a string');
    return { isValid: false };
  }

  try {
    // Try to parse the connection string
    const parsed = parse(url);
    
    // Check for required components
    const hasRequiredFields = parsed.host && parsed.database && parsed.user;
    const isValidFormat = url.startsWith('postgresql://') || 
                         url.startsWith('postgres://') ||
                         url.includes('host=');
    
    if (!hasRequiredFields || !isValidFormat) {
      console.warn('❌ DATABASE_URL is missing required components');
      return { isValid: false };
    }
    
    return { 
      isValid: true,
      parsed,
      maskedUrl: url.replace(/:[^:]*@/, ':***@') // Mask password in logs
    };
  } catch (error) {
    console.warn('❌ Failed to parse DATABASE_URL:', error.message);
    return { isValid: false };
  }
};

const databaseUrl = process.env.DATABASE_URL;
const { isValid, parsed, maskedUrl } = validateAndParseDatabaseUrl(databaseUrl);

// Log connection details (masking sensitive info)
if (isValid) {
  console.log(`🔍 Detected database: postgresql://${parsed.user}@${parsed.host}:${parsed.port || 5432}/${parsed.database}`);
} else if (!databaseUrl) {
  console.warn('⚠️  WARNING: DATABASE_URL environment variable is not set');
} else {
  console.warn('⚠️  WARNING: DATABASE_URL is invalid');
  console.warn(`Received: ${maskedUrl || '(empty)'}`);
}

// Database configuration with fallback
let dbConfig = null;

if (isValid) {
  try {
    dbConfig = {
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }, // Always use SSL for Railway connections
      max: 20, // Maximum number of connections in the pool
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection could not be established
      query_timeout: 15000, // Return error after 15 seconds if query is taking too long
    };
    console.log('✅ Database configuration is valid');
  } catch (error) {
    console.error('❌ Failed to configure database:', error.message);
    dbConfig = null;
  }
} else {
  console.warn('ℹ️  Backend will run in DEMO MODE without database connectivity');
  console.warn('ℹ️  To enable database features, set a valid DATABASE_URL environment variable');
  console.warn('ℹ️  Expected format: postgresql://user:password@host:port/database');
  console.warn('ℹ️  Example: postgresql://postgres:yourpassword@localhost:5432/polytrade');
}

// Create connection pool (only if configuration is valid)
let pool = null;
let isConnected = false;

async function initializePool() {
  if (!dbConfig) {
    console.log('ℹ️  Running in DEMO MODE - database features are disabled');
    return null;
  }

  console.log('🔗 Attempting to create database connection pool...');
  
  let testPool = null;
  let client = null;
  
  try {
    // Create a test pool
    testPool = new Pool(dbConfig);
    
    // Test the connection
    client = await testPool.connect();
    const result = await client.query('SELECT version()');
    console.log(`✅ Connected to PostgreSQL ${result.rows[0].version.split(' ')[1]}`);
    
    // Connection successful, keep the pool
    isConnected = true;
    return testPool;
  } catch (error) {
    console.error('❌ Failed to connect to database:', error.message);
    console.error('❌ Please check your DATABASE_URL and ensure the database is running');
    
    // Cleanup resources
    if (client) {
      try {
        client.release();
      } catch (e) {
        console.error('❌ Error releasing client:', e.message);
      }
    }
    
    if (testPool) {
      try {
        await testPool.end();
      } catch (e) {
        console.error('❌ Error cleaning up connection pool:', e.message);
      }
    }
    
    return null;
  } finally {
    // Ensure client is always released
    if (client) {
      try {
        client.release();
      } catch (e) {
        console.error('❌ Error in finally block releasing client:', e.message);
      }
    }
  }
}

// Initialize the pool immediately
initializePool()
  .then(p => {
    pool = p;
  })
  .catch(error => {
    console.error('❌ Error initializing database pool:', error.message);
    pool = null;
  });

// Health check function that can be called externally
export async function healthCheck() {
  if (!pool || !isConnected) {
    return {
      status: 'unhealthy',
      message: 'Database connection not available',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      readOnly: true
    };
  }

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    client.release();
    
    return {
      status: 'healthy',
      timestamp: result.rows[0].current_time,
      database: 'connected',
      version: result.rows[0].version,
      readOnly: false
    };
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    return {
      status: 'unhealthy',
      message: error.message,
      timestamp: new Date().toISOString(),
      database: 'error',
      readOnly: true
    };
  }
}

// Handle pool errors (only if pool exists)
if (pool) {
  pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle client:', err.message);
    console.error('❌ Stack:', err.stack);
    console.log('ℹ️  Attempting to reconnect...');
    
    // Try to reinitialize the pool
    initializePool()
      .then(newPool => {
        if (newPool) {
          console.log('✅ Successfully reconnected to database');
          pool = newPool;
          isConnected = true;
        } else {
          console.error('❌ Failed to reconnect to database');
          pool = null;
          isConnected = false;
        }
      });
  });
}

// Handle graceful shutdown
const shutdown = async () => {
  console.log('\n🔄 Gracefully shutting down...');
  
  if (pool) {
    console.log('🔄 Closing database connections...');
    try {
      await pool.end();
      console.log('✅ Database connections closed');
    } catch (err) {
      console.error('❌ Error closing database connections:', err.message);
    }
  }
  
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Database query helper with error handling

// Database query helper with error handling
export const query = async (text, params = []) => {
  if (!pool) {
    throw new Error('Database not available. Please configure DATABASE_URL environment variable.');
  }

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`⚠️  Slow query (${duration}ms):`, text.substring(0, 100));
    }

    return result;
  } catch (error) {
    console.error('❌ Database query error:', error.message);
    console.error('Query:', text);
    console.error('Params:', params);
    throw error;
  }
};

// Transaction helper
export const transaction = async (callback) => {
  if (!pool) {
    throw new Error('Database not available. Please configure DATABASE_URL environment variable.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Geospatial query helpers
export const geoQuery = {
  // Create a point from latitude and longitude
  createPoint: (lat, lon) => {
    return `ST_GeogFromText('POINT(${lon} ${lat})')`;
  },

  // Calculate distance between two points in kilometers
  distance: (point1, point2) => {
    return `ST_Distance(${point1}, ${point2}) / 1000.0`;
  },

  // Check if a point is within a certain distance of another point
  withinDistance: (point1, point2, distanceKm) => {
    return `ST_DWithin(${point1}, ${point2}, ${distanceKm * 1000})`;
  },

  // Get latitude and longitude from a geography point
  getLatLon: (point) => {
    return `ST_Y(${point}::geometry) as latitude, ST_X(${point}::geometry) as longitude`;
  }
};

// Note: healthCheck function is already defined above

export default pool;
