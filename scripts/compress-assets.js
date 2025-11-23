/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const unitIconsDir = path.join(root, 'public', 'images', 'units');
const unitIconsOutputZip = path.join(root, 'public', 'zip', 'unitIcons.zip');
const fixedDate = new Date('1984-01-01T00:00:00Z');

function addDirectoryToZip(zip, dirPath, rootPath, counter) {
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

async function compress() {
  if (!fs.existsSync(unitIconsDir)) {
    console.log(`[Compress] Source directory not found: ${unitIconsDir}`);
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

  return new Promise((resolve, reject) => {
    zip.generateNodeStream({ 
        type: 'nodebuffer', 
        streamFiles: true, 
        compression: 'DEFLATE', 
        compressionOptions: { level: 6 } 
    })
      .pipe(fs.createWriteStream(unitIconsOutputZip))
      .on('finish', () => {
        const size = (fs.statSync(unitIconsOutputZip).size / 1024 / 1024).toFixed(2);
        
        // Generate SHA256 hash
        const fileBuffer = fs.readFileSync(unitIconsOutputZip);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');
        
        // Create unitIcons.zip.sha256 adjacent to unitIcons.zip
        const hashFile = unitIconsOutputZip + '.sha256';
        fs.writeFileSync(hashFile, hex);

        console.log(`[Compress] Created ${unitIconsOutputZip} (${size} MB) with ${counter.count} files.`);
        console.log(`[Compress] Generated hash: ${hex}`);
        resolve();
      })
      .on('error', (err) => reject(err));
  });
}

compress().catch(err => {
  console.error('[Compress] Error:', err);
  process.exit(1);
});