// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Signal } from '@angular/core';
import type { UnitSummary } from './unit-summary.model';
import type { ASSerializedUnit, ConditionData } from './force-serialization';
import type { Force, UnitGroup } from './force.model';
import type { C3Component } from './c3-network.model';
import type { UnitTagEcmCapabilitySummary } from './unit-capability-summary.model';
import type { UnitConditionKey } from './unit-condition.model';

/** @internal Friend capability for the synchronous Force-owned C3 transaction. */
export const applyForceUnitOwnerC3Position = Symbol('applyForceUnitOwnerC3Position');

/** Structural contract required by shared force/group ownership code. */
export interface ForceUnit {
    force: Force;
    id: string;
    updatedTs: number;
    disabledSaving: boolean;
    readonly readOnly: Signal<boolean>;
    readonly commander: Signal<boolean>;
    readonly alias: Signal<string | undefined>;
    readonly c3Position: Signal<{ x: number; y: number } | null>;
    readonly modified: boolean;
    readonly destroyed: boolean;
    readonly getBaseBv: Signal<number>;
    /** BV/PV after force modifiers, but before the final skill adjustment. */
    readonly getPreSkillBv: Signal<number>;
    readonly getBv: Signal<number>;
    readonly getPilotStats: Signal<number>;

    getDisplayName(): string;
    setModified(): void;
    getConditions(): ReadonlyMap<UnitConditionKey, ConditionData | undefined>;
    isC3EndpointOperational(componentIndex: number, component?: C3Component): boolean;
    isC3Jammed(): boolean;
    [applyForceUnitOwnerC3Position](pos: { x: number; y: number } | null): void;
    setFormationCommander(value: boolean, markModified?: boolean): void;
    getSummary(): UnitSummary;
    getFormationSummary(): UnitSummary;
    getC3Specials(): readonly string[];
    getC3Presentation(): Readonly<{
        chassis: string;
        model: string;
        icon: UnitSummary['icon'];
        tons: number;
        walk: number;
    }>;
    getTagEcmCapabilitySummary(): UnitTagEcmCapabilitySummary;
    getGroup(): UnitGroup<ForceUnit> | null;

    repairAll(): void;
    update(data: ASSerializedUnit): void;
    serialize(): ASSerializedUnit;
}
