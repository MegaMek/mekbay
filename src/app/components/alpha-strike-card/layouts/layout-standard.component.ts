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
} from '../critical-hits';
import { AsLayoutBaseComponent } from './layout-base.component';

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
        AsCriticalHitsAerofighterComponent
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

    movementDisplay = computed<string>(() => {
        const fu = this.forceUnit();
        if (!fu) return this.asStats().MV ?? '';

        const effectiveMv = fu.effectiveMovement();
        const entries = this.getMovementEntries(effectiveMv);
        if (entries.length === 0) return this.asStats().MV ?? '';

        return entries
            .map(([mode, inches]) => this.formatMovement(inches, mode))
            .join('/');
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
        if (groundMoveInches <= 0) return this.formatMovement(0);

        const sprintInches = Math.ceil(groundMoveInches * 1.5);
        return this.formatMovement(sprintInches);
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

    // Pending heat change (delta: 0 = no change)
    pendingHeat = computed<number>(() => {
        return this.forceUnit()?.getState().pendingHeat() ?? 0;
    });

    // Damage values affected by weapon critical hits: -1 per hit
    effectiveDamageS = computed<string>(() => {
        const base = this.asStats().dmg.dmgS;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    effectiveDamageM = computed<string>(() => {
        const base = this.asStats().dmg.dmgM;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    effectiveDamageL = computed<string>(() => {
        const base = this.asStats().dmg.dmgL;
        return this.calculateReducedDamage(base, this.weaponHits());
    });

    private calculateReducedDamage(base: string, weaponHits: number): string {
        if (weaponHits <= 0) return base;

        // Determine the position in the sequence: 9 8 7 6 5 4 3 2 1 0* 0
        let position: number;

        if (base === '0*') {
            position = 1;
        } else if (base === '0') {
            position = 0;
        } else {
            const numericValue = parseInt(base, 10);
            if (isNaN(numericValue) || numericValue < 0) {
                // Non-numeric (like "-"), return as-is
                return base;
            }
            position = numericValue + 1;
        }

        // Reduce position
        const newPosition = Math.max(0, position - weaponHits);

        // Convert back to string
        if (newPosition === 0) return '0';
        if (newPosition === 1) return '0*';
        return (newPosition - 1).toString();
    }

    constructor() {
        super();
        afterNextRender(() => {
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

    private getMovementEntries(mvm: Record<string, number> | undefined): Array<[string, number]> {
        if (!mvm) return [];

        const entries = Object.entries(mvm)
            .filter(([, value]) => typeof value === 'number') as Array<[string, number]>;

        return entries;
    }

    private formatMovement(inches: number, suffix: string = ''): string {
        if (this.useHex()) {
            return Math.ceil(inches / 2) + suffix;
        }
        return inches + '"' + suffix;
    }
}