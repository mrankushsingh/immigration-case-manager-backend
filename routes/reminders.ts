import { Router } from 'express';
import { db } from '../utils/database.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const memoryDb = db;

// All routes require authentication
router.use(authenticateToken);

// Get all reminders
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const reminders = await memoryDb.getReminders();
    res.json(reminders);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get reminders' });
  }
});

// Create a new reminder
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = req.body;

    // client_id is optional (for standalone reminders), but name, surname, and date are required
    if (!client_name || !client_surname || !reminder_date) {
      return res.status(400).json({ error: 'client_name, client_surname, and reminder_date are required' });
    }

    const reminder = await memoryDb.insertReminder({
      client_id,
      client_name,
      client_surname,
      phone,
      reminder_date,
      notes,
      reminder_type,
    });

    res.status(201).json(reminder);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create reminder' });
  }
});

// Update a reminder
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = req.body;

    const updated = await memoryDb.updateReminder(id, {
      client_id,
      client_name,
      client_surname,
      phone,
      reminder_date,
      notes,
      reminder_type,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.json({ success: true, message: 'Reminder updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update reminder' });
  }
});

// Delete a reminder
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const deleted = await memoryDb.deleteReminder(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.json({ success: true, message: 'Reminder deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete reminder' });
  }
});

export default router;

