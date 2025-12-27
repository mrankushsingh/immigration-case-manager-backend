import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { extname } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { db } from '../utils/database.js';
import { uploadFile, deleteFile, isUsingBucketStorage } from '../utils/storage.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const memoryDb = db;

// Allowed file types for uploads
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// Helper function to get user name from request
async function getUserName(request: AuthenticatedRequest): Promise<string> {
  try {
    if (request.user?.uid) {
      const user = await memoryDb.getUserByFirebaseUid(request.user.uid);
      return user?.name || user?.email || request.user.email || request.user.name || 'Unknown User';
    }
  } catch (error) {
    console.error('Error getting user name:', error);
  }
  return 'Unknown User';
}

// Helper function to process multipart file
async function processFile(
  request: FastifyRequest,
  fieldName: string = 'file'
): Promise<{ buffer: Buffer; filename: string; mimetype: string; size: number } | null> {
  try {
    if (!request.isMultipart()) {
      return null;
    }

    const data = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit
    
    if (!data) {
      return null;
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      throw new Error(`File type ${data.mimetype} is not allowed. Allowed types: PDF, images, Word, Excel`);
    }

    const buffer = await data.toBuffer();
    
    return {
      buffer,
      filename: data.filename || 'unknown',
      mimetype: data.mimetype,
      size: buffer.length,
    };
  } catch (error: any) {
    if (error.message && error.message.includes('File type')) {
      throw error;
    }
    if (error.message && error.message.includes('file size')) {
      throw new Error('File size exceeds 50MB limit');
    }
    return null;
  }
}

