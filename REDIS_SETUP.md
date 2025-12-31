# Redis Cache Setup

This application uses Redis for caching API responses to improve performance. Redis is optional - if Redis is not available, the application will automatically fall back to in-memory caching.

## Configuration

### Environment Variable

Set the `REDIS_URL` environment variable to connect to Redis:

```bash
REDIS_URL=redis://localhost:6379
```

For Redis with authentication:
```bash
REDIS_URL=redis://:password@localhost:6379
```

For Redis Cloud or Railway Redis:
```bash
REDIS_URL=rediss://:password@hostname:port
```

### Railway Setup

1. Add a Redis service to your Railway project
2. Railway will automatically provide a `REDIS_URL` environment variable
3. The application will automatically connect to Redis on startup

### Local Development

#### Option 1: Docker
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

#### Option 2: Install Redis locally
- **macOS**: `brew install redis && brew services start redis`
- **Ubuntu/Debian**: `sudo apt-get install redis-server && sudo systemctl start redis`
- **Windows**: Download from https://redis.io/download

Then set:
```bash
REDIS_URL=redis://localhost:6379
```

## Features

- **Automatic Fallback**: If Redis is unavailable, the app uses in-memory caching
- **Connection Resilience**: Automatically reconnects if Redis connection is lost
- **Error Handling**: Gracefully handles Redis errors and falls back to memory
- **TTL Support**: All cached entries have automatic expiration
- **Cache Invalidation**: Cache is automatically invalidated on data updates

## Cached Endpoints

The following endpoints use Redis caching:

- **Templates**: Cached for 5 minutes
- **Users**: Cached for 2 minutes
- **Analytics**: Cached for 1 minute
- **Search Results**: Not cached (always fresh)

## Monitoring

The cache utility provides statistics:

```typescript
const stats = await cache.getStats();
console.log(stats);
// { type: 'redis', size: 10, keys: [...], info: '...' }
// or
// { type: 'memory', size: 5, keys: [...] }
```

## Troubleshooting

### Redis Not Connecting

1. Check `REDIS_URL` is set correctly
2. Verify Redis is running: `redis-cli ping` (should return `PONG`)
3. Check firewall/network settings
4. Application will automatically use in-memory cache as fallback

### Cache Not Working

- Check Redis connection status in application logs
- Verify cache keys are being set (check Redis: `redis-cli KEYS *`)
- Ensure TTL values are appropriate for your use case

### Performance Issues

- Redis should improve performance, especially for frequently accessed data
- If using in-memory fallback, cache is limited to single instance
- For multi-instance deployments, Redis is recommended

## Production Recommendations

1. **Use Redis**: For production, always use Redis for shared cache across instances
2. **Connection Pooling**: Already configured with retry strategy
3. **Monitoring**: Monitor Redis memory usage and connection status
4. **Backup**: Configure Redis persistence if needed for your use case

