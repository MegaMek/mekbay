// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { computed, signal } from '@angular/core';
import type { CBTForce } from './cbt-force.model';
import type { ASForceUnit } from './as-force-unit.model';
import type { BaseEntity } from './entity/base-entity';
import type { UnitInstanceId } from './runtime/runtime-state';
import type { UnitSummary } from './unit-summary.model';
import type { UnitProviderId, UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import type { ForceViewerBVPVDisplayDamage } from './options.model';
import type { NonMekRecordSheetSnapshot } from './runtime/non-mek-record-sheet';

const MAX_RECORD_SHEET_PAGES = 2;

/** A direct Classic member. Its force owns the entity, rules, and sparse runtime. */
export class CBTForceMember {
    readonly kind: 'cbt';
    readonly id: UnitInstanceId;
    readonly force: CBTForce;
    readonly entity: BaseEntity;
    #recordSheets: readonly SVGSVGElement[] = [];
    #recordSheetLoad: Promise<readonly SVGSVGElement[]> | null = null;
    readonly #recordSheetIndex = signal(0);
    readonly #runtime = signal<Readonly<{
        owner: object | null;
        revision: number | null;
    }>>(Object.freeze({ owner: null, revision: null }));
    readonly #battleValueRuntime = signal<Readonly<{
        owner: object | null;
        revision: number | null;
    }>>(Object.freeze({ owner: null, revision: null }));
    readonly #tacticalInventoryExpandedRows = signal<ReadonlySet<string>>(new Set());

    /** Current entity + rules + sparse-runtime BV; only this unit can invalidate it. */
    readonly currentBaseBattleValue = computed(() => {
        this.#battleValueRuntime();
        return this.force.getUnitCurrentBaseBattleValue(this.id);
    });

    /** One reactive record-sheet projection per exact runtime revision. */
    readonly mekRecordSheetSnapshot = computed(() => {
        this.#runtime();
        return this.force.getMekRecordSheetSnapshot(this.id);
    });

    /** One reactive non-Mek record-sheet projection per exact runtime revision. */
    readonly nonMekRecordSheetSnapshot = computed<NonMekRecordSheetSnapshot | null>(() => {
        this.#runtime();
        return this.force.getNonMekRecordSheetSnapshot(this.id);
    });

    /** Immutable entity BV before damage and force-level adjustments. */
    readonly pristineBattleValue = computed(() => this.force.getUnitPristineBattleValue(this.id));

    /** TAG + configured, intact C3 topology + skills over current base BV. */
    readonly adjustedBattleValue = computed(() => this.force.getUnitAdjustedBattleValue(this.id));

    /** The same force adjustments over immutable Entity BV instead of runtime-damaged BV. */
    readonly pristineAdjustedBattleValue = computed(() =>
        this.force.getUnitPristineAdjustedBattleValue(this.id));

    readonly c3State = computed(() => this.force.getC3State(this.id));

    public tagBattleValue(): number | null {
        return this.force.getUnitTagBattleValue(this.id);
    }

    public c3BattleValue(): number | null {
        return this.force.getUnitC3BattleValue(this.id);
    }

    /** The currently visible page of this member's lazily generated sheet set. */
    public recordSheet(): SVGSVGElement | null {
        return this.#recordSheets[this.#recordSheetIndex()] ?? null;
    }

    public recordSheets(): readonly SVGSVGElement[] {
        return this.#recordSheets;
    }

    public recordSheetIndex(): number {
        return this.#recordSheetIndex();
    }

    public loadRecordSheets(
        create: () => Promise<readonly SVGSVGElement[]>,
    ): Promise<readonly SVGSVGElement[]> {
        if (this.#recordSheets.length > 0) return Promise.resolve(this.#recordSheets);
        if (this.#recordSheetLoad) return this.#recordSheetLoad;

        const pending = create()
            .then(svgs => {
                if (svgs.length === 0) throw new Error('A record-sheet set cannot be empty');
                this.#recordSheets = Object.freeze(svgs.slice(0, MAX_RECORD_SHEET_PAGES));
                this.#recordSheetIndex.set(0);
                return this.#recordSheets;
            })
            .finally(() => {
                this.#recordSheetLoad = null;
            });
        this.#recordSheetLoad = pending;
        return pending;
    }

    /** Cycles this member's presentation page without changing gameplay state. */
    public showNextRecordSheet(): SVGSVGElement | null {
        if (this.#recordSheets.length === 0) return null;
        this.#recordSheetIndex.update(index => (index + 1) % this.#recordSheets.length);
        return this.recordSheet();
    }

    /** Runtime-only presentation memory; never enters persistence or gameplay history. */
    public isTacticalInventoryRowExpanded(rowId: string): boolean {
        return this.#tacticalInventoryExpandedRows().has(rowId);
    }

    public setTacticalInventoryRowExpanded(rowId: string, expanded: boolean): void {
        const current = this.#tacticalInventoryExpandedRows();
        if (current.has(rowId) === expanded) return;
        const next = new Set(current);
        if (expanded) next.add(rowId);
        else next.delete(rowId);
        this.#tacticalInventoryExpandedRows.set(next);
    }

    public setTacticalInventoryRowsExpanded(rowIds: readonly string[]): void {
        this.#tacticalInventoryExpandedRows.set(new Set(rowIds));
    }

    public constructor(
        id: UnitInstanceId,
        force: CBTForce,
        entity: BaseEntity,
    ) {
        this.kind = 'cbt';
        this.id = id;
        this.force = force;
        this.entity = entity;
        Object.freeze(this);
    }

    /** Publishes a new runtime witness only when this exact member changed. */
    public bindRuntime(
        owner: object | null,
        revision: number | null,
        battleValueChanged = true,
    ): boolean {
        const current = this.#runtime();
        const changed = current.owner !== owner || current.revision !== revision;
        if (changed) this.#runtime.set(Object.freeze({ owner, revision }));
        if (battleValueChanged) {
            const battleValueCurrent = this.#battleValueRuntime();
            if (battleValueCurrent.owner !== owner || battleValueCurrent.revision !== revision) {
                this.#battleValueRuntime.set(Object.freeze({ owner, revision }));
            }
        }
        return changed;
    }

    public get rosterGroupId(): string {
        const groupId = this.force.getRosterGroupId(this.id);
        if (groupId === null) throw new Error(`Classic force member ${this.id} is no longer owned`);
        return groupId;
    }

    public getFormationEntity(): BaseEntity {
        return this.entity;
    }

}

/** A real family narrowing used only by Mek-specific rules and UI. */
export type CBTMekForceMember = CBTForceMember & Readonly<{
    entity: BaseEntity & Readonly<{ entityType: 'Mek' }>;
}>;

export type ForceMember = ASForceUnit | CBTForceMember;
export type ForceMemberPresentationUnit = UnitSummary | BaseEntity;

export function isCBTForceMember(value: ForceMember | null | undefined): value is CBTForceMember {
    return value !== null
        && value !== undefined
        && 'kind' in value
        && value.kind === 'cbt';
}

export function isCBTMekForceMember(value: ForceMember | null | undefined): value is CBTMekForceMember {
    return isCBTForceMember(value) && value.entity.entityType === 'Mek';
}

export function alphaStrikeMemberSummary(value: ASForceUnit): UnitSummary {
    return value.getSummary();
}

/** Entity for loaded Classic members; lightweight catalog projection for Alpha Strike. */
export function forceMemberPresentationUnit(value: ForceMember): ForceMemberPresentationUnit {
    return isCBTForceMember(value) ? value.entity : value.getSummary();
}

/**
 * Explicit catalog boundary for search-derived metadata and cross-system admission.
 * Classic members never retain the returned projection.
 */
export function resolveForceMemberCatalogSummary(
    value: ForceMember,
    resolve: (provider: UnitProviderId, uuid: UnitUuid) => UnitSummary | undefined,
): UnitSummary | undefined {
    if (!isCBTForceMember(value)) return value.getSummary();
    const identity = value.force.getUnitSourceIdentity(value.id);
    return identity ? resolve(identity.provider, identity.uuid) : undefined;
}

export function forceMemberDisplayName(value: ForceMember): string {
    return isCBTForceMember(value) ? value.entity.displayName() : value.getDisplayName();
}

export function forceMemberChassis(value: ForceMember): string {
    return isCBTForceMember(value) ? value.entity.chassis() : value.getSummary().chassis;
}

export function forceMemberModel(value: ForceMember): string {
    return isCBTForceMember(value) ? value.entity.model() : value.getSummary().model;
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
export function forceMemberAdjustedValue(
    value: ForceMember,
    damageMode: ForceViewerBVPVDisplayDamage,
): number {
    if (!isCBTForceMember(value)) return value.getBv();
    return damageMode === 'pristine'
        ? value.pristineAdjustedBattleValue() ?? value.entity.battleValue()
        : value.adjustedBattleValue() ?? value.entity.battleValue();
}

/** Pre-skill BV/PV under the selected Classic damage policy. */
export function forceMemberBaseValue(
    value: ForceMember,
    damageMode: ForceViewerBVPVDisplayDamage,
): number {
    if (!isCBTForceMember(value)) return value.getPreSkillBv();
    return damageMode === 'pristine'
        ? value.pristineBattleValue() ?? value.entity.battleValue()
        : value.currentBaseBattleValue() ?? value.entity.battleValue();
}

export function forceMemberCommander(value: ForceMember): boolean {
    if (!isCBTForceMember(value)) return value.commander();
    return value.force.isUnitCommander(value.id);
}
