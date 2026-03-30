import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { cache } from '../utils/cache.js';

const memoryDb = db;

const caseTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const { name, description, requiredDocuments, reminderIntervalDays, administrativeSilenceDays } = request.body as any;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return reply.status(400).send({ error: 'Name is required and must be a non-empty string' });
      }
      
      if (reminderIntervalDays !== undefined) {
        const interval = Number(reminderIntervalDays);
        if (isNaN(interval) || interval < 1 || interval > 365) {
          return reply.status(400).send({ error: 'Reminder interval must be between 1 and 365 days' });
        }
      }
      
      if (administrativeSilenceDays !== undefined) {
        const days = Number(administrativeSilenceDays);
        if (isNaN(days) || days < 1 || days > 3650) {
          return reply.status(400).send({ error: 'Administrative silence days must be between 1 and 3650 days' });
        }
      }
      
      if (requiredDocuments !== undefined && !Array.isArray(requiredDocuments)) {
        return reply.status(400).send({ error: 'Required documents must be an array' });
      }

      const template = await memoryDb.insertTemplate({
        name: name.trim(),
        description: description?.trim() || undefined,
        required_documents: Array.isArray(requiredDocuments) ? requiredDocuments : [],
        reminder_interval_days: Number(reminderIntervalDays) || 10,
        administrative_silence_days: Number(administrativeSilenceDays) || 60,
      });

      // Invalidate templates cache
      await cache.delete('templates:all');

      return reply.status(201).send(template);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create template' });
    }
  });

  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const { limit, offset, search } = request.query as { limit?: string; offset?: string; search?: string };
      
      // If pagination parameters are provided, use paginated endpoint
      if (limit !== undefined || offset !== undefined || search !== undefined) {
        const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 25; // Default 25, max 100
        const offsetNum = offset ? Math.max(parseInt(offset, 10), 0) : 0;
        const searchTerm = search ? String(search).trim() : undefined;
        
        // Cache key includes pagination and search params (don't cache search results)
        const cacheKey = searchTerm 
          ? null // Don't cache search results
          : `templates:paginated:${limitNum}:${offsetNum}`;
        
        if (cacheKey) {
          const cached = await cache.get(cacheKey);
          if (cached) {
            return reply.send(cached);
          }
        }
        
        const result = await memoryDb.getTemplatesPaginated(limitNum, offsetNum, searchTerm);
        const response = {
          templates: result.templates,
          total: result.total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < result.total,
          search: searchTerm || undefined
        };
        
        // Cache for 5 minutes (only if not a search query)
        if (cacheKey) {
          await cache.set(cacheKey, response, 5 * 60 * 1000);
        }
        
        return reply.send(response);
      }
      
      // Default behavior: return all templates (for backward compatibility)
      const cacheKey = 'templates:all';
      const cached = await cache.get(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      const templates = await memoryDb.getTemplates();
      
      // Cache for 5 minutes
      await cache.set(cacheKey, templates, 5 * 60 * 1000);
      
      return reply.send(templates);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch templates' });
    }
  });

  fastify.get('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const template = await memoryDb.getTemplate(id);
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      return reply.send(template);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch template' });
    }
  });

  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { name, description, requiredDocuments, reminderIntervalDays, administrativeSilenceDays } = request.body as any;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (requiredDocuments !== undefined) updateData.required_documents = requiredDocuments;
      if (reminderIntervalDays !== undefined) updateData.reminder_interval_days = reminderIntervalDays;
      if (administrativeSilenceDays !== undefined) updateData.administrative_silence_days = administrativeSilenceDays;
      
      const template = await memoryDb.updateTemplate(id, updateData);
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      
      // Invalidate templates cache
      await cache.delete('templates:all');
      await cache.delete(`templates:${id}`);
      
      // Automatically update all clients using this template
      try {
        const allClients = await memoryDb.getClients();
        const clientsToUpdate = allClients.filter(
          (client: any) => 
            client.case_template_id === id && 
            !client.submitted_to_immigration
        );
        
        let updatedClientsCount = 0;
        
        for (const client of clientsToUpdate) {
          const clientUpdateData: any = {};
          
          if (name !== undefined) {
            clientUpdateData.case_type = name;
          }
          
          if (reminderIntervalDays !== undefined) {
            clientUpdateData.reminder_interval_days = reminderIntervalDays;
          }
          
          if (administrativeSilenceDays !== undefined) {
            clientUpdateData.administrative_silence_days = administrativeSilenceDays;
          }
          
          if (requiredDocuments !== undefined && Array.isArray(requiredDocuments)) {
            const existingDocs = client.required_documents || [];
            const existingDocsMap = new Map();
            
            existingDocs.forEach((doc: any) => {
              existingDocsMap.set(doc.code, doc);
            });
            
            const mergedDocs = requiredDocuments.map((templateDoc: any) => {
              const existingDoc = existingDocsMap.get(templateDoc.code);
              
              if (existingDoc && existingDoc.submitted) {
                return {
                  code: templateDoc.code,
                  name: templateDoc.name,
                  description: templateDoc.description || '',
                  submitted: true,
                  fileUrl: existingDoc.fileUrl,
                  uploadedAt: existingDoc.uploadedAt,
                  fileName: existingDoc.fileName,
                  fileSize: existingDoc.fileSize,
                  isOptional: templateDoc.isOptional || false,
                };
              } else {
                return {
                  code: templateDoc.code,
                  name: templateDoc.name,
                  description: templateDoc.description || '',
                  submitted: false,
                  fileUrl: null,
                  uploadedAt: null,
                  isOptional: templateDoc.isOptional || false,
                };
              }
            });
            
            clientUpdateData.required_documents = mergedDocs;
          }
          
          await memoryDb.updateClient(client.id, clientUpdateData);
          updatedClientsCount++;
        }
        
        if (updatedClientsCount > 0) {
          fastify.log.info(`Updated ${updatedClientsCount} client(s) using template "${template.name}"`);
        }
      } catch (clientUpdateError: any) {
        fastify.log.error('Error updating clients:', clientUpdateError);
      }
      
      return reply.send(template);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update template' });
    }
  });

  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await memoryDb.deleteTemplate(id);
      if (!deleted) return reply.status(404).send({ error: 'Template not found' });
      
      // Invalidate templates cache
      await cache.delete('templates:all');
      await cache.delete(`templates:${id}`);
      
      return reply.send({ message: 'Template deleted successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete template' });
    }
  });
};

export default caseTemplatesRoutes;
