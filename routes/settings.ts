import { Router } from 'express';
import { db } from '../utils/database.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const memoryDb = db;

// All routes require authentication
router.use(authenticateToken);

// Get payment passcode (admin only)
router.get('/payment-passcode', async (req: AuthenticatedRequest, res) => {
  try {
    // Check if user is admin
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const currentUser = await memoryDb.getUserByFirebaseUid(req.user.uid);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const passcode = await memoryDb.getSetting('payment_passcode');
    // Don't return the actual passcode for security, just indicate if it's set
    res.json({ isSet: !!passcode });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get payment passcode status' });
  }
});

// Set payment passcode (admin only)
router.post('/payment-passcode', async (req: AuthenticatedRequest, res) => {
  try {
    // Check if user is admin
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const currentUser = await memoryDb.getUserByFirebaseUid(req.user.uid);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { passcode } = req.body;
    if (!passcode || typeof passcode !== 'string' || passcode.trim().length === 0) {
      return res.status(400).json({ error: 'Passcode is required' });
    }

    if (passcode.length < 4) {
      return res.status(400).json({ error: 'Passcode must be at least 4 characters' });
    }

    await memoryDb.setSetting('payment_passcode', passcode.trim(), req.user.uid);
    res.json({ success: true, message: 'Payment passcode updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to set payment passcode' });
  }
});

// Verify payment passcode (for dashboard)
router.post('/payment-passcode/verify', async (req: AuthenticatedRequest, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode || typeof passcode !== 'string') {
      return res.status(400).json({ error: 'Passcode is required' });
    }

    const storedPasscode = await memoryDb.getSetting('payment_passcode');
    // If no passcode is set, use default
    const defaultPasscode = process.env.PAYMENT_PASSCODE || '1234';
    const correctPasscode = storedPasscode || defaultPasscode;

    if (passcode.trim() === correctPasscode) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to verify passcode' });
  }
});

export default router;

