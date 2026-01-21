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
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

// Load .env file if it exists
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
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
    console.log(`[SpriteMap] Loaded configuration from ${envPath}`);
  } catch (e) {
    console.warn('[SpriteMap] Failed to parse .env file:', e.message);
  }
}

const mmDataPath = process.env.MM_DATA_PATH || '../mm-data';
const unitIconsDir = path.resolve(root, mmDataPath, 'data/images/units');
const outputDir = path.join(root, 'public', 'sprites');

// Sprite configuration
const ICON_WIDTH = 84;
const ICON_HEIGHT = 72;
const ICONS_PER_ROW = 30;
const PADDING = 0;

console.log(`[SpriteMap] Using unit icons from: ${unitIconsDir}`);

/**
 * Collect images grouped by unit type (top-level subfolder)
 */
function collectImagesByType(dir) {
  const imagesByType = new Map();
  
  if (!fs.existsSync(dir)) return imagesByType;
  
  const topLevelDirs = fs.readdirSync(dir).filter(name => {
    const fullPath = path.join(dir, name);
    return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
  }).sort();

  for (const unitType of topLevelDirs) {
    const typeDir = path.join(dir, unitType);
    const images = [];
    collectImagesRecursive(typeDir, dir, images);
    if (images.length > 0) {
      imagesByType.set(unitType, images);
    }
  }

  return imagesByType;
}

function collectImagesRecursive(dir, rootDir, images) {
  const files = fs.readdirSync(dir).sort();
  
  for (const file of files) {
    if (file.startsWith('.') || file === 'Thumbs.db' || file === 'Desktop.ini') {
      continue;
    }
    
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      collectImagesRecursive(fullPath, rootDir, images);
    } else if (/\.(png|gif|jpg|jpeg|webp)$/i.test(file)) {
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      images.push({ path: relativePath, fullPath });
    }
  }
}

/**
 * Generate sprite sheet for a single unit type
 */
async function generateSpriteForType(sharp, unitType, images, spriteData) {
  const cols = Math.min(images.length, ICONS_PER_ROW);
  const rows = Math.ceil(images.length / ICONS_PER_ROW);
  const spriteWidth = cols * (ICON_WIDTH + PADDING) - PADDING;
  const spriteHeight = rows * (ICON_HEIGHT + PADDING) - PADDING;

  console.log(`[SpriteMap] Creating ${unitType} sprite: ${spriteWidth}x${spriteHeight} (${images.length} icons)`);

  const compositeOps = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const col = i % ICONS_PER_ROW;
    const row = Math.floor(i / ICONS_PER_ROW);
    const x = col * (ICON_WIDTH + PADDING);
    const y = row * (ICON_HEIGHT + PADDING);

    try {
      const resizedBuffer = await sharp(img.fullPath)
        .resize(ICON_WIDTH, ICON_HEIGHT, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

      compositeOps.push({
        input: resizedBuffer,
        left: x,
        top: y
      });

      // Store sprite data with unit type info
      spriteData[img.path] = { 
        type: unitType,
        x, 
        y, 
        w: ICON_WIDTH, 
        h: ICON_HEIGHT 
      };

    } catch (err) {
      console.warn(`[SpriteMap] Failed to process ${img.path}: ${err.message}`);
    }
  }

  // Create the sprite sheet for this type
  const spriteImagePath = path.join(outputDir, `${unitType}.webp`);
  
  await sharp({
    create: {
      width: spriteWidth,
      height: spriteHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(compositeOps)
    .webp({ quality: 90, effort: 4 })
    .toFile(spriteImagePath);

  const spriteSize = (fs.statSync(spriteImagePath).size / 1024).toFixed(2);
  console.log(`[SpriteMap] Created ${spriteImagePath} (${spriteSize} KB)`);

  return { width: spriteWidth, height: spriteHeight };
}

async function generateSprites() {
  if (!fs.existsSync(unitIconsDir)) {
    console.log(`[SpriteMap] Source directory not found: ${unitIconsDir}`);
    console.log(`[SpriteMap] Please check MM_DATA_PATH in .env or environment variables.`);
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('[SpriteMap] Collecting images by unit type...');
  const imagesByType = collectImagesByType(unitIconsDir);
  
  if (imagesByType.size === 0) {
    console.log('[SpriteMap] No images found.');
    return;
  }

  let totalImages = 0;
  for (const images of imagesByType.values()) {
    totalImages += images.length;
  }
  console.log(`[SpriteMap] Found ${totalImages} images in ${imagesByType.size} unit types.`);

  const sharp = require('sharp');
  // Limit sharp concurrency to avoid memory issues
  sharp.concurrency(2);

  const spriteData = {};
  const spriteSizes = {};

  // Process each unit type
  for (const [unitType, images] of imagesByType) {
    const size = await generateSpriteForType(sharp, unitType, images, spriteData);
    spriteSizes[unitType] = size;
  }

  // Write combined JSON mapping file
  const spriteJsonPath = path.join(outputDir, 'unit-icons.json');
  const manifest = {
    types: Object.fromEntries(
      [...imagesByType.keys()].map(type => [type, {
        url: `sprites/${type}.webp`,
        ...spriteSizes[type]
      }])
    ),
    icons: spriteData
  };
  fs.writeFileSync(spriteJsonPath, JSON.stringify(manifest));

  // Generate combined hash
  const hashSum = crypto.createHash('sha256');
  hashSum.update(JSON.stringify(manifest));
  const hash = hashSum.digest('hex');
  
  const hashFilePath = path.join(outputDir, 'unit-icons.hash');
  fs.writeFileSync(hashFilePath, hash);

  const jsonSize = (fs.statSync(spriteJsonPath).size / 1024).toFixed(2);

  console.log(`[SpriteMap] Generated files:`);
  console.log(`  - ${spriteJsonPath} (${jsonSize} KB)`);
  console.log(`  - ${hashFilePath}`);
  console.log(`[SpriteMap] Hash: ${hash}`);
  console.log(`[SpriteMap] Total icons: ${Object.keys(spriteData).length}`);
}

generateSprites().catch(err => {
  console.error('[SpriteMap] Error:', err);
  process.exit(1);
});
