// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import path from 'node:path';

/** Whether a native unit source supplies the stable UUID that its parser preserves. */
export function nativeUnitSourceDeclaresUuid(source: string, fileName: string): boolean {
  switch (path.extname(fileName).toLowerCase()) {
    case '.mtf':
      return source.split(/\r?\n/u).some(line => {
        const separator = line.indexOf(':');
        return separator > 0
          && line.slice(0, separator).trim().toLowerCase() === 'uuid'
          && line.slice(separator + 1).trim().length > 0;
      });
    case '.blk': {
      const match = source.match(/<UUID>([\s\S]*?)<\/UUID>/iu);
      return (match?.[1]?.trim().length ?? 0) > 0;
    }
    default:
      return false;
  }
}
