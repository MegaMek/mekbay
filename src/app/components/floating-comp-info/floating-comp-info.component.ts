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

import { Component, input, computed, inject, ChangeDetectionStrategy } from '@angular/core';

import { UnitComponent } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { Unit } from '../../models/units.model';
import { Equipment, WeaponEquipment } from '../../models/equipment.model';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';

/*
 * Author: Drake
 */
@Component({
    selector: 'floating-comp-info',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './floating-comp-info.component.html',
    styleUrls: ['./floating-comp-info.component.css'],
    host: {
        '(pointerenter)': 'onPointerEnter()',
        '(pointerleave)': 'onPointerLeave()'
    }
})
export class FloatingCompInfoComponent {
    private dataService = inject(DataService);
    unit = input.required<Unit>();
    comp = input<UnitComponent | null>(null);

    positioned = false;

    equipment = computed<Equipment | null>(() => {
        const currentComp = this.comp();
        const currentUnit = this.unit();
        if (currentUnit && currentComp?.id && currentUnit?.type) {
            return this.dataService.getEquipmentByName(currentComp.id) || null;
        }
        return null;
    });

    equipmentDisplay = computed(() => this.computeEquipmentDisplay());

    onPointerEnter() {
        // overlay service listens for overlay element pointer events; parent keeps component state
    }

    onPointerLeave() {
        // overlay service listens for overlay element pointer events; parent keeps component state
    }

    get name(): string {
        return this.equipment()?.name ?? this.comp()?.n ?? '';
    }

    get typeClass(): string {
        return getWeaponTypeCSSClass(this.comp()?.t ?? '');
    }

    get typeLabel(): string {
        return this.typeClass.charAt(0).toUpperCase() + this.typeClass.slice(1);
    }

    get rackSize(): number | null {
        if (this.equipment() instanceof WeaponEquipment) {
            return (this.equipment() as WeaponEquipment).rackSize;
        }
        return null;
    }

    get range(): string | null {
        if (this.comp()?.r) {
            const eq = this.equipment();
            if (eq instanceof WeaponEquipment) {
                const ranges = eq.ranges; 
                // Ranges has 4 entries: 0: short, 1: medium, 2: long, 3: extreme
                return `${ranges[0]}/${ranges[1]}/${ranges[2]}`;
            }
        }
        return null;
    }

    get minRange(): number {
        const eq = this.equipment();
        if (eq instanceof WeaponEquipment) {
            return eq.minRange;
        }
        return 0;
    }

    get damage(): string | null {
        const currentComp = this.comp();
        if (currentComp?.d && currentComp.md && Number(currentComp.md) !== Number(currentComp.d)) {
            return currentComp.d + (currentComp.md ? ` (${currentComp.md})` : '');
        }
        if (currentComp?.d) {
            const eq = this.equipment();
            if (eq instanceof WeaponEquipment) {
                return String(eq.damage);
            }
        }
        return null;
    }

    get heat(): number | null {
        const eq = this.equipment();
        if (eq instanceof WeaponEquipment) {
            return eq.heat;
        }
        return null;
    }

    computeEquipmentDisplay(): Array<{ group: string, items: Array<{ label: string, value: any }> }> {
        const unit = this.unit();
        if (!unit) return [];
        const eq = this.equipment();
        if (!eq) return [];
        const parseYear = (val: any): number | null => {
            if (typeof val === 'string') {
                if (val === 'ES') return 1950;
                if (val === 'PS') return 2100;
                const digits = val.replace(/\D/g, '');
                return digits ? parseInt(digits, 10) : null;
            }
            if (typeof val === 'number') return val;
            return null;
        };

        // Helper to pick earliest date from two options
        const earliest = (a?: string, b?: string): string | undefined => {
            const aY = parseYear(a), bY = parseYear(b);
            if (aY === null) return b;
            if (bY === null) return a;
            return aY <= bY ? a : b;
        };

        // Helper to pick latest date from two options
        const latest = (a?: string, b?: string): string | undefined => {
            const aY = parseYear(a), bY = parseYear(b);
            if (aY === null) return b;
            if (bY === null) return a;
            return aY >= bY ? a : b;
        };

        let dates: { prototype?: string; production?: string; common?: string; extinct?: string; reintroduced?: string };
        switch (unit.techBase) {
            case 'Clan':
                dates = eq.tech.advancement?.clan ?? {};
                break;
            case 'Mixed': {
                const is = eq.tech.advancement?.is;
                const clan = eq.tech.advancement?.clan;
                // For mixed: earliest for most dates, latest for extinction
                let extinct: string | undefined;
                let reintroduced: string | undefined;
                
                // Only show extinction if BOTH have it (otherwise tech was still available)
                const bothHaveExtinction = is?.extinct && clan?.extinct;
                if (bothHaveExtinction) {
                    extinct = latest(is?.extinct, clan?.extinct);
                    reintroduced = earliest(is?.reintroduced, clan?.reintroduced);
                    // If extinction is at or beyond reintroduction, there's no real gap
                    const extY = parseYear(extinct), reintY = parseYear(reintroduced);
                    if (extY !== null && reintY !== null && extY >= reintY) {
                        extinct = undefined;
                        reintroduced = undefined;
                    }
                }
                
                dates = {
                    prototype: earliest(is?.prototype, clan?.prototype),
                    production: earliest(is?.production, clan?.production),
                    common: earliest(is?.common, clan?.common),
                    extinct,
                    reintroduced
                };
                break;
            }
            case 'Inner Sphere':
            default:
                dates = eq.tech.advancement?.is ?? {};
                break;
        }

        const historyItems: Array<{ label: string, value: string }> = [
            { label: 'Prototype', value: dates?.prototype },
            { label: 'Production', value: dates?.production },
            { label: 'Common', value: dates?.common },
            { label: 'Extinction', value: dates?.extinct },
            { label: 'Reintroduction', value: dates?.reintroduced },
        ].filter((item): item is { label: string, value: string } => 
            item.value !== undefined && item.value !== null && item.value !== '' && item.value !== '-')
        .sort((a, b) => {
            const aYear = parseYear(a.value);
            const bYear = parseYear(b.value);
            if (aYear === null) return 1;
            if (bYear === null) return -1;
            return aYear - bYear;
        });

        let slots = eq.critSlots;
        if (eq.svSlots > -1) {
            slots = eq.svSlots;
        } else if (eq.tankSlots > -1) {
            slots = eq.tankSlots;
        }

        const ratingString = `${eq.techBase} | ${eq.rating}/${eq.availability}`;
        const result = [
            {
                group: 'General',
                items: [
                    { label: 'BV', value: eq.bv },
                    { label: 'Cost', value: eq.cost },
                    { label: 'Tonnage', value: eq.tonnage },
                    { label: 'Criticals', value: slots },
                    { label: 'Reference', value: eq.rulesRefs }
                ]
            },
            {
                group: 'Technology',
                items: [
                    { label: 'Level', value: eq.level },
                    { label: 'Rating', value: ratingString },
                ]
            }
        ];

        if (historyItems.length > 0) {
            result.push({
                group: 'History',
                items: historyItems
            });
        }

        return result;
    }
}