import { exec } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Encrypt a PDF buffer with a user password using `qpdf`. The resulting PDF
 * requires the password to open in any compliant PDF reader (Adobe, Preview,
 * browsers, etc.).
 *
 * Requires the `qpdf` system binary to be installed (apt-get install qpdf).
 *
 * @param pdf - The PDF bytes to encrypt
 * @param password - The user password (required to open the PDF)
 * @returns A new PDF buffer encrypted with the given password
 */
export const encryptPdfWithPassword = async (
  pdf: Buffer,
  password: string,
): Promise<Buffer> => {
  // qpdf rejects empty passwords
  if (!password || password.length === 0) {
    throw new Error('PDF lock password cannot be empty');
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'pdf-lock-'));
  const inputPath = path.join(tempDir, 'in.pdf');
  const outputPath = path.join(tempDir, 'out.pdf');

  try {
    await writeFile(inputPath, pdf);

    // qpdf --encrypt USER OWNER KEYLEN -- input output
    // Use the same password for user and owner, 256-bit AES key length.
    // The `--` separator ends the encryption flags.
    const cmd = [
      'qpdf',
      '--encrypt',
      escapeShellArg(password),
      escapeShellArg(password),
      '256',
      '--',
      escapeShellArg(inputPath),
      escapeShellArg(outputPath),
    ].join(' ');

    await execAsync(cmd);

    return await readFile(outputPath);
  } finally {
    // Best-effort cleanup
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

const escapeShellArg = (value: string): string => {
  // Wrap in single quotes and escape any embedded single quotes
  return `'${value.replace(/'/g, `'\\''`)}'`;
};
