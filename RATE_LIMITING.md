# Rate Limiting Configuration

## Overview

Rate limiting has been implemented to protect the API from abuse, DDoS attacks, and excessive resource usage.

## Rate Limit Tiers

### 1. General API Endpoints
- **Limit**: 100 requests per 15 minutes per user/IP
- **Applies to**: 
  - Case Templates (GET, POST, PUT, DELETE)
  - Clients (GET, POST, PUT, DELETE - non-file operations)
  - Reminders (GET, POST, PUT, DELETE)
  - General API operations

### 2. File Upload Endpoints
- **Limit**: 20 requests per 15 minutes per user/IP
- **Applies to**:
  - Client document uploads (`POST /api/clients/:id/documents/:documentCode`)
  - Additional document file uploads (`POST /api/clients/:id/additional-documents/:documentId/file`)
  - Requested document uploads (`POST /api/clients/:id/requested-documents/:code/upload`)
  - Aportar documentacion file uploads
  - Requerimiento file uploads
  - Resolucion file uploads
  - Justificante presentacion file uploads

### 3. Sensitive Operations
- **Limit**: 10 requests per 15 minutes per user/IP
- **Applies to**:
  - User management (`/api/users/*`)
  - Settings management (`/api/settings/*`)
  - Database copy operations
  - Data export/import operations

### 4. Analytics Endpoints
- **Limit**: 50 requests per 15 minutes per user/IP
- **Applies to**:
  - Payment summaries (`/api/analytics/payments-summary`)
  - Monthly summaries (`/api/analytics/monthly-summary`)
  - Monthly trends (`/api/analytics/monthly-trend`)

## Rate Limit Key Generation

Rate limits are tracked per user when authenticated:
- **Authenticated users**: `user:{firebase_uid}` - Limits are per user account
- **Unauthenticated requests**: `ip:{ip_address}` - Limits are per IP address

This ensures that:
- Each user has their own rate limit quota
- Unauthenticated requests are limited by IP
- Users cannot bypass limits by switching IPs

## Error Response

When rate limit is exceeded, the API returns:

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 450
}
```

- **Status Code**: `429 Too Many Requests`
- **retryAfter**: Time in seconds until the rate limit resets

## Implementation Details

### Location
- **Configuration**: `backend/middleware/rateLimit.ts`
- **Application**: `backend/index.ts`

### Storage
- **Current**: In-memory store (single instance)
- **Future**: Can be upgraded to Redis for distributed systems

### Customization

To adjust rate limits, modify `backend/middleware/rateLimit.ts`:

```typescript
export const rateLimitConfig = {
  general: {
    max: 100, // Change this value
    timeWindow: 15 * 60 * 1000, // Change time window (in milliseconds)
  },
  // ... other configs
};
```

## Best Practices

1. **Client-side**: Implement exponential backoff when receiving 429 errors
2. **Monitoring**: Monitor rate limit hits to identify abuse patterns
3. **Adjustment**: Adjust limits based on actual usage patterns
4. **Documentation**: Inform users about rate limits in API documentation

## Testing Rate Limits

### Test with curl:

```bash
# Make 101 requests quickly to trigger rate limit
for i in {1..101}; do
  curl -H "Authorization: Bearer YOUR_TOKEN" https://your-api.com/api/clients
done
```

### Expected Behavior:
- First 100 requests: `200 OK`
- 101st request: `429 Too Many Requests` with retryAfter header

## Notes

- Rate limits reset after the time window expires
- Limits are applied per user/IP combination
- File uploads have stricter limits to prevent storage abuse
- Sensitive operations have the strictest limits for security

