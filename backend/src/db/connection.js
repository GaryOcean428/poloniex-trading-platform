import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Check for DATABASE_URL environment variable
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  WARNING: DATABASE_URL environment variable not set');
  console.log('ℹ️  Backend will run without database connectivity');
  console.log('ℹ️  Please set DATABASE_URL in your Railway environment variables');
}

// Database configuration with fallback
const dbConfig = process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  max: 20, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
  query_timeout: 5000, // Return error after 5 seconds if query is taking too long
} : null;

// Create connection pool (only if DATABASE_URL is available)
let pool = null;
if (dbConfig) {
  pool = new Pool(dbConfig);
} else {
  console.log('📄 Running in demo mode without database connection');
}

// Test connection on startup (only if pool exists)
if (pool) {
  pool.connect()
    .then(client => {
      console.log('✅ PostGIS database connected successfully');
      client.release();
    })
    .catch(err => {
      console.error('❌ Database connection failed:', err.message);
      console.log('ℹ️  Backend will continue without database connectivity');
      pool = null; // Disable pool if connection fails
    });
}

// Handle pool errors (only if pool exists)
if (pool) {
  pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle client:', err);
    console.log('ℹ️  Continuing without database connectivity');
    pool = null; // Disable pool on error
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔄 Gracefully shutting down...');
  if (pool) {
    console.log('🔄 Closing database connections...');
    pool.end()
      .then(() => {
        console.log('✅ Database connections closed');
        process.exit(0);
      })
      .catch(err => {
        console.error('❌ Error closing database connections:', err);
        process.exit(1);
      });
  } else {
    console.log('✅ No database connections to close');
    process.exit(0);
  }
});

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

// Health check query
export const healthCheck = async () => {
  if (!pool) {
    return {
      healthy: false,
      error: 'Database not configured. Please set DATABASE_URL environment variable.',
      database_configured: false
    };
  }
  
  try {
    const result = await query('SELECT NOW() as timestamp, PostGIS_Version() as postgis_version');
    return {
      healthy: true,
      timestamp: result.rows[0].timestamp,
      postgis_version: result.rows[0].postgis_version,
      pool_size: pool.totalCount,
      idle_connections: pool.idleCount,
      waiting_connections: pool.waitingCount,
      database_configured: true
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      database_configured: true
    };
  }
};

export default pool;
