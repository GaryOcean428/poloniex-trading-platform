# Railpack Documentation Links

## Core Documentation
1. [Getting Started](https://railpack.com/getting-started) - Initial setup and basic concepts
2. [Installation](https://railpack.com/installation) - Installation instructions
3. [Installing Packages](https://railpack.com/guides/installing-packages) - Package management
4. [Adding Steps](https://railpack.com/guides/adding-steps) - Build step configuration
5. [Developing Locally](https://railpack.com/guides/developing-locally) - Local development workflow
6. [Running in Production](https://railpack.com/guides/running-railpack-in-production) - Production deployment best practices

## Configuration
7. [Configuration File](https://railpack.com/config/file) - railpack.json structure and options
8. [Environment Variables](https://railpack.com/config/environment-variables) - Environment variable handling
9. [Procfile](https://railpack.com/config/procfile) - Process configuration

## Language Support
10. [Node.js](https://railpack.com/languages/node) - Node.js specific configuration
11. [Python](https://railpack.com/languages/python) - Python specific configuration
12. [Go](https://railpack.com/languages/golang) - Go specific configuration
13. [PHP](https://railpack.com/languages/php) - PHP specific configuration
14. [Java](https://railpack.com/languages/java) - Java specific configuration
15. [Ruby](https://railpack.com/languages/ruby) - Ruby specific configuration

## Reference
16. [CLI Reference](https://railpack.com/reference/cli) - Command line interface documentation
17. [Frontend](https://railpack.com/reference/frontend) - Frontend integration
18. [Architecture Overview](https://railpack.com/architecture/overview) - System architecture
19. [Package Resolution](https://railpack.com/architecture/package-resolution) - How packages are resolved
20. [Secrets](https://railpack.com/architecture/secrets) - Secret management
21. [BuildKit](https://railpack.com/architecture/buildkit) - BuildKit integration
22. [Caching](https://railpack.com/architecture/caching) - Build caching strategies
23. [User Config](https://railpack.com/architecture/user-config) - User configuration options
24. [Contributing](https://railpack.com/contributing) - How to contribute

## Best Practices for Monorepos

### Recommended Configuration Structure:
- **Root railpack.json**: Coordination file for service discovery
- **Service-specific railpack.json**: Individual build configurations per service
- **Railway Root Directory**: Set to specific service directory (e.g., `./frontend`, `./backend`)

### Key Principles:
1. Use isolated monorepo pattern with Railway
2. Set root directories in Railway UI for each service
3. Maintain service-specific railpack.json files for build isolation
4. Root coordination file references individual service configs
