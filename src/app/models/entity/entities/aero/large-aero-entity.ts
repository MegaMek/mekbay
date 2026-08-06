// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AeroEntity } from './aero-entity';

/** Shared domain root for aerospace units MegaMek classifies as large craft. */
export abstract class LargeAeroEntity extends AeroEntity {
  override isLargeCraft(): boolean {
    return true;
  }
}