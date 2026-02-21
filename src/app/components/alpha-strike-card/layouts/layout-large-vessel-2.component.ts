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

import { Component, ChangeDetectionStrategy, computed } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { AsLayoutBaseComponent } from './layout-base.component';

/*
 * Author: Drake
 *
 * Large Vessel Card 2 (DropShip) layout component for Alpha Strike cards.
 * Used for: DA, DS, SC (second card)
 */

interface ArcDamage {
    label: string;
    shortLabel: string;
    dmgS: number | string;
    dmgM: number | string;
    dmgL: number | string;
    dmgE: number | string;
    capS?: number | string;
    capM?: number | string;
    capL?: number | string;
    capE?: number | string;
    scapS?: number | string;
    scapM?: number | string;
    scapL?: number | string;
    scapE?: number | string;
    mslS?: number | string;
    mslM?: number | string;
    mslL?: number | string;
    mslE?: number | string;
    spe?: string;
}

/** Effective arc damage with crit damage reduction applied */
interface EffectiveArcDamage extends ArcDamage {
    effDmgS: string;
    effDmgM: string;
    effDmgL: string;
    effDmgE: string;
    effCapS: string;
    effCapM: string;
    effCapL: string;
    effCapE: string;
    effScapS: string;
    effScapM: string;
    effScapL: string;
    effScapE: string;
    effMslS: string;
    effMslM: string;
    effMslL: string;
    effMslE: string;
}

