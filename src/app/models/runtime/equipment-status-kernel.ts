// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { combineEquipmentStatuses, type EquipmentStatus } from '../equipment-status.model';
import { isCBTRuleset, type CBTRuleset } from '../cbt-ruleset.model';
import { isShieldFlags } from '../entity/utils/physical-weapon-kernel';
import { hasWeaponTrait } from '../weapon-traits-kernel';

export type EquipmentStatusUnitFamily = 'mek' | 'vehicle' | 'other';

export interface RuntimeStatusComponentDefinition {
    readonly id: string;
    readonly flags: ReadonlySet<string>;
    readonly locationIds: readonly string[];
    readonly criticalSlotIds: readonly string[];
}

export interface RuntimeStatusCriticalDefinition {
    readonly id: string;
    /** One normally; superheavy shared slots deliberately name both components. */
    readonly componentIds: readonly string[];
    readonly locationId: string;
}

/**
 * Read-only projection of entity topology used by status evaluation.
 * It intentionally contains no equipment objects, owners, rules, callbacks, or UI state.
 */
export interface RuntimeEquipmentStatusTopology {
    readonly components: ReadonlyMap<string, RuntimeStatusComponentDefinition>;
    readonly criticalSlots: ReadonlyMap<string, RuntimeStatusCriticalDefinition>;
}

export interface RuntimeCriticalCommittedState {
    readonly status: EquipmentStatus;
    readonly hits: number;
    readonly armored: boolean;
}

/** Sparse committed facts. Missing entries are pristine/available. */
export interface RuntimeEquipmentCommittedState {
    readonly components: ReadonlyMap<string, EquipmentStatus>;
    readonly criticalSlots: ReadonlyMap<string, RuntimeCriticalCommittedState>;
    readonly locations: ReadonlyMap<string, EquipmentStatus>;
    readonly engineHit: boolean;
}

export type EquipmentStatusDiagnosticCode =
    | 'STALE_COMPONENT_REFERENCE'
    | 'STALE_CRITICAL_REFERENCE';

export interface EquipmentStatusDiagnostic {
    readonly code: EquipmentStatusDiagnosticCode;
    readonly referenceId: string;
}

export interface EquipmentStatusResolution {
    readonly status: EquipmentStatus;
    readonly diagnostics: readonly EquipmentStatusDiagnostic[];
}

export interface RuntimeEquipmentStatusKernelOptions {
    readonly rules: CBTRuleset;
    readonly family: EquipmentStatusUnitFamily;
}

const AVAILABLE: EquipmentStatusResolution = Object.freeze({
    status: 'available',
    diagnostics: Object.freeze([]),
});

/**
 * Pure V2 status resolver over one immutable topology and one committed sparse snapshot.
 * Selection happens once in the constructor; queries cannot call back into the unit graph.
 */
export class RuntimeEquipmentStatusKernel {
    public constructor(
        private readonly topology: RuntimeEquipmentStatusTopology,
        private readonly committed: RuntimeEquipmentCommittedState,
        private readonly options: RuntimeEquipmentStatusKernelOptions,
    ) {
        if (!isCBTRuleset(options.rules)) {
            throw new Error(`Unsupported CBT ruleset ${String(options.rules)}`);
        }
        validateTopology(topology);
        validateCommittedState(committed);
    }

    public component(componentId: string): EquipmentStatusResolution {
        const definition = this.topology.components.get(componentId);
        if (!definition) return stale('STALE_COMPONENT_REFERENCE', componentId);

        return resolution([
            this.componentState(componentId),
            ...definition.locationIds.map(locationId => this.locationState(locationId)),
            this.mountedCriticalContribution(definition.criticalSlotIds, definition.flags),
            this.familyContribution(definition),
        ]);
    }

    public componentAtLocation(componentId: string, locationId: string): EquipmentStatusResolution {
        const definition = this.topology.components.get(componentId);
        if (!definition) return stale('STALE_COMPONENT_REFERENCE', componentId);

        const criticalIds = definition.criticalSlotIds.filter(slotId =>
            this.topology.criticalSlots.get(slotId)?.locationId === locationId,
        );
        return resolution([
            this.componentState(componentId),
            this.locationState(locationId),
            this.mountedCriticalContribution(criticalIds, definition.flags),
            this.familyContribution(definition),
        ]);
    }

