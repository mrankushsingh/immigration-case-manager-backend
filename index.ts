import express from 'express';
import cors from 'cors';
import caseTemplatesRoutes from './routes/caseTemplates.js';
import clientsRoutes from './routes/clients.js';
import usersRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import remindersRoutes from './routes/reminders.js';
import { db } from './utils/database.js';
import { isUsingBucketStorage, getFileUrl } from './utils/storage.js';
import { initializeFirebaseAdmin } from './utils/firebase.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Configure CORS
// In production, set CORS_ORIGIN to your frontend URL (e.g., https://your-frontend-domain.com)
// For development, you can use '*' or specific localhost URLs
const corsOptions = {
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

// Serve uploaded files
// For Railway bucket, files are served via signed URLs or proxy
// For local storage, use express.static
if (!isUsingBucketStorage()) {
  const uploadsDir = db.getUploadsDir();
  app.use('/uploads', express.static(uploadsDir));
} else {
  // Proxy files from Railway bucket (serve through our domain instead of redirecting)
  app.get('/uploads/:filename', async (req, res) => {
    try {
      const fileUrl = `/uploads/${req.params.filename}`;
      const signedUrl = await getFileUrl(fileUrl, 3600); // 1 hour expiry
      
      if (signedUrl && signedUrl.startsWith('http')) {
        // Fetch file from bucket and proxy it through our domain
        const response = await fetch(signedUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
          res.send(Buffer.from(buffer));
        } else {
          res.status(404).json({ error: 'File not found' });
        }
      } else {
        // Fallback: try to fetch and proxy the file
        const response = await fetch(signedUrl || fileUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
          res.send(Buffer.from(buffer));
        } else {
          res.status(404).json({ error: 'File not found' });
        }
      }
    } catch (error: any) {
      console.error('Error serving file:', error);
      res.status(500).json({ error: 'Failed to serve file' });
    }
  });
}

// API Routes
app.get('/health', async (req, res) => {
  try {
    const dbStatus = {
      type: process.env.DATABASE_URL ? 'PostgreSQL' : 'File-based',
      connected: false,
    };

    if (process.env.DATABASE_URL) {
      try {
        await db.getTemplates(); // Test database connection
        dbStatus.connected = true;
      } catch (error) {
        dbStatus.connected = false;
      }
    } else {
      dbStatus.connected = true; // File-based always works
    }

    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: dbStatus
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API routes (authentication removed - publicly accessible)
app.use('/api/case-templates', caseTemplatesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reminders', remindersRoutes);

// 404 handler for undefined API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend API server running on http://localhost:${PORT}`);
  console.log(`🌐 Server accessible on all network interfaces`);
  console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
  
  if (process.env.DATABASE_URL) {
    console.log(`💾 Database: PostgreSQL (Railway)`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL.substring(0, 20)}...`);
    try {
      // Test database connection
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
});

