// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, ChangeDetectionStrategy, computed, input, output, inject } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import type { ForceUnit } from '../../models/force-unit.model';
import type { Unit } from '../../models/units.model';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';
import { CdkMenuModule } from '@angular/cdk/menu';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import type { TooltipLine } from '../tooltip/tooltip.component';
import { ECMMode } from '../../models/common.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { C3Capabilities, C3Network, c3NetworkTypeName, type C3Component, type C3NetworkType } from '../../models/c3-network.model';
import { GameSystem } from '../../models/common.model';
import { formatMovement, formatMovementWithAlternate } from '../../utils/as-common.util';
import { getUnitConditionDefinition, unitConditionSortIndex } from '../../models/rules/unit-type-rules';
import { formatBvPv } from '../../utils/force-viewer-bv-pv-display.util';

interface UnitConditionDisplay {
    key: string;
    label: string;
    color: string;
}

interface ECMDisplay {
    mode: ECMMode | string;
    unavailable: boolean;
}

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
    forceUnit = input<ForceUnit>();
    compactMode = input<boolean>(false);
    ctrlHeld = input<boolean>(false);
    onInfo = output<MouseEvent>();
    onCloneUnit = output<MouseEvent>();
    onRemoveUnit = output<MouseEvent>();
    onOpenC3Network = output<MouseEvent>();
    onRepairUnit = output<MouseEvent>();
    onEditPilot = output<UnitBlockPilotEditEvent>();

    unit = computed<Unit | undefined>(() => {
        return this.forceUnit()?.getUnit();
    });

    alphaStrikePilotSkill = computed<number | undefined>(() => {
        const forceUnit = this.forceUnit();
        return forceUnit instanceof ASForceUnit ? forceUnit.getPilotSkill() : undefined;
    });

    displayedBvPv = computed(() => {
        const unit = this.forceUnit();
        if (!unit) return '';
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
        if (forceUnit instanceof ASForceUnit || forceUnit instanceof CBTForceUnit) {
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
        if (unit instanceof ASForceUnit) {
            return false;
        } else
        if (unit instanceof CBTForceUnit) {
            return unit.turnState().dirty();
        }
        return false;
    });

    unitPhase = computed<string>(() => {
        const unit = this.forceUnit();
        if (!unit) return '';
        if (unit instanceof ASForceUnit) {
            return '';
        } else
        if (unit instanceof CBTForceUnit) {
            const phase = unit.turnState().currentPhase();
            return phase || '';
        }
        return '';
    });

    hasPendingEffects = computed<boolean>(() => {
        if (!this.optionsService.options().trackPhaseAndTurn) {
            return false;
        }
        const unit = this.forceUnit();
        if (!unit) return false;
        if (unit instanceof ASForceUnit) {
            return false;
        } else
        if (unit instanceof CBTForceUnit) {
            return unit.turnState().dirtyPhase();
        }
        return false;
    });

    activeConditions = computed<UnitConditionDisplay[]>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return [];

        const conditionKeys = new Set(forceUnit.getConditions().keys());
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

        if (!(forceUnit instanceof CBTForceUnit)) return unitConditions;

        const crewStates = new Set(forceUnit.getCrewMembers().map(crewMember => crewMember.getState()));
        const crewConditions = Array.from(crewStates).flatMap(state => {
            const definition = forceUnit.rules.crewStateDefinition(state);
            return definition ? [{
                key: `crew-${definition.key}`,
                label: definition.bannerLabel,
                color: definition.color,
            }] : [];
        });

        const locationConditions = [];
        const hasNarc = Object.keys(forceUnit.getLocations()).some(location => forceUnit.getLocationCondition(location, 'narc'));
        if (hasNarc) {
            const narcDefinition = forceUnit.rules.locationConditionControls.find(condition => condition.key === 'narc');
            locationConditions.push({
                key: 'location-narc',
                label: narcDefinition?.label ?? 'NARC',
                color: narcDefinition?.color ?? '#f00',
            });
        };

        return [...unitConditions, ...crewConditions, ...locationConditions];
    });

    tagDisplay = computed<{ label: 'TAG' | 'LTAG'; unavailable: boolean } | undefined>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return undefined;
        if (forceUnit instanceof ASForceUnit) {
            const specials = forceUnit.getUnit().as.specials;
            if (specials.includes('TAG')) {
                return { label: 'TAG', unavailable: false };
            }
            if (specials.includes('LTAG')) {
                return { label: 'LTAG', unavailable: false };
            }
            return undefined;
        } else
        if (forceUnit instanceof CBTForceUnit) {
            const tagMounts = forceUnit.getMountedEquipmentByFlag('F_TAG');
            if (tagMounts.length === 0) return undefined;
            const tag = tagMounts.find(mount => mount.owner.canPerformEquipmentAction(mount, 'activate')) ?? tagMounts[0];
            const names = [tag.name, tag.equipment?.name, tag.equipment?.shortName, tag.equipment?.sortingName]
                .filter((name): name is string => !!name);
            return {
                label: names.some(name => /\blight\b/i.test(name)) ? 'LTAG' : 'TAG',
                unavailable: tagMounts.every(mount => !mount.owner.canPerformEquipmentAction(mount, 'activate')),
            };
        }
        return undefined;
    });

    ecmDisplay = computed<ECMDisplay | null>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return null;
        if (forceUnit instanceof ASForceUnit) {
            const mode = forceUnit.getUnit().as.specials.find(spec => spec === 'ECM' || spec === 'AECM' || spec === 'LECM');
            return mode ? { mode, unavailable: false } : null;
        }
        if (forceUnit instanceof CBTForceUnit) {
            const ecms = forceUnit.getMountedEquipmentByFlag('F_ECM');
            if (ecms.length === 0) return null;
            const mount = ecms.find(candidate => candidate.owner.canPerformEquipmentAction(candidate, 'activate')) ?? ecms[0];
            return {
                mode: mount.states.get('ecm_mode') as ECMMode || ECMMode.ECM,
                unavailable: ecms.every(candidate => !candidate.owner.canPerformEquipmentAction(candidate, 'activate')),
            };
        }
        return null;
    });

    /** Get individual C3 network items for display */
    c3NetworkItems = computed<{ label: string; networkType: C3NetworkType; enabled: boolean; unavailable: boolean; color?: string }[]>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return [];
        const components = new C3Capabilities(forceUnit).components;
        if (components.length === 0) return [];

        const networks = (forceUnit instanceof CBTForceUnit || forceUnit instanceof ASForceUnit) 
            ? forceUnit.force.c3Networks() 
            : [];
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
            
            const runtimeState = forceUnit instanceof CBTForceUnit
                ? forceUnit.getC3NetworkRuntimeState(networkType)
                : null;
            const enabled = runtimeState?.linked ?? !!connectedNetwork;
            
            // Get color from root network
            let color: string | undefined;
            if (runtimeState?.color) {
                color = runtimeState.color;
            } else if (connectedNetwork) {
                const rootNetwork = new C3Network(networks).rootOf(connectedNetwork.id) ?? connectedNetwork;
                color = rootNetwork.color;
            }
            
            items.push({
                label: c3NetworkTypeName(networkType),
                networkType,
                enabled,
                unavailable: forceUnit instanceof CBTForceUnit
                    && forceUnit.isC3NetworkTypeUnavailable(networkType),
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
        if (forceUnit instanceof ASForceUnit) {
            return this.formatTmm(forceUnit.effectiveTmm());
        }
        return forceUnit.getUnit()?.as?.TMM?.toString() ?? '';
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
        if (forceUnit instanceof ASForceUnit) {
            const effectiveMv = forceUnit.effectiveMovement();
            const entries = this.getMovementEntries(effectiveMv);
            if (entries.length === 0) return forceUnit.getUnit()?.as?.MV ?? '';
            return entries
                .map(([mode, inches]) => this.formatASMovementEntry(forceUnit, mode, inches))
                .join('/');
        }
        return forceUnit.getUnit()?.as?.MV ?? '';
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
        if (!(forceUnit instanceof CBTForceUnit)) return null;

        const baseBv = forceUnit.getUnit().bv;
        const ammoBvVariation = forceUnit.customAmmoBvVariation();
        const totalBv = forceUnit.getBv();
        if (baseBv === totalBv) return null; // No adjustments
        const tagBv = forceUnit.tagBV();
        const c3Tax = forceUnit.c3Tax();
        const pilotBv = forceUnit.pilotBV();

        const lines: TooltipLine[] = [];
        if (baseBv > 0) {
            lines.push({ label: 'Base', value: `${baseBv}` });
        }
        if (ammoBvVariation !== 0) {
            const sign = ammoBvVariation > 0 ? '+' : '';
            lines.push({ label: 'Custom Ammo', value: `${sign}${ammoBvVariation}` });
        }
        if (tagBv > 0) {
            lines.push({ label: 'TAG', value: `+${tagBv}` });
        }
        if (c3Tax > 0) {
            lines.push({ label: 'C³', value: `+${c3Tax}` });
        }
        if (pilotBv !== 0) {
            const sign = pilotBv > 0 ? '+' : '';
            lines.push({ label: 'Pilot', value: `${sign}${pilotBv}` });
        }
        lines.push({ isBreak: true });
        if (tagBv > 0 || c3Tax > 0 || pilotBv !== 0) {
            lines.push({ label: 'Total', value: `${totalBv}` });
        }

        return lines.length > 0 ? lines : null;
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
