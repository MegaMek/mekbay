// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {
  setFileContentTimestamp,
  writeFileWithContentTimestamp,
} from './lib/deterministic-output';
import { loadOptionalEnvFile, resolveMmDataRoot } from './lib/script-paths';

const root = path.resolve(__dirname, '..');

loadOptionalEnvFile(root, { logPrefix: 'Compress' });

const mmDataRoot = resolveMmDataRoot(root, { allowMissing: true });
const unitIconsDir = path.join(mmDataRoot, 'data/images/units');

console.log(`[Compress] Using MM data from: ${mmDataRoot}`);
console.log(`[Compress] Using unit icons from: ${unitIconsDir}`);

const unitIconsOutputZip = path.join(root, 'public', 'zip', 'unitIcons.zip');
const fixedDate = new Date('1984-01-01T00:00:00Z');

interface FileCounter {
  count: number;
}

function addDirectoryToZip(
  zip: JSZip,
  dirPath: string,
  rootPath: string,
  counter: FileCounter,
): void {
  // Sort files to ensure deterministic order (important for the hash)
  const files = fs.readdirSync(dirPath).sort();

  files.forEach(file => {
    // Ignore hidden files and system files that might change automatically
    if (file.startsWith('.') || file === 'Thumbs.db' || file === 'Desktop.ini') {
      return;
    }

    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      const relativePath = path.relative(rootPath, fullPath).split(path.sep).join('/');
      
      // Explicitly add directory entry with fixed timestamp to ensure determinism
      zip.file(relativePath + '/', null, {
        dir: true,
        date: fixedDate,
        unixPermissions: "755"
      });

      addDirectoryToZip(zip, fullPath, rootPath, counter);
    } else {
      const relativePath = path.relative(rootPath, fullPath).split(path.sep).join('/');
      
      const data = fs.readFileSync(fullPath);
      // Use a fixed date to ensure deterministic zip generation regardless of file modification time
      zip.file(relativePath, data, { 
          date: fixedDate,
          unixPermissions: "644"
      });
      counter.count++;
    }
  });
}

async function compress(): Promise<void> {
  if (!fs.existsSync(unitIconsDir)) {
    console.log(`[Compress] Source directory not found: ${unitIconsDir}`);
    console.log(`[Compress] Please check MM_DATA_PATH in .env or environment variables.`);
    return;
  }

  // Ensure output directory exists
  const outputDir = path.dirname(unitIconsOutputZip);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('[Compress] Starting compression of unit icons...');
  const zip = new JSZip();
  const counter = { count: 0 };

  addDirectoryToZip(zip, unitIconsDir, unitIconsDir, counter);

  if (counter.count === 0) {
    console.log('[Compress] No files found to compress.');
    return;
  }

  return new Promise<void>((resolve, reject) => {
    zip.generateNodeStream({ 
        type: 'nodebuffer', 
        streamFiles: true, 
        compression: 'DEFLATE', 
        compressionOptions: { level: 6 } 
    })
      .pipe(fs.createWriteStream(unitIconsOutputZip))
      .on('finish', () => {
        setFileContentTimestamp(unitIconsOutputZip);
        const size = (fs.statSync(unitIconsOutputZip).size / 1024 / 1024).toFixed(2);
        
        // Generate SHA256 hash
        const fileBuffer = fs.readFileSync(unitIconsOutputZip);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');
        
        // Create unitIcons.zip.sha256 adjacent to unitIcons.zip
        const hashFile = unitIconsOutputZip + '.sha256';
        writeFileWithContentTimestamp(hashFile, hex);

        console.log(`[Compress] Created ${unitIconsOutputZip} (${size} MB) with ${counter.count} files.`);
        console.log(`[Compress] Generated hash: ${hex}`);
        resolve();
      })
      .on('error', (error: Error) => reject(error));
  });
}

compress().catch(err => {
  console.error('[Compress] Error:', err);
  process.exit(1);
});
