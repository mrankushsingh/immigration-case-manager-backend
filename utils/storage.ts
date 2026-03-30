import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if Railway bucket is configured
const isRailwayBucketConfigured = () => {
  const hasEndpoint = !!process.env.RAILWAY_BUCKET_ENDPOINT;
  const hasBucketName = !!process.env.RAILWAY_BUCKET_NAME;
  const hasAccessKey = !!process.env.RAILWAY_BUCKET_ACCESS_KEY;
  const hasSecretKey = !!process.env.RAILWAY_BUCKET_SECRET_KEY;
  
  if (hasEndpoint || hasBucketName || hasAccessKey || hasSecretKey) {
    // Log which variables are missing
    if (!hasEndpoint) console.warn('⚠️  RAILWAY_BUCKET_ENDPOINT is not set');
    if (!hasBucketName) console.warn('⚠️  RAILWAY_BUCKET_NAME is not set');
    if (!hasAccessKey) console.warn('⚠️  RAILWAY_BUCKET_ACCESS_KEY is not set');
    if (!hasSecretKey) console.warn('⚠️  RAILWAY_BUCKET_SECRET_KEY is not set');
  }
  
  return hasEndpoint && hasBucketName && hasAccessKey && hasSecretKey;
};

// Initialize S3 client if Railway bucket is configured
let s3Client: S3Client | null = null;
if (isRailwayBucketConfigured()) {
  try {
    const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT!;
    const bucketName = process.env.RAILWAY_BUCKET_NAME!;
    const region = process.env.RAILWAY_BUCKET_REGION || 'auto';
    const accessKey = process.env.RAILWAY_BUCKET_ACCESS_KEY!;
    const secretKey = process.env.RAILWAY_BUCKET_SECRET_KEY!;
    
    // Validate that values are not placeholder text
    if (accessKey.includes('YOUR_ACCESS_KEY_ID_HERE') || secretKey.includes('YOUR_SECRET_ACCESS_KEY_HERE')) {
      console.error('❌ Railway bucket credentials appear to be placeholders. Please set actual values.');
      s3Client = null;
    } else {
      s3Client = new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
        },
        forcePathStyle: true, // Required for S3-compatible services
      });
      console.log(`✅ Railway bucket client initialized`);
    }
  } catch (error: any) {
    console.error('❌ Failed to initialize Railway bucket client:', error.message);
    s3Client = null;
  }
}

/**
 * Upload a file to storage (Railway bucket or local filesystem)
 */
export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  if (s3Client && isRailwayBucketConfigured()) {
    // Upload to Railway bucket
    const bucketName = process.env.RAILWAY_BUCKET_NAME!;
    const key = `uploads/${fileName}`;

    try {
      // Try without ACL first (some S3-compatible services don't support ACL)
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      });

      await s3Client.send(command);
      
      // Construct the file URL
      // Railway bucket might provide different URL formats, so we normalize to relative path
      // The file will be served through our /uploads route which generates signed URLs
      const fileUrl = `/uploads/${fileName}`;
      return fileUrl;
    } catch (error: any) {
      console.error('❌ Error uploading to Railway bucket:', {
        bucket: bucketName,
        key: key,
        errorCode: error.Code || error.name,
        errorMessage: error.message,
        httpStatusCode: error.$metadata?.httpStatusCode,
      });
      
      // If bucket doesn't exist, fall back to local storage
      if (error.message.includes('does not exist') || error.name === 'NoSuchBucket' || error.Code === 'NoSuchBucket') {
        console.warn('⚠️  Bucket does not exist, falling back to local filesystem storage');
        // Fall through to local storage below - don't throw error
      } else if (error.Code === 'AccessDenied' || error.name === 'AccessDenied') {
        const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT || 'Not set';
        const accessKeyPreview = process.env.RAILWAY_BUCKET_ACCESS_KEY 
          ? `${process.env.RAILWAY_BUCKET_ACCESS_KEY.substring(0, 8)}...` 
          : 'Not set';
        
        throw new Error(`Access denied to Railway bucket. Configuration:
- RAILWAY_BUCKET_NAME: ${bucketName}
- RAILWAY_BUCKET_ENDPOINT: ${endpoint}
- RAILWAY_BUCKET_ACCESS_KEY: ${accessKeyPreview}

Please verify:
1. All environment variables are set correctly in Railway
2. The bucket name matches exactly (case-sensitive)
3. The access key and secret key are valid and not expired
4. The bucket has proper read/write permissions
5. The endpoint URL is correct for your Railway region`);
      } else {
        // For other errors, also fall back to local storage
        console.warn(`⚠️  Bucket upload failed (${error.message}), falling back to local filesystem storage`);
        // Fall through to local storage below
      }
    }
  }
  
  // Use local filesystem storage (either no bucket configured or bucket error occurred)
  {
    // Fallback to local filesystem
    const uploadsDir = db.getUploadsDir();
    const filePath = join(uploadsDir, fileName);

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write file to local filesystem
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, fileBuffer);

    return `/uploads/${fileName}`;
  }
}