    public criticalSlot(criticalSlotId: string): EquipmentStatusResolution {
        const definition = this.topology.criticalSlots.get(criticalSlotId);
        if (!definition) return stale('STALE_CRITICAL_REFERENCE', criticalSlotId);
        return resolution([
            this.criticalState(criticalSlotId),
            this.locationState(definition.locationId),
        ]);
    }

    private componentState(componentId: string): EquipmentStatus {
        return this.committed.components.get(componentId) ?? 'available';
    }

    private criticalState(criticalSlotId: string): EquipmentStatus {
        return this.committed.criticalSlots.get(criticalSlotId)?.status ?? 'available';
    }

    private locationState(locationId: string): EquipmentStatus {
        return this.committed.locations.get(locationId) ?? 'available';
    }

    private mountedCriticalContribution(
        criticalSlotIds: readonly string[],
        componentFlags: ReadonlySet<string>,
    ): EquipmentStatus {
        if (this.options.family !== 'mek' || criticalSlotIds.length === 0) return 'available';
        const hits = criticalSlotIds.reduce(
            (count, id) => {
                const slot = this.committed.criticalSlots.get(id);
                return count + Math.max(0, (slot?.hits ?? 0) - (slot?.armored ? 1 : 0));
            },
            0,
        );
        return hits >= mekCriticalDamageThreshold(this.options.rules, componentFlags)
            ? 'destroyed'
            : 'available';
    }

    private familyContribution(definition: RuntimeStatusComponentDefinition): EquipmentStatus {
        return this.options.family === 'vehicle'
            && this.committed.engineHit
            && hasWeaponTrait(definition.flags, 'energy')
            ? 'disabled'
            : 'available';
    }
}

/** Number of component hits required to destroy mounted Mek equipment. */
export function mekCriticalDamageThreshold(
    rules: CBTRuleset,
    componentFlags: ReadonlySet<string>,
): number {
    // Shield critical and actuator losses reduce DA/DC tracks; the shield
    // projection owns their operational threshold.
    if (isShieldFlags(componentFlags)) return Number.MAX_SAFE_INTEGER;
    return rules === 'core-2026' && hasWeaponTrait(componentFlags, 'autocannon') ? 2 : 1;
}

function resolution(statuses: readonly EquipmentStatus[]): EquipmentStatusResolution {
    const status = combineEquipmentStatuses(statuses);
    return status === 'available' ? AVAILABLE : { status, diagnostics: AVAILABLE.diagnostics };
}

function stale(code: EquipmentStatusDiagnosticCode, referenceId: string): EquipmentStatusResolution {
    return {
        status: 'available',
        diagnostics: Object.freeze([{ code, referenceId }]),
    };
}

function validateTopology(topology: RuntimeEquipmentStatusTopology): void {
    for (const [id, component] of topology.components) {
        if (!id || component.id !== id) throw new Error(`Invalid runtime component identity: ${id}`);
        if (new Set(component.locationIds).size !== component.locationIds.length) {
            throw new Error(`Duplicate location identity on runtime component ${id}`);
        }
        if (new Set(component.criticalSlotIds).size !== component.criticalSlotIds.length) {
            throw new Error(`Duplicate critical identity on runtime component ${id}`);
        }
        for (const slotId of component.criticalSlotIds) {
            const slot = topology.criticalSlots.get(slotId);
            if (!slot || !slot.componentIds.includes(id)) {
                throw new Error(`Runtime component ${id} references invalid critical ${slotId}`);
            }
        }
    }
    for (const [id, slot] of topology.criticalSlots) {
        if (!id || slot.id !== id || !slot.locationId || slot.componentIds.length === 0
            || slot.componentIds.some(componentId => !topology.components.has(componentId))) {
            throw new Error(`Invalid runtime critical identity: ${id}`);
        }
        for (const componentId of slot.componentIds) {
            if (!topology.components.get(componentId)?.criticalSlotIds.includes(id)) {
                throw new Error(`Runtime critical ${id} is absent from component ${componentId}`);
            }
        }
    }
}

function validateCommittedState(state: RuntimeEquipmentCommittedState): void {
    for (const [id, critical] of state.criticalSlots) {
        if (!id || !Number.isSafeInteger(critical.hits) || critical.hits < 0) {
            throw new Error(`Invalid committed critical state: ${id}`);
        }
    }
}
