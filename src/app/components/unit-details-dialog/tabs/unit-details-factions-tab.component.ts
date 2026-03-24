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

import { Component, ChangeDetectionStrategy, input, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Unit } from '../../../models/units.model';
import { DataService } from '../../../services/data.service';

const CATCH_ALL_FACTIONS: Record<string, string> = {
    'Inner Sphere General': 'Inner Sphere',
    'IS Clan General': 'IS Clan',
    'HW Clan General': 'HW Clan',
    'Periphery General': 'Periphery',
};

export interface FactionAvailability {
    eraName: string;
    eraImg?: string;
    eraYearFrom?: number;
    eraYearTo?: number;
    factions: {
        name: string;
        img: string;
        isCatchAll?: boolean;
        collapsedFactions?: { name: string; img: string }[];
    }[];
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

    factionAvailability = computed<FactionAvailability[]>(() => {
        const u = this.unit();
        if (!u) return [];

        const unitId = u.id;
        const allEras = this.dataService.getEras();
        const allFactions = this.dataService.getFactions();
        const availability: FactionAvailability[] = [];

        for (const era of allEras) {
            const matchingFactions: { name: string; img: string; group: string }[] = [];
            for (const faction of allFactions) {
                const factionEras = faction.eras[era.id];
                if (factionEras && (factionEras as Set<number>).has(unitId)) {
                    matchingFactions.push({ name: faction.name, img: faction.img, group: faction.group });
                }
            }

            if (matchingFactions.length > 0) {
                const activeCatchAllGroups = new Set<string>();
                for (const f of matchingFactions) {
                    if (CATCH_ALL_FACTIONS[f.name]) {
                        activeCatchAllGroups.add(CATCH_ALL_FACTIONS[f.name]);
                    }
                }

                const factions: FactionAvailability['factions'] = [];
                const collapsedByGroup = new Map<string, { name: string; img: string }[]>();

                for (const f of matchingFactions) {
                    if (CATCH_ALL_FACTIONS[f.name]) {
                        factions.push({ name: f.name, img: f.img, isCatchAll: true });
                    } else if (activeCatchAllGroups.has(f.group)) {
                        if (!collapsedByGroup.has(f.group)) {
                            collapsedByGroup.set(f.group, []);
                        }
                        collapsedByGroup.get(f.group)!.push({ name: f.name, img: f.img });
                    } else {
                        factions.push({ name: f.name, img: f.img });
                    }
                }

                for (const f of factions) {
                    if (f.isCatchAll) {
                        const group = CATCH_ALL_FACTIONS[f.name];
                        const collapsed = collapsedByGroup.get(group);
                        if (collapsed) {
                            collapsed.sort((a, b) => a.name.localeCompare(b.name));
                            f.collapsedFactions = collapsed;
                        }
                    }
                }

                factions.sort((a, b) => a.name.localeCompare(b.name));
                availability.push({
                    eraName: era.name,
                    eraImg: era.img,
                    eraYearFrom: era.years.from,
                    eraYearTo: !era.years.to || era.years.to >= 9999 ? undefined : era.years.to,
                    factions
                });
            }
        }
        return availability;
    });

    expandedCatchAlls = signal(new Set<string>());

    toggleCatchAll(eraIndex: number, factionName: string): void {
        const key = `${eraIndex}:${factionName}`;
        this.expandedCatchAlls.update(set => {
            const next = new Set(set);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    isCatchAllExpanded(eraIndex: number, factionName: string): boolean {
        return this.expandedCatchAlls().has(`${eraIndex}:${factionName}`);
    }
}
