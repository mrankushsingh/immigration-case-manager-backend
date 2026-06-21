import { sanitizeString, sanitizeEmail, sanitizePhone, sanitizeText } from './sanitize.js';

const ALLOWED_FIELDS = new Set([
  'first_name',
  'last_name',
  'parent_name',
  'email',
  'phone',
  'case_template_id',
  'case_type',
  'details',
  'required_documents',
  'reminder_interval_days',
  'administrative_silence_days',
  'payment',
  'submitted_to_immigration',
  'application_date',
  'custom_reminder_date',
  'notifications',
  'additional_docs_required',
  'notes',
  'additional_documents',
  'requested_documents',
  'requested_documents_reminder_duration_days',
  'requested_documents_reminder_interval_days',
  'requested_documents_last_reminder_date',
  'aportar_documentacion',
  'requerimiento',
  'resolucion',
  'justificante_presentacion',
  'recurso_in_appeals_box',
  'replacePayments',
]);

const CAMEL_TO_SNAKE: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  parentName: 'parent_name',
  caseTemplateId: 'case_template_id',
  caseType: 'case_type',
  requiredDocuments: 'required_documents',
  reminderIntervalDays: 'reminder_interval_days',
  administrativeSilenceDays: 'administrative_silence_days',
  submittedToImmigration: 'submitted_to_immigration',
  applicationDate: 'application_date',
  customReminderDate: 'custom_reminder_date',
  additionalDocsRequired: 'additional_docs_required',
  additionalDocuments: 'additional_documents',
  requestedDocuments: 'requested_documents',
  requestedDocumentsReminderDurationDays: 'requested_documents_reminder_duration_days',
  requestedDocumentsReminderIntervalDays: 'requested_documents_reminder_interval_days',
  requestedDocumentsLastReminderDate: 'requested_documents_last_reminder_date',
  aportarDocumentacion: 'aportar_documentacion',
  justificantePresentacion: 'justificante_presentacion',
  recursoInAppealsBox: 'recurso_in_appeals_box',
};

function normalizeFieldName(key: string): string {
  return CAMEL_TO_SNAKE[key] || key;
}

function optionalString(value: unknown, sanitizer: (v: string) => string): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return undefined;
  const sanitized = sanitizer(String(value));
  return sanitized || undefined;
}

function optionalNullableString(
  value: unknown,
  sanitizer: (v: string) => string
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return sanitizer(String(value)) || null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true';
}

function optionalIsoDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
  return date.toISOString();
}

function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(num);
}

function optionalArray(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('Expected an array');
  }
  return value;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}