// Helper function to save file locally
function saveFileLocally(buffer: Buffer, originalName: string): string {
  const uploadsDir = memoryDb.getUploadsDir();
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
  const ext = extname(originalName);
  const name = originalName.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${name}_${uniqueSuffix}${ext}`;
  const filePath = `${uploadsDir}/${fileName}`;

  writeFileSync(filePath, buffer);
  return `/uploads/${fileName}`;
}

const clientsRoutes: FastifyPluginAsync = async (fastify) => {
  // Register multipart plugin
  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // Create client
  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const { firstName, lastName, parentName, email, phone, caseTemplateId, totalFee, details } = request.body as any;
      
      if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
        return reply.status(400).send({ error: 'First name is required and must be a non-empty string' });
      }
      
      if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
        return reply.status(400).send({ error: 'Last name is required and must be a non-empty string' });
      }
      
      if (email && typeof email === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return reply.status(400).send({ error: 'Invalid email format' });
        }
      }
      
      if (totalFee !== undefined && (isNaN(Number(totalFee)) || Number(totalFee) < 0)) {
        return reply.status(400).send({ error: 'Total fee must be a non-negative number' });
      }

      let requiredDocs: any[] = [];
      let caseType = '';
      let reminderInterval = 10;
      let adminSilenceDays = 60;

      if (caseTemplateId) {
        const template = await memoryDb.getTemplate(caseTemplateId);
        if (template) {
          caseType = template.name;
          reminderInterval = template.reminder_interval_days;
          adminSilenceDays = template.administrative_silence_days;
          if (Array.isArray(template.required_documents)) {
            requiredDocs = template.required_documents.map((doc: any) => ({
              code: doc.code,
              name: doc.name,
              description: doc.description || '',
              submitted: false,
              fileUrl: null,
              uploadedAt: null,
              isOptional: false,
            }));
          }
        }
      }

      const client = await memoryDb.insertClient({
        first_name: firstName,
        last_name: lastName,
        parent_name: parentName || null,
        email: email || null,
        phone: phone || null,
        case_template_id: caseTemplateId || null,
        case_type: caseType,
        details: details || null,
        required_documents: requiredDocs,
        reminder_interval_days: reminderInterval,
        administrative_silence_days: adminSilenceDays,
        payment: {
          totalFee: totalFee || 0,
          paidAmount: 0,
          payments: [],
        },
        submitted_to_immigration: false,
        notifications: [],
        additional_docs_required: false,
        notes: '',
        additional_documents: [],
        aportar_documentacion: [],
        requerimiento: [],
        resolucion: [],
        justificante_presentacion: [],
      });

      return reply.status(201).send(client);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create client' });
    }
  });

  // Get all clients
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const clients = await memoryDb.getClients();
      return reply.send(clients);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch clients' });
    }
  });

  // Get client by ID
  fastify.get('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const client = await memoryDb.getClient(id);
      if (!client) return reply.status(404).send({ error: 'Client not found' });
      return reply.send(client);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch client' });
    }
  });

  // Update client
  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      fastify.log.info(`Updating client ${id} - hasBody: ${!!request.body}, bodyKeys: ${request.body ? Object.keys(request.body as any).join(',') : 'none'}`);
      
      if (!request.body || typeof request.body !== 'object') {
        fastify.log.warn(`Invalid request body for client ${id}`);
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      
      const client = await memoryDb.updateClient(id, request.body as any);
      if (!client) {
        fastify.log.warn(`Client ${id} not found`);
        return reply.status(404).send({ error: 'Client not found' });
      }
      fastify.log.info(`Client ${id} updated successfully`);
      return reply.send(client);
    } catch (error: any) {
      const clientId = (request.params as { id?: string })?.id || 'unknown';
      fastify.log.error(`Error updating client ${clientId}: ${error.message || error} - ${error.stack || 'no stack'}`);
      return reply.status(500).send({ 
        error: error.message || 'Failed to update client',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Delete client
  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await memoryDb.deleteClient(id);
      if (!deleted) return reply.status(404).send({ error: 'Client not found' });
      return reply.send({ message: 'Client deleted successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete client' });
    }
  });

  // Upload required document
  fastify.post('/:id/documents/:documentCode', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, documentCode } = request.params as { id: string; documentCode: string };
      
      const fileData = await processFile(request);
      if (!fileData) {
        return reply.status(400).send({ error: 'No file uploaded or file upload failed' });
      }

      const userName = await getUserName(request);
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      let fileName: string;
      let fileUrl: string;
      
      if (isUsingBucketStorage()) {
        const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        const ext = extname(fileData.filename);
        const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
        fileName = `${name}_${uniqueSuffix}${ext}`;
        fileUrl = await uploadFile(fileData.buffer, fileName, fileData.mimetype);
      } else {
        fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
        fileName = fileUrl.replace('/uploads/', '');
      }

      const updatedDocuments = client.required_documents.map((doc: any) => {
        if (doc.code === documentCode) {
          if (doc.fileUrl && doc.fileUrl.startsWith('/uploads/')) {
            deleteFile(doc.fileUrl).catch(err => {
              console.error('Error deleting old file:', err);
            });
          }
          return {
            ...doc,
            submitted: true,
            fileUrl: fileUrl,
            uploadedAt: new Date().toISOString(),
            fileName: fileData.filename,
            fileSize: fileData.size,
            uploadedBy: userName,
          };
        }
        return doc;
      });

      const updated = await memoryDb.updateClient(id, {
        required_documents: updatedDocuments,
      });

      return reply.send(updated);
    } catch (error: any) {
      if (error.message && error.message.includes('File type')) {
        return reply.status(400).send({ error: error.message });
      }
      if (error.message && error.message.includes('File size')) {
        return reply.status(400).send({ error: 'File size exceeds 50MB limit' });
      }
      return reply.status(500).send({ error: error.message || 'Failed to upload document' });
    }
  });

  // Create or upload additional document
  fastify.post('/:id/additional-documents', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      let body: any = {};
      let fileData: { buffer: Buffer; filename: string; mimetype: string; size: number } | null = null;

      if (request.isMultipart()) {
        // Handle multipart form data
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const file = part as any;
            if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
              return reply.status(400).send({ error: `File type ${file.mimetype} is not allowed. Allowed types: PDF, images, Word, Excel` });
            }
            const buffer = await file.toBuffer();
            fileData = {
              buffer,
              filename: file.filename || 'unknown',
              mimetype: file.mimetype,
              size: buffer.length,
            };
          } else {
            const field = part as any;
            body[field.fieldname] = field.value;
          }
        }
      } else {
        body = request.body as any;
      }

      const { name, description, reminder_days } = body;
      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'Document name is required' });
      }

      const reminderDays = reminder_days ? parseInt(reminder_days) : 10;
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      if (fileData) {
        const userName = await getUserName(request);
        let fileName: string;
        let fileUrl: string;
        
        if (isUsingBucketStorage()) {
          const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
          const ext = extname(fileData.filename);
          const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
          fileName = `${name}_${uniqueSuffix}${ext}`;
          fileUrl = await uploadFile(fileData.buffer, fileName, fileData.mimetype);
        } else {
          fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
          fileName = fileUrl.replace('/uploads/', '');
        }

        const newDocument = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          description: description ? description.trim() : undefined,
          fileUrl: fileUrl,
          fileName: fileData.filename,
          fileSize: fileData.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userName,
          reminder_days: reminderDays,
          reminder_date: reminderDate.toISOString(),
          created_at: new Date().toISOString(),
        };

        const updatedAdditionalDocs = [...(client.additional_documents || []), newDocument];
        const updated = await memoryDb.updateClient(id, {
          additional_documents: updatedAdditionalDocs,
        });

        return reply.send(updated);
      } else {
        const newDocument = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          description: description ? description.trim() : undefined,
          reminder_days: reminderDays,
          reminder_date: reminderDate.toISOString(),
          created_at: new Date().toISOString(),
        };

        const updatedAdditionalDocs = [...(client.additional_documents || []), newDocument];
        const updated = await memoryDb.updateClient(id, {
          additional_documents: updatedAdditionalDocs,
        });

        return reply.send(updated);
      }
    } catch (error: any) {
      if (error.message && error.message.includes('File type')) {
        return reply.status(400).send({ error: error.message });
      }
      if (error.message && error.message.includes('File size')) {
        return reply.status(400).send({ error: 'File size exceeds 50MB limit' });
      }
      return reply.status(500).send({ error: error.message || 'Failed to create additional document' });
    }
  });

  // Update additional document
  fastify.put('/:id/additional-documents/:documentId', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, documentId } = request.params as { id: string; documentId: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const { name, description, reminder_days } = request.body as any;
      const documents = client.additional_documents || [];
      const docIndex = documents.findIndex((d: any) => d.id === documentId);
      
      if (docIndex === -1) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const reminderDays = reminder_days ? parseInt(reminder_days) : documents[docIndex].reminder_days || 10;
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      const updatedDoc = {
        ...documents[docIndex],
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description ? description.trim() : undefined }),
        reminder_days: reminderDays,
        reminder_date: reminderDate.toISOString(),
      };

      documents[docIndex] = updatedDoc;
      const updated = await memoryDb.updateClient(id, {
        additional_documents: documents,
      });

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update additional document' });
    }
  });

  // Upload file to existing additional document
  fastify.post('/:id/additional-documents/:documentId/file', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, documentId } = request.params as { id: string; documentId: string };
      
      const fileData = await processFile(request);
      if (!fileData) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const userName = await getUserName(request);
      const documents = client.additional_documents || [];
      const docIndex = documents.findIndex((d: any) => d.id === documentId);
      
      if (docIndex === -1) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      let fileName: string;
      let fileUrl: string;
      
      if (isUsingBucketStorage()) {
        const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        const ext = extname(fileData.filename);
        const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
        fileName = `${name}_${uniqueSuffix}${ext}`;
        fileUrl = await uploadFile(fileData.buffer, fileName, fileData.mimetype);
      } else {
        fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
        fileName = fileUrl.replace('/uploads/', '');
      }

      const updatedDoc = {
        ...documents[docIndex],
        fileUrl: fileUrl,
        fileName: fileData.filename,
        fileSize: fileData.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userName,
      };

      documents[docIndex] = updatedDoc;
      const updated = await memoryDb.updateClient(id, {
        additional_documents: documents,
      });

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to upload file' });
    }
  });

  // Remove required document
  fastify.delete('/:id/documents/:documentCode', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, documentCode } = request.params as { id: string; documentCode: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const updatedDocuments = client.required_documents.map((doc: any) => {
        if (doc.code === documentCode) {
          if (doc.fileUrl && doc.fileUrl.startsWith('/uploads/')) {
            deleteFile(doc.fileUrl).catch(err => {
              console.error('Error deleting file:', err);
            });
          }
          return {
            ...doc,
            submitted: false,
            fileUrl: null,
            uploadedAt: null,
            fileName: null,
            fileSize: null,
          };
        }
        return doc;
      });

      const updated = await memoryDb.updateClient(id, {
        required_documents: updatedDocuments,
      });

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to remove document' });
    }
  });

  // Remove additional document
  fastify.delete('/:id/additional-documents/:documentId', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, documentId } = request.params as { id: string; documentId: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const docToRemove = client.additional_documents?.find((doc: any) => doc.id === documentId);
      if (docToRemove && docToRemove.fileUrl && docToRemove.fileUrl.startsWith('/uploads/')) {
        deleteFile(docToRemove.fileUrl).catch(err => {
          console.error('Error deleting file:', err);
        });
      }

      const updatedAdditionalDocs = (client.additional_documents || []).filter(
        (doc: any) => doc.id !== documentId
      );

      const updated = await memoryDb.updateClient(id, {
        additional_documents: updatedAdditionalDocs,
      });

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to remove additional document' });
    }
  });

  // Add requested document
  fastify.post('/:id/requested-documents', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      if (!client.submitted_to_immigration) {
        return reply.status(400).send({ error: 'Client must be submitted to immigration before adding requested documents' });
      }

      const { name, description } = request.body as any;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return reply.status(400).send({ error: 'Document name is required' });
      }

      const requestedDocs = client.requested_documents || [];
      const code = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newDoc = {
        code,
        name: name.trim(),
        description: description?.trim() || undefined,
        submitted: false,
        requestedAt: new Date().toISOString(),
      };

      requestedDocs.push(newDoc);

      const updated = await memoryDb.updateClient(id, {
        requested_documents: requestedDocs,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to add requested document' });
    }
  });

  // Upload file for requested document
  fastify.post('/:id/requested-documents/:code/upload', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, code } = request.params as { id: string; code: string };
      
      const fileData = await processFile(request);
      if (!fileData) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const userName = await getUserName(request);
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      if (!client.submitted_to_immigration) {
        return reply.status(400).send({ error: 'Client must be submitted to immigration' });
      }

      const requestedDocs = client.requested_documents || [];
      const docIndex = requestedDocs.findIndex((d: any) => d.code === code);
      if (docIndex === -1) {
        return reply.status(404).send({ error: 'Requested document not found' });
      }

      let fileUrl: string;
      let fileName: string;

      if (isUsingBucketStorage()) {
        const ext = extname(fileData.filename);
        const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
        fileName = `${name}_${uniqueSuffix}${ext}`;
        fileUrl = await uploadFile(fileData.buffer, `clients/${id}/requested/${fileName}`, fileData.mimetype);
      } else {
        fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
        fileName = fileUrl.replace('/uploads/', '');
      }

      const oldDoc = requestedDocs[docIndex];
      if (oldDoc.fileUrl && oldDoc.fileUrl.startsWith('/uploads/')) {
        deleteFile(oldDoc.fileUrl).catch(err => {
          console.error('Error deleting old file:', err);
        });
      }

      requestedDocs[docIndex] = {
        ...requestedDocs[docIndex],
        submitted: true,
        fileUrl,
        fileName: fileData.filename,
        fileSize: fileData.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userName,
      };

      const updated = await memoryDb.updateClient(id, {
        requested_documents: requestedDocs,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to upload requested document' });
    }
  });

  // Remove requested document
  fastify.delete('/:id/requested-documents/:code', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id, code } = request.params as { id: string; code: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const requestedDocs = (client.requested_documents || []).filter(
        (d: any) => d.code !== code
      );

      const docToRemove = client.requested_documents?.find((d: any) => d.code === code);
      if (docToRemove && docToRemove.fileUrl && docToRemove.fileUrl.startsWith('/uploads/')) {
        deleteFile(docToRemove.fileUrl).catch(err => {
          console.error('Error deleting file:', err);
        });
      }

      const updated = await memoryDb.updateClient(id, {
        requested_documents: requestedDocs,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to remove requested document' });
    }
  });

  // Set requested documents reminder duration
  fastify.put('/:id/requested-documents-reminder-duration', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { durationDays } = request.body as any;
      if (!durationDays || typeof durationDays !== 'number' || durationDays < 1 || durationDays > 365) {
        return reply.status(400).send({ error: 'Duration must be between 1 and 365 days' });
      }

      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      if (!client.submitted_to_immigration) {
        return reply.status(400).send({ error: 'Client must be submitted to immigration' });
      }

      const updated = await memoryDb.updateClient(id, {
        requested_documents_reminder_duration_days: durationDays,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update reminder duration' });
    }
  });

  // Update last reminder date for requested documents
  fastify.put('/:id/requested-documents-last-reminder', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const updated = await memoryDb.updateClient(id, {
        requested_documents_last_reminder_date: new Date().toISOString(),
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update last reminder date' });
    }
  });

  // Helper function to handle document upload for different types
  async function handleDocumentUpload(
    request: AuthenticatedRequest,
    reply: FastifyReply,
    documentType: 'aportar_documentacion' | 'requerimiento' | 'resolucion' | 'justificante_presentacion'
  ) {
    try {
      const { id } = request.params as { id: string };
      let body: any = {};
      let fileData: { buffer: Buffer; filename: string; mimetype: string; size: number } | null = null;

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const file = part as any;
            if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
              return reply.status(400).send({ error: `File type ${file.mimetype} is not allowed. Allowed types: PDF, images, Word, Excel` });
            }
            const buffer = await file.toBuffer();
            fileData = {
              buffer,
              filename: file.filename || 'unknown',
              mimetype: file.mimetype,
              size: buffer.length,
            };
          } else {
            const field = part as any;
            body[field.fieldname] = field.value;
          }
        }
      } else {
        body = request.body as any;
      }

      const { name, description, reminder_days } = body;
      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'Document name is required' });
      }

      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const documents = (client as any)[documentType] || [];
      const reminderDays = reminder_days ? parseInt(reminder_days) : 10;
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      if (fileData) {
        const userName = await getUserName(request);
        let fileUrl: string;
        let fileName: string;

        if (isUsingBucketStorage()) {
          const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
          const ext = extname(fileData.filename);
          const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
          fileName = `${name}_${uniqueSuffix}${ext}`;
          fileUrl = await uploadFile(fileData.buffer, fileName, fileData.mimetype);
        } else {
          fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
          fileName = fileUrl.replace('/uploads/', '');
        }

        const newDoc: any = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          description: description ? description.trim() : undefined,
          fileUrl,
          fileName: fileData.filename,
          fileSize: fileData.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userName,
          reminder_days: reminderDays,
          reminder_date: reminderDate.toISOString(),
          created_at: new Date().toISOString(),
        };

        documents.push(newDoc);
      } else {
        const newDoc: any = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          description: description ? description.trim() : undefined,
          reminder_days: reminderDays,
          reminder_date: reminderDate.toISOString(),
          created_at: new Date().toISOString(),
        };

        documents.push(newDoc);
      }

      const updated = await memoryDb.updateClient(id, {
        [documentType]: documents,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || `Failed to create ${documentType} document` });
    }
  }

  // Helper function to handle document update for different types
  async function handleDocumentUpdate(
    request: AuthenticatedRequest,
    reply: FastifyReply,
    documentType: 'aportar_documentacion' | 'requerimiento' | 'resolucion' | 'justificante_presentacion'
  ) {
    try {
      const { id, docId } = request.params as { id: string; docId: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const { name, description, reminder_days } = request.body as any;
      const documents = (client as any)[documentType] || [];
      const docIndex = documents.findIndex((d: any) => d.id === docId);
      
      if (docIndex === -1) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const reminderDays = reminder_days ? parseInt(reminder_days) : documents[docIndex].reminder_days || 10;
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      const updatedDoc = {
        ...documents[docIndex],
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description ? description.trim() : undefined }),
        reminder_days: reminderDays,
        reminder_date: reminderDate.toISOString(),
      };

      documents[docIndex] = updatedDoc;
      const updated = await memoryDb.updateClient(id, {
        [documentType]: documents,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || `Failed to update ${documentType} document` });
    }
  }

  // Helper function to handle file upload to existing document
  async function handleDocumentFileUpload(
    request: AuthenticatedRequest,
    reply: FastifyReply,
    documentType: 'aportar_documentacion' | 'requerimiento' | 'resolucion' | 'justificante_presentacion'
  ) {
    try {
      const { id, docId } = request.params as { id: string; docId: string };
      
      const fileData = await processFile(request);
      if (!fileData) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const userName = await getUserName(request);
      const documents = (client as any)[documentType] || [];
      const docIndex = documents.findIndex((d: any) => d.id === docId);
      
      if (docIndex === -1) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      let fileName: string;
      let fileUrl: string;
      
      if (isUsingBucketStorage()) {
        const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        const ext = extname(fileData.filename);
        const name = fileData.filename.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
        fileName = `${name}_${uniqueSuffix}${ext}`;
        fileUrl = await uploadFile(fileData.buffer, fileName, fileData.mimetype);
      } else {
        fileUrl = saveFileLocally(fileData.buffer, fileData.filename);
        fileName = fileUrl.replace('/uploads/', '');
      }

      const updatedDoc = {
        ...documents[docIndex],
        fileUrl: fileUrl,
        fileName: fileData.filename,
        fileSize: fileData.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userName,
      };

      documents[docIndex] = updatedDoc;
      const updated = await memoryDb.updateClient(id, {
        [documentType]: documents,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || `Failed to upload file` });
    }
  }

  // Helper function to handle document removal for different types
  async function handleDocumentRemove(
    request: AuthenticatedRequest,
    reply: FastifyReply,
    documentType: 'aportar_documentacion' | 'requerimiento' | 'resolucion' | 'justificante_presentacion'
  ) {
    try {
      const { id, docId } = request.params as { id: string; docId: string };
      const client = await memoryDb.getClient(id);
      if (!client) {
        return reply.status(404).send({ error: 'Client not found' });
      }

      const documents = ((client as any)[documentType] || []).filter(
        (d: any) => d.id !== docId
      );

      const docToRemove = ((client as any)[documentType] || []).find(
        (d: any) => d.id === docId
      );
      if (docToRemove && docToRemove.fileUrl) {
        if (docToRemove.fileUrl.startsWith('/uploads/')) {
          deleteFile(docToRemove.fileUrl).catch(err => {
            console.error('Error deleting file:', err);
          });
        } else if (isUsingBucketStorage()) {
          const key = docToRemove.fileUrl.split('/').slice(-3).join('/');
          deleteFile(key).catch(err => {
            console.error('Error deleting file from bucket:', err);
          });
        }
      }

      const updated = await memoryDb.updateClient(id, {
        [documentType]: documents,
      } as any);

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || `Failed to remove ${documentType} document` });
    }
  }

  // APORTAR DOCUMENTACIÓN routes
  fastify.post('/:id/aportar-documentacion', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpload(request, reply, 'aportar_documentacion')
  );
  fastify.put('/:id/aportar-documentacion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpdate(request, reply, 'aportar_documentacion')
  );
  fastify.post('/:id/aportar-documentacion/:docId/file', async (request: AuthenticatedRequest, reply) => 
    handleDocumentFileUpload(request, reply, 'aportar_documentacion')
  );
  fastify.delete('/:id/aportar-documentacion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentRemove(request, reply, 'aportar_documentacion')
  );

  // REQUERIMIENTO routes
  fastify.post('/:id/requerimiento', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpload(request, reply, 'requerimiento')
  );
  fastify.put('/:id/requerimiento/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpdate(request, reply, 'requerimiento')
  );
  fastify.post('/:id/requerimiento/:docId/file', async (request: AuthenticatedRequest, reply) => 
    handleDocumentFileUpload(request, reply, 'requerimiento')
  );
  fastify.delete('/:id/requerimiento/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentRemove(request, reply, 'requerimiento')
  );

  // RESOLUCIÓN routes
  fastify.post('/:id/resolucion', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpload(request, reply, 'resolucion')
  );
  fastify.put('/:id/resolucion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpdate(request, reply, 'resolucion')
  );
  fastify.post('/:id/resolucion/:docId/file', async (request: AuthenticatedRequest, reply) => 
    handleDocumentFileUpload(request, reply, 'resolucion')
  );
  fastify.delete('/:id/resolucion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentRemove(request, reply, 'resolucion')
  );

  // JUSTIFICANTE DE PRESENTACION routes
  fastify.post('/:id/justificante-presentacion', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpload(request, reply, 'justificante_presentacion')
  );
  fastify.put('/:id/justificante-presentacion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentUpdate(request, reply, 'justificante_presentacion')
  );
  fastify.post('/:id/justificante-presentacion/:docId/file', async (request: AuthenticatedRequest, reply) => 
    handleDocumentFileUpload(request, reply, 'justificante_presentacion')
  );
  fastify.delete('/:id/justificante-presentacion/:docId', async (request: AuthenticatedRequest, reply) => 
    handleDocumentRemove(request, reply, 'justificante_presentacion')
  );
};

export default clientsRoutes;
