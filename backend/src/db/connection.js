import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  max: 20, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
  query_timeout: 5000, // Return error after 5 seconds if query is taking too long
};

// Create connection pool
const pool = new Pool(dbConfig);

// Test connection on startup
pool.connect()
  .then(client => {
    console.log('✅ PostGIS database connected successfully');
    client.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client:', err);
  process.exit(-1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔄 Gracefully shutting down database connections...');
  pool.end()
    .then(() => {
      console.log('✅ Database connections closed');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error closing database connections:', err);
      process.exit(1);
    });
});

// Database query helper with error handling
export const query = async (text, params = []) => {
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
  try {
    const result = await query('SELECT NOW() as timestamp, PostGIS_Version() as postgis_version');
    return {
      healthy: true,
      timestamp: result.rows[0].timestamp,
      postgis_version: result.rows[0].postgis_version,
      pool_size: pool.totalCount,
      idle_connections: pool.idleCount,
      waiting_connections: pool.waitingCount
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
};

export default pool;
