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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { writeDeterministicFile } from './lib/deterministic-output';
import { loadMeksetAssignments } from './lib/mekset-assignments';
import { loadOptionalEnvFile, resolveMmDataRoot } from './lib/script-paths';

const root = path.resolve(__dirname, '..');

loadOptionalEnvFile(root, { logPrefix: 'SpriteMap' });

const mmDataRoot = resolveMmDataRoot(root, { allowMissing: true });
const unitIconsDir = path.join(mmDataRoot, 'data/images/units');
const meksetPath = path.join(unitIconsDir, 'mekset.txt');
const outputDir = path.join(root, 'public', 'online-assets', 'generated', 'sprites');

// Sprite configuration
const ICON_BASE_WIDTH = 84;
const ICON_BASE_HEIGHT = 72;
const ICON_SCALE = 1.0; // Scale factor (0.5 = half size, 2.0 = double size)
const ICON_WIDTH = Math.round(ICON_BASE_WIDTH * ICON_SCALE);
const ICON_HEIGHT = Math.round(ICON_BASE_HEIGHT * ICON_SCALE);
const PADDING = 0;
// Bump only when intentionally forcing every client to refresh stored sprite sheets.
const SPRITE_CACHE_VERSION = '1';
const SPRITE_HASH_LENGTH = 16;

interface CollectedImage {
  readonly path: string;
  readonly fullPath: string;
}

