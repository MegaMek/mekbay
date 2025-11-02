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

import { UnitSvgService } from "./unit-svg.service";

/*
 * Author: Drake
 */
export class UnitSvgInfantryService extends UnitSvgService {
    // BattleArmor-specific SVG handling logic goes here

    protected override updateAllDisplays() {
        if (!this.unit.svg()) return;
        // Read all reactive state properties to ensure they are tracked by the effect.
        const crew = this.unit.getCrewMembers();
        const locations = this.unit.getLocations();

        // Update all displays
        this.updateBVDisplay();
        this.updateCrewDisplay(crew);
        this.updateTroopsDisplay();
        this.updateInventory();
        this.updateHitMod();
        this.updateTurnState();
    }

    protected override evaluateDestroyed(): void {
        const svg = this.unit.svg();
        if (!svg) return;

        const armorLocs = new Set<string>(this.unit.locations?.armor.keys() || []);
        let allTroopsDestroyed = true;
        for (const loc of armorLocs) {
            const locDestroyed = this.unit.isArmorLocDestroyed(loc);
            if (!locDestroyed) {
                allTroopsDestroyed = false;
                break;
            }
        }
        const structureLocs = new Set<string>(this.unit.locations?.internal.keys() || []);
        for (const loc of structureLocs) {
            const locDestroyed = this.unit.isInternalLocDestroyed(loc);
            if (!locDestroyed) {
                allTroopsDestroyed = false;
                break;
            }
        }
        const destroyed = allTroopsDestroyed;
        if (this.unit.destroyed !== destroyed) {
            this.unit.setDestroyed(destroyed);
        }
    }

    protected override updateArmorDisplay(initial: boolean = false) {
        const svg = this.unit.svg();
        if (!svg) return;

        const armorPips = Array.from(svg.querySelectorAll(`.armor.pip`)).reverse();
        const locations = this.unit.getLocations();
        // Track remaining armor pips per location
        const armorRemaining: Record<string, number> = {};

        armorPips.forEach(pip => {
            const loc = pip.getAttribute('loc');
            if (!loc) return;
            if (armorRemaining[loc] === undefined) {
                armorRemaining[loc] = locations[loc]?.armor || 0;
            }
            if (armorRemaining[loc] > 0) {
                if (!pip.classList.contains('damaged')) {
                    pip.classList.add('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else if (pip.classList.contains('fresh')) {
                    pip.classList.remove('fresh');
                }
                armorRemaining[loc]--;
            } else {
                if (pip.classList.contains('damaged')) {
                    pip.classList.remove('damaged');
                    if (!initial) {
                        pip.classList.add('fresh');
                    }
                } else
                    if (pip.classList.contains('fresh')) {
                        pip.classList.remove('fresh');
                    }
            }
        });

        this.unit.locations?.armor.forEach(entry => {
            let el = svg.querySelector(`.unitLocation.armor[loc="${entry.loc}"]`);
            if (!el) return;
            if (this.unit.isArmorLocDestroyed(entry.loc, entry.rear)) {
                el.classList.add('damaged');
            } else {
                el.classList.remove('damaged');
            }
        });
    }

    protected updateTroopsDisplay() {
        const svg = this.unit.svg();
        if (!svg) return;

        const hasTroops = svg.getElementById('soldier_1');
        if (!hasTroops) return;
        const totalTroops = this.unit.locations?.internal.get('TROOP')!.points || 0;
        const hits = this.unit.getInternalHits('TROOP');
        for (let i = 1; i <= totalTroops; i++) {
            const soldierEl = svg.getElementById(`soldier_${i}`);
            if (!soldierEl) continue;
            if (i <= (totalTroops-hits)) {
                if (soldierEl.classList.contains('damaged')) {
                    soldierEl.classList.add('fresh');
                } else {
                    soldierEl.classList.remove('fresh');
                }
                soldierEl.classList.remove('damaged');
            } else {
                if (!soldierEl.classList.contains('damaged')) {
                    soldierEl.classList.add('fresh');
                } else {
                    soldierEl.classList.remove('fresh');
                }
                soldierEl.classList.add('damaged');
            }
        }
    }

    protected override updateInventory() {
        const svg = this.unit.svg();
        if (!svg) return;
        this.unit.getInventory().forEach(entry => {
            if (entry.el) {
                if (!entry.el.getAttribute('SSW')) return;
                entry.destroyed = this.unit.isArmorLocDestroyed('T1');
                if (entry.destroyed) {
                    entry.el.classList.add('damagedInventory');
                    entry.el.classList.remove('interactive');
                    entry.el.classList.remove('selected');
                } else {
                    entry.el.classList.remove('damagedInventory');
                    entry.el.classList.add('interactive');
                }
            }
        });
    }
}
