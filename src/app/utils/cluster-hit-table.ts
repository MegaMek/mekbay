/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

/** MegaMek's Compute.clusterHitsTable, indexed as [rack size, roll 2 through 12]. */
const CLUSTER_HIT_TABLE: readonly (readonly number[])[] = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2],
    [3, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3], [4, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
    [5, 1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5], [6, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6],
    [7, 2, 2, 3, 4, 4, 4, 4, 6, 6, 7, 7], [8, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8],
    [9, 3, 3, 4, 5, 5, 5, 5, 7, 7, 9, 9], [10, 3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10],
    [11, 4, 4, 5, 7, 7, 7, 7, 9, 9, 11, 11], [12, 4, 4, 5, 8, 8, 8, 8, 10, 10, 12, 12],
    [13, 4, 4, 5, 8, 8, 8, 8, 11, 11, 13, 13], [14, 5, 5, 6, 9, 9, 9, 9, 11, 11, 14, 14],
    [15, 5, 5, 6, 9, 9, 9, 9, 12, 12, 15, 15], [16, 5, 5, 7, 10, 10, 10, 10, 13, 13, 16, 16],
    [17, 5, 5, 7, 10, 10, 10, 10, 14, 14, 17, 17], [18, 6, 6, 8, 11, 11, 11, 11, 14, 14, 18, 18],
    [19, 6, 6, 8, 11, 11, 11, 11, 15, 15, 19, 19], [20, 6, 6, 9, 12, 12, 12, 12, 16, 16, 20, 20],
    [21, 7, 7, 9, 13, 13, 13, 13, 17, 17, 21, 21], [22, 7, 7, 9, 14, 14, 14, 14, 18, 18, 22, 22],
    [23, 7, 7, 10, 15, 15, 15, 15, 19, 19, 23, 23], [24, 8, 8, 10, 16, 16, 16, 16, 20, 20, 24, 24],
    [25, 8, 8, 10, 16, 16, 16, 16, 21, 21, 25, 25], [26, 9, 9, 11, 17, 17, 17, 17, 21, 21, 26, 26],
    [27, 9, 9, 11, 17, 17, 17, 17, 22, 22, 27, 27], [28, 9, 9, 11, 17, 17, 17, 17, 23, 23, 28, 28],
    [29, 10, 10, 12, 18, 18, 18, 18, 23, 23, 29, 29], [30, 10, 10, 12, 18, 18, 18, 18, 24, 24, 30, 30],
    [40, 12, 12, 18, 24, 24, 24, 24, 32, 32, 40, 40],
];

/** Returns the Java Compute cluster-hit value for a 2d6 roll and rack size. */
export function clusterHits(roll: number, rackSize: number): number {
    if (!Number.isInteger(roll) || roll < 2 || roll > 12) {
        throw new RangeError(`Cluster table roll must be an integer from 2 through 12; received ${roll}`);
    }
    if (!Number.isInteger(rackSize) || rackSize <= 0) return 0;
    const row = CLUSTER_HIT_TABLE.find(candidate => candidate[0] === rackSize);
    return row?.[roll - 1] ?? 0;
}
