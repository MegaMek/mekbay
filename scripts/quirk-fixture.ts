// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import * as fs from 'fs';
import * as path from 'path';
import type { Quirk, Quirks } from '../src/app/models/quirks.model';
import type { QuirkResolverFn } from '../src/app/models/entity/parsers/parse-context';

/** Load the generated quirk catalog used by standalone entity parser scripts. */
export function loadQuirkResolver(): QuirkResolverFn {
  const fixturePath = path.join(__dirname, 'fixtures', 'quirks.json');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Quirk catalog not found: ${fixturePath}`);
  }

  const catalog = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Quirks;
  const quirksByKey = new Map<string, Quirk>(
    catalog.quirks.map(quirk => [quirk.key, quirk]),
  );
  return key => quirksByKey.get(key);
}