export function parseClientUpdateBody(raw: unknown): { data: Record<string, unknown>; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: {}, error: 'Invalid request body' };
  }

  const body = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    const field = normalizeFieldName(key);
    if (!ALLOWED_FIELDS.has(field)) continue;
    normalized[field] = value;
  }

  if (Object.keys(normalized).length === 0) {
    return { data: {}, error: 'No valid fields to update' };
  }

  try {
    const data: Record<string, unknown> = {};

    if (normalized.first_name !== undefined) {
      const first = sanitizeString(String(normalized.first_name));
      if (!first) return { data: {}, error: 'First name must be a non-empty string' };
      data.first_name = first;
    }
    if (normalized.last_name !== undefined) {
      const last = sanitizeString(String(normalized.last_name));
      if (!last) return { data: {}, error: 'Last name must be a non-empty string' };
      data.last_name = last;
    }
    if (normalized.parent_name !== undefined) {
      data.parent_name = optionalNullableString(normalized.parent_name, sanitizeString);
    }
    if (normalized.email !== undefined) {
      const email = optionalString(normalized.email, sanitizeEmail);
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return { data: {}, error: 'Invalid email format' };
        }
      }
      data.email = email;
    }
    if (normalized.phone !== undefined) {
      data.phone = optionalNullableString(normalized.phone, sanitizePhone);
    }
    if (normalized.case_template_id !== undefined) {
      if (normalized.case_template_id === null || normalized.case_template_id === '') {
        data.case_template_id = null;
      } else {
        data.case_template_id = sanitizeString(String(normalized.case_template_id));
      }
    }
    if (normalized.case_type !== undefined) {
      data.case_type = optionalNullableString(normalized.case_type, sanitizeString);
    }
    if (normalized.details !== undefined) {
      data.details = optionalNullableString(normalized.details, sanitizeText);
    }
    if (normalized.notes !== undefined) {
      data.notes = optionalNullableString(normalized.notes, sanitizeText);
    }
    if (normalized.required_documents !== undefined) {
      data.required_documents = optionalArray(normalized.required_documents);
    }
    if (normalized.additional_documents !== undefined) {
      data.additional_documents = optionalArray(normalized.additional_documents);
    }
    if (normalized.requested_documents !== undefined) {
      data.requested_documents = optionalArray(normalized.requested_documents);
    }
    if (normalized.aportar_documentacion !== undefined) {
      data.aportar_documentacion = optionalArray(normalized.aportar_documentacion);
    }
    if (normalized.requerimiento !== undefined) {
      data.requerimiento = optionalArray(normalized.requerimiento);
    }
    if (normalized.resolucion !== undefined) {
      data.resolucion = optionalArray(normalized.resolucion);
    }
    if (normalized.justificante_presentacion !== undefined) {
      data.justificante_presentacion = optionalArray(normalized.justificante_presentacion);
    }
    if (normalized.notifications !== undefined) {
      data.notifications = optionalArray(normalized.notifications);
    }
    if (normalized.payment !== undefined) {
      data.payment = optionalObject(normalized.payment);
    }
    if (normalized.reminder_interval_days !== undefined) {
      data.reminder_interval_days = optionalPositiveInt(
        normalized.reminder_interval_days,
        'reminder_interval_days'
      );
    }
    if (normalized.administrative_silence_days !== undefined) {
      data.administrative_silence_days = optionalPositiveInt(
        normalized.administrative_silence_days,
        'administrative_silence_days'
      );
    }
    if (normalized.requested_documents_reminder_duration_days !== undefined) {
      data.requested_documents_reminder_duration_days = optionalPositiveInt(
        normalized.requested_documents_reminder_duration_days,
        'requested_documents_reminder_duration_days'
      );
    }
    if (normalized.requested_documents_reminder_interval_days !== undefined) {
      data.requested_documents_reminder_interval_days = optionalPositiveInt(
        normalized.requested_documents_reminder_interval_days,
        'requested_documents_reminder_interval_days'
      );
    }
    if (normalized.submitted_to_immigration !== undefined) {
      data.submitted_to_immigration = optionalBoolean(normalized.submitted_to_immigration);
    }
    if (normalized.additional_docs_required !== undefined) {
      data.additional_docs_required = optionalBoolean(normalized.additional_docs_required);
    }
    if (normalized.recurso_in_appeals_box !== undefined) {
      data.recurso_in_appeals_box = optionalBoolean(normalized.recurso_in_appeals_box);
    }
    if (normalized.application_date !== undefined) {
      data.application_date = optionalIsoDate(normalized.application_date);
    }
    if (normalized.custom_reminder_date !== undefined) {
      data.custom_reminder_date = optionalIsoDate(normalized.custom_reminder_date);
    }
    if (normalized.requested_documents_last_reminder_date !== undefined) {
      data.requested_documents_last_reminder_date = optionalIsoDate(
        normalized.requested_documents_last_reminder_date
      );
    }
    if (normalized.replacePayments !== undefined && normalized.payment !== undefined) {
      data.replacePayments = normalized.replacePayments === true;
    }

    return { data };
  } catch (error: any) {
    return { data: {}, error: error.message || 'Invalid update payload' };
  }
}
