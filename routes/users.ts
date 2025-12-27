import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const memoryDb = db;

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const users = await memoryDb.getUsers();
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
};

export default usersRoutes;
