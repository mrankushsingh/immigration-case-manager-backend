// This file is kept for backward compatibility
// The actual implementation is now in database.ts
import { db } from './database.js';

// Backward compatibility export
// The actual implementation is in database.ts which supports both PostgreSQL and file storage
export const memoryDb = db;

