import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TIMESTAMP_BASE_SECONDS = Math.floor(Date.UTC(2000, 0, 1) / 1000);
const CONTENT_TIMESTAMP_SPAN_SECONDS = 30 * 365 * 24 * 60 * 60;

type WriteFileOptions = BufferEncoding | { readonly encoding?: BufferEncoding };

function toBuffer(content: string | Buffer, encoding: BufferEncoding = 'utf8'): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

export function getContentTimestamp(
  content: string | Buffer,
  encoding: BufferEncoding = 'utf8',
): Date {
  const buffer = toBuffer(content, encoding);
  const digest = crypto.createHash('sha256').update(buffer).digest();
  const offsetSeconds = Number(digest.readBigUInt64BE(0) % BigInt(CONTENT_TIMESTAMP_SPAN_SECONDS));
  return new Date((CONTENT_TIMESTAMP_BASE_SECONDS + offsetSeconds) * 1000);
}

function setFileTimestamp(filePath: string, timestamp: Date): Date {
  fs.utimesSync(filePath, timestamp, timestamp);
  return timestamp;
}

export function setFileContentTimestamp(filePath: string): Date {
  const buffer = fs.readFileSync(filePath);
  return setFileTimestamp(filePath, getContentTimestamp(buffer));
}

export function writeFileWithContentTimestamp(
  filePath: string,
  content: string | Buffer,
  options?: WriteFileOptions,
): Date {
  const encoding = typeof options === 'string'
    ? options
    : options && typeof options.encoding === 'string'
      ? options.encoding
      : 'utf8';

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(filePath, content);
    return setFileTimestamp(filePath, getContentTimestamp(content));
  }

  fs.writeFileSync(filePath, content, options || encoding);
  return setFileTimestamp(filePath, getContentTimestamp(content, encoding));
}

export function normalizeTreeContentTimestamps(rootPath: string): number {
  if (!fs.existsSync(rootPath)) {
    return 0;
  }

  let updated = 0;
  const pending: string[] = [rootPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (currentPath === undefined) {
      break;
    }
    const stat = fs.statSync(currentPath);

    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(currentPath)) {
        pending.push(path.join(currentPath, name));
      }
      continue;
    }

    if (stat.isFile()) {
      setFileContentTimestamp(currentPath);
      updated += 1;
    }
  }

  return updated;
}

