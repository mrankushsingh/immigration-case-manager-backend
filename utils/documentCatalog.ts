/**
 * Standard immigration document names (from case templates) and OCR phrases
 * commonly found on scanned PDFs for each document type.
 */

export const PREDEFINED_DOCUMENT_NAMES = [
  'Pasaporte en vigor',
  'Copia completa del pasaporte',
  'Pasaporte anterior',
  'Tarjeta de residencia TIE',
  'Certificado histórico de empadronamiento',
  'Certificado de convivencia',
  'Certificado histórico de convivencia',
  'Certificación de haber superado estudios',
  'Acreditación de capacitación profesional',
  'Titulación homologada',
  'Certificado de antecedentes penales',
  'Certificado de antecedentes penales del país de origen',
  'Certificado médico',
  'Documentación acreditativa de permanencia en España',
  'Seguro de salud público',
  'Seguro médico privado',
  'Informe de vida laboral',
  'Medios económicos del solicitante',
  'Extractos bancarios',
  'Contrato de trabajo',
  'Últimas seis nóminas',
  'Declaración IRPF',
  'Copia del DNI del ciudadano español',
  'Copia del pasaporte o DNI del ciudadano UE',
  'Certificado de registro de ciudadano UE (NIE verde)',
  'Fe de vida y estado',
  'Sentencia firme de divorcio',
  'Escritura de constitución de pareja estable',
  'Inscripción en el Registro de Parejas Estables de Cataluña',
  'Certificado de matrimonio',
  'Certificado de nacimiento del hijo',
  'Certificado de nacimiento (ascendientes o descendientes)',
  'Autorización del otro progenitor',
  'Libro de familia',
  'Documentación acreditativa de parentesco',
  'Documentación acreditativa de estar a cargo',
  'Documentación acreditativa de grado de dependencia',
  'Volante de empadronamiento del solicitante y pareja',
  'Contrato de trabajo firmado por ambas partes',
  'Copia del DNI o TIE del empleador',
  'Certificado de convivencia del empleador',
  'Acreditación de solvencia económica del empleador',
  'Declaración IRPF del empleador',
  'Declaración trimestral del IVA del empleador',
  'Certificado de estar al corriente en Seguridad Social',
  'Certificado de estar al corriente en Agencia Tributaria',
  'Certificado bancario de saldo',
  'Alta de autónomos (Seguridad Social y AEAT)',
  'Declaraciones IVA',
  'Tres últimas nóminas',
  'Memoria descriptiva de la ocupación',
  'Otra documentación del despacho',
] as const;

