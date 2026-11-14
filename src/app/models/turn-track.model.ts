// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The turn a column of a sheet's turn track shows while the game is in `currentTurn`: the Velocity Record, a VTOL's
 * Elevation Track. A track prints two tables of `perTable` turns, `column` counting from 1 across both. The tables take
 * turns moving on, so this turn and the `perTable` before it always show: with ten, turns 1-10 and 11-20, then 21-30
 * beside 11-20, then 21-30 beside 31-40, and so on.
 */
export function turnTrackShownTurn(column: number, currentTurn: number, perTable: number): number {
    const table = column <= perTable ? 0 : 1;
    const span = Math.floor((Math.max(1, currentTurn) - 1) / perTable);
    return (span % 2 === table ? span : Math.max(table, span - 1)) * perTable + (column - 1) % perTable + 1;
}
