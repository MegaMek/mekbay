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
 * Serialises BLK tag-based format.
 *
 * Usage:
 * ```ts
 * const writer = new BuildingBlockWriter();
 * writer.addBlock('Name', 'Ostrogoth');
 * writer.addBlock('Model', 'A');
 * writer.addBlock('armor', 77, 61, 61, 41);
 * console.log(writer.toString());
 * ```
 */
export class BuildingBlockWriter {
  private readonly lines: string[] = [];

  /**
   * Add a single block with one or more values.
   * Each value occupies its own line between the opening and closing tags.
   *
   * @param tag   The tag name (case-preserved in output)
   * @param values One or more values to write between the tags
   */
  addBlock(tag: string, ...values: (string | number)[]): void {
    this.lines.push(`<${tag}>`);
    for (const v of values) {
      this.lines.push(String(v));
    }
    this.lines.push(`</${tag}>`);
    this.lines.push('');
  }

  /**
   * Add a block only if the values array is non-empty.
   * Convenience method for optional blocks.
   */
  addBlockIfPresent(tag: string, values: (string | number)[]): void {
    if (values.length > 0) {
      this.addBlock(tag, ...values);
    }
  }

  /**
   * Add a raw line (no tags). Useful for comments or blank lines.
   */
  addRawLine(line: string): void {
    this.lines.push(line);
  }

  /**
   * Add a comment line.
   */
  addComment(text: string): void {
    this.lines.push(`#${text}`);
  }

  /**
   * Serialise all accumulated blocks to a single string.
   */
  toString(): string {
    return this.lines.join('\n');
  }
}
