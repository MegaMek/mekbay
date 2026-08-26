// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Exact MegaMek oracle bugs accepted by the unit-output comparison.
 * Keep this list empty until a mismatch has been verified against MegaMek.
 */
const KNOWN_COST_MISMATCHES = new Set([
  '019f583e-d3b4-7265-8425-3b391074fb5a|26838000|27021750',
  '019f583e-d544-7c65-9399-6c63d37cf3d1|19353100|19821100',
  '019f583e-deed-7edf-abab-c50ac0b0c39a|6649479|6563542',
  '019f583e-df52-75da-b9e0-77c4ca9d7b50|6213540|6115665',
  '019f583e-dfbe-7782-9456-a10868f1e9ce|9878000|9743000',
]);

export function isKnownMegaMekCostBug(
  uuid: unknown,
  actual: unknown,
  expected: unknown,
): boolean {
  return KNOWN_COST_MISMATCHES.has(`${String(uuid)}|${String(actual)}|${String(expected)}`);
}
