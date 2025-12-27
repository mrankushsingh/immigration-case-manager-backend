import { Request, Response, NextFunction } from 'express';
import { verifyIdToken, getFirebaseAdmin } from '../utils/firebase.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
  };
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Check if Firebase is configured
    const firebaseAdmin = getFirebaseAdmin();
    if (!firebaseAdmin) {
      return res.status(503).json({ 
        error: 'Authentication service unavailable',
        message: 'Firebase Authentication is not configured on the server. Please contact the administrator.'
      });
    }

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No authentication token provided. Please log in to access this resource.'
      });
    }

    // Verify the token
    const decodedToken = await verifyIdToken(token);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid or expired token. Please log in again.'
      });
    }

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };

    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: error.message || 'Failed to verify authentication token'
    });
  }
}