@Component({
    selector: 'as-layout-large-vessel-2',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './layout-large-vessel-2.component.html',
    styleUrls: ['./layout-large-vessel-2.component.scss'],
    imports: [
        UpperCasePipe,
    ],
    host: {
        '[class.interactive]': 'interactive()',
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutLargeVessel2Component extends AsLayoutBaseComponent {
    hasCap = computed<boolean>(() => {
        const stats = this.asStats();
        return stats.TP == 'WS' || stats.TP == 'SS' || stats.TP == 'JS';
    });
    /**
     * Get arc damage data from unit stats.
     * DropShips have arc-based damage (Nose, Aft, Left Side, Right Side).
     */
    arcDamageData = computed<ArcDamage[]>(() => {
        const stats = this.asStats();

        const d = this.dmgValue.bind(this);

        // Default damage values if no arc data
        if (!stats.usesArcs) {
            return [
                { label: 'NOSE ARC DAMAGE', shortLabel: 'NOSE', dmgS: '—', dmgM: '—', dmgL: '—', dmgE: '—' },
                { label: 'AFT ARC DAMAGE', shortLabel: 'AFT', dmgS: '—', dmgM: '—', dmgL: '—', dmgE: '—' },
                { label: 'LEFT SIDE DAMAGE', shortLabel: 'LS', dmgS: '—', dmgM: '—', dmgL: '—', dmgE: '—' },
                { label: 'RIGHT SIDE DAMAGE', shortLabel: 'RS', dmgS: '—', dmgM: '—', dmgL: '—', dmgE: '—' },
            ];
        }

        return [
            {
                label: 'NOSE ARC DAMAGE',
                shortLabel: 'NOSE',
                dmgS: d(stats.frontArc?.STD.dmgS),
                dmgM: d(stats.frontArc?.STD.dmgM),
                dmgL: d(stats.frontArc?.STD.dmgL),
                dmgE: d(stats.frontArc?.STD.dmgE),
                capS: d(stats.frontArc?.CAP.dmgS),
                capM: d(stats.frontArc?.CAP.dmgM),
                capL: d(stats.frontArc?.CAP.dmgL),
                capE: d(stats.frontArc?.CAP.dmgE),
                scapS: d(stats.frontArc?.SCAP.dmgS),
                scapM: d(stats.frontArc?.SCAP.dmgM),
                scapL: d(stats.frontArc?.SCAP.dmgL),
                scapE: d(stats.frontArc?.SCAP.dmgE),
                mslS: d(stats.frontArc?.MSL.dmgS),
                mslM: d(stats.frontArc?.MSL.dmgM),
                mslL: d(stats.frontArc?.MSL.dmgL),
                mslE: d(stats.frontArc?.MSL.dmgE),
                spe: stats.frontArc?.specials,
            },
            {
                label: 'AFT ARC DAMAGE',
                shortLabel: 'AFT',
                dmgS: d(stats.rearArc?.STD.dmgS),
                dmgM: d(stats.rearArc?.STD.dmgM),
                dmgL: d(stats.rearArc?.STD.dmgL),
                dmgE: d(stats.rearArc?.STD.dmgE),
                capS: d(stats.rearArc?.CAP.dmgS),
                capM: d(stats.rearArc?.CAP.dmgM),
                capL: d(stats.rearArc?.CAP.dmgL),
                capE: d(stats.rearArc?.CAP.dmgE),
                scapS: d(stats.rearArc?.SCAP.dmgS),
                scapM: d(stats.rearArc?.SCAP.dmgM),
                scapL: d(stats.rearArc?.SCAP.dmgL),
                scapE: d(stats.rearArc?.SCAP.dmgE),
                mslS: d(stats.rearArc?.MSL.dmgS),
                mslM: d(stats.rearArc?.MSL.dmgM),
                mslL: d(stats.rearArc?.MSL.dmgL),
                mslE: d(stats.rearArc?.MSL.dmgE),
                spe: stats.rearArc?.specials,
            },
            {
                label: 'LEFT SIDE DAMAGE',
                shortLabel: 'LS',
                dmgS: d(stats.leftArc?.STD.dmgS),
                dmgM: d(stats.leftArc?.STD.dmgM),
                dmgL: d(stats.leftArc?.STD.dmgL),
                dmgE: d(stats.leftArc?.STD.dmgE),
                capS: d(stats.leftArc?.CAP.dmgS),
                capM: d(stats.leftArc?.CAP.dmgM),
                capL: d(stats.leftArc?.CAP.dmgL),
                capE: d(stats.leftArc?.CAP.dmgE),
                scapS: d(stats.leftArc?.SCAP.dmgS),
                scapM: d(stats.leftArc?.SCAP.dmgM),
                scapL: d(stats.leftArc?.SCAP.dmgL),
                scapE: d(stats.leftArc?.SCAP.dmgE),
                mslS: d(stats.leftArc?.MSL.dmgS),
                mslM: d(stats.leftArc?.MSL.dmgM),
                mslL: d(stats.leftArc?.MSL.dmgL),
                mslE: d(stats.leftArc?.MSL.dmgE),
                spe: stats.leftArc?.specials,
            },
            {
                label: 'RIGHT SIDE DAMAGE',
                shortLabel: 'RS',
                dmgS: d(stats.rightArc?.STD.dmgS),
                dmgM: d(stats.rightArc?.STD.dmgM),
                dmgL: d(stats.rightArc?.STD.dmgL),
                dmgE: d(stats.rightArc?.STD.dmgE),
                capS: d(stats.rightArc?.CAP.dmgS),
                capM: d(stats.rightArc?.CAP.dmgM),
                capL: d(stats.rightArc?.CAP.dmgL),
                capE: d(stats.rightArc?.CAP.dmgE),
                scapS: d(stats.rightArc?.SCAP.dmgS),
                scapM: d(stats.rightArc?.SCAP.dmgM),
                scapL: d(stats.rightArc?.SCAP.dmgL),
                scapE: d(stats.rightArc?.SCAP.dmgE),
                mslS: d(stats.rightArc?.MSL.dmgS),
                mslM: d(stats.rightArc?.MSL.dmgM),
                mslL: d(stats.rightArc?.MSL.dmgL),
                mslE: d(stats.rightArc?.MSL.dmgE),
                spe: stats.rightArc?.specials,
            },
        ];
    });

    // Helper to convert 0 or "0" to em-dash
    private dmgValue(val: number | string | undefined): number | string {
        if (val === undefined || val === null || val === 0 || val === '0' || val === '') {
            return '—';
        }
        if (typeof val === 'string') {
            return parseInt(val, 10);
        }
        return val;
    }

    /**
     * Get column name from index based on whether CAP column is present.
     */
    getColumnName(index: number): string {
        if (this.hasCap()) {
            return ['STD', 'CAP', 'SCAP', 'MSL'][index] ?? '';
        }
        return ['STD', 'SCAP', 'MSL'][index] ?? '';
    }

    /**
     * Get effective arc damage with crit damage reduction applied.
     * Vessel weapon criticals reduce column damage by 50% per hit (halving each time).
     */
    effectiveArcDamageData = computed<EffectiveArcDamage[]>(() => {
        const arcs = this.arcDamageData();
        const forceUnit = this.forceUnit();
        
        return arcs.map(arc => {
            // Get crit hits for each column using column names
            const stdCrits = forceUnit?.getCommittedCritHits(`${arc.shortLabel}-STD`) ?? 0;
            const capCrits = forceUnit?.getCommittedCritHits(`${arc.shortLabel}-CAP`) ?? 0;
            const scapCrits = forceUnit?.getCommittedCritHits(`${arc.shortLabel}-SCAP`) ?? 0;
            const mslCrits = forceUnit?.getCommittedCritHits(`${arc.shortLabel}-MSL`) ?? 0;
            return {
                ...arc,
                effDmgS: this.applyVesselCritReduction(arc.dmgS, stdCrits),
                effDmgM: this.applyVesselCritReduction(arc.dmgM, stdCrits),
                effDmgL: this.applyVesselCritReduction(arc.dmgL, stdCrits),
                effDmgE: this.applyVesselCritReduction(arc.dmgE, stdCrits),
                effCapS: this.applyVesselCritReduction(arc.capS, capCrits),
                effCapM: this.applyVesselCritReduction(arc.capM, capCrits),
                effCapL: this.applyVesselCritReduction(arc.capL, capCrits),
                effCapE: this.applyVesselCritReduction(arc.capE, capCrits),
                effScapS: this.applyVesselCritReduction(arc.scapS, scapCrits),
                effScapM: this.applyVesselCritReduction(arc.scapM, scapCrits),
                effScapL: this.applyVesselCritReduction(arc.scapL, scapCrits),
                effScapE: this.applyVesselCritReduction(arc.scapE, scapCrits),
                effMslS: this.applyVesselCritReduction(arc.mslS, mslCrits),
                effMslM: this.applyVesselCritReduction(arc.mslM, mslCrits),
                effMslL: this.applyVesselCritReduction(arc.mslL, mslCrits),
                effMslE: this.applyVesselCritReduction(arc.mslE, mslCrits),
            };
        });
    });

    /**
     * Apply vessel weapon crit reduction: 25% reduction per crit hit. 4 hits = 100% reduction.
     * @param baseValue The base damage value (number or string)
     * @param critHits Number of crit hits applied
     * @returns The adjusted damage value as a string
     */
    private applyVesselCritReduction(baseValue: number | string | undefined, critHits: number): string {
        // If it's already a string (like '—') or not a number, return as-is
        if (baseValue === undefined || baseValue === null || typeof baseValue === 'string') {
            return String(baseValue ?? '—');
        }
        
        if (critHits <= 0) return String(baseValue);
        
        // Apply 25% reduction per hit, 1 hit = 25%, 2 hits = 50%, 3 hits = 75%, 4 hits = 100%
        const effectiveCrits = Math.min(critHits, 4);
        const reductionFactor = 1 - (effectiveCrits * 0.25);
        const reducedValue = Math.floor(baseValue * reductionFactor);
        
        return reducedValue <= 0 ? '0' : String(reducedValue);
    }
}
