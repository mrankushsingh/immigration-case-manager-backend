import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { cache } from '../utils/cache.js';

const memoryDb = db;

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      // Check cache first (users change infrequently)
      const cacheKey = 'users:all';
      const cached = cache.get(cacheKey);
      if (cached) {
        return reply.send(cached);
      }

      const users = await memoryDb.getUsers();
      
      // Cache for 2 minutes (users change more often than templates)
      cache.set(cacheKey, users, 2 * 60 * 1000);
      
      return reply.send(users);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch users' });
    }
  });

  fastify.get('/me', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      let user = await memoryDb.getUserByFirebaseUid(request.user.uid);
      
      if (!user) {
        const allUsers = await memoryDb.getUsers();
        const hasAdmin = allUsers.some(u => u.role === 'admin');
        
        user = await memoryDb.insertUser({
          firebase_uid: request.user.uid,
          email: request.user.email || '',
          name: request.user.name || undefined,
          role: hasAdmin ? 'user' : 'admin',
          active: true,
          created_by: request.user.uid,
        });
      }

      return reply.send(user);
    } catch (error: any) {
      fastify.log.error('Error in /me route:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch user' });
    }
  });

  fastify.get('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const user = await memoryDb.getUser(id);
      if (!user) return reply.status(404).send({ error: 'User not found' });
      return reply.send(user);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to fetch user' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { email, name, role, firebase_uid } = request.body as any;

      if (!email || !firebase_uid) {
        return reply.status(400).send({ error: 'Email and Firebase UID are required' });
      }

      const existingUser = await memoryDb.getUserByEmail(email);
      if (existingUser) {
        return reply.status(400).send({ error: 'User with this email already exists' });
      }

      const existingUserByUid = await memoryDb.getUserByFirebaseUid(firebase_uid);
      if (existingUserByUid) {
        return reply.status(400).send({ error: 'User with this Firebase UID already exists' });
      }

      const user = await memoryDb.insertUser({
        firebase_uid,
        email,
        name: name || undefined,
        role: role || 'user',
        active: true,
        created_by: request.user.uid,
      });

      return reply.status(201).send(user);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create user' });
    }
  });

  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser) {
        return reply.status(401).send({ error: 'User not found' });
      }

      const { id } = request.params as { id: string };
      const targetUser = await memoryDb.getUser(id);
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (currentUser.role !== 'admin' && targetUser.firebase_uid !== request.user.uid) {
        return reply.status(403).send({ error: 'You can only update your own profile' });
      }

      const { role, ...updateData } = request.body as any;
      if (role) {
        const allUsers = await memoryDb.getUsers();
        const hasAdmin = allUsers.some(u => u.role === 'admin' && u.id !== targetUser.id);
        
        if (currentUser.role !== 'admin') {
          if (!hasAdmin && role === 'admin' && targetUser.firebase_uid === request.user.uid) {
            // Allow this
          } else {
            return reply.status(403).send({ error: 'Only admins can change user roles' });
          }
        }
      }

      const updated = await memoryDb.updateUser(id, {
        ...updateData,
        ...(role && { role }),
      });

      if (!updated) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update user' });
    }
  });

  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { id } = request.params as { id: string };
      const targetUser = await memoryDb.getUser(id);
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (targetUser.firebase_uid === request.user.uid) {
        return reply.status(400).send({ error: 'You cannot delete your own account' });
      }

      const deleted = await memoryDb.deleteUser(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send({ message: 'User deleted successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete user' });
    }
  });

  // Export all data
  fastify.get('/export/all', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // Get all data
      const clients = await memoryDb.getClients();
      const users = await memoryDb.getUsers();
      const templates = await memoryDb.getTemplates();

      const exportData = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        data: {
          clients,
          users,
          templates,
        },
        stats: {
          totalClients: clients.length,
          totalUsers: users.length,
          totalTemplates: templates.length,
        },
      };

      const jsonData = JSON.stringify(exportData, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `data-export-${timestamp}.json`;

      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      
      return reply.send(jsonData);
    } catch (error: any) {
      fastify.log.error('Error exporting data:', error);
      return reply.status(500).send({ error: error.message || 'Failed to export data' });
    }
  });

  // Import/Restore all data
  fastify.post('/import/all', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { data } = request.body as { data: any };

      if (!data || !data.data) {
        return reply.status(400).send({ error: 'Invalid backup file format' });
      }

      const { clients, users, templates } = data.data;

      const results = {
        clients: { imported: 0, skipped: 0, errors: [] as string[] },
        users: { imported: 0, skipped: 0, errors: [] as string[] },
        templates: { imported: 0, skipped: 0, errors: [] as string[] },
      };

      // Import templates
      if (Array.isArray(templates)) {
        for (const template of templates) {
          try {
            const existing = await memoryDb.getTemplate(template.id);
            if (existing) {
              results.templates.skipped++;
              continue;
            }
            // Remove id, created_at, updated_at for insert
            const { id, created_at, updated_at, ...templateData } = template;
            await memoryDb.insertTemplate(templateData);
            results.templates.imported++;
          } catch (error: any) {
            results.templates.errors.push(`${template.name || template.id}: ${error.message}`);
          }
        }
      }

      // Import users (skip current user)
      if (Array.isArray(users)) {
        for (const user of users) {
          try {
            if (user.firebase_uid === request.user.uid) {
              results.users.skipped++;
              continue;
            }
            const existing = await memoryDb.getUserByFirebaseUid(user.firebase_uid);
            if (existing) {
              results.users.skipped++;
              continue;
            }
            // Remove id, created_at, updated_at for insert
            const { id, created_at, updated_at, ...userData } = user;
            await memoryDb.insertUser(userData);
            results.users.imported++;
          } catch (error: any) {
            results.users.errors.push(`${user.email || user.id}: ${error.message}`);
          }
        }
      }

      // Import clients
      if (Array.isArray(clients)) {
        for (const client of clients) {
          try {
            const existing = await memoryDb.getClient(client.id);
            if (existing) {
              results.clients.skipped++;
              continue;
            }
            // Remove id, created_at, updated_at for insert
            const { id, created_at, updated_at, ...clientData } = client;
            await memoryDb.insertClient(clientData);
            results.clients.imported++;
          } catch (error: any) {
            results.clients.errors.push(`${client.first_name} ${client.last_name}: ${error.message}`);
          }
        }
      }

      return reply.send({
        message: 'Data imported successfully',
        results,
      });
    } catch (error: any) {
      fastify.log.error('Error importing data:', error);
      return reply.status(500).send({ error: error.message || 'Failed to import data' });
    }
  });
};

export default usersRoutes;