/**
 * Delete a file from storage (Railway bucket or local filesystem)
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) {
    return; // Invalid file URL
  }

  const fileName = fileUrl.replace('/uploads/', '');

  if (s3Client && isRailwayBucketConfigured()) {
    // Delete from Railway bucket
    const bucketName = process.env.RAILWAY_BUCKET_NAME!;
    const key = `uploads/${fileName}`;

    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await s3Client.send(command);
    } catch (error: any) {
      console.error('❌ Error deleting from Railway bucket:', {
        bucket: bucketName,
        key: key,
        errorCode: error.Code || error.name,
        errorMessage: error.message,
      });
      // Don't throw - file might not exist
    }
  } else {
    // Delete from local filesystem
    const uploadsDir = db.getUploadsDir();
    const filePath = join(uploadsDir, fileName);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error: any) {
      console.error('❌ Error deleting local file:', error);
      // Don't throw - file might not exist
    }
  }
}

/**
 * Get a signed URL for a file in Railway bucket (for direct access)
 * Returns null if using local storage or if file doesn't exist
 */
export async function getFileUrl(fileUrl: string, expiresIn: number = 3600): Promise<string | null> {
  if (!fileUrl) {
    console.warn(`⚠️  Empty file URL provided`);
    return null;
  }

  // Handle different URL formats from Railway bucket
  let fileName: string;
  let bucketKey: string;
  
  // Check if it's a full URL (from Railway bucket)
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    // Extract filename from full URL
    // Format might be: https://bucket-endpoint.railway.app/uploads/filename.pdf
    // or: https://bucket-endpoint.railway.app/bucket-name/uploads/filename.pdf
    const urlParts = fileUrl.split('/');
    fileName = urlParts[urlParts.length - 1];
    
    // Try to find the uploads directory in the path
    const uploadsIndex = urlParts.findIndex(part => part === 'uploads');
    if (uploadsIndex !== -1) {
      bucketKey = urlParts.slice(uploadsIndex).join('/');
    } else {
      // If no uploads in path, assume it's just the filename
      bucketKey = `uploads/${fileName}`;
    }
    
  } else if (fileUrl.startsWith('/uploads/')) {
    // Relative path format: /uploads/filename.pdf
    fileName = fileUrl.replace('/uploads/', '');
    bucketKey = `uploads/${fileName}`;
  } else {
    // Assume it's just a filename or different format
    fileName = fileUrl.split('/').pop() || fileUrl;
    bucketKey = fileUrl.startsWith('uploads/') ? fileUrl : `uploads/${fileName}`;
  }

  if (!s3Client || !isRailwayBucketConfigured()) {
    // For local storage, return the relative URL (served by express.static)
    return fileUrl.startsWith('/') ? fileUrl : `/uploads/${fileName}`;
  }

  const bucketName = process.env.RAILWAY_BUCKET_NAME!;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: bucketKey,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error: any) {
    console.error(`❌ Error generating signed URL for ${fileName}:`, {
      errorCode: error.Code || error.name,
      errorMessage: error.message,
      key: bucketKey,
      bucket: bucketName,
      originalUrl: fileUrl,
    });
    return null;
  }
}

/**
 * Check if a file exists in storage (bucket or local filesystem)
 */
export async function fileExists(fileUrl: string): Promise<boolean> {
  if (!fileUrl) {
    return false;
  }

  // Normalize URL to get bucket key
  let bucketKey: string;
  let fileName: string;
  
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    // Full URL format
    const urlParts = fileUrl.split('/');
    fileName = urlParts[urlParts.length - 1];
    const uploadsIndex = urlParts.findIndex(part => part === 'uploads');
    if (uploadsIndex !== -1) {
      bucketKey = urlParts.slice(uploadsIndex).join('/');
    } else {
      bucketKey = `uploads/${fileName}`;
    }
  } else if (fileUrl.startsWith('/uploads/')) {
    fileName = fileUrl.replace('/uploads/', '');
    bucketKey = `uploads/${fileName}`;
  } else {
    fileName = fileUrl.split('/').pop() || fileUrl;
    bucketKey = fileUrl.startsWith('uploads/') ? fileUrl : `uploads/${fileName}`;
  }

  if (!s3Client || !isRailwayBucketConfigured()) {
    // Check local filesystem
    const uploadsDir = db.getUploadsDir();
    const filePath = join(uploadsDir, fileName);
    return existsSync(filePath);
  }

  // Check Railway bucket
  const bucketName = process.env.RAILWAY_BUCKET_NAME!;

  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: bucketKey,
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.Code === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    console.error(`Error checking file existence for ${fileName}:`, error);
    return false;
  }
}

/**
 * Check if Railway bucket storage is being used
 */
export function isUsingBucketStorage(): boolean {
  return isRailwayBucketConfigured() && s3Client !== null;
}

