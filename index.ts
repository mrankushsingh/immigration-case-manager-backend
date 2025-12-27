import express from 'express';
import cors from 'cors';
import caseTemplatesRoutes from './routes/caseTemplates.js';
import clientsRoutes from './routes/clients.js';
import usersRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import remindersRoutes from './routes/reminders.js';
import { db } from './utils/database.js';
import { isUsingBucketStorage, getFileUrl, fileExists } from './utils/storage.js';
import { initializeFirebaseAdmin } from './utils/firebase.js';
import { authenticateToken } from './middleware/auth.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Configure CORS
// In production, set CORS_ORIGIN to your frontend URL (e.g., https://your-frontend-domain.com)
// For development, you can use '*' or specific localhost URLs
const corsOrigin = process.env.CORS_ORIGIN;
let corsOriginValue: string | string[] | boolean | undefined;

if (corsOrigin) {
  // Remove trailing slashes and handle multiple origins
  const origins = corsOrigin.split(',').map(origin => origin.trim().replace(/\/+$/, ''));
  corsOriginValue = origins.length === 1 ? origins[0] : origins;
} else {
  corsOriginValue = process.env.NODE_ENV === 'production' ? false : '*';
}

const corsOptions = {
  origin: corsOriginValue,
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
const usingBucket = isUsingBucketStorage();
console.log(`📁 File storage mode: ${usingBucket ? 'Railway Bucket' : 'Local Filesystem'}`);

if (!usingBucket) {
  const uploadsDir = db.getUploadsDir();
  console.log(`📁 Local storage directory: ${uploadsDir}`);
  app.use('/uploads', express.static(uploadsDir));
} else {
  console.log(`📁 Using Railway bucket storage for file serving`);
  // Proxy files from Railway bucket (serve through our domain instead of redirecting)
  // Use wildcard route to capture full filename including special characters
  app.get('/uploads/*', async (req, res) => {
    // Extract filename from wildcard route (everything after /uploads/)
    const pathMatch = req.path.match(/^\/uploads\/(.+)$/);
    if (!pathMatch) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Handle URL-encoded filenames and special characters
    let filename: string;
    try {
      filename = decodeURIComponent(pathMatch[1]);
    } catch (e) {
      filename = pathMatch[1]; // Fallback if decoding fails
    }
    
    console.log(`📁 Serving file from bucket: ${filename}`);
    console.log(`   Request path: ${req.path}`);
    console.log(`   Extracted filename: ${filename}`);
    
    try {
      // Try relative path first (standard format)
      let fileUrl = `/uploads/${filename}`;
      
      // First, check if file exists
      const { fileExists } = await import('./utils/storage.js');
      console.log(`🔍 Checking if file exists: ${fileUrl}`);
      const exists = await fileExists(fileUrl);
      
      if (!exists) {
        console.error(`❌ File does not exist: ${filename}`);
        console.error(`   Checked URL: ${fileUrl}`);
        console.error(`   Bucket key would be: uploads/${filename}`);
        return res.status(404).json({ 
          error: 'File not found',
          filename: filename,
          requestedUrl: fileUrl,
          message: 'The requested file does not exist in storage'
        });
      }
      
      console.log(`✅ File exists, generating signed URL...`);
      
      // If the stored URL in database is a full URL, we need to handle it
      // But for serving, we'll use the relative path format
      const signedUrl = await getFileUrl(fileUrl, 3600); // 1 hour expiry
      
      if (!signedUrl) {
        console.error(`❌ Failed to generate signed URL for: ${filename}`);
        return res.status(500).json({ 
          error: 'Failed to generate file access URL',
          filename: filename,
          message: 'Could not create access URL for the file'
        });
      }
      
      if (signedUrl.startsWith('http')) {
        // Fetch file from bucket and proxy it through our domain
        console.log(`📥 Fetching file from bucket: ${signedUrl.substring(0, 50)}...`);
        const response = await fetch(signedUrl);
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
          
          // Set CORS headers
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET');
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
          res.setHeader('Content-Length', buffer.byteLength);
          
          console.log(`✅ Successfully serving file: ${filename} (${(buffer.byteLength / 1024).toFixed(2)} KB)`);
          res.send(Buffer.from(buffer));
        } else {
          console.error(`❌ Failed to fetch file from bucket: ${response.status} ${response.statusText}`);
          res.status(404).json({ error: 'File not found in bucket' });
        }
      } else {
        // Fallback: try to fetch and proxy the file
        console.log(`📥 Fallback: fetching file with relative URL: ${signedUrl}`);
        const response = await fetch(signedUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
          
          // Set CORS headers
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET');
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', buffer.byteLength);
          
          res.send(Buffer.from(buffer));
        } else {
          console.error(`❌ Fallback fetch failed: ${response.status} ${response.statusText}`);
          res.status(404).json({ error: 'File not found' });
        }
      }
    } catch (error: any) {
      console.error(`❌ Error serving file ${filename}:`, {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      res.status(500).json({ 
        error: 'Failed to serve file',
        details: error.message 
      });
    }
  });
}

// Public routes (no authentication required)
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

// Apply authentication middleware to all API routes
// Public routes (health, file serving) are defined before this
console.log('🔒 Securing all API routes with authentication middleware');

// All API routes require authentication
app.use('/api', authenticateToken);

// API routes (all require authentication)
app.use('/api/case-templates', caseTemplatesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reminders', remindersRoutes);

// Protected API endpoint: Check if a file exists (requires authentication)
app.get('/api/files/check', async (req, res) => {
  try {
    const fileUrl = req.query.url as string;
    if (!fileUrl) {
      return res.status(400).json({ error: 'File URL is required' });
    }

    const exists = await fileExists(fileUrl);
    
    res.json({ 
      exists,
      url: fileUrl 
    });
  } catch (error: any) {
    console.error('Error checking file existence:', error);
    res.status(500).json({ error: 'Failed to check file existence' });
  }
});

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

