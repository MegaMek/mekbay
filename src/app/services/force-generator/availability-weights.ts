// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MegaMekWeightedAvailabilityRecord, MegaMekWeightedAvailabilityValue } from '../../models/megamek/availability.model';

const UNKNOWN_AVAILABILITY_WEIGHT = 10;

export interface AvailabilityWeights {
    requisition: number;
    salvage: number;
}

export interface AvailabilityWeightScope {
    eraIdTexts: readonly string[];
    factionIdTextSet: ReadonlySet<string>;
}

/** Requisition and salvage each take their highest value anywhere in the selected scope. */
export function getScopedAvailabilityWeights(
    record: MegaMekWeightedAvailabilityRecord | undefined,
    scope: AvailabilityWeightScope,
    useMegaMekAvailability: boolean,
): AvailabilityWeights {
    const weights = { requisition: 0, salvage: 0 };
    if (!record || scope.eraIdTexts.length === 0 || scope.factionIdTextSet.size === 0) {
        weights.requisition = useMegaMekAvailability ? UNKNOWN_AVAILABILITY_WEIGHT : 0;
        return weights;
    }

    if (scope.eraIdTexts.length === 1 && scope.factionIdTextSet.size === 1) {
        const factionId = scope.factionIdTextSet.values().next().value!;
        const value = record.e[scope.eraIdTexts[0]]?.[factionId];
        return { requisition: Math.max(0, value?.[0] ?? 0), salvage: Math.max(0, value?.[1] ?? 0) };
    }

    for (const eraId of scope.eraIdTexts) {
        const eraAvailability = record.e[eraId];
        if (!eraAvailability) {
            continue;
        }
        for (const factionId in eraAvailability) {
            if (!scope.factionIdTextSet.has(factionId)) {
                continue;
            }
            const value = eraAvailability[factionId];
            const requisition = value[0] ?? 0;
            const salvage = value[1] ?? 0;
            if (requisition > weights.requisition) {
                weights.requisition = requisition;
            }
            if (salvage > weights.salvage) {
                weights.salvage = salvage;
            }
        }
    }
    return weights;
}

/** MUL membership supplies an unknown production weight only when the exact record is absent. */
export function includeMulAvailabilityFallback(weights: AvailabilityWeights, exactValue: MegaMekWeightedAvailabilityValue | undefined): void {
    if (exactValue === undefined && weights.requisition < UNKNOWN_AVAILABILITY_WEIGHT) {
        weights.requisition = UNKNOWN_AVAILABILITY_WEIGHT;
    }
}
