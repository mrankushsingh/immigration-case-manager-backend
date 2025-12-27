import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const memoryDb = db;

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/payment-passcode', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const passcode = await memoryDb.getSetting('payment_passcode');
      return reply.send({ isSet: !!passcode });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to get payment passcode status' });
    }
  });

  fastify.post('/payment-passcode', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { passcode } = request.body as any;
      if (!passcode || typeof passcode !== 'string' || passcode.trim().length === 0) {
        return reply.status(400).send({ error: 'Passcode is required' });
      }

      if (passcode.length < 4) {
        return reply.status(400).send({ error: 'Passcode must be at least 4 characters' });
      }

      await memoryDb.setSetting('payment_passcode', passcode.trim(), request.user.uid);
      return reply.send({ success: true, message: 'Payment passcode updated successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to set payment passcode' });
    }
  });

  fastify.post('/payment-passcode/verify', async (request: AuthenticatedRequest, reply) => {
    try {
      const { passcode } = request.body as any;
      if (!passcode || typeof passcode !== 'string') {
        return reply.status(400).send({ error: 'Passcode is required' });
      }

      const storedPasscode = await memoryDb.getSetting('payment_passcode');
      const defaultPasscode = process.env.PAYMENT_PASSCODE || '1234';
      const correctPasscode = storedPasscode || defaultPasscode;

      if (passcode.trim() === correctPasscode) {
        return reply.send({ valid: true });
      } else {
        return reply.send({ valid: false });
      }
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to verify passcode' });
    }
  });
};

export default settingsRoutes;
