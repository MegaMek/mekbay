// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GameSystem } from '../common.model';

/** A person exists independently of a unit; g (CBT Gunnery / AS Skill) defaults to 4, p to 5. */
export interface StoredForcePerson {
    readonly id: string;
    readonly g?: number;
    readonly p?: number;
    readonly name?: string;
    readonly notes?: string;
    readonly portrait?: string;
    readonly commander?: true;
    readonly abilities?: readonly (string | import('../pilot-abilities.model').ASCustomPilotAbility)[];
    readonly health?: Readonly<{
        wounds?: number;
        unconscious?: true;
        ejected?: true;
        dead?: true;
        recoveryReadyTurn?: number | null;
    }>;
}

/** Array index is the crew station; each occupant is stored once, null means vacant. */
export type StoredForceCrew = readonly (StoredForcePerson | null)[];

/** Authoritative unit identity and choices, with sparse game state kept separately. */
export interface StoredForceUnit {
    readonly id: string;
    readonly uuid: string;
    readonly sourceHash?: string;
    readonly destroyed?: true;
    readonly updatedTs?: number;
    readonly crew?: StoredForceCrew;
    readonly state?: Readonly<Record<string, unknown>>;
}

/** Arrays define display order; membership indexes the force's independent unit order. */
export interface StoredForceGroup {
    readonly id: string;
    readonly name?: string;
    readonly color?: string;
    readonly formationId?: string;
    readonly formationLock?: true;
    readonly formationTarget?: number;
    readonly unitIndices: readonly number[];
}

export interface StoredForceV2 {
    readonly version: 2;
    readonly instanceId: string;
    readonly timestamp: number;
    readonly type: GameSystem;
    readonly name: string;
    readonly note?: string;
    readonly tags?: readonly string[];
    readonly factionId?: number;
    readonly factionLock?: boolean;
    readonly eraId?: number;
    readonly eraLock?: boolean;
    readonly bv?: number;
    readonly pv?: number;
    readonly owned?: boolean;
    readonly units: readonly StoredForceUnit[];
    /** Only unassigned people; omitted when there are no reserves. */
    readonly personnel?: readonly StoredForcePerson[];
    readonly groups: readonly StoredForceGroup[];
    readonly a?: Readonly<{ n?: readonly unknown[] }>;
    readonly cbt?: Readonly<{ r: number; h?: readonly unknown[]; e?: unknown }>;
}

/** Database and file ingress can also contain V1 or damaged user data. */
export type StoredForceRecord = Readonly<Record<string, unknown>>;