/** Phrases often visible on scanned pages (Spanish / English) */
export const OCR_PHRASE_HINTS: Record<string, string[]> = {
  passport: [
    'pasaporte', 'passport', 'passaport', 'republica', 'republic of', 'nationality',
    'nacionalidad', 'date of birth', 'fecha de nacimiento', 'p<', 'tipo p',
  ],
  passport_copy: ['pasaporte', 'passport', 'copia', 'pages', 'paginas'],
  tie: [
    'tarjeta de identidad de extranjero', 'tie', 'residencia', 'extranjero',
    'foreigner', 'número de soporte', 'numero de soporte',
  ],
  nie: [
    'nie', 'certificado de registro', 'ciudadano de la unión', 'green certificate',
    'certificado de ciudadano', 'inscripcion en el registro central',
  ],
  dni: [
    'documento nacional de identidad', 'dni', 'reino de espana', 'reino de españa',
    'ministerio del interior', 'identidad',
  ],
  empadronamiento: [
    'empadronamiento', 'padron', 'padrón', 'ayuntamiento', 'hoja de inscripcion',
    'volante de empadronamiento', 'certificado historico',
  ],
  convivencia: ['convivencia', 'cohabitacion', 'cohabitación', 'certificado de convivencia'],
  criminal_record: [
    'antecedentes penales', 'criminal record', 'certificado negativo',
    'registro central de penados', 'ministerio de justicia',
  ],
  medical: ['certificado medico', 'certificado médico', 'medical certificate', 'aptitud'],
  health_insurance: ['seguro de salud', 'seguro medico', 'health insurance', 'poliza'],
  work_contract: ['contrato de trabajo', 'employment contract', 'contrato indefinido', 'contrato temporal'],
  payslip: ['nomina', 'nómina', 'salario', 'devengos', 'empresa', 'nif', 'periodo de liquidacion'],
  tax: ['irpf', 'declaracion', 'declaración', 'renta', 'agencia tributaria', 'hacienda', 'modelo 100'],
  bank: ['extracto', 'cuenta', 'iban', 'saldo', 'movimientos', 'entidad bancaria', 'certificado bancario'],
  birth_certificate: ['nacimiento', 'birth', 'acta de nacimiento', 'registro civil'],
  marriage: ['matrimonio', 'marriage', 'registro civil', 'contrayentes'],
  divorce: ['divorcio', 'sentencia', 'separacion', 'separación'],
  family_book: ['libro de familia', 'family book'],
  education: ['titulacion', 'titulación', 'universidad', 'homologacion', 'homologación', 'estudios'],
  labor_report: ['vida laboral', 'tesoro publico', 'tesoro público', 'seguridad social', 'informe de situacion'],
  vat: ['iva', 'autoliquidacion', 'autoliquidación', 'modelo 303'],
  social_security: ['seguridad social', 'corriente de pago', 'estar al corriente'],
  authorization_parent: ['autorizacion', 'autorización', 'progenitor', 'menor'],
};

/** Link catalog categories to template document name substrings */
export const CATALOG_NAME_TO_CATEGORIES: Array<{ match: RegExp; categories: string[] }> = [
  { match: /pasaporte en vigor/i, categories: ['passport'] },
  { match: /copia completa del pasaporte/i, categories: ['passport_copy', 'passport'] },
  { match: /pasaporte anterior/i, categories: ['passport'] },
  { match: /tarjeta de residencia|tie/i, categories: ['tie'] },
  { match: /empadronamiento/i, categories: ['empadronamiento'] },
  { match: /convivencia/i, categories: ['convivencia'] },
  { match: /antecedentes penales/i, categories: ['criminal_record'] },
  { match: /certificado medico|certificado médico/i, categories: ['medical'] },
  { match: /seguro de salud|seguro medico|seguro médico/i, categories: ['health_insurance', 'medical'] },
  { match: /vida laboral/i, categories: ['labor_report'] },
  { match: /nominas|nóminas/i, categories: ['payslip'] },
  { match: /irpf/i, categories: ['tax'] },
  { match: /extracto|bancario|bancarios/i, categories: ['bank'] },
  { match: /\bdni\b/i, categories: ['dni'] },
  { match: /nie|ciudadano ue/i, categories: ['nie'] },
  { match: /matrimonio/i, categories: ['marriage'] },
  { match: /nacimiento/i, categories: ['birth_certificate'] },
  { match: /divorcio/i, categories: ['divorce'] },
  { match: /libro de familia/i, categories: ['family_book'] },
  { match: /contrato de trabajo/i, categories: ['work_contract'] },
  { match: /iva/i, categories: ['vat', 'tax'] },
  { match: /seguridad social/i, categories: ['social_security', 'labor_report'] },
  { match: /agencia tributaria/i, categories: ['tax'] },
  { match: /autorizacion del otro progenitor|autorización del otro progenitor/i, categories: ['authorization_parent'] },
];

export function getOcrCategoriesForDocName(docName: string): string[] {
  const categories = new Set<string>();
  for (const { match, categories: cats } of CATALOG_NAME_TO_CATEGORIES) {
    if (match.test(docName)) {
      cats.forEach((c) => categories.add(c));
    }
  }
  return [...categories];
}
