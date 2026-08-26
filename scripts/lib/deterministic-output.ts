import fs from 'node:fs';
import path from 'node:path';

type WriteFileOptions = BufferEncoding | { readonly encoding?: BufferEncoding };

function toBuffer(content: string | Buffer, encoding: BufferEncoding): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

/**
 * Writes exact deterministic bytes without assigning synthetic mtimes.
 * Identical existing output is left untouched
 */
export function writeDeterministicFile(
  filePath: string,
  content: string | Buffer,
  options?: WriteFileOptions,
): boolean {
  const encoding = typeof options === 'string'
    ? options
    : options && typeof options.encoding === 'string'
      ? options.encoding
      : 'utf8';
  const bytes = toBuffer(content, encoding);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(bytes)) return false;
  fs.writeFileSync(filePath, bytes);
  return true;
}
