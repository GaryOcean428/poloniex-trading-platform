/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // During builds, we'll run ESLint on the following directories
    dirs: ['src', 'pages', 'components', 'lib'],
  },
  experimental: {
    // Enable latest React features
    reactCompiler: true,
  },
  // Ensure compatibility with the port configuration from .clinerules
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  // Handle the existing static assets
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
  
  // Configure for Railway deployment
  output: 'standalone',
  
  // Path imports configuration (similar to existing Vite alias)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, './src'),
      '@shared': require('path').resolve(__dirname, './src/shared'),
    };
    return config;
  },
  
  // Server configuration for Railway
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: process.env.VITE_API_URL || 'http://localhost:8765' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;