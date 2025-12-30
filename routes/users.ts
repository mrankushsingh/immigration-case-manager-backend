import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import pg from 'pg';
const { Pool } = pg;

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

  // Copy data from one PostgreSQL database to another
  fastify.post('/copy-database', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!request.user?.uid) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const currentUser = await memoryDb.getUserByFirebaseUid(request.user.uid);
      if (!currentUser || currentUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { sourceUrl, destinationUrl, skipDuplicates } = request.body as {
        sourceUrl: string;
        destinationUrl: string;
        skipDuplicates?: boolean;
      };

      if (!sourceUrl || !destinationUrl) {
        return reply.status(400).send({ error: 'Source and destination database URLs are required' });
      }

      // Validate URLs
      if (!sourceUrl.startsWith('postgresql://') && !sourceUrl.startsWith('postgres://')) {
        return reply.status(400).send({ error: 'Invalid source database URL format' });
      }
      if (!destinationUrl.startsWith('postgresql://') && !destinationUrl.startsWith('postgres://')) {
        return reply.status(400).send({ error: 'Invalid destination database URL format' });
      }

      // Configure SSL with proper verification
      // For production, we should verify SSL certificates
      // For development/testing, we allow self-signed certificates
      const sslConfig = process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: true } // Verify SSL in production
        : { rejectUnauthorized: false }; // Allow self-signed in development

      const sourcePool = new Pool({
        connectionString: sourceUrl,
        ssl: sslConfig,
        connectionTimeoutMillis: 10000, // 10 second timeout
      });

      const destinationPool = new Pool({
        connectionString: destinationUrl,
        ssl: sslConfig,
        connectionTimeoutMillis: 10000, // 10 second timeout
      });

      // Test connections
      try {
        await sourcePool.query('SELECT NOW()');
        await destinationPool.query('SELECT NOW()');
      } catch (error: any) {
        sourcePool.end();
        destinationPool.end();
        return reply.status(400).send({ error: `Database connection failed: ${error.message}` });
      }

      // Initialize destination database (create tables)
      await initializeDestinationDatabase(destinationPool);

      const results = {
        templates: { copied: 0, skipped: 0, errors: [] as string[] },
        users: { copied: 0, skipped: 0, errors: [] as string[] },
        clients: { copied: 0, skipped: 0, errors: [] as string[] },
      };

      try {
        // Copy templates
        const templatesResult = await sourcePool.query('SELECT * FROM case_templates');
        for (const template of templatesResult.rows) {
          try {
            if (skipDuplicates) {
              const existing = await destinationPool.query('SELECT id FROM case_templates WHERE id = $1', [template.id]);
              if (existing.rows.length > 0) {
                results.templates.skipped++;
                continue;
              }
            }
            await destinationPool.query(
              `INSERT INTO case_templates (id, name, description, required_documents, reminder_interval_days, administrative_silence_days, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name,
                 description = EXCLUDED.description,
                 required_documents = EXCLUDED.required_documents,
                 reminder_interval_days = EXCLUDED.reminder_interval_days,
                 administrative_silence_days = EXCLUDED.administrative_silence_days,
                 updated_at = EXCLUDED.updated_at`,
              [
                template.id,
                template.name,
                template.description || null,
                typeof template.required_documents === 'string' 
                  ? template.required_documents 
                  : JSON.stringify(template.required_documents || []),
                template.reminder_interval_days,
                template.administrative_silence_days,
                template.created_at,
                template.updated_at,
              ]
            );
            results.templates.copied++;
          } catch (error: any) {
            results.templates.errors.push(`${template.name || template.id}: ${error.message}`);
          }
        }

        // Copy users
        const usersResult = await sourcePool.query('SELECT * FROM users');
        for (const user of usersResult.rows) {
          try {
            if (skipDuplicates) {
              const existing = await destinationPool.query('SELECT id FROM users WHERE firebase_uid = $1', [user.firebase_uid]);
              if (existing.rows.length > 0) {
                results.users.skipped++;
                continue;
              }
            }
            await destinationPool.query(
              `INSERT INTO users (id, firebase_uid, email, name, role, active, created_by, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (firebase_uid) DO UPDATE SET
                 email = EXCLUDED.email,
                 name = EXCLUDED.name,
                 role = EXCLUDED.role,
                 active = EXCLUDED.active,
                 updated_at = EXCLUDED.updated_at`,
              [
                user.id,
                user.firebase_uid,
                user.email,
                user.name || null,
                user.role,
                user.active,
                user.created_by || null,
                user.created_at,
                user.updated_at,
              ]
            );
            results.users.copied++;
          } catch (error: any) {
            results.users.errors.push(`${user.email || user.id}: ${error.message}`);
          }
        }

        // Copy clients
        const clientsResult = await sourcePool.query('SELECT * FROM clients');
        for (const client of clientsResult.rows) {
          try {
            if (skipDuplicates) {
              const existing = await destinationPool.query('SELECT id FROM clients WHERE id = $1', [client.id]);
              if (existing.rows.length > 0) {
                results.clients.skipped++;
                continue;
              }
            }
            await destinationPool.query(
              `INSERT INTO clients (
                id, first_name, last_name, parent_name, email, phone, case_template_id, case_type, details,
                required_documents, reminder_interval_days, administrative_silence_days, payment,
                submitted_to_immigration, application_date, custom_reminder_date, notifications,
                additional_docs_required, notes, additional_documents, requested_documents,
                requested_documents_reminder_duration_days, requested_documents_reminder_interval_days,
                requested_documents_last_reminder_date, aportar_documentacion, requerimiento,
                resolucion, justificante_presentacion, created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
              )
              ON CONFLICT (id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                parent_name = EXCLUDED.parent_name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                case_template_id = EXCLUDED.case_template_id,
                case_type = EXCLUDED.case_type,
                details = EXCLUDED.details,
                required_documents = EXCLUDED.required_documents,
                reminder_interval_days = EXCLUDED.reminder_interval_days,
                administrative_silence_days = EXCLUDED.administrative_silence_days,
                payment = EXCLUDED.payment,
                submitted_to_immigration = EXCLUDED.submitted_to_immigration,
                application_date = EXCLUDED.application_date,
                custom_reminder_date = EXCLUDED.custom_reminder_date,
                notifications = EXCLUDED.notifications,
                additional_docs_required = EXCLUDED.additional_docs_required,
                notes = EXCLUDED.notes,
                additional_documents = EXCLUDED.additional_documents,
                requested_documents = EXCLUDED.requested_documents,
                requested_documents_reminder_duration_days = EXCLUDED.requested_documents_reminder_duration_days,
                requested_documents_reminder_interval_days = EXCLUDED.requested_documents_reminder_interval_days,
                requested_documents_last_reminder_date = EXCLUDED.requested_documents_last_reminder_date,
                aportar_documentacion = EXCLUDED.aportar_documentacion,
                requerimiento = EXCLUDED.requerimiento,
                resolucion = EXCLUDED.resolucion,
                justificante_presentacion = EXCLUDED.justificante_presentacion,
                updated_at = EXCLUDED.updated_at`,
              [
                client.id,
                client.first_name,
                client.last_name,
                client.parent_name || null,
                client.email || null,
                client.phone || null,
                client.case_template_id || null,
                client.case_type || null,
                client.details || null,
                typeof client.required_documents === 'string' ? client.required_documents : JSON.stringify(client.required_documents || []),
                client.reminder_interval_days,
                client.administrative_silence_days,
                typeof client.payment === 'string' ? client.payment : JSON.stringify(client.payment || {}),
                client.submitted_to_immigration || false,
                client.application_date || null,
                client.custom_reminder_date || null,
                typeof client.notifications === 'string' ? client.notifications : JSON.stringify(client.notifications || []),
                client.additional_docs_required || false,
                client.notes || null,
                typeof client.additional_documents === 'string' ? client.additional_documents : JSON.stringify(client.additional_documents || []),
                typeof client.requested_documents === 'string' ? client.requested_documents : JSON.stringify(client.requested_documents || []),
                client.requested_documents_reminder_duration_days || null,
                client.requested_documents_reminder_interval_days || null,
                client.requested_documents_last_reminder_date || null,
                typeof client.aportar_documentacion === 'string' ? client.aportar_documentacion : JSON.stringify(client.aportar_documentacion || []),
                typeof client.requerimiento === 'string' ? client.requerimiento : JSON.stringify(client.requerimiento || []),
                typeof client.resolucion === 'string' ? client.resolucion : JSON.stringify(client.resolucion || []),
                typeof client.justificante_presentacion === 'string' ? client.justificante_presentacion : JSON.stringify(client.justificante_presentacion || []),
                client.created_at,
                client.updated_at,
              ]
            );
            results.clients.copied++;
          } catch (error: any) {
            results.clients.errors.push(`${client.first_name} ${client.last_name}: ${error.message}`);
          }
        }
      } finally {
        await sourcePool.end();
        await destinationPool.end();
      }

      return reply.send({
        message: 'Database copy completed',
        results,
      });
    } catch (error: any) {
      fastify.log.error('Error copying database:', error);
      return reply.status(500).send({ error: error.message || 'Failed to copy database' });
    }
  });
};

