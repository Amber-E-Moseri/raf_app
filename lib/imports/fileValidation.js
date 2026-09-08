import { ImportHttpError } from './shared.js';

const EXECUTABLE_SIGNATURES = [
  { label: 'Windows executable', bytes: [0x4d, 0x5a] },
  { label: 'ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'Mach-O executable', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'Mach-O executable', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { label: 'Mach-O executable', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: 'Mach-O executable', bytes: [0xce, 0xfa, 0xed, 0xfe] },
];

function startsWithBytes(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(String(value ?? ''));
}

export function sanitizeFilename(filename) {
  const basename = String(filename ?? '')
    .trim()
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) ?? 'statement';
  return basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
    || 'statement';
}

export function assertNotExecutableContent(content) {
  const bytes = toBytes(content);
  const match = EXECUTABLE_SIGNATURES.find((signature) => startsWithBytes(bytes, signature.bytes));
  if (match) {
    throw new ImportHttpError(400, 'uploaded file content is not a supported statement format');
  }
}

export function assertPdfContent(pdfBuffer) {
  const bytes = toBytes(pdfBuffer);
  if (bytes.length === 0) {
    throw new ImportHttpError(400, 'uploaded file is empty');
  }

  assertNotExecutableContent(bytes);
  const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
  if (header !== '%PDF-') {
    throw new ImportHttpError(400, 'uploaded PDF content is invalid');
  }
}

export function assertCsvContent(text) {
  const value = String(text ?? '');
  if (value.length === 0 || value.trim().length === 0) {
    throw new ImportHttpError(400, 'uploaded file is empty');
  }

  assertNotExecutableContent(value);
  if (value.includes('\u0000') || value.includes('\ufffd')) {
    throw new ImportHttpError(400, 'uploaded CSV content is binary or not valid text');
  }

  const invalidControl = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  if (invalidControl) {
    throw new ImportHttpError(400, 'uploaded CSV content contains unsupported binary control characters');
  }

  const firstNonEmptyLine = value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  if (!firstNonEmptyLine.includes(',')) {
    throw new ImportHttpError(400, 'CSV header row must contain at least two columns');
  }
}
