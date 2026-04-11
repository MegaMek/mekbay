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
const yaml = require('js-yaml');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

// Load .env file if it exists to support local configuration overrides
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let value = parts.slice(1).join('=').trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
    console.log(`[Assets] Loaded configuration from ${envPath}`);
  } catch (e) {
    console.warn('[Assets] Failed to parse .env file:', e.message);
  }
}

// Configuration:
// MM_DATA_PATH can be set in .env or environment variables.
// Default assumes mm-data is located at ../mm-data relative to this project root.
const mmDataPath = process.env.MM_DATA_PATH || '../mm-data';
const sourcebooksDir = path.resolve(root, mmDataPath, 'data/sourcebooks');
const sourcebooksOutput = path.join(root, 'public', 'assets', 'sourcebooks.json');

console.log(`[Assets] Using sourcebooks from: ${sourcebooksDir}`);

function generateSourcebooks() {
  if (!fs.existsSync(sourcebooksDir)) {
    console.log(`[Assets] Sourcebooks directory not found: ${sourcebooksDir}`);
    console.log(`[Assets] Please check MM_DATA_PATH in .env or environment variables.`);
    return;
  }

  const files = fs.readdirSync(sourcebooksDir).filter(f => f.endsWith('.yaml'));
  const sourcebooks = [];

  for (const file of files) {
    try {
      const filePath = path.join(sourcebooksDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = yaml.load(content);

      if (data && data.abbrev) {
        sourcebooks.push({
          id: data.id,
          sku: data.sku || '',
          abbrev: data.abbrev,
          title: data.title || data.abbrev,
          image: data.image || undefined,
          url: data.url || undefined,
          mul_url: data.mul_url || undefined
        });
      }
    } catch (e) {
      console.warn(`[Assets] Failed to parse ${file}: ${e.message}`);
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(sourcebooksOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(sourcebooksOutput, JSON.stringify(sourcebooks, null, 2));
  console.log(`[Assets] Generated ${sourcebooksOutput} with ${sourcebooks.length} sourcebooks.`);
}

// function runCompressAssets() {
//   return new Promise((resolve, reject) => {
//     const compressScript = path.join(__dirname, 'compress-assets.js');
    
//     if (!fs.existsSync(compressScript)) {
//       console.log('[Assets] compress-assets.js not found, skipping compression.');
//       resolve();
//       return;
//     }

//     console.log('[Assets] Running compress-assets.js...');
//     const child = spawn('node', [compressScript], { 
//       stdio: 'inherit',
//       cwd: root
//     });

//     child.on('close', (code) => {
//       if (code === 0) {
//         resolve();
//       } else {
//         reject(new Error(`compress-assets.js exited with code ${code}`));
//       }
//     });

//     child.on('error', (err) => {
//       reject(err);
//     });
//   });
// }

async function main() {
  try {
    generateSourcebooks();
    // await runCompressAssets();
    console.log('[Assets] All asset generation complete.');
  } catch (err) {
    console.error('[Assets] Error:', err);
    process.exit(1);
  }
}

main();