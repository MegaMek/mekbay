// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
    const value = this.getDataAsString(key)[0];
    return value === undefined ? NaN : parseInt(value, 10);
  }

  /** Get values parsed as floating-point numbers. */
  getDataAsDouble(key: string): number[] {
    return this.getDataAsString(key).map(s => parseFloat(s));
  }

  /** Get first value as double. Returns NaN if not found. */
  getFirstDouble(key: string): number {
    const value = this.getDataAsString(key)[0];
    return value === undefined ? NaN : parseFloat(value);
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
      if (!currentTag && line.length > 2 && line[0] === '<' && line[1] !== '/' && line.endsWith('>')) {
        currentTag = line.slice(1, -1).toLowerCase();
        currentValues = [];
        continue;
      }

      // Closing tag: </TagName>
      if (currentTag && line.length > 3 && line.startsWith('</') && line.endsWith('>')) {
        const closeName = line.slice(2, -1).toLowerCase();
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
