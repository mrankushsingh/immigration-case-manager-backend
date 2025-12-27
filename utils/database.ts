import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

interface CaseTemplate {
  id: string;
  name: string;
  description?: string;
  required_documents: any[];
  reminder_interval_days: number;
  administrative_silence_days: number;
  created_at: string;
  updated_at: string;
}

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  parent_name?: string;
  email?: string;
  phone?: string;
  case_template_id?: string;
  case_type?: string;
  details?: string;
  required_documents: any[];
  reminder_interval_days: number;
  administrative_silence_days: number;
  payment: any;
  submitted_to_immigration: boolean;
  application_date?: string;
  custom_reminder_date?: string;
  notifications: any[];
  additional_docs_required: boolean;
  notes?: string;
  additional_documents?: any[];
  requested_documents?: any[];
  requested_documents_reminder_duration_days?: number;
  requested_documents_reminder_interval_days?: number;
  requested_documents_last_reminder_date?: string;
  aportar_documentacion?: any[];
  requerimiento?: any[];
  resolucion?: any[];
  justificante_presentacion?: any[];
  created_at: string;
  updated_at: string;
}

interface User {
  id: string;
  firebase_uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DatabaseAdapter {
  private pool: pg.Pool | null = null;
  private usePostgres: boolean = false;
  private dataDir: string;
  private templatesFile: string;
  private clientsFile: string;
  private usersFile: string;
  private uploadsDir: string;
  private templates: Map<string, CaseTemplate>;
  private clients: Map<string, Client>;
  private users: Map<string, User>;
  private templateCounter: number = 0;
  private clientCounter: number = 0;
  private userCounter: number = 0;
  private dbInitialized: Promise<void> | null = null;

  constructor() {
    this.dataDir = join(__dirname, '../../data');
    this.templatesFile = join(this.dataDir, 'templates.json');
    this.clientsFile = join(this.dataDir, 'clients.json');
    this.usersFile = join(this.dataDir, 'users.json');
    this.uploadsDir = join(this.dataDir, 'uploads');
    
    this.templates = new Map();
    this.clients = new Map();
    this.users = new Map();

    // Check if DATABASE_URL is set (Railway provides this automatically)
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      this.usePostgres = true;
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      });
      // Initialize database and store the promise
      this.dbInitialized = this.initPostgres();
    } else {
      // Use file-based storage for local development
      this.initFileStorage();
      this.dbInitialized = Promise.resolve();
    }
  }

  // Ensure database is initialized before queries
  private async ensureInitialized() {
    if (this.dbInitialized) {
      await this.dbInitialized;
    }
  }

  private async initPostgres() {
    if (!this.pool) return;

    try {
      // Test connection first
      console.log('🔌 Testing PostgreSQL connection...');
      await this.pool.query('SELECT NOW()');
      console.log('✅ PostgreSQL connection successful');

      // Create tables if they don't exist
      console.log('📋 Creating database tables...');
      await this.pool.query(`
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

      await this.pool.query(`
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

      await this.pool.query(`
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

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_by VARCHAR(255),
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS reminders (
          id VARCHAR(255) PRIMARY KEY,
          client_id VARCHAR(255),
          client_name VARCHAR(255) NOT NULL,
          client_surname VARCHAR(255) NOT NULL,
          phone VARCHAR(255),
          reminder_date TIMESTAMP NOT NULL,
          notes TEXT,
          reminder_type VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Add reminder_type column if it doesn't exist (for existing databases)
      await this.pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'reminders' AND column_name = 'reminder_type'
          ) THEN
            ALTER TABLE reminders ADD COLUMN reminder_type VARCHAR(50);
          END IF;
        END $$;
      `);
      
      // Add migration to make client_id nullable if it exists as NOT NULL
      await this.pool.query(`
        DO $$ 
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'reminders' 
            AND column_name = 'client_id' 
            AND is_nullable = 'NO'
          ) THEN
            ALTER TABLE reminders ALTER COLUMN client_id DROP NOT NULL;
          END IF;
        END $$;
      `);
      
      // Add custom_reminder_date column if it doesn't exist (for existing databases)
      // Use DO block to handle cases where column might already exist
      await this.pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'clients' AND column_name = 'custom_reminder_date'
          ) THEN
            ALTER TABLE clients ADD COLUMN custom_reminder_date TIMESTAMP;
          END IF;
        END $$;
      `);

      // Add requested_documents columns if they don't exist (for existing databases)
      await this.pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'requested_documents'
          ) THEN
            ALTER TABLE clients ADD COLUMN requested_documents JSONB;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'requested_documents_reminder_duration_days'
          ) THEN
            ALTER TABLE clients ADD COLUMN requested_documents_reminder_duration_days INTEGER DEFAULT 10;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'requested_documents_reminder_interval_days'
          ) THEN
            ALTER TABLE clients ADD COLUMN requested_documents_reminder_interval_days INTEGER DEFAULT 3;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'requested_documents_last_reminder_date'
          ) THEN
            ALTER TABLE clients ADD COLUMN requested_documents_last_reminder_date TIMESTAMP;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'aportar_documentacion'
          ) THEN
            ALTER TABLE clients ADD COLUMN aportar_documentacion JSONB;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'requerimiento'
          ) THEN
            ALTER TABLE clients ADD COLUMN requerimiento JSONB;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
              WHERE table_name = 'clients' AND column_name = 'resolucion'
          ) THEN
            ALTER TABLE clients ADD COLUMN resolucion JSONB;
          END IF;
          
          -- Add justificante_presentacion column if it doesn't exist
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'clients' AND column_name = 'justificante_presentacion'
          ) THEN
            ALTER TABLE clients ADD COLUMN justificante_presentacion JSONB;
          END IF;
        END $$;
      `);

      console.log('✅ PostgreSQL database initialized and tables created');
    } catch (error: any) {
      console.error('❌ Error initializing PostgreSQL:', error.message);
      console.error('Full error:', error);
      // Don't throw - fall back to file storage if database fails
      console.warn('⚠️ Falling back to file-based storage');
      this.usePostgres = false;
      this.pool = null;
      this.initFileStorage();
    }
  }

  private initFileStorage() {
    // Ensure directories exist
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    if (!existsSync(this.uploadsDir)) {
      mkdirSync(this.uploadsDir, { recursive: true });
    }

    // Load existing data
    this.loadData();
    console.log('✅ File-based storage initialized');
  }

  private loadData() {
    try {
      // Load templates
      if (existsSync(this.templatesFile)) {
        const templatesData = JSON.parse(readFileSync(this.templatesFile, 'utf-8'));
        if (Array.isArray(templatesData)) {
          templatesData.forEach((template: CaseTemplate) => {
            this.templates.set(template.id, template);
            const match = template.id.match(/template_(\d+)_/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > this.templateCounter) this.templateCounter = num;
            }
          });
        }
      }

      // Load clients
      if (existsSync(this.clientsFile)) {
        const clientsData = JSON.parse(readFileSync(this.clientsFile, 'utf-8'));
        if (Array.isArray(clientsData)) {
          clientsData.forEach((client: Client) => {
            this.clients.set(client.id, client);
            const match = client.id.match(/client_(\d+)_/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > this.clientCounter) this.clientCounter = num;
            }
          });
        }
      }

      // Load users
      if (existsSync(this.usersFile)) {
        const usersData = JSON.parse(readFileSync(this.usersFile, 'utf-8'));
        if (Array.isArray(usersData)) {
          usersData.forEach((user: User) => {
            this.users.set(user.id, user);
            const match = user.id.match(/user_(\d+)_/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > this.userCounter) this.userCounter = num;
            }
          });
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  private saveTemplates() {
    if (this.usePostgres) return; // PostgreSQL handles persistence automatically
    try {
      const templatesArray = Array.from(this.templates.values());
      writeFileSync(this.templatesFile, JSON.stringify(templatesArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving templates:', error);
    }
  }

  private saveClients() {
    if (this.usePostgres) return; // PostgreSQL handles persistence automatically
    try {
      const clientsArray = Array.from(this.clients.values());
      writeFileSync(this.clientsFile, JSON.stringify(clientsArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving clients:', error);
    }
  }

  private saveUsers() {
    if (this.usePostgres) return; // PostgreSQL handles persistence automatically
    try {
      const usersArray = Array.from(this.users.values());
      writeFileSync(this.usersFile, JSON.stringify(usersArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving users:', error);
    }
  }

  getUploadsDir(): string {
    // For Railway, use /data/uploads (Railway Volume mount point)
    // For local, use relative path
    let uploadsPath: string;
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
      uploadsPath = join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads');
    } else {
      uploadsPath = this.uploadsDir;
    }
    
    // Ensure directory exists
    if (!existsSync(uploadsPath)) {
      mkdirSync(uploadsPath, { recursive: true });
    }
    
    return uploadsPath;
  }

  // Templates
  async insertTemplate(data: Omit<CaseTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<CaseTemplate> {
    await this.ensureInitialized();
    const id = `template_${++this.templateCounter}_${Date.now()}`;
    const now = new Date().toISOString();
    const template: CaseTemplate = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
    };

    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO case_templates (id, name, description, required_documents, reminder_interval_days, administrative_silence_days, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          template.id,
          template.name,
          template.description || null,
          JSON.stringify(template.required_documents),
          template.reminder_interval_days,
          template.administrative_silence_days,
          template.created_at,
          template.updated_at,
        ]
      );
    } else {
      this.templates.set(id, template);
      this.saveTemplates();
    }

    return template;
  }

  async getTemplates(): Promise<CaseTemplate[]> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM case_templates ORDER BY created_at DESC');
      return result.rows.map((row: any) => ({
        ...row,
        required_documents: typeof row.required_documents === 'string' 
          ? JSON.parse(row.required_documents) 
          : row.required_documents,
      }));
    }
    return Array.from(this.templates.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getTemplate(id: string): Promise<CaseTemplate | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM case_templates WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        ...row,
        required_documents: typeof row.required_documents === 'string' 
          ? JSON.parse(row.required_documents) 
          : row.required_documents,
      };
    }
    return this.templates.get(id) || null;
  }

  async updateTemplate(id: string, data: Partial<CaseTemplate>): Promise<CaseTemplate | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        values.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${paramCount++}`);
        values.push(data.description);
      }
      if (data.required_documents !== undefined) {
        updates.push(`required_documents = $${paramCount++}`);
        values.push(JSON.stringify(data.required_documents));
      }
      if (data.reminder_interval_days !== undefined) {
        updates.push(`reminder_interval_days = $${paramCount++}`);
        values.push(data.reminder_interval_days);
      }
      if (data.administrative_silence_days !== undefined) {
        updates.push(`administrative_silence_days = $${paramCount++}`);
        values.push(data.administrative_silence_days);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      await this.pool.query(
        `UPDATE case_templates SET ${updates.join(', ')} WHERE id = $${paramCount}`,
        values
      );

      return this.getTemplate(id);
    }

    const template = this.templates.get(id);
    if (!template) return null;
    const updated = { ...template, ...data, updated_at: new Date().toISOString() };
    this.templates.set(id, updated);
    this.saveTemplates();
    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('DELETE FROM case_templates WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    }

    const deleted = this.templates.delete(id);
    if (deleted) {
      this.saveTemplates();
    }
    return deleted;
  }

  // Clients
  async insertClient(data: Omit<Client, 'id' | 'created_at' | 'updated_at'>): Promise<Client> {
    await this.ensureInitialized();
    const id = `client_${++this.clientCounter}_${Date.now()}`;
    const now = new Date().toISOString();
    const client: Client = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
    };

    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO clients (id, first_name, last_name, parent_name, email, phone, case_template_id, case_type, details,
         required_documents, reminder_interval_days, administrative_silence_days, payment, 
         submitted_to_immigration, application_date, custom_reminder_date, notifications, additional_docs_required, 
         notes, additional_documents, requested_documents,          requested_documents_reminder_duration_days, 
         requested_documents_reminder_interval_days, requested_documents_last_reminder_date, 
         aportar_documentacion, requerimiento, resolucion, justificante_presentacion, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
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
          JSON.stringify(client.required_documents),
          client.reminder_interval_days,
          client.administrative_silence_days,
          JSON.stringify(client.payment),
          client.submitted_to_immigration,
          client.application_date || null,
          client.custom_reminder_date || null,
          JSON.stringify(client.notifications),
          client.additional_docs_required,
          client.notes || null,
          JSON.stringify(client.additional_documents || []),
          JSON.stringify((client as any).requested_documents || []),
          (client as any).requested_documents_reminder_duration_days || 10,
          (client as any).requested_documents_reminder_interval_days || 3,
          (client as any).requested_documents_last_reminder_date || null,
          JSON.stringify((client as any).aportar_documentacion || []),
          JSON.stringify((client as any).requerimiento || []),
          JSON.stringify((client as any).resolucion || []),
          JSON.stringify((client as any).justificante_presentacion || []),
          client.created_at,
          client.updated_at,
        ]
      );
    } else {
      this.clients.set(id, client);
      this.saveClients();
    }

    return client;
  }

  async getClients(): Promise<Client[]> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM clients ORDER BY created_at DESC');
      return result.rows.map((row: any) => this.parseClientRow(row));
    }
    return Array.from(this.clients.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getClient(id: string): Promise<Client | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      return this.parseClientRow(result.rows[0]);
    }
    return this.clients.get(id) || null;
  }

  private parseClientRow(row: any): Client {
    return {
      ...row,
      required_documents: typeof row.required_documents === 'string' 
        ? JSON.parse(row.required_documents) 
        : row.required_documents,
      payment: typeof row.payment === 'string' 
        ? JSON.parse(row.payment) 
        : row.payment,
      notifications: typeof row.notifications === 'string' 
        ? JSON.parse(row.notifications) 
        : row.notifications,
      additional_documents: typeof row.additional_documents === 'string' 
        ? JSON.parse(row.additional_documents) 
        : row.additional_documents,
      requested_documents: typeof row.requested_documents === 'string' 
        ? JSON.parse(row.requested_documents) 
        : (row.requested_documents || []),
      requested_documents_reminder_duration_days: row.requested_documents_reminder_duration_days || 10,
      requested_documents_reminder_interval_days: row.requested_documents_reminder_interval_days || 3,
      requested_documents_last_reminder_date: row.requested_documents_last_reminder_date 
        ? row.requested_documents_last_reminder_date.toISOString() 
        : undefined,
      aportar_documentacion: typeof row.aportar_documentacion === 'string' 
        ? JSON.parse(row.aportar_documentacion) 
        : (row.aportar_documentacion || []),
      requerimiento: typeof row.requerimiento === 'string' 
        ? JSON.parse(row.requerimiento) 
        : (row.requerimiento || []),
      resolucion: typeof row.resolucion === 'string' 
        ? JSON.parse(row.resolucion) 
        : (row.resolucion || []),
      justificante_presentacion: typeof row.justificante_presentacion === 'string' 
        ? JSON.parse(row.justificante_presentacion) 
        : (row.justificante_presentacion || []),
      application_date: row.application_date ? row.application_date.toISOString() : undefined,
      custom_reminder_date: row.custom_reminder_date ? row.custom_reminder_date.toISOString() : undefined,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  async updateClient(id: string, data: Partial<Client>): Promise<Client | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      const fields: { [key: string]: any } = {
        first_name: data.first_name,
        last_name: data.last_name,
        parent_name: data.parent_name,
        email: data.email,
        phone: data.phone,
        case_template_id: data.case_template_id,
        case_type: data.case_type,
        details: data.details,
        required_documents: data.required_documents,
        reminder_interval_days: data.reminder_interval_days,
        administrative_silence_days: data.administrative_silence_days,
        payment: data.payment,
        submitted_to_immigration: data.submitted_to_immigration,
        application_date: data.application_date,
        custom_reminder_date: data.custom_reminder_date,
        notifications: data.notifications,
        additional_docs_required: data.additional_docs_required,
        notes: data.notes,
        additional_documents: data.additional_documents,
        requested_documents: (data as any).requested_documents,
        requested_documents_reminder_duration_days: (data as any).requested_documents_reminder_duration_days,
        requested_documents_reminder_interval_days: (data as any).requested_documents_reminder_interval_days,
        requested_documents_last_reminder_date: (data as any).requested_documents_last_reminder_date,
        aportar_documentacion: (data as any).aportar_documentacion,
        requerimiento: (data as any).requerimiento,
        resolucion: (data as any).resolucion,
        justificante_presentacion: (data as any).justificante_presentacion,
      };

      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          updates.push(`${key} = $${paramCount++}`);
          if (['required_documents', 'payment', 'notifications', 'additional_documents', 'requested_documents', 'aportar_documentacion', 'requerimiento', 'resolucion', 'justificante_presentacion'].includes(key)) {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      await this.pool.query(
        `UPDATE clients SET ${updates.join(', ')} WHERE id = $${paramCount}`,
        values
      );

      return this.getClient(id);
    }

    const client = this.clients.get(id);
    if (!client) return null;
    const updated = { ...client, ...data, updated_at: new Date().toISOString() };
    this.clients.set(id, updated);
    this.saveClients();
    return updated;
  }

  async deleteClient(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const client = await this.getClient(id);
    if (client) {
      // Delete associated files
      try {
        const { unlinkSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const uploadsDir = this.getUploadsDir();

        // Delete required document files
        if (client.required_documents) {
          for (const doc of client.required_documents) {
            if (doc.fileUrl && doc.fileUrl.startsWith('/uploads/')) {
              const filePath = join(uploadsDir, doc.fileUrl.replace('/uploads/', ''));
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
            }
          }
        }
        // Delete additional document files
        if (client.additional_documents) {
          for (const doc of client.additional_documents) {
            if (doc.fileUrl && doc.fileUrl.startsWith('/uploads/')) {
              const filePath = join(uploadsDir, doc.fileUrl.replace('/uploads/', ''));
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error deleting client files:', error);
      }
    }

    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('DELETE FROM clients WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    }

    const deleted = this.clients.delete(id);
    if (deleted) {
      this.saveClients();
    }
    return deleted;
  }

  // User management methods
  async insertUser(data: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    await this.ensureInitialized();
    const id = `user_${++this.userCounter}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const user: User = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
    };

    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO users (id, firebase_uid, email, name, role, active, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
      return user;
    }

    this.users.set(id, user);
    this.saveUsers();
    return user;
  }

  async getUsers(): Promise<User[]> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return result.rows.map((row: any) => ({
        id: row.id,
        firebase_uid: row.firebase_uid,
        email: row.email,
        name: row.name || undefined,
        role: row.role,
        active: row.active,
        created_by: row.created_by || undefined,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      }));
    }
    return Array.from(this.users.values());
  }

  async getUser(id: string): Promise<User | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        firebase_uid: row.firebase_uid,
        email: row.email,
        name: row.name || undefined,
        role: row.role,
        active: row.active,
        created_by: row.created_by || undefined,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
    }
    return this.users.get(id) || null;
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM users WHERE firebase_uid = $1', [firebaseUid]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        firebase_uid: row.firebase_uid,
        email: row.email,
        name: row.name || undefined,
        role: row.role,
        active: row.active,
        created_by: row.created_by || undefined,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
    }
    return Array.from(this.users.values()).find(u => u.firebase_uid === firebaseUid) || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        firebase_uid: row.firebase_uid,
        email: row.email,
        name: row.name || undefined,
        role: row.role,
        active: row.active,
        created_by: row.created_by || undefined,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
    }
    return Array.from(this.users.values()).find(u => u.email === email) || null;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 0;

      if (data.email !== undefined) {
        paramCount++;
        updates.push(`email = $${paramCount}`);
        values.push(data.email);
      }
      if (data.name !== undefined) {
        paramCount++;
        updates.push(`name = $${paramCount}`);
        values.push(data.name || null);
      }
      if (data.role !== undefined) {
        paramCount++;
        updates.push(`role = $${paramCount}`);
        values.push(data.role);
      }
      if (data.active !== undefined) {
        paramCount++;
        updates.push(`active = $${paramCount}`);
        values.push(data.active);
      }
      if (data.firebase_uid !== undefined) {
        paramCount++;
        updates.push(`firebase_uid = $${paramCount}`);
        values.push(data.firebase_uid);
      }

      if (updates.length === 0) {
        return this.getUser(id);
      }

      paramCount++;
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      await this.pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`,
        values
      );

      return this.getUser(id);
    }

    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...data, updated_at: new Date().toISOString() };
    this.users.set(id, updated);
    this.saveUsers();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    }
    const deleted = this.users.delete(id);
    if (deleted) {
      this.saveUsers();
    }
    return deleted;
  }

  // Settings methods
  async getSetting(key: string): Promise<string | null> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT value FROM settings WHERE key = $1', [key]);
      if (result.rows.length === 0) return null;
      return result.rows[0].value;
    }
    // For file-based storage, we'll use a simple JSON file
    const settingsFile = join(this.dataDir, 'settings.json');
    if (!existsSync(settingsFile)) return null;
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
      return settings[key] || null;
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: string, updatedBy?: string): Promise<void> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO settings (key, value, updated_by, updated_at) 
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET value = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP`,
        [key, value, updatedBy || null]
      );
    } else {
      // For file-based storage
      const settingsFile = join(this.dataDir, 'settings.json');
      let settings: Record<string, string> = {};
      if (existsSync(settingsFile)) {
        try {
          settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
        } catch {
          settings = {};
        }
      }
      settings[key] = value;
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
    }
  }

  // Reminders methods
  async insertReminder(reminder: {
    client_id?: string;
    client_name: string;
    client_surname: string;
    phone?: string;
    reminder_date: string;
    notes?: string;
    reminder_type?: string;
  }): Promise<any> {
    await this.ensureInitialized();
    const id = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO reminders (id, client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          reminder.client_id || null,
          reminder.client_name,
          reminder.client_surname,
          reminder.phone || null,
          reminder.reminder_date,
          reminder.notes || null,
          reminder.reminder_type || null,
          now,
          now,
        ]
      );
    } else {
      // File-based storage
      const remindersFile = join(this.dataDir, 'reminders.json');
      let reminders: any[] = [];
      if (existsSync(remindersFile)) {
        try {
          reminders = JSON.parse(readFileSync(remindersFile, 'utf-8'));
        } catch {
          reminders = [];
        }
      }
      const newReminder = {
        id,
        ...reminder,
        created_at: now,
        updated_at: now,
      };
      reminders.push(newReminder);
      writeFileSync(remindersFile, JSON.stringify(reminders, null, 2), 'utf-8');
    }

    return {
      id,
      ...reminder,
      created_at: now,
      updated_at: now,
    };
  }

  async getReminders(): Promise<any[]> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('SELECT * FROM reminders ORDER BY reminder_date ASC');
      return result.rows;
    } else {
      const remindersFile = join(this.dataDir, 'reminders.json');
      if (!existsSync(remindersFile)) return [];
      try {
        return JSON.parse(readFileSync(remindersFile, 'utf-8'));
      } catch {
        return [];
      }
    }
  }

  async updateReminder(id: string, reminder: {
    client_id?: string;
    client_name?: string;
    client_surname?: string;
    phone?: string;
    reminder_date?: string;
    notes?: string;
    reminder_type?: string;
  }): Promise<boolean> {
    await this.ensureInitialized();
    const now = new Date().toISOString();

    if (this.usePostgres && this.pool) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (reminder.client_id !== undefined) {
        updates.push(`client_id = $${paramIndex++}`);
        values.push(reminder.client_id);
      }
      if (reminder.client_name !== undefined) {
        updates.push(`client_name = $${paramIndex++}`);
        values.push(reminder.client_name);
      }
      if (reminder.client_surname !== undefined) {
        updates.push(`client_surname = $${paramIndex++}`);
        values.push(reminder.client_surname);
      }
      if (reminder.phone !== undefined) {
        updates.push(`phone = $${paramIndex++}`);
        values.push(reminder.phone || null);
      }
      if (reminder.reminder_date !== undefined) {
        updates.push(`reminder_date = $${paramIndex++}`);
        values.push(reminder.reminder_date);
      }
      if (reminder.notes !== undefined) {
        updates.push(`notes = $${paramIndex++}`);
        values.push(reminder.notes || null);
      }
      if (reminder.reminder_type !== undefined) {
        updates.push(`reminder_type = $${paramIndex++}`);
        values.push(reminder.reminder_type || null);
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(now);
      values.push(id);

      if (updates.length === 1) return false; // Only updated_at

      const query = `UPDATE reminders SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      const result = await this.pool.query(query, values);
      return (result.rowCount ?? 0) > 0;
    } else {
      const remindersFile = join(this.dataDir, 'reminders.json');
      if (!existsSync(remindersFile)) return false;
      try {
        const reminders = JSON.parse(readFileSync(remindersFile, 'utf-8'));
        const index = reminders.findIndex((r: any) => r.id === id);
        if (index === -1) return false;
        reminders[index] = {
          ...reminders[index],
          ...reminder,
          updated_at: now,
        };
        writeFileSync(remindersFile, JSON.stringify(reminders, null, 2), 'utf-8');
        return true;
      } catch {
        return false;
      }
    }
  }

  async deleteReminder(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (this.usePostgres && this.pool) {
      const result = await this.pool.query('DELETE FROM reminders WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    } else {
      const remindersFile = join(this.dataDir, 'reminders.json');
      if (!existsSync(remindersFile)) return false;
      try {
        const reminders = JSON.parse(readFileSync(remindersFile, 'utf-8'));
        const filtered = reminders.filter((r: any) => r.id !== id);
        if (filtered.length === reminders.length) return false;
        writeFileSync(remindersFile, JSON.stringify(filtered, null, 2), 'utf-8');
        return true;
      } catch {
        return false;
      }
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

export const db = new DatabaseAdapter();

