/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Component, ChangeDetectionStrategy, computed, input, output, inject } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ForceUnit } from '../../models/force-unit.model';
import { Unit } from '../../models/units.model';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';
import { CdkMenuModule } from '@angular/cdk/menu';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { TooltipLine } from '../tooltip/tooltip.component';
import { ECMMode } from '../../models/common.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { C3NetworkUtil } from '../../utils/c3-network.util';
import { C3Component, C3NetworkType } from '../../models/c3-network.model';
import { GameSystem } from '../../models/common.model';
import { formatMovement } from '../../utils/as-common.util';

/**
 * Author: Drake
 */
@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CdkMenuModule, FormatNumberPipe, FormatTonsPipe, UnitIconComponent, TooltipDirective, UpperCasePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-block.component.html',
    styleUrls: ['./unit-block.component.scss'],
})
export class UnitBlockComponent {
    optionsService = inject(OptionsService);
    forceUnit = input<ForceUnit>();
    compactMode = input<boolean>(false);
    onInfo = output<MouseEvent>();
    onRemoveUnit = output<MouseEvent>();
    onOpenC3Network = output<MouseEvent>();
    onRepairUnit = output<MouseEvent>();
    onEditPilot = output<MouseEvent>();

    unit = computed<Unit | undefined>(() => {
        return this.forceUnit()?.getUnit();
    });

    /** Derives Alpha Strike status from the unit's own force, not the global game system. */
    isAlphaStrike = computed<boolean>(() => this.forceUnit()?.force?.gameSystem === GameSystem.ALPHA_STRIKE);

    dirty = computed<boolean>(() => {
        if (!this.optionsService.options().useAutomations) {
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
        if (!this.optionsService.options().useAutomations) {
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

    hasECM = computed(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return false;
        if (forceUnit instanceof ASForceUnit) {
            const hasECM = forceUnit.getUnit().as.specials.some(spec => spec === 'ECM' || spec === 'AECM' || spec === 'LECM');
            return hasECM;
        } else 
        if (forceUnit instanceof CBTForceUnit) {
            const hasECM = forceUnit.getUnit().comp.some(eq => eq.eq?.flags.has('F_ECM'));
            return hasECM;
        }
        return false;
    });

    getECMStatus = computed<boolean | undefined>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return undefined;
        if (forceUnit instanceof ASForceUnit) {
            return true;
        } else 
        if (forceUnit instanceof CBTForceUnit) {
            forceUnit.getCritSlots();
            const mountedECM = forceUnit.getInventory().find(eq => eq.equipment?.flags.has('F_ECM'));
            if (!mountedECM) return undefined;
            if (mountedECM.destroyed) {
                return false;
            }
            return true;
        }
        return undefined;
    });

    getECMMode = computed<ECMMode | string | undefined>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return undefined;
        if (forceUnit instanceof ASForceUnit) {
            // we return ECM, AECM or LECM as mode for AS units
            const ecmSpec = forceUnit.getUnit().as.specials.find(spec => spec === 'ECM' || spec === 'AECM' || spec === 'LECM');
            return ecmSpec || undefined;
        } else 
        if (forceUnit instanceof CBTForceUnit) {
            forceUnit.getCritSlots();
            const mountedECM = forceUnit.getInventory().find(eq => eq.equipment?.flags.has('F_ECM'));
            if (!mountedECM) return ECMMode.ECM;
            return mountedECM ? mountedECM.states?.get('ecm_mode') as ECMMode || ECMMode.ECM : ECMMode.ECM;
        }
        return undefined;
    });

    /** Get individual C3 network items for display */
    c3NetworkItems = computed<{ label: string; networkType: C3NetworkType; enabled: boolean; color?: string }[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        
        // getC3Components now handles both CBT (component flags) and AS (specials)
        const components = C3NetworkUtil.getC3Components(unit);
        if (components.length === 0) return [];
        
        const forceUnit = this.forceUnit();
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
        
        const items: { label: string; networkType: C3NetworkType; enabled: boolean; color?: string }[] = [];
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
                const rootNetwork = C3NetworkUtil.getRootNetwork(connectedNetwork, networks);
                color = rootNetwork.color;
            }
            
            items.push({
                label: C3NetworkUtil.getNetworkTypeName(networkType),
                networkType,
                enabled,
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
                .map(([mode, inches]) => formatMovement(inches, mode, this.optionsService.options().ASUseHex))
                .join('/');
        }
        return forceUnit.getUnit()?.as?.MV ?? '';
    });

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

        const baseBv = unit.bv;
        const totalBv = forceUnit.getBv();
        if (baseBv === totalBv) return null; // No adjustments
        const c3Tax = forceUnit.c3Tax();
        const pilotDiff = totalBv - baseBv - c3Tax;

        const lines: TooltipLine[] = [];
        if (baseBv > 0) {
            lines.push({ label: 'Base', value: `${baseBv}` });
        }
        if (c3Tax > 0) {
            lines.push({ label: 'Network', value: `+${c3Tax}` });
        }
        if (pilotDiff !== 0) {
            const sign = pilotDiff > 0 ? '+' : '';
            lines.push({ label: 'Pilot', value: `${sign}${pilotDiff}` });
        }
        if (c3Tax > 0 || pilotDiff !== 0) {
            lines.push({ label: 'Total', value: `=${totalBv}` });
        }

        return lines.length > 0 ? lines : null;
    });

    clickInfo(event: MouseEvent): void {
        event.stopPropagation();
        this.onInfo.emit(event);
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
        this.onEditPilot.emit(event);
    }
}