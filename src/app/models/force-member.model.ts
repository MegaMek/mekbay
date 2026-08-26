// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal } from '@angular/core';
import type { CBTForce } from './cbt-force.model';
import type { ASForceUnit } from './as-force-unit.model';
import type { UnitInstanceId } from './runtime/runtime-state';
import type { UnitSummary } from './unit-summary.model';

/** A direct Classic member. Its force owns the entity, rules, and sparse runtime. */
export class CBTForceMember {
    readonly kind: 'cbt';
    readonly id: UnitInstanceId;
    readonly force: CBTForce;
    readonly summary: UnitSummary;
    readonly #runtime = signal<Readonly<{
        owner: object | null;
        revision: number | null;
    }>>(Object.freeze({ owner: null, revision: null }));

    /** Current entity + rules + sparse-runtime BV; only this unit can invalidate it. */
    readonly currentBaseBattleValue = computed(() => {
        this.#runtime();
        return this.force.getUnitCurrentBaseBattleValue(this.id);
    });

    /** Immutable entity BV before damage and force-level adjustments. */
    readonly pristineBattleValue = computed(() => this.force.getUnitPristineBattleValue(this.id));

    /** TAG + operational C3 network + skills over current base BV. */
    readonly adjustedBattleValue = computed(() => this.force.getUnitAdjustedBattleValue(this.id));

    readonly c3State = computed(() => this.force.getC3State(this.id));

    public tagBattleValue(): number | null {
        return this.force.getUnitTagBattleValue(this.id);
    }

    public c3BattleValue(): number | null {
        return this.force.getUnitC3BattleValue(this.id);
    }

    public constructor(
        id: UnitInstanceId,
        force: CBTForce,
        summary: UnitSummary,
    ) {
        this.kind = 'cbt';
        this.id = id;
        this.force = force;
        this.summary = summary;
        Object.freeze(this);
    }

    /** Publishes a new runtime witness only when this exact member changed. */
    public bindRuntime(owner: object | null, revision: number | null): boolean {
        const current = this.#runtime();
        if (current.owner === owner && current.revision === revision) return false;
        this.#runtime.set(Object.freeze({ owner, revision }));
        return true;
    }

    public get rosterGroupId(): string {
        const groupId = this.force.getRosterGroupId(this.id);
        if (groupId === null) throw new Error(`Classic force member ${this.id} is no longer owned`);
        return groupId;
    }

    public getSummary(): UnitSummary {
        return this.summary;
    }
}

/** A real family narrowing used only by Mek-specific rules and UI. */
export type CBTMekForceMember = CBTForceMember & Readonly<{
    summary: UnitSummary & Readonly<{ entityType: 'Mek' }>;
}>;

export type ForceMember = ASForceUnit | CBTForceMember;

export function isCBTForceMember(value: ForceMember | null | undefined): value is CBTForceMember {
    return value !== null
        && value !== undefined
        && 'kind' in value
        && value.kind === 'cbt';
}

export function isCBTMekForceMember(value: ForceMember | null | undefined): value is CBTMekForceMember {
    return isCBTForceMember(value) && value.summary.entityType === 'Mek';
}

export function forceMemberSummary(value: ForceMember): UnitSummary {
    return isCBTForceMember(value) ? value.summary : value.getSummary();
}

export function forceMemberAlias(value: ForceMember): string | undefined {
    return isCBTForceMember(value) ? undefined : value.alias();
}

export function forceMemberDestroyed(value: ForceMember): boolean {
    if (!isCBTForceMember(value)) return value.destroyed;
    return value.force.getUnitDestroyed(value.id) ?? false;
}

export function forceMemberPilotStats(value: ForceMember): string {
    if (!isCBTForceMember(value)) return `${value.getPilotStats()}`;
    const crew = value.force.getUnitCrewAssignment(value.id)?.positions ?? [];
    return crew.map(position => `${position.gunnery}/${position.piloting}`).join(' ');
}

/** Current skill-adjusted BV/PV for one visible force member. */
export function forceMemberAdjustedValue(value: ForceMember): number {
    if (!isCBTForceMember(value)) return value.getBv();
    return value.adjustedBattleValue() ?? value.summary.bv;
}

/** Pristine/base BV/PV for one visible force member. */
export function forceMemberBaseValue(value: ForceMember): number {
    if (!isCBTForceMember(value)) return value.getPreSkillBv();
    return value.pristineBattleValue() ?? value.summary.bv;
}

export function forceMemberCommander(value: ForceMember): boolean {
    if (!isCBTForceMember(value)) return value.commander();
    return value.force.isUnitCommander(value.id);
}
