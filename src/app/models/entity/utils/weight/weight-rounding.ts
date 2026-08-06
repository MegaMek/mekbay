// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/** Round construction mass upward to the nearest half ton after removing FP noise. */
export function ceilToHalfTon(value: number): number {
  const kilogramRounded = Math.round(value * 1000) / 1000;
  return Math.ceil(kilogramRounded * 2) / 2;
}

export function ceilToWholeTon(value: number): number {
  return Math.ceil(Math.round(value * 1000) / 1000);
}