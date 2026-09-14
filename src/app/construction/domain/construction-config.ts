// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Extra years allowed before technology introduction during construction checks.
 * Matches MegaMek's default UnitVerifierOptions introYearMargin and stacks with
 * approximate-date adjustments. Set to 0 to disable this extra tolerance.
 */
export const CONSTRUCTION_INTRO_YEAR_MARGIN = 5;

/**
 * Whether construction eligibility rejects technology during extinction periods.
 * False matches MegaMekLab's introduction-only date validation. Set to true to
 * enforce extinction and reintroduction dates as well.
 */
export const CONSTRUCTION_VALIDATE_EXTINCTION = false;

/**
 * Whether construction validation reports issues for assigned unit and weapon quirks.
 * Set to true to enforce quirk applicability and report unmatched weapon quirks.
 * Quirk selection still uses the applicability rules independently of this setting.
 */
export const CONSTRUCTION_VALIDATE_QUIRKS = true;
