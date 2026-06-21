import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, resolve, sep, extname } from 'path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fileExists, getFileUrl } from './storage.js';
import { getSafeErrorMessage } from './errors.js';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function resolveUploadFilename(rawPath: string): string | null {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }

  const name = basename(decoded.replace(/\\/g, '/'));
  if (!name || name === '.' || name === '..' || name.includes('..')) {
    return null;
  }
  return name;
}

export function resolveUploadFilePath(uploadsDir: string, filename: string): string | null {
  const normalizedRoot = resolve(uploadsDir);
  const resolved = resolve(normalizedRoot, filename);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    return null;
  }
  return resolved;
}

function contentTypeForFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function serveFromBucket(filename: string, reply: FastifyReply) {
  const fileUrl = `/uploads/${filename}`;
  const exists = await fileExists(fileUrl);
  if (!exists) {
    return reply.status(404).send({ error: 'File not found' });
  }

  const signedUrl = await getFileUrl(fileUrl, 3600);
  if (!signedUrl) {
    return reply.status(500).send({ error: 'Failed to generate file access URL' });
  }

  const response = await fetch(signedUrl);
  if (!response.ok) {
    return reply.status(404).send({ error: 'File not found in storage' });
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || contentTypeForFilename(filename);
  reply.type(contentType);
  reply.header('Content-Disposition', `inline; filename="${basename(filename)}"`);
  return reply.send(Buffer.from(buffer));
}

async function serveFromLocal(filename: string, uploadsDir: string, reply: FastifyReply) {
  const filePath = resolveUploadFilePath(uploadsDir, filename);
  if (!filePath || !existsSync(filePath)) {
    return reply.status(404).send({ error: 'File not found' });
  }

  const buffer = await readFile(filePath);
  reply.type(contentTypeForFilename(filename));
  reply.header('Content-Disposition', `inline; filename="${basename(filename)}"`);
  return reply.send(buffer);
}

export async function handleAuthenticatedUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { uploadsDir: string; usingBucket: boolean }
) {
  const pathMatch = request.url.match(/^\/uploads\/(.+?)(?:\?.*)?$/);
  if (!pathMatch) {
    return reply.status(400).send({ error: 'Invalid file path' });
  }

  const filename = resolveUploadFilename(pathMatch[1]);
  if (!filename) {
    return reply.status(400).send({ error: 'Invalid file path' });
  }

  try {
    if (options.usingBucket) {
      return await serveFromBucket(filename, reply);
    }
    return await serveFromLocal(filename, options.uploadsDir, reply);
  } catch (error: any) {
    return reply.status(500).send({
      error: getSafeErrorMessage(error, 'Failed to serve file'),
    });
  }
}
