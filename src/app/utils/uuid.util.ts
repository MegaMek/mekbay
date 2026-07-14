/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

const buf = new Uint8Array(16);
const hexTable = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = 0;
let seq = 0;

export function uuidv4(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // Fallback for non-secure contexts
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function uuidv7(): string {
  let now = Date.now();

  if (now <= lastMs) {
    now = lastMs;
    seq = (seq + 1) | 0; 
    if (seq === 0) {
      // Handle rare 32-bit overflow by advancing the millisecond flag
      now++;
      lastMs = now;
    }
  } else {
    lastMs = now;
    crypto.getRandomValues(buf);
    seq = (buf[8] << 24) | (buf[9] << 16) | (buf[10] << 8) | buf[11];
  }

  // Write Timestamp (48 bits / Bytes 0 to 5)
  const hiTime = (now / 0x100000000) | 0;
  const loTime = now | 0;
  
  buf[0] = hiTime >> 8;
  buf[1] = hiTime;
  buf[2] = loTime >> 24;
  buf[3] = loTime >> 16;
  buf[4] = loTime >> 8;
  buf[5] = loTime;

  // Write Version 7 into bits 12-15 of rand_a (Byte 6)
  // Re-roll entropy for byte 6 & 7 if needed, or use the single initial buffer call
  buf[6] = (buf[6] & 0x0f) | 0x70; 

  // Inject Monotonic Counter into rand_b (Bytes 8 to 11)
  // Ensure the top two bits of Byte 8 strictly match Variant 2 (binary 10xx xxxx)
  buf[8] = 0x80 | ((seq >> 26) & 0x3f);
  buf[9] = (seq >> 18) & 0xff;
  buf[10] = (seq >> 10) & 0xff;
  buf[11] = (seq >> 2) & 0xff;
  buf[12] = (buf[12] & 0x3f) | ((seq & 0x03) << 6);

  // Bytes 13, 14, and 15 retain pure random entropy values from the crypto call

  return (
    hexTable[buf[0]] + hexTable[buf[1]] + hexTable[buf[2]] + hexTable[buf[3]] + "-" +
    hexTable[buf[4]] + hexTable[buf[5]] + "-" +
    hexTable[buf[6]] + hexTable[buf[7]] + "-" +
    hexTable[buf[8]] + hexTable[buf[9]] + "-" +
    hexTable[buf[10]] + hexTable[buf[11]] + hexTable[buf[12]] +
    hexTable[buf[13]] + hexTable[buf[14]] + hexTable[buf[15]]
  );
}