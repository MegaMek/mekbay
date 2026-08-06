// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { calculateProtoMekEngineWeight } from './protomek-weight';

describe('ProtoMek construction weight', () => {
  it('exports the ProtoMek-specific engine calculator', () => {
    expect(calculateProtoMekEngineWeight).toBeDefined();
  });
});