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

/**
 * Port of Java's `megamek.common.util.BuildingBlock`.
 *
 * Parses the BLK tag-based format into a lookup map.
 * Tags are matched case-insensitively.
 *
 * Format example:
 * ```
 * <Name>
 * Ostrogoth
 * </Name>
 *
 * <armor>
 * 77
 * 61
 * 61
 * 41
 * </armor>
 * ```
 */
export class BuildingBlock {
  /** Lowercase key → raw string values (one per line between tags) */
  private readonly blocks = new Map<string, string[]>();

  constructor(content: string) {
    this.parse(content);
  }

  // ── Query methods ────────────────────────────────────────────────────────

  /** Check if a tag exists (case-insensitive) */
  exists(key: string): boolean {
    return this.blocks.has(key.toLowerCase());
  }

  /** Get raw string values for a tag. Returns empty array if tag not found. */
  getDataAsString(key: string): string[] {
    return this.blocks.get(key.toLowerCase()) ?? [];
  }

  /** Get first string value for a tag. Returns empty string if not found. */
  getFirstString(key: string): string {
    return this.getDataAsString(key)[0] ?? '';
  }

  /** Get values parsed as integers. Non-numeric values become NaN. */
  getDataAsInt(key: string): number[] {
    return this.getDataAsString(key).map(s => parseInt(s, 10));
  }

  /** Get first value as integer. Returns NaN if not found. */
  getFirstInt(key: string): number {
    return this.getDataAsInt(key)[0] ?? NaN;
  }

  /** Get values parsed as floating-point numbers. */
  getDataAsDouble(key: string): number[] {
    return this.getDataAsString(key).map(s => parseFloat(s));
  }

  /** Get first value as double. Returns NaN if not found. */
  getFirstDouble(key: string): number {
    return this.getDataAsDouble(key)[0] ?? NaN;
  }

  /** Get all registered tag names (lowercase) */
  getTagNames(): string[] {
    return [...this.blocks.keys()];
  }

  // ── Parser ───────────────────────────────────────────────────────────────

  private parse(content: string): void {
    const lines = content.split(/\r?\n/);
    let currentTag: string | null = null;
    let currentValues: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip comments
      if (line.startsWith('#')) {
        continue;
      }

      // Opening tag: <TagName>
      const openMatch = line.match(/^<([^/][^>]*)>$/);
      if (openMatch && !currentTag) {
        currentTag = openMatch[1].toLowerCase();
        currentValues = [];
        continue;
      }

      // Closing tag: </TagName>
      const closeMatch = line.match(/^<\/([^>]+)>$/);
      if (closeMatch && currentTag) {
        const closeName = closeMatch[1].toLowerCase();
        if (closeName === currentTag) {
          this.blocks.set(currentTag, currentValues);
          currentTag = null;
          currentValues = [];
        }
        continue;
      }

      // Value line inside a tag
      if (currentTag !== null) {
        // Preserve the original line (not trimmed) for multi-line fluff text,
        // but trim leading/trailing whitespace for data values.
        currentValues.push(rawLine.trim());
      }
    }
  }
}
