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

import { Component, ChangeDetectionStrategy, input, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';

export interface FactionAvailability {
    eraName: string;
    eraImg?: string;
    factions: { name: string; img: string }[];
}

@Component({
    selector: 'unit-details-factions-tab',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    templateUrl: './unit-details-factions-tab.component.html',
    styleUrls: ['./unit-details-factions-tab.component.css']
})
export class UnitDetailsFactionTabComponent {
    private dataService = inject(DataService);

    unit = input.required<Unit>();
    
    factionAvailability = signal<FactionAvailability[]>([]);

    constructor() {
        effect(() => {
            this.unit();
            this.updateFactionAvailability();
        });
    }

    private updateFactionAvailability() {
        const u = this.unit();
        if (!u) {
            this.factionAvailability.set([]);
            return;
        }

        const unitId = u.id;
        const allEras = this.dataService.getEras().sort((a, b) => (a.years.from || 0) - (b.years.from || 0));
        const allFactions = this.dataService.getFactions();
        const availability: FactionAvailability[] = [];

        for (const era of allEras) {
            const factionsInEra: { name: string, img: string }[] = [];
            for (const faction of allFactions) {
                const factionEras = faction.eras[era.id];
                if (factionEras && (factionEras as Set<number>).has(unitId)) {
                    factionsInEra.push({ name: faction.name, img: faction.img });
                }
            }

            if (factionsInEra.length > 0) {
                factionsInEra.sort((a, b) => a.name.localeCompare(b.name));
                availability.push({
                    eraName: era.name,
                    eraImg: era.img,
                    factions: factionsInEra
                });
            }
        }
        this.factionAvailability.set(availability);
    }
}
