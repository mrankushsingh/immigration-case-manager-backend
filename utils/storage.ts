import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
      console.log(`   Endpoint: ${endpoint}`);
      console.log(`   Bucket: ${bucketName}`);
      console.log(`   Region: ${region}`);
      console.log(`   Access Key: ${accessKey.substring(0, 8)}...${accessKey.substring(accessKey.length - 4)}`);
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
      
      // Return the file URL path (will be served through /uploads route)
      return `/uploads/${fileName}`;
    } catch (error: any) {
      console.error('❌ Error uploading to Railway bucket:', {
        bucket: bucketName,
        key: key,
        errorCode: error.Code || error.name,
        errorMessage: error.message,
        httpStatusCode: error.$metadata?.httpStatusCode,
      });
      
      // Provide more helpful error message
      if (error.Code === 'AccessDenied' || error.name === 'AccessDenied') {
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
      }
      
      throw new Error(`Failed to upload file to bucket: ${error.message}`);
    }
  } else {
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
      console.log(`✅ File deleted from Railway bucket: ${key}`);
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
        console.log(`✅ File deleted from local storage: ${fileName}`);
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
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) {
    return null;
  }

  if (!s3Client || !isRailwayBucketConfigured()) {
    // For local storage, return the relative URL (served by express.static)
    return fileUrl;
  }

  const fileName = fileUrl.replace('/uploads/', '');
  const bucketName = process.env.RAILWAY_BUCKET_NAME!;
  const key = `uploads/${fileName}`;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error: any) {
    console.error('Error generating signed URL:', error);
    return null;
  }
}

/**
 * Check if Railway bucket storage is being used
 */
export function isUsingBucketStorage(): boolean {
  return isRailwayBucketConfigured() && s3Client !== null;
}