interface SpritePosition {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface SpriteTypeInfo {
  readonly width: number;
  readonly height: number;
  /** Complete lowercase SHA-256 hex digest of the authored WebP bytes. */
  readonly hash: string;
}

function getFileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildSpriteTempFileName(unitType: string): string {
  return `${unitType}.${SPRITE_CACHE_VERSION}.tmp.webp`;
}

function buildSpriteFileName(unitType: string, spriteHash: string): string {
  return `${unitType}.${SPRITE_CACHE_VERSION}.${spriteHash}.webp`;
}

function buildSpriteUrl(unitType: string, spriteHash: string): string {
  return `online-assets/generated/sprites/${buildSpriteFileName(unitType, spriteHash)}`;
}

function cleanGeneratedSpriteFiles(): number {
  if (!fs.existsSync(outputDir)) return 0;

  let removed = 0;
  for (const file of fs.readdirSync(outputDir)) {
    const filePath = path.join(outputDir, file);
    if (!fs.lstatSync(filePath).isFile()) continue;
    fs.unlinkSync(filePath);
    removed += 1;
  }

  return removed;
}

/**
 * Calculate optimal columns for a roughly square sprite sheet.
 * Takes into account the icon aspect ratio to balance width/height.
 */
function calculateOptimalColumns(iconCount: number): number {
  if (iconCount <= 1) return 1;
  
  // For a square-ish sprite: cols * ICON_WIDTH ≈ rows * ICON_HEIGHT
  // With rows = ceil(iconCount / cols), solve for cols:
  // cols ≈ sqrt(iconCount * ICON_HEIGHT / ICON_WIDTH)
  const aspectRatio = ICON_HEIGHT / ICON_WIDTH;
  const optimalCols = Math.round(Math.sqrt(iconCount * aspectRatio));
  
  // Clamp to reasonable bounds (at least 1, at most iconCount)
  return Math.max(1, Math.min(optimalCols, iconCount));
}

console.log(`[SpriteMap] Using MM data from: ${mmDataRoot}`);
console.log(`[SpriteMap] Using unit icons from: ${unitIconsDir}`);
console.log(`[SpriteMap] Icon size: ${ICON_WIDTH}x${ICON_HEIGHT} (scale: ${ICON_SCALE})`);

/**
 * Collect images grouped by unit type (top-level subfolder)
 */
function collectImagesByType(dir: string): Map<string, CollectedImage[]> {
  const imagesByType = new Map<string, CollectedImage[]>();
  
  if (!fs.existsSync(dir)) return imagesByType;
  
  const topLevelDirs = fs.readdirSync(dir).filter(name => {
    const fullPath = path.join(dir, name);
    return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
  }).sort();

  for (const unitType of topLevelDirs) {
    const typeDir = path.join(dir, unitType);
    const images: CollectedImage[] = [];
    collectImagesRecursive(typeDir, dir, images);
    if (images.length > 0) {
      imagesByType.set(unitType, images);
    }
  }

  return imagesByType;
}

function collectImagesRecursive(
  dir: string,
  rootDir: string,
  images: CollectedImage[],
): void {
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
async function generateSpriteForType(
  sharpImpl: typeof sharp,
  unitType: string,
  images: readonly CollectedImage[],
  spriteData: Record<string, SpritePosition>,
): Promise<SpriteTypeInfo> {
  const cols = calculateOptimalColumns(images.length);
  const rows = Math.ceil(images.length / cols);
  const spriteWidth = cols * (ICON_WIDTH + PADDING) - PADDING;
  const spriteHeight = rows * (ICON_HEIGHT + PADDING) - PADDING;

  console.log(`[SpriteMap] Creating ${unitType} sprite: ${spriteWidth}x${spriteHeight} (${images.length} icons, ${cols}x${rows} grid)`);

  const compositeOps: sharp.OverlayOptions[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (ICON_WIDTH + PADDING);
    const y = row * (ICON_HEIGHT + PADDING);

    try {
      const resizedBuffer = await sharpImpl(img.fullPath)
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
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[SpriteMap] Failed to process ${img.path}: ${message}`);
    }
  }

  // Create the sprite sheet for this type
  const spriteTempPath = path.join(outputDir, buildSpriteTempFileName(unitType));
  
  await sharpImpl({
    create: {
      width: spriteWidth,
      height: spriteHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite(compositeOps)
    .webp({ lossless: true, effort: 6 })
    .toFile(spriteTempPath);

  const spriteHash = getFileHash(spriteTempPath);
  const spriteImagePath = path.join(
    outputDir,
    buildSpriteFileName(unitType, spriteHash.slice(0, SPRITE_HASH_LENGTH)),
  );
  if (fs.existsSync(spriteImagePath)) fs.unlinkSync(spriteTempPath);
  else fs.renameSync(spriteTempPath, spriteImagePath);

  const spriteSize = (fs.statSync(spriteImagePath).size / 1024).toFixed(2);
  console.log(`[SpriteMap] Created ${spriteImagePath} (${spriteSize} KB)`);

  return { width: spriteWidth, height: spriteHeight, hash: spriteHash };
}

async function generateSprites(): Promise<void> {
  if (!fs.existsSync(unitIconsDir)) {
    console.log(`[SpriteMap] Source directory not found: ${unitIconsDir}`);
    console.log(`[SpriteMap] Please check MM_DATA_PATH in .env or environment variables.`);
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const removedOutputs = cleanGeneratedSpriteFiles();
  if (removedOutputs > 0) {
    console.log(`[SpriteMap] Removed ${removedOutputs} stale generated sprite outputs.`);
  }

  console.log('[SpriteMap] Collecting images by unit type...');
  const imagesByType = collectImagesByType(unitIconsDir);
  
  if (imagesByType.size === 0) {
    console.log('[SpriteMap] No images found.');
    return;
  }

  let totalImages = 0;
  const availableIcons = new Set<string>();
  for (const images of imagesByType.values()) {
    totalImages += images.length;
    for (const image of images) {
      availableIcons.add(image.path.toLowerCase());
    }
  }
  console.log(`[SpriteMap] Found ${totalImages} images in ${imagesByType.size} unit types.`);

  const assignments = loadMeksetAssignments(meksetPath, { availableIcons });
  if (assignments.missingIcons.length > 0) {
    console.warn(`[SpriteMap] Ignored ${assignments.missingIcons.length} mekset assignments whose images are unavailable.`);
  }

  // Limit sharp concurrency to avoid memory issues
  sharp.concurrency(2);

  const spriteData: Record<string, SpritePosition> = {};
  const spriteTypes: Record<string, SpriteTypeInfo> = {};

  // Process each unit type
  for (const [unitType, images] of imagesByType) {
    const typeInfo = await generateSpriteForType(sharp, unitType, images, spriteData);
    spriteTypes[unitType] = typeInfo;
  }

  // Write combined JSON mapping file
  const spriteJsonPath = path.join(outputDir, 'unit-icons.json');
  const manifest = {
    types: Object.fromEntries(
      [...imagesByType.keys()].map(type => {
        const { width, height, hash } = spriteTypes[type]!;
        return [type, {
          url: buildSpriteUrl(type, hash.slice(0, SPRITE_HASH_LENGTH)),
          width,
          height,
          hash,
        }];
      })
    ),
    icons: spriteData,
    assignments: {
      exact: assignments.exact,
      chassis: assignments.chassis
    }
  };
  const manifestJson = JSON.stringify(manifest);
  writeDeterministicFile(spriteJsonPath, manifestJson);

  const jsonSize = (fs.statSync(spriteJsonPath).size / 1024).toFixed(2);

  console.log(`[SpriteMap] Generated files:`);
  console.log(`  - ${spriteJsonPath} (${jsonSize} KB)`);
  console.log(`[SpriteMap] Total icons: ${Object.keys(spriteData).length}`);
}

generateSprites().catch(err => {
  console.error('[SpriteMap] Error:', err);
  process.exit(1);
});
