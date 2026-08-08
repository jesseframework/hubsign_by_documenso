import { describe, expect, it } from 'vitest';

import {
  MAX_SUPPORTING_FILE_BYTES,
  sanitizeSupportingFileName,
  validateSupportingFile,
} from './supporting-file-types';

const bytes = (...values: number[]) => new Uint8Array([...values, ...Array(16).fill(0x20)]);

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const MZ_EXE = bytes(0x4d, 0x5a, 0x90, 0x00);
const TEXT = new Uint8Array([...'name,qty\n1,2\n'].map((c) => c.charCodeAt(0)));

const check = (fileName: string, declaredType: string, data: Uint8Array, size = 1024) =>
  validateSupportingFile({ fileName, declaredType, sizeBytes: size, bytes: data });

describe('validateSupportingFile — accepts intended business documents', () => {
  it.each([
    ['po.pdf', 'application/pdf', PDF],
    ['spec.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP],
    ['costs.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ZIP],
    ['legacy.doc', 'application/msword', OLE],
    ['legacy.xls', 'application/vnd.ms-excel', OLE],
    ['site.png', 'image/png', PNG],
    ['photo.jpg', 'image/jpeg', JPEG],
    ['data.csv', 'text/csv', TEXT],
  ])('accepts %s', (name, mime, data) => {
    expect(check(name, mime, data).ok).toBe(true);
  });

  it('trusts its own derived content type, not the browser claim', () => {
    const verdict = check('po.pdf', 'application/pdf', PDF);

    expect(verdict).toMatchObject({ ok: true, contentType: 'application/pdf' });
  });
});

describe('validateSupportingFile — refuses executables and archives', () => {
  it.each([
    'malware.exe',
    'script.js',
    'run.sh',
    'installer.msi',
    'macro.docm',
    'link.lnk',
    'lib.dll',
    'app.bat',
    'archive.zip',
    'archive.rar',
    'archive.7z',
    'archive.tar',
    'archive.gz',
  ])('refuses %s by extension', (name) => {
    const verdict = check(name, 'application/octet-stream', PDF);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/aren't accepted/);
  });

  it('refuses an executable renamed to .pdf — the rename attack', () => {
    // Extension and MIME both look fine; only the magic bytes give it away.
    const verdict = check('invoice.pdf', 'application/pdf', MZ_EXE);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/may have been renamed/);
  });

  it('refuses a zip renamed to .pdf', () => {
    expect(check('invoice.pdf', 'application/pdf', ZIP).ok).toBe(false);
  });

  it('refuses binary content masquerading as .csv', () => {
    const verdict = check('data.csv', 'text/csv', MZ_EXE);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/doesn't look like a text/);
  });

  it('refuses a mismatched declared type', () => {
    const verdict = check('photo.png', 'application/pdf', PNG);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/doesn't match its/);
  });

  it('refuses a file with no extension', () => {
    expect(check('attachment', 'application/pdf', PDF).ok).toBe(false);
  });
});

describe('validateSupportingFile — size', () => {
  it('refuses an empty file', () => {
    expect(check('po.pdf', 'application/pdf', PDF, 0).ok).toBe(false);
  });

  it('refuses anything over the cap', () => {
    const verdict = check('po.pdf', 'application/pdf', PDF, MAX_SUPPORTING_FILE_BYTES + 1);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/or smaller/);
  });

  it('accepts exactly the cap', () => {
    expect(check('po.pdf', 'application/pdf', PDF, MAX_SUPPORTING_FILE_BYTES).ok).toBe(true);
  });
});

describe('sanitizeSupportingFileName', () => {
  it('strips path traversal and drive prefixes', () => {
    expect(sanitizeSupportingFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeSupportingFileName('C:\\Users\\evil\\invoice.pdf')).toBe('invoice.pdf');
  });

  it('removes characters that would break a Content-Disposition header', () => {
    expect(sanitizeSupportingFileName('in"voice;\r\nname.pdf')).toBe('invoicename.pdf');
  });

  it('never returns an empty name', () => {
    expect(sanitizeSupportingFileName('   ')).toBe('attachment');
    expect(sanitizeSupportingFileName('"')).toBe('attachment');
  });

  it('caps absurd lengths', () => {
    expect(sanitizeSupportingFileName('a'.repeat(500)).length).toBe(200);
  });
});
