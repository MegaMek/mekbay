const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTENT_TIMESTAMP_BASE_SECONDS = Math.floor(Date.UTC(2000, 0, 1) / 1000);
const CONTENT_TIMESTAMP_SPAN_SECONDS = 30 * 365 * 24 * 60 * 60;

function toBuffer(content, encoding = 'utf8') {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

function getContentTimestamp(content, encoding = 'utf8') {
  const buffer = toBuffer(content, encoding);
  const digest = crypto.createHash('sha256').update(buffer).digest();
  const offsetSeconds = Number(digest.readBigUInt64BE(0) % BigInt(CONTENT_TIMESTAMP_SPAN_SECONDS));
  return new Date((CONTENT_TIMESTAMP_BASE_SECONDS + offsetSeconds) * 1000);
}

function setFileTimestamp(filePath, timestamp) {
  fs.utimesSync(filePath, timestamp, timestamp);
  return timestamp;
}

function setFileContentTimestamp(filePath) {
  const buffer = fs.readFileSync(filePath);
  return setFileTimestamp(filePath, getContentTimestamp(buffer));
}

function writeFileWithContentTimestamp(filePath, content, options = undefined) {
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

function normalizeTreeContentTimestamps(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return 0;
  }

  let updated = 0;
  const pending = [rootPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
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

module.exports = {
  getContentTimestamp,
  normalizeTreeContentTimestamps,
  setFileContentTimestamp,
  writeFileWithContentTimestamp,
};