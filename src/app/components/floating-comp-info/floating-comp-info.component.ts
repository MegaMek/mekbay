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

import { Component, input, signal, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UnitComponent } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { Unit } from '../../models/units.model';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';

/*
 * Author: Drake
 */
@Component({
    selector: 'floating-comp-info',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
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

    pos = signal<{ x: number, y: number }>({ x: 0, y: 0 });
    equipment = signal<any>(null);
    positioned = false;
    equipmentDisplay: Array<{ group: string, items: Array<{ label: string, value: any }> }> = [];
    
    constructor() {
        effect(() => {
            const currentComp = this.comp();
            const currentUnit = this.unit();
            
            if (currentUnit && currentComp?.id && currentUnit?.type) {
                const eq = this.dataService.getEquipment(currentUnit.type)[currentComp.id];
                this.equipment.set(eq || null);
            } else {
                this.equipment.set(null);
            }
            this.equipmentDisplay = this.computeEquipmentDisplay();
        });

        effect(() => {
            this.comp();
            this.unit();
            this.equipmentDisplay = this.computeEquipmentDisplay();
        });
    }

    onPointerEnter() {
        // overlay service listens for overlay element pointer events; parent keeps component state
    }

    onPointerLeave() {
        // overlay service listens for overlay element pointer events; parent keeps component state
    }

    get name(): string {
        return this.equipment()?.name ?? this.comp()?.n ?? '';
    }

    get desc(): string {
        return this.equipment()?.desc ?? '';
    }

    get typeClass(): string {
        return getWeaponTypeCSSClass(this.comp()?.t ?? '');
    }

    get typeLabel(): string {
        return this.typeClass.charAt(0).toUpperCase() + this.typeClass.slice(1);
    }

    get rackSize(): number | null {
        return this.equipment()?.rackSize ?? null;
    }

    get range(): string | null {
        return this.comp()?.r ?? this.equipment()?.range ?? null;
    }

    get minRange(): number | null {
        return this.equipment()?.minr ?? null;
    }

    get damage(): string | null {
        const currentComp = this.comp();
        if (currentComp?.d && currentComp.md && Number(currentComp.md) !== Number(currentComp.d)) {
            return currentComp.d + (currentComp.md ? ` (${currentComp.md})` : '');
        }
        return currentComp?.d ?? this.equipment()?.damage ?? null;
    }

    get heat(): number | null {
        return this.equipment()?.heat ?? null;
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
                // Remove all non-digit characters and parse as number
                const digits = val.replace(/\D/g, '');
                return digits ? parseInt(digits, 10) : null;
            }
            if (typeof val === 'number') return val;
            return null;
        };
        let dates;
        switch (unit.techBase) {
            case 'Clan':
                dates = eq.dates?.clan ?? {};
                break;
            case 'Mixed':
                dates = eq.dates?.mixed ?? {};
                break;
            case 'Inner Sphere':
            default:
                dates = eq.dates?.is ?? {};
                break;
        }

        const historyItems = [
            { label: 'Prototype', value: dates.t },
            { label: 'Production', value: dates.p },
            { label: 'Common', value: dates.c },
            { label: 'Extinction', value: dates.x },
            { label: 'Reintroduction', value: dates.r },
        ].filter(item => item.value !== undefined && item.value !== null && item.value !== '' && item.value !== '-')
        .sort((a, b) => {
            const aYear = parseYear(a.value);
            const bYear = parseYear(b.value);
            if (aYear === null) return 1;
            if (bYear === null) return -1;
            return aYear - bYear;
        });

        const ratingString = `${eq.base} | ${unit.techBase == 'Clan' ? eq.rating.clan : eq.rating.is}`;
        const result = [
            {
                group: 'General',
                items: [
                    { label: 'BV', value: eq.bv },
                    { label: 'Cost', value: eq.cost },
                    { label: 'Weight', value: eq.weight },
                    { label: 'Criticals', value: eq.crit },
                    { label: 'Special', value: eq.special },
                    { label: 'Reference', value: eq.reference }
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