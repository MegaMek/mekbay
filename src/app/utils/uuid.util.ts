// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const buf = new Uint8Array(16);
const hexTable = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
type UuidCrypto = Partial<Pick<Crypto, 'getRandomValues' | 'randomUUID'>>;

let lastMs = 0;
let seq = 0;

export function uuidv4(cryptoApi: UuidCrypto | undefined = globalThis.crypto): string {
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }

    // randomUUID() is restricted to secure contexts, while getRandomValues()
    // remains available on plain-HTTP LAN origins used for local mobile play.
    const bytes = new Uint8Array(16);
    fillRandomBytes(bytes, cryptoApi);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return formatUuid(bytes);
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
    fillRandomBytes(buf, globalThis.crypto);
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

  return formatUuid(buf);
}

function fillRandomBytes(
    target: Uint8Array<ArrayBuffer>,
    cryptoApi: Pick<UuidCrypto, 'getRandomValues'> | undefined,
): void {
    if (typeof cryptoApi?.getRandomValues === 'function') {
        cryptoApi.getRandomValues(target);
        return;
    }

    // Last-resort compatibility for runtimes without Web Crypto. UUIDs are
    // opaque collision-resistant identifiers here, not authentication tokens.
    for (let index = 0; index < target.length; index++) {
        target[index] = Math.floor(Math.random() * 256);
    }
}

function formatUuid(bytes: Uint8Array): string {
    return (
        hexTable[bytes[0]] + hexTable[bytes[1]] + hexTable[bytes[2]] + hexTable[bytes[3]] + '-' +
        hexTable[bytes[4]] + hexTable[bytes[5]] + '-' +
        hexTable[bytes[6]] + hexTable[bytes[7]] + '-' +
        hexTable[bytes[8]] + hexTable[bytes[9]] + '-' +
        hexTable[bytes[10]] + hexTable[bytes[11]] + hexTable[bytes[12]] +
        hexTable[bytes[13]] + hexTable[bytes[14]] + hexTable[bytes[15]]
    );
}
