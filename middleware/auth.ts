import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyIdToken, getFirebaseAdmin } from '../utils/firebase.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    uid: string;
    email?: string;
    name?: string;
  };
}

export async function authenticateToken(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    // Check if Firebase is configured
    const firebaseAdmin = getFirebaseAdmin();
    if (!firebaseAdmin) {
      return reply.status(503).send({ 
        error: 'Authentication service unavailable',
        message: 'Firebase Authentication is not configured on the server. Please contact the administrator.'
      });
    }

    // Get token from Authorization header
    const authHeader = request.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return reply.status(401).send({ 
        error: 'Authentication required',
        message: 'No authentication token provided. Please log in to access this resource.'
      });
    }

    // Verify the token
    const decodedToken = await verifyIdToken(token);
    
    if (!decodedToken) {
      return reply.status(401).send({ 
        error: 'Authentication failed',
        message: 'Invalid or expired token. Please log in again.'
      });
    }

    // Attach user info to request
    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
  } catch (error: any) {
    console.error('Authentication error:', error);
    return reply.status(401).send({ 
      error: 'Authentication failed',
      message: error.message || 'Failed to verify authentication token'
    });
  }
}