// Helper function to initialize destination database
async function initializeDestinationDatabase(pool: pg.Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_templates (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      required_documents JSONB,
      reminder_interval_days INTEGER DEFAULT 10,
      administrative_silence_days INTEGER DEFAULT 60,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR(255) PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      parent_name VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(255),
      case_template_id VARCHAR(255),
      case_type VARCHAR(255),
      details TEXT,
      required_documents JSONB,
      reminder_interval_days INTEGER DEFAULT 10,
      administrative_silence_days INTEGER DEFAULT 60,
      payment JSONB,
      submitted_to_immigration BOOLEAN DEFAULT FALSE,
      application_date TIMESTAMP,
      custom_reminder_date TIMESTAMP,
      notifications JSONB,
      additional_docs_required BOOLEAN DEFAULT FALSE,
      notes TEXT,
      additional_documents JSONB,
      requested_documents JSONB,
      requested_documents_reminder_duration_days INTEGER DEFAULT 10,
      requested_documents_reminder_interval_days INTEGER DEFAULT 3,
      requested_documents_last_reminder_date TIMESTAMP,
      aportar_documentacion JSONB,
      requerimiento JSONB,
      resolucion JSONB,
      justificante_presentacion JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      firebase_uid VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      active BOOLEAN DEFAULT TRUE,
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export default usersRoutes;
