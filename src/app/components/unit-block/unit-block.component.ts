// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, computed, effect, input, output, inject, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import type { UnitSummary } from '../../models/unit-summary.model';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';
import { CdkMenuModule } from '@angular/cdk/menu';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { C3Capabilities, C3Network, C3NetworkType, c3NetworkTypeName, type C3Component } from '../../models/c3-network.model';
import { GameSystem } from '../../models/common.model';
import { formatMovement, formatMovementWithAlternate } from '../../utils/as-common.util';
import {
    crewStateDefinitions,
    getUnitConditionDefinition,
    NARC_CONDITION_COLOR,
    unitConditionSortIndex,
} from '../../models/unit-status-presentation';
import { MEK_CREW_STATE_DISPLAYS } from '../../models/mek-record-sheet-controls';
import { formatBvPv } from '../../utils/force-viewer-bv-pv-display.util';
import {
    isMekTurnPanelDirty,
    isMekTurnPanelDirtyPhase,
    mekTurnPanelPhase,
} from '../../models/runtime/mek-turn-panel';
import {
    forceMemberAlias,
    forceMemberAdjustedValue,
    forceMemberBaseValue,
    forceMemberDestroyed,
    forceMemberPilotStats,
    isCBTForceMember,
    isCBTMekForceMember,
    type ForceMember,
} from '../../models/force-member.model';

interface UnitConditionDisplay {
    key: string;
    label: string;
    color: string;
}

const VEHICLE_CREW_STATE_DISPLAYS = crewStateDefinitions(['killed', 'stunned']);
const PROTOMEK_CREW_STATE_DISPLAYS = crewStateDefinitions(['unconscious', 'dead']);

export interface UnitBlockPilotEditEvent {
    event: MouseEvent;
}

@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CdkMenuModule, FormatTonsPipe, UnitIconComponent, TooltipDirective, UpperCasePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-block.component.html',
    styleUrls: ['./unit-block.component.scss'],
})
export class UnitBlockComponent {
    optionsService = inject(OptionsService);
    forceUnit = input<ForceMember>();
    compactMode = input<boolean>(false);
    ctrlHeld = input<boolean>(false);
    onInfo = output<MouseEvent>();
    onCloneUnit = output<MouseEvent>();
    onRemoveUnit = output<MouseEvent>();
    onOpenC3Network = output<MouseEvent>();
    onRepairUnit = output<MouseEvent>();
    onEditPilot = output<UnitBlockPilotEditEvent>();

    private readonly runtimeRevision = signal(0);

    unit = computed<UnitSummary | undefined>(() => {
        this.runtimeRevision();
        const member = this.forceUnit();
        return member ? (isCBTForceMember(member) ? member.summary : member.getSummary()) : undefined;
    });

    destroyed = computed(() => {
        this.runtimeRevision();
        const member = this.forceUnit();
        return member ? forceMemberDestroyed(member) : false;
    });

    alias = computed(() => {
        const member = this.forceUnit();
        return member ? forceMemberAlias(member) : null;
    });

    readOnly = computed(() => this.forceUnit()?.force.readOnly() ?? true);

    pilotStats = computed(() => {
        this.runtimeRevision();
        const member = this.forceUnit();
        return member ? forceMemberPilotStats(member) : '';
    });

    public constructor() {
        effect(onCleanup => {
            const member = this.forceUnit();
            if (!member || !isCBTForceMember(member)) return;
            const subscription = member.force.changed.subscribe(changedUnitIds => {
                if (changedUnitIds?.includes(member.id) ?? true) {
                    this.runtimeRevision.update(value => value + 1);
                }
            });
            onCleanup(() => subscription.unsubscribe());
        });
    }

    alphaStrikePilotSkill = computed<number | undefined>(() => {
        const forceUnit = this.forceUnit();
        return forceUnit instanceof ASForceUnit ? forceUnit.getPilotSkill() : undefined;
    });

    displayedBvPv = computed(() => {
        const startedAt = performance.now();
        const unit = this.forceUnit();
        if (!unit) return '';
        if (isCBTForceMember(unit)) {
            const result = formatBvPv(
                forceMemberAdjustedValue(unit),
                forceMemberBaseValue(unit),
                this.optionsService.options().forceViewerBVPVDisplay,
            );
            console.info(`[unit-block-perf] bv ${unit.summary.name} ${(performance.now() - startedAt).toFixed(1)}ms`);
            return result;
        }
        return formatBvPv(
            unit.getBv(),
            unit.getPreSkillBv(),
            this.optionsService.options().forceViewerBVPVDisplay,
        );
    });

