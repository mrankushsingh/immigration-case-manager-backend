import { extname } from 'path';
import {
  classifyDocument,
  MIN_CONFIDENCE,
  type ClassifyDocumentOptions,
  type RequiredDocRef,
} from './documentClassifier.js';
import type { ClassificationResult } from './documentClassifier.js';
import {
  applyFileToRequiredDocAtIndex,
  resolveRequiredDocTargetIndex,
} from './resolveRequiredDoc.js';
import { deleteFile, isUsingBucketStorage, uploadFile } from './storage.js';
import { db } from './database.js';

export const MAX_SMART_UPLOAD_FILES = 20;

export type SmartUploadFilePayload = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
};

export type SmartUploadFileResult = {
  fileName: string;
  success: boolean;
  error?: string;
  classification?: ClassificationResult & { routedTo: 'required' | 'all_documents' };
};

export async function runSmartUploadBatch(
  clientId: string,
  files: SmartUploadFilePayload[],
  userName: string,
  saveFileLocally: (buffer: Buffer, originalName: string) => string
): Promise<{ client: NonNullable<Awaited<ReturnType<typeof db.getClient>>>; results: SmartUploadFileResult[] }> {
  let client = await db.getClient(clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  const allTemplates = await db.getTemplates();
  const results: SmartUploadFileResult[] = [];

  for (const fileData of files) {
    try {
      const outcome = await runSmartUploadOne(
        clientId,
        client,
        fileData,
        userName,
        allTemplates,
        saveFileLocally
      );
      client = outcome.client;
      results.push({
        fileName: fileData.filename,
        success: true,
        classification: outcome.classification,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      results.push({
        fileName: fileData.filename,
        success: false,
        error: message,
      });
    }
  }

  return { client, results };
}

async function runSmartUploadOne(
  clientId: string,
  client: NonNullable<Awaited<ReturnType<typeof db.getClient>>>,
  fileData: SmartUploadFilePayload,
  userName: string,
  allTemplates: ClassifyDocumentOptions['allTemplates'],
  saveFileLocally: (buffer: Buffer, originalName: string) => string
): Promise<{
  client: NonNullable<Awaited<ReturnType<typeof db.getClient>>>;
  classification: ClassificationResult & { routedTo: 'required' | 'all_documents' };
}> {
  const requiredDocs = (client.required_documents || []) as RequiredDocRef[];

  const classification = await classifyDocument(
    fileData.filename,
    fileData.mimetype,
    fileData.buffer,
    requiredDocs,
    { allTemplates: allTemplates || [] }
  );

  const fileUrl = await storeUploadedFile(fileData, saveFileLocally);

  let routedTo: 'required' | 'all_documents' = 'all_documents';
  let updated = client;

  if (classification.documentCode && classification.confidence >= MIN_CONFIDENCE) {
    const targetIdx = resolveRequiredDocTargetIndex(
      requiredDocs,
      classification,
      fileData.filename
    );

    if (targetIdx < 0) {
      throw new Error('Could not determine which required document slot to use');
    }

    const targetDoc = requiredDocs[targetIdx];
    const existing = (client.required_documents || [])[targetIdx] as { fileUrl?: string };
    if (existing?.fileUrl?.startsWith('/uploads/')) {
      deleteFile(existing.fileUrl).catch((err) => {
        console.error('Error deleting old file:', err);
      });
    }

    const updatedDocuments = applyFileToRequiredDocAtIndex(
      client.required_documents || [],
      targetIdx,
      {
        fileUrl,
        fileName: fileData.filename,
        fileSize: fileData.size,
        uploadedBy: userName,
      }
    );

    classification.documentCode = targetDoc.code;
    classification.documentName = targetDoc.name;

    const requiredUpdated = await db.updateClient(clientId, {
      required_documents: updatedDocuments,
    });
    if (!requiredUpdated) {
      throw new Error('Failed to update client');
    }
    updated = requiredUpdated;
    routedTo = 'required';
  } else {
    const reminderDays = 10;
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + reminderDays);
    const newDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: fileData.filename,
      allDocumentsSection: true,
      fileUrl,
      fileName: fileData.filename,
      fileSize: fileData.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: userName,
      reminder_days: reminderDays,
      reminder_date: reminderDate.toISOString(),
      created_at: new Date().toISOString(),
    };
    const additionalUpdated = await db.updateClient(clientId, {
      additional_documents: [...(client.additional_documents || []), newDocument],
    });
    if (!additionalUpdated) {
      throw new Error('Failed to update client');
    }
    updated = additionalUpdated;
  }

  return {
    client: updated,
    classification: { ...classification, routedTo },
  };
}

async function storeUploadedFile(
  fileData: SmartUploadFilePayload,
  saveFileLocally: (buffer: Buffer, originalName: string) => string
): Promise<string> {
  if (isUsingBucketStorage()) {
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
    const ext = extname(fileData.filename);
    const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
    const storedName = `${name}_${uniqueSuffix}${ext}`;
    return uploadFile(fileData.buffer, storedName, fileData.mimetype);
  }
  return saveFileLocally(fileData.buffer, fileData.filename);
}
