import { Router } from 'express';
import { db } from '../utils/database.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const memoryDb = db; // For backward compatibility

// All routes require authentication
router.use(authenticateToken);

// Get all users
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const users = await memoryDb.getUsers();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

// Get current user
router.get('/me', async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    let user = await memoryDb.getUserByFirebaseUid(req.user.uid);
    
    // If user doesn't exist in database, create one using info from the decoded token
    if (!user) {
      // Check if there are any admins in the system
      const allUsers = await memoryDb.getUsers();
      const hasAdmin = allUsers.some(u => u.role === 'admin');
      
      // Use the information from the decoded token (req.user) instead of fetching from Firebase Admin
      // This avoids permission issues with Firebase Admin SDK
      // If no admins exist, make the first user an admin
      user = await memoryDb.insertUser({
        firebase_uid: req.user.uid,
        email: req.user.email || '',
        name: req.user.name || undefined,
        role: hasAdmin ? 'user' : 'admin', // First user becomes admin
        active: true,
        created_by: req.user.uid,
      });
    }

    res.json(user);
  } catch (error: any) {
    console.error('Error in /me route:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user' });
  }
});

// Get user by ID
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const user = await memoryDb.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch user' });
  }
});

// Create user (admin only)
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    // Check if current user is admin
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const currentUser = await memoryDb.getUserByFirebaseUid(req.user.uid);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email, name, role, firebase_uid } = req.body;

    if (!email || !firebase_uid) {
      return res.status(400).json({ error: 'Email and Firebase UID are required' });
    }

    // Check if user already exists
    const existingUser = await memoryDb.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const existingUserByUid = await memoryDb.getUserByFirebaseUid(firebase_uid);
    if (existingUserByUid) {
      return res.status(400).json({ error: 'User with this Firebase UID already exists' });
    }

    const user = await memoryDb.insertUser({
      firebase_uid,
      email,
      name: name || undefined,
      role: role || 'user',
      active: true,
      created_by: req.user.uid,
    });

    res.status(201).json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// Update user
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const currentUser = await memoryDb.getUserByFirebaseUid(req.user.uid);
    if (!currentUser) {
      return res.status(401).json({ error: 'User not found' });
    }

    const targetUser = await memoryDb.getUser(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Users can only update themselves, unless they're admin
    if (currentUser.role !== 'admin' && targetUser.firebase_uid !== req.user.uid) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    // Only admins can change roles, OR if there are no admins, allow anyone to make themselves admin
    const { role, ...updateData } = req.body;
    if (role) {
      const allUsers = await memoryDb.getUsers();
      const hasAdmin = allUsers.some(u => u.role === 'admin' && u.id !== targetUser.id);
      
      if (currentUser.role !== 'admin') {
        // If no admins exist, allow user to make themselves admin
        if (!hasAdmin && role === 'admin' && targetUser.firebase_uid === req.user.uid) {
          // Allow this - user is making themselves the first admin
        } else {
          return res.status(403).json({ error: 'Only admins can change user roles' });
        }
      }
    }

    const updated = await memoryDb.updateUser(req.params.id, {
      ...updateData,
      ...(role && { role }),
    });

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Delete user (admin only)
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const currentUser = await memoryDb.getUserByFirebaseUid(req.user.uid);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const targetUser = await memoryDb.getUser(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting yourself
    if (targetUser.firebase_uid === req.user.uid) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const deleted = await memoryDb.deleteUser(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

export default router;