    /** Derives Alpha Strike status from the unit's own force, not the global game system. */
    isAlphaStrike = computed<boolean>(() => this.forceUnit()?.force?.gameSystem === GameSystem.ALPHA_STRIKE);

    isCommander = computed<boolean>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return false;
        if (isCBTForceMember(forceUnit)) {
            this.runtimeRevision();
            return forceUnit.force.isUnitCommander(forceUnit.id);
        }
        if (forceUnit instanceof ASForceUnit) {
            return forceUnit.commander();
        }
        return false;
    });

    dirty = computed<boolean>(() => {
        if (!this.optionsService.options().trackPhaseAndTurn) {
            return false;
        }
        const unit = this.forceUnit();
        if (!unit) return false;
        if (isCBTMekForceMember(unit)) {
            this.runtimeRevision();
            const snapshot = unit.force.getMekTurnPanelSnapshot(unit.id, 'manual');
            return snapshot !== null && isMekTurnPanelDirty(snapshot);
        }
        return false;
    });

    unitPhase = computed<string>(() => {
        const unit = this.forceUnit();
        if (!unit) return '';
        if (isCBTMekForceMember(unit)) {
            this.runtimeRevision();
            const snapshot = unit.force.getMekTurnPanelSnapshot(unit.id, 'manual');
            return snapshot === null ? '' : mekTurnPanelPhase(snapshot);
        }
        if (unit instanceof ASForceUnit) {
            return '';
        }
        return '';
    });

    hasPendingEffects = computed<boolean>(() => {
        if (!this.optionsService.options().trackPhaseAndTurn) {
            return false;
        }
        const unit = this.forceUnit();
        if (!unit) return false;
        if (isCBTMekForceMember(unit)) {
            this.runtimeRevision();
            const snapshot = unit.force.getMekTurnPanelSnapshot(unit.id, 'manual');
            return snapshot !== null && isMekTurnPanelDirtyPhase(snapshot);
        }
        return false;
    });

    activeConditions = computed<UnitConditionDisplay[]>(() => {
        const startedAt = performance.now();
        const forceUnit = this.forceUnit();
        if (!forceUnit) return [];
        this.runtimeRevision();
        const conditionKeys = new Set<string>();
        let crewConditions: UnitConditionDisplay[] = [];
        let locationConditions: UnitConditionDisplay[] = [];
        if (isCBTMekForceMember(forceUnit)) {
            const sheet = forceUnit.force.getMekRecordSheetSnapshot(forceUnit.id);
            const turn = forceUnit.force.getMekTurnPanelSnapshot(forceUnit.id, 'manual');
            sheet?.conditions.forEach(condition => conditionKeys.add(condition));
            turn?.conditions.forEach(condition => conditionKeys.add(condition));
            if (sheet?.crippled) conditionKeys.add('crippled');
            if (turn?.turn.spotting) conditionKeys.add('spotting');
            const crewStates = new Set(sheet?.crew.map(position => position.effectiveState) ?? []);
            crewConditions = [...crewStates].flatMap(state => {
                if (state === 'healthy') return [];
                const definition = MEK_CREW_STATE_DISPLAYS.find(candidate => candidate.key === state);
                return definition ? [{
                    key: `crew-${definition.key}`,
                    label: definition.bannerLabel,
                    color: definition.color,
                }] : [];
            });
            const hasNarc = sheet?.locations.some(location => location.conditions.some(condition =>
                condition.condition === 'narc' && condition.preview > 0)) ?? false;
            if (hasNarc) {
                locationConditions = [{ key: 'location-narc', label: 'NARC', color: NARC_CONDITION_COLOR }];
            }
        } else if (isCBTForceMember(forceUnit)) {
            forceUnit.force.getUnitConditions(forceUnit.id)?.forEach(condition => conditionKeys.add(condition));
            const sheet = forceUnit.force.getNonMekRecordSheetSnapshot(forceUnit.id);
            const definitions = sheet?.unitType === 'ProtoMek'
                ? PROTOMEK_CREW_STATE_DISPLAYS
                : sheet !== null && ['Tank', 'VTOL', 'Naval'].includes(sheet.unitType)
                    ? VEHICLE_CREW_STATE_DISPLAYS
                    : [];
            const crewStates = new Set(sheet?.crew.map(position => position.effectiveState) ?? []);
            crewConditions = [...crewStates].flatMap(state => {
                const definition = definitions.find(candidate => candidate.key === state);
                return definition ? [{
                    key: `crew-${definition.key}`,
                    label: definition.bannerLabel,
                    color: definition.color,
                }] : [];
            });
        } else {
            for (const condition of forceUnit.getConditions().keys()) conditionKeys.add(condition);
        }

        const unitConditions = Array.from(conditionKeys)
            .map(key => {
                const condition = getUnitConditionDefinition(key);
                return {
                    key,
                    label: condition?.bannerLabel ?? condition?.label ?? key.toUpperCase(),
                    color: condition?.color ?? '#666',
                };
            })
            .sort((left, right) => unitConditionSortIndex(left.key) - unitConditionSortIndex(right.key) || left.label.localeCompare(right.label));
        const result = [...unitConditions, ...crewConditions, ...locationConditions];
        if (isCBTForceMember(forceUnit)) {
            console.info(`[unit-block-perf] conditions ${forceUnit.summary.name} ${(performance.now() - startedAt).toFixed(1)}ms`);
        }
        return result;
    });

    private readonly capabilitySummary = computed(() => {
        const member = this.forceUnit();
        return !member || isCBTForceMember(member)
            ? null
            : member.getTagEcmCapabilitySummary();
    });

    tagDisplay = computed(() => this.capabilitySummary()?.tag ?? undefined);

    ecmDisplay = computed(() => this.capabilitySummary()?.ecm ?? null);

    /** Get individual C3 network items for display */
    c3NetworkItems = computed<{ label: string; networkType: C3NetworkType; enabled: boolean; unavailable: boolean; color?: string }[]>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return [];
        if (isCBTForceMember(forceUnit)) {
            const networkType = summaryC3NetworkType(forceUnit.summary.c3);
            if (!networkType) return [];
            const state = forceUnit.c3State();
            const connected = forceUnit.force.c3EncounterNetworks().find(network =>
                network.networkType === networkType
                && network.endpoints.some(endpoint => endpoint.instanceId === forceUnit.id));
            return [{
                label: c3NetworkTypeName(networkType),
                networkType,
                enabled: state === 'operational',
                unavailable: state === 'degraded',
                ...(connected ? { color: connected.color } : {}),
            }];
        }
        const components = new C3Capabilities(forceUnit).components;
        if (components.length === 0) return [];

        const networks = forceUnit instanceof ASForceUnit ? forceUnit.force.c3Networks() : [];
        const unitId = forceUnit?.id;
        
        // Group by network type to get unique types
        const typeMap = new Map<C3NetworkType, C3Component[]>();
        for (const comp of components) {
            const existing = typeMap.get(comp.networkType) || [];
            existing.push(comp);
            typeMap.set(comp.networkType, existing);
        }
        
        const items: { label: string; networkType: C3NetworkType; enabled: boolean; unavailable: boolean; color?: string }[] = [];
        for (const [networkType] of typeMap) {
            // Find the network this unit is connected to for this type
            const connectedNetwork = unitId ? networks.find(n => 
                n.type === networkType && (
                    n.masterId === unitId ||
                    n.peerIds?.includes(unitId) ||
                    n.members?.some(m => m === unitId || m.startsWith(unitId + ':'))
                )
            ) : undefined;
            
            const enabled = !!connectedNetwork;
            
            // Get color from root network
            let color: string | undefined;
            if (connectedNetwork) {
                const rootNetwork = new C3Network(networks).rootOf(connectedNetwork.id) ?? connectedNetwork;
                color = rootNetwork.color;
            }
            
            items.push({
                label: c3NetworkTypeName(networkType),
                networkType,
                enabled,
                unavailable: false,
                color
            });
        }
        
        return items;
    });

    cleanedModel = computed(() => {
        const unit = this.unit();
        if (!unit || !unit.model) return '';
        return unit.model.replace(/\s*\(.*?\)\s*/g, '').trim();
    });

    /** Get the effective TMM for Alpha Strike units */
    getEffectiveTmm = computed<string>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return '';
        if (isCBTMekForceMember(forceUnit)) return forceUnit.summary.as?.TMM?.toString() ?? '';
        if (forceUnit instanceof ASForceUnit) {
            return this.formatTmm(forceUnit.effectiveTmm());
        }
        return forceUnit.getSummary()?.as?.TMM?.toString() ?? '';
    });

    private formatTmm(tmm: { [mode: string]: number }): string {
        const entries = Object.entries(tmm);
        if (entries.length === 0) return '';
        return entries
            .map(([mode, value]) => `${value}${mode}`)
            .join('/');
    }

    /** Get the effective movement display for Alpha Strike units */
    getEffectiveMovement = computed<string>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return '';
        if (isCBTMekForceMember(forceUnit)) return forceUnit.summary.as?.MV ?? '';
        if (forceUnit instanceof ASForceUnit) {
            const effectiveMv = forceUnit.effectiveMovement();
            const entries = this.getMovementEntries(effectiveMv);
            if (entries.length === 0) return forceUnit.getSummary()?.as?.MV ?? '';
            return entries
                .map(([mode, inches]) => this.formatASMovementEntry(forceUnit, mode, inches))
                .join('/');
        }
        return forceUnit.getSummary()?.as?.MV ?? '';
    });

    private formatASMovementEntry(forceUnit: ASForceUnit, mode: string, inches: number): string {
        const useHex = this.optionsService.options().ASUseHex;
        const display = forceUnit.movementDisplayValue(mode, inches);
        const formatted = display.adjustedInches !== undefined
            ? formatMovementWithAlternate(display.baseInches, display.adjustedInches, mode, useHex)
            : formatMovement(display.baseInches, mode, useHex);

        return formatted;
    }

    showTMM = computed<boolean>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return true;
        if (isCBTMekForceMember(forceUnit)) return true;
        if (forceUnit instanceof ASForceUnit) {
            return !forceUnit.isAerospace();
        }
        return true;
    });

    private getMovementEntries(mvm: Record<string, number> | undefined): Array<[string, number]> {
        if (!mvm) return [];
        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number') as Array<[string, number]>;
        return entries;
    }

    bvTooltip = computed<TooltipLine[] | null>(() => {
        const forceUnit = this.forceUnit();
        const unit = this.unit();
        if (!forceUnit || !unit) return null;
        if (isCBTForceMember(forceUnit)) {
            const pristine = forceUnit.pristineBattleValue();
            const current = forceUnit.currentBaseBattleValue();
            const tag = forceUnit.tagBattleValue();
            const c3 = forceUnit.c3BattleValue();
            const adjusted = forceUnit.adjustedBattleValue();
            if (pristine === null || current === null || tag === null || c3 === null || adjusted === null
                || (current === pristine && adjusted === current)) return null;
            const lines: TooltipLine[] = [{ label: 'Base', value: `${pristine}` }];
            if (current !== pristine) lines.push({ label: 'Damage', value: `${current}` });
            if (tag !== 0) lines.push({ label: 'TAG', value: `+${tag}` });
            if (c3 !== 0) lines.push({ label: 'C3', value: `+${c3}` });
            const preSkill = current + tag + c3;
            if (adjusted !== preSkill) lines.push({ label: 'Skills', value: `${adjusted - preSkill}` });
            lines.push({ isBreak: true }, { label: 'Total', value: `${adjusted}` });
            return lines;
        }
        return null;
    });

    clickInfo(event: MouseEvent): void {
        event.stopPropagation();
        if (this.ctrlHeld()) {
            this.onCloneUnit.emit(event);
        } else {
            this.onInfo.emit(event);
        }
    }

    repairUnit(event: MouseEvent): void {
        event.stopPropagation();
        this.onRepairUnit.emit(event);
    }

    clickRemove(event: MouseEvent): void {
        event.stopPropagation();
        this.onRemoveUnit.emit(event);
    }

    openC3Network(event: MouseEvent): void {
        event.stopPropagation();
        this.onOpenC3Network.emit(event);
    }

    editPilot(event: MouseEvent): void {
        event.stopPropagation();
        this.onEditPilot.emit({ event });
    }
}

function summaryC3NetworkType(value: string): C3NetworkType | null {
    if (value === 'C3') return C3NetworkType.C3;
    if (value === 'C3i') return C3NetworkType.C3I;
    if (value === 'Naval C3') return C3NetworkType.NAVAL;
    if (value === 'Nova CEWS') return C3NetworkType.NOVA;
    return null;
}
