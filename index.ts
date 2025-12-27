import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import caseTemplatesRoutes from './routes/caseTemplates.js';
import clientsRoutes from './routes/clients.js';
import usersRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import remindersRoutes from './routes/reminders.js';
import { db } from './utils/database.js';
import { isUsingBucketStorage, getFileUrl, fileExists } from './utils/storage.js';
import { initializeFirebaseAdmin } from './utils/firebase.js';
import { authenticateToken } from './middleware/auth.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

const PORT = Number(process.env.PORT) || 4000;

// Configure CORS
const corsOrigin = process.env.CORS_ORIGIN;
let corsOriginValue: string | string[] | boolean | undefined;

if (corsOrigin) {
  const origins = corsOrigin.split(',').map(origin => origin.trim().replace(/\/+$/, ''));
  corsOriginValue = origins.length === 1 ? origins[0] : origins;
} else {
  corsOriginValue = process.env.NODE_ENV === 'production' ? false : '*';
}

await fastify.register(cors, {
  origin: corsOriginValue,
  credentials: true,
});

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

// Serve uploaded files
const usingBucket = isUsingBucketStorage();

if (!usingBucket) {
  const uploadsDir = db.getUploadsDir();
  await fastify.register(staticFiles, {
    root: uploadsDir,
    prefix: '/uploads/',
  });
} else {
  // Proxy files from Railway bucket
  fastify.get('/uploads/*', async (request, reply) => {
    const pathMatch = request.url.match(/^\/uploads\/(.+)$/);
    if (!pathMatch) {
      return reply.status(400).send({ error: 'Invalid file path' });
    }
    
    let filename: string;
    try {
      filename = decodeURIComponent(pathMatch[1]);
    } catch (e) {
      filename = pathMatch[1];
    }
    
    try {
      let fileUrl = `/uploads/${filename}`;
      
      const exists = await fileExists(fileUrl);
      
      if (!exists) {
        fastify.log.error(`❌ File does not exist: ${filename}`);
        return reply.status(404).send({ 
          error: 'File not found',
          filename: filename,
          requestedUrl: fileUrl,
          message: 'The requested file does not exist in storage'
        });
      }
      
      const signedUrl = await getFileUrl(fileUrl, 3600);
      
      if (!signedUrl) {
        fastify.log.error(`❌ Failed to generate signed URL for: ${filename}`);
        return reply.status(500).send({ 
          error: 'Failed to generate file access URL',
          filename: filename,
          message: 'Could not create access URL for the file'
        });
      }
      
      if (signedUrl.startsWith('http')) {
        const response = await fetch(signedUrl);
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
          
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Access-Control-Allow-Methods', 'GET');
          reply.type(contentType);
          reply.header('Content-Disposition', `inline; filename="${filename}"`);
          
          return reply.send(Buffer.from(buffer));
        } else {
          fastify.log.error(`❌ Failed to fetch file from bucket: ${response.status} ${response.statusText}`);
          return reply.status(404).send({ error: 'File not found in bucket' });
        }
      } else {
        const response = await fetch(signedUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
          
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Access-Control-Allow-Methods', 'GET');
          reply.type(contentType);
          
          return reply.send(Buffer.from(buffer));
        } else {
          fastify.log.error(`❌ Fallback fetch failed: ${response.status} ${response.statusText}`);
          return reply.status(404).send({ error: 'File not found' });
        }
      }
    } catch (error: any) {
      fastify.log.error(`❌ Error serving file ${filename}: ${error.message}`);
      return reply.status(500).send({ 
        error: 'Failed to serve file',
        details: error.message 
      });
    }
  });
}

// Public routes (no authentication required)
fastify.get('/health', async (request, reply) => {
  try {
    const dbStatus = {
      type: process.env.DATABASE_URL ? 'PostgreSQL' : 'File-based',
      connected: false,
    };

    if (process.env.DATABASE_URL) {
      try {
        await db.getTemplates();
        dbStatus.connected = true;
      } catch (error) {
        dbStatus.connected = false;
      }
    } else {
      dbStatus.connected = true;
    }

    return reply.send({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: dbStatus
    });
  } catch (error) {
    return reply.status(500).send({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// Apply authentication middleware to all API routes
fastify.log.info('🔒 Securing all API routes with authentication middleware');

// Register authenticated routes
await fastify.register(async (fastify) => {
  // Apply authentication to all routes in this context
  fastify.addHook('onRequest', authenticateToken);
  
  // Register route plugins
  await fastify.register(caseTemplatesRoutes, { prefix: '/case-templates' });
  await fastify.register(clientsRoutes, { prefix: '/clients' });
  await fastify.register(usersRoutes, { prefix: '/users' });
  await fastify.register(settingsRoutes, { prefix: '/settings' });
  await fastify.register(remindersRoutes, { prefix: '/reminders' });
  
  // Protected API endpoint: Check if a file exists
  fastify.get('/files/check', async (request, reply) => {
    try {
      const fileUrl = (request.query as any).url as string;
      if (!fileUrl) {
        return reply.status(400).send({ error: 'File URL is required' });
      }

      const exists = await fileExists(fileUrl);
      
      return reply.send({ 
        exists,
        url: fileUrl 
      });
    } catch (error: any) {
      fastify.log.error('Error checking file existence:', error);
      return reply.status(500).send({ error: 'Failed to check file existence' });
    }
  });
}, { prefix: '/api' });

// 404 handler for undefined API routes
fastify.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'API endpoint not found' });
  }
  return reply.status(404).send({ error: 'Not found' });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    
    console.log(`🚀 Backend API server running on http://localhost:${PORT}`);
    console.log(`🌐 Server accessible on all network interfaces`);
    console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
    
    if (process.env.DATABASE_URL) {
      console.log(`💾 Database: PostgreSQL (Railway)`);
      console.log(`   DATABASE_URL: ${process.env.DATABASE_URL.substring(0, 20)}...`);
      try {
        await db.getTemplates();
        console.log(`✅ Database connection verified`);
      } catch (error: any) {
        console.error(`❌ Database connection failed: ${error.message}`);
        console.log(`⚠️  Using file-based storage as fallback`);
      }
    } else {
      console.log(`💾 Storage: File-based (Local)`);
      console.log(`   No DATABASE_URL found - using local file storage`);
    }
    
    if (isUsingBucketStorage()) {
      console.log(`📁 File Storage: Railway Bucket`);
      console.log(`   Bucket: ${process.env.RAILWAY_BUCKET_NAME || 'Not configured'}`);
      console.log(`   Endpoint: ${process.env.RAILWAY_BUCKET_ENDPOINT || 'Not configured'}`);
      console.log(`   Region: ${process.env.RAILWAY_BUCKET_REGION || 'auto'}`);
    } else {
      const uploadsDir = db.getUploadsDir();
      console.log(`📁 Uploads directory: ${uploadsDir}`);
    }
    
    console.log(`\n🔍 Check /health endpoint for database status`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
