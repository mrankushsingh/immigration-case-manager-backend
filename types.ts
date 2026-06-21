export interface RequiredDocument {
  code?: string;
  name: string;
  description?: string;
  submitted?: boolean;
  fileUrl?: string;
  uploadedAt?: string;
  fileName?: string;
  fileSize?: number;
  isOptional?: boolean;
  uploadedBy?: string;
  expiryCheck?: boolean | 'depends';
  translationRequired?: boolean | 'depends';
  apostilleRequired?: boolean | 'depends';
}
