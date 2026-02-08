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

import {
    Component,
    ChangeDetectionStrategy,
    computed,
    signal,
    inject,
    ElementRef,
    DestroyRef,
    afterNextRender,
    viewChild,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { CriticalHitsVariant, getLayoutForUnitType } from '../card-layout.config';
import {
    AsCriticalHitsMekComponent,
    AsCriticalHitsVehicleComponent,
    AsCriticalHitsProtomekComponent,
    AsCriticalHitsAerofighterComponent,
    AsCriticalHitsEmplacementComponent,
} from '../critical-hits';
import { AsLayoutBaseComponent } from './layout-base.component';
import { formatMovement, isAerospace } from '../../../utils/as-common.util';

/*
 * Author: Drake
 *
 * Standard layout component for Alpha Strike cards.
 */

@Component({
    selector: 'as-layout-standard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        UpperCasePipe,
        AsCriticalHitsMekComponent,
        AsCriticalHitsProtomekComponent,
        AsCriticalHitsVehicleComponent,
        AsCriticalHitsAerofighterComponent,
        AsCriticalHitsEmplacementComponent,
    ],
    templateUrl: './layout-standard.component.html',
    styleUrls: ['./layout-standard.component.scss'],
    host: {
        '[class.monochrome]': 'cardStyle() === "monochrome"',
    }
})
export class AsLayoutStandardComponent extends AsLayoutBaseComponent {
    private readonly elRef = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);
    private readonly statsContainerRef = viewChild('statsContainer', { read: ElementRef<HTMLElement> });

    private readonly statsToHostHeightThreshold = 0.67;
    private resizeObserver: ResizeObserver | null = null;
    chassisSmall = signal(false);

    // Critical hits variant from layout config (override for standard units)
    override criticalHitsVariant = computed<CriticalHitsVariant>(() => {
        const config = getLayoutForUnitType(this.asStats().TP);
        return config.cards[0]?.criticalHits ?? 'none';
    });

    verticallyCenterImage = computed<boolean>(() => {
        return this.criticalHitsVariant() !== 'mek';
    });

    reducedHeightImage = computed<boolean>(() => {
        return this.criticalHitsVariant() === 'vehicle' || this.criticalHitsVariant() === 'aerofighter';
    });

    // Sprint movement (x1.5 of ground movement)
    sprintMove = computed<string | null>(() => {
        const fu = this.forceUnit();
        if (!fu) return null;

        const effectiveMv = fu.effectiveMovement();
        const entries = this.getMovementEntries(effectiveMv);
        const groundEntries = entries.filter(([mode]) => mode !== 'j');
        if (groundEntries.length === 0) return null;

        const defaultGround = groundEntries.find(([mode]) => mode === '') ?? groundEntries[0];
        const groundMoveInches = defaultGround[1];
        if (groundMoveInches <= 0) return formatMovement(0, '', this.useHex());

        const sprintInches = Math.ceil(groundMoveInches * 1.5);
        return formatMovement(sprintInches, '', this.useHex());
    });

    tmmDisplay = computed<string>(() => {
        const fu = this.forceUnit();
        if (!fu) {
            const tmm = this.asStats().TMM;
            return tmm !== undefined && tmm !== null ? tmm.toString() : '';
        }
        return this.formatTmm(fu.effectiveTmm());
    });

    private formatTmm(tmm: { [mode: string]: number }): string {
        const entries = Object.entries(tmm);
        if (entries.length === 0) return '';
        return entries
            .map(([mode, value]) => `${value}${mode}`)
            .join('/');
    }

    // Range distances
    rangeShort = computed<string>(() => this.useHex() ? '0~3' : '0"~6"');
    rangeMedium = computed<string>(() => this.useHex() ? '4~12' : '>6"~24"');
    rangeLong = computed<string>(() => this.useHex() ? '13~21' : '>24"~42"');
    rangeExtreme = computed<string>(() => this.useHex() ? '22+' : '>42"');

    // Pending heat change (delta: 0 = no change)
    pendingHeat = computed<number>(() => {
        return this.forceUnit()?.getState().pendingHeat() ?? 0;
    });

    // Damage values affected by weapon critical hits: -1 per hit
    // Uses forceUnit's damage calculations when available

    effectiveDamageS = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageS();
        return this.asStats().dmg.dmgS;
    });

    effectiveDamageM = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageM();
        return this.asStats().dmg.dmgM;
    });

    effectiveDamageL = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageL();
        return this.asStats().dmg.dmgL;
    });

    effectiveDamageE = computed<string>(() => {
        const fu = this.forceUnit();
        if (fu) return fu.effectiveDamageE();
        return this.asStats().dmg.dmgE;
    });

    isAerospace = computed<boolean>(() => {
        const type = this.asStats().TP;
        const movements = this.asStats().MVm;
        return isAerospace(type, movements);
    });

    constructor() {
        super();
        const afterRenderRef = afterNextRender(() => {
            const hostEl = this.elRef.nativeElement;
            const statsEl = this.statsContainerRef()?.nativeElement;
            if (!hostEl || !statsEl) return;

            this.resizeObserver?.disconnect();
            this.resizeObserver = new ResizeObserver(() => {
                this.updateChassisSmallClass();
            });

            this.resizeObserver.observe(hostEl);
            this.resizeObserver.observe(statsEl);

            // Initial calculation after layout.
            requestAnimationFrame(() => this.updateChassisSmallClass());
        });

        this.destroyRef.onDestroy(() => {
            afterRenderRef.destroy();
            this.resizeObserver?.disconnect();
        });
    }

    private updateChassisSmallClass(): void {
        const hostEl = this.elRef.nativeElement;
        const statsEl = this.statsContainerRef()?.nativeElement;
        if (!hostEl || !statsEl) {
            this.chassisSmall.set(false);
            return;
        }

        const hostHeight = hostEl.clientHeight;
        if (hostHeight <= 0) {
            this.chassisSmall.set(false);
            return;
        }

        const ratio = statsEl.clientHeight / hostHeight;
        this.chassisSmall.set(ratio > this.statsToHostHeightThreshold);
    }
}