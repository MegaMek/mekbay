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

import { ForceUnit } from '../models/force-unit.model';
import { Unit } from '../models/units.model';

/*
 * Author: Drake
 */

export interface LanceTypeDefinition {
    id: string;
    parent?: string;
    name: string;
    description: string;
    validator: (units: ForceUnit[]) => boolean;
    idealRole?: string;
    techBase?: 'Inner Sphere' | 'Clan' | 'Special';
    minUnits?: number;
    exclusiveFaction?: string;
}



function countMatchedPairs(units: ForceUnit[]): number {
    const matchedPairs = units.reduce((acc, curr) => {
        const name = curr.getUnit().name;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    return Object.values(matchedPairs).filter(count => count >= 2).length;
}

function findIdenticalVehiclePairs(units: ForceUnit[]): ForceUnit[][] {
    const pairs: ForceUnit[][] = [];
    const seen = new Set<string>();

    for (const unit of units) {
        const name = unit.getUnit().name;
        if (seen.has(name)) {
            pairs.push([unit, units.find(u => u.getUnit().name === name)!]);
        }
        seen.add(name);
    }

    return pairs;
}

function isOnlyCombatVehicles(units: ForceUnit[]): boolean {
    return units.every(u => u.getUnit().type === 'Tank' || u.getUnit().type === 'VTOL');
}

export class LanceTypeIdentifierUtil {
    private static readonly definitions: LanceTypeDefinition[] = [
        // Air Lance
        {
            id: 'air-lance',
            name: 'Air Lance',
            description: 'Lance of ground units plus two aerospace/conventional fighters',
            techBase: 'Special',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const fighters = units.filter(u => u.getUnit().subtype === 'Aerospace Fighter' || u.getUnit().subtype === 'Conventional Fighter');
                const groundUnits = units.filter(u => u.getUnit().type !== 'Aero' && u.getUnit().type !== 'Infantry');
                
                if (fighters.length !== 2 || groundUnits.length < 1) return false;
                
                // Check if fighters are identical
                if (fighters.length === 2) {
                    return fighters[0].getUnit().name === fighters[1].getUnit().name;
                }
                return false;
            }
        },

        // Anti-'Mech Lance
        {
            id: 'anti-mech-lance',
            name: 'Anti-\'Mech Lance',
            description: 'All infantry units for urban and anti-mech warfare',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                return units.every(u => u.getUnit().type === 'Infantry');
            }
        },

        // Assault Lance variations
        {
            id: 'assault-lance',
            name: 'Assault Lance',
            description: 'Heavy firepower and armor powerhouse formation',
            idealRole: 'Juggernaut',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                const hasLight = units.some(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 0);
                
                if (heavyOrLarger.length < 3 || hasLight) return false;
                
                const hasEnoughArmor = units.every(u => u.getUnit().armor >= 135);
                const highDamage = units.filter(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 25, 7));
                const has75PercentHighDamage = highDamage.length >= Math.floor(units.length * 0.75);

                // At least 1 Juggernaut roles and 2 Sniper roles
                const hasJuggernaut = units.some(u => u.getUnit().role === 'Juggernaut');
                const hasSnipers = units.filter(u => u.getUnit().role === 'Sniper').length >= 2;

                return hasEnoughArmor && has75PercentHighDamage && hasJuggernaut && hasSnipers;
            }
        },

        {
            id: 'anvil-lance',
            name: 'Anvil Lance',
            description: 'Marik heavy formation for holding enemy advance',
            
            exclusiveFaction: 'Free Worlds League',
            idealRole: 'Juggernaut',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                
                const allMediumOrLarger = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 1);
                const hasEnoughArmor = units.every(u => u.getUnit().armor >= 105);
                const hasWeapons = units.filter(u => LanceTypeIdentifierUtil.hasAutocannon(u.getUnit()) || 
                    LanceTypeIdentifierUtil.hasLRM(u.getUnit()) || LanceTypeIdentifierUtil.hasSRM(u.getUnit()));
                
                return allMediumOrLarger && hasEnoughArmor && hasWeapons.length >= Math.floor(units.length * 0.5);
            }
        },

        {
            id: 'fast-assault-lance',
            parent: 'assault-lance',
            name: 'Fast Assault Lance',
            description: 'Mobile assault formation with speed advantage',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // Fast assault requirement
                const fastUnits = units.every(u => u.getUnit().walk >= 5 || u.getUnit().jump > 0);
                
                return fastUnits;
            }
        },

        {
            id: 'hunter-lance',
            name: 'Hunter Lance',
            description: 'Ambush specialists for heavy terrain',
            
            idealRole: 'Ambusher',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least 50% must be Ambusher or Juggernaut role
                const ambusherOrJuggernaut = units.filter(u => u.getUnit().role === 'Ambusher' 
                                                            || u.getUnit().role === 'Juggernaut');
                return ambusherOrJuggernaut.length >= Math.floor(units.length * 0.5);
            }
        },

        // Battle Lance variations
        {
            id: 'battle-lance',
            name: 'Battle Lance',
            description: 'Line troops with balanced firepower and armor',
            
            idealRole: 'Brawler',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                // If the Battle Lance consists of combat vehicles, there must be at least two matched pairs (same unit) of heavy units.
                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairs(heavyOrLarger);
                    if (matchedPairs < 2) return false;
                }
                // At least three units in this Formation must have any combination of the Brawler, Sniper and/or Skirmisher Unit Roles
                const hasRequiredRoles = units.filter(u => ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
                
                return (heavyOrLarger.length >= Math.floor(units.length * 0.5)) && (hasRequiredRoles.length >= 3);
            }
        },

        {
            id: 'light-battle-lance',
            name: 'Light Battle Lance',
            description: 'Fast light formation for reconnaissance and skirmishing',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                
                const lightUnits = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 0);
                const hasAssault = units.some(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 4);
                // If the Formation consists of combat vehicles, there must be at least two matched (same unit) pairs of light units.
                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairs(lightUnits);
                    if (matchedPairs < 2) return false;
                }
                // At least one of the units in a Light Battle Lance must have the Scout Unit Role
                const hasScout = units.some(u => u.getUnit().role === 'Scout');
                return lightUnits.length >= Math.floor(units.length * 0.75) && !hasAssault && hasScout;
            }
        },

        {
            id: 'medium-battle-lance',
            name: 'Medium Battle Lance',
            description: 'Medium weight balanced formation',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                
                const mediumUnits = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 1);
                const hasAssault = units.some(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 4);
                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairs(mediumUnits);
                    if (matchedPairs < 2) return false;
                }
                return mediumUnits.length >= Math.floor(units.length * 0.5) && !hasAssault;
            }
        },

        {
            id: 'heavy-battle-lance',
            name: 'Heavy Battle Lance',
            description: 'Heavy weight powerhouse formation',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {                
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                const hasLight = units.some(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 0);
                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairs(heavyOrLarger);
                    if (matchedPairs < 2) return false;
                }
                return heavyOrLarger.length >= Math.floor(units.length * 0.5) && !hasLight;
            }
        },

        {
            id: 'rifle-lance',
            name: 'Rifle Lance',
            description: 'Davion autocannon specialists',
            
            exclusiveFaction: 'Federated Suns',
            validator: (units: ForceUnit[]) => {
                if (units.length < 1) return false;
                
                const mediumOrHeavy = units.filter(u => {
                    const weight = LanceTypeIdentifierUtil.getWeightClass(u.getUnit());
                    return weight === 1 || weight === 3;
                });
                
                const withAutocannon = units.filter(u => LanceTypeIdentifierUtil.hasAutocannon(u.getUnit()));
                const fastEnough = units.every(u => u.getUnit().walk >= 4);
                
                return mediumOrHeavy.length >= Math.floor(units.length * 0.75) &&
                       withAutocannon.length >= Math.floor(units.length * 0.5) &&
                       fastEnough;
            }
        },

        {
            id: 'berserker-lance',
            name: 'Berserker/Close Combat Lance',
            description: 'Close combat specialists for physical attacks',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // Same as battle lance but focused on close combat. I don't use the 'parent' to avoid priority issues.
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                // If the Battle Lance consists of combat vehicles, there must be at least two matched pairs (same unit) of heavy units.
                if (isOnlyCombatVehicles(units)) {
                    const matchedPairs = countMatchedPairs(heavyOrLarger);
                    if (matchedPairs < 2) return false;
                }
                // At least three units in this Formation must have any combination of the Brawler, Sniper and/or Skirmisher Unit Roles
                const hasRequiredRoles = units.filter(u => ['Brawler', 'Sniper', 'Skirmisher'].includes(u.getUnit().role));
                
                return (heavyOrLarger.length >= Math.floor(units.length * 0.5)) && (hasRequiredRoles.length >= 3);

            }
        },

        // Command Lance
        {
            id: 'command-lance',
            name: 'Command Lance',
            description: 'Diverse formation built around force commander',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least 50 percent of the units in this Formation must have one of the following Unit Roles: Sniper, Missile Boat, Skirmisher, or Juggernaut.
                const hasRequiredRoles = units.filter(u => ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));

                //  One additional unit in the lance must be a Brawler, Striker, or Scout.
                const hasAdditionalRole = units.filter(u => ['Brawler', 'Striker', 'Scout'].includes(u.getUnit().role));
                return hasRequiredRoles.length >= Math.floor(units.length * 0.5) && hasAdditionalRole.length >= 1;
            }
        },

        {
            id: 'order-lance',
            name: 'Order Lance',
            description: 'Kurita synchronized formation of identical units',
            
            exclusiveFaction: 'Draconis Combine',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {                
                // All units must be same weight class
                const firstWeight = LanceTypeIdentifierUtil.getWeightClass(units[0].getUnit());
                const sameWeight = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === firstWeight);
                
                // All units should be same model (simplified check)
                const firstChassis = units[0].getUnit().chassis;
                const sameChassis = units.every(u => u.getUnit().chassis === firstChassis);
                
                return sameWeight && sameChassis;
            }
        },

        {
            id: 'vehicle-command-lance',
            name: 'Vehicle Command Lance',
            description: 'Formation of command vehicle units',
            
            exclusiveFaction: 'Draconis Combine',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // One pair of (identical) vehicles needs to have the Sniper, Missile Boat, Skirmisher, or Juggernaut Unit Roles
                if (!isOnlyCombatVehicles(units)) return false;
                // find the pairs of vehicles and check if they have the required roles
                const vehiclePairs = findIdenticalVehiclePairs(units);
                const hasRequiredRoles = vehiclePairs.filter(pair => {
                    return pair.every(u => ['Sniper', 'Missile Boat', 'Skirmisher', 'Juggernaut'].includes(u.getUnit().role));
                });
                if (hasRequiredRoles.length < 2) return false;
                return true;
            }
        },

        // Fire Lance variations
        {
            id: 'fire-lance',
            name: 'Fire Lance',
            description: 'Long-range firepower specialists',
            
            idealRole: 'Missile Boat',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least 75 percent of the units in this Formation must have either the Missile Boat or Sniper Unit Roles.
                const hasRequiredRoles = units.filter(u => ['Missile Boat', 'Sniper'].includes(u.getUnit().role));;
                return hasRequiredRoles.length >= Math.floor(units.length * 0.75);
            }
        },

        {
            id: 'anti-air-lance',
            parent: 'fire-lance',
            name: 'Anti-Air Lance',
            description: 'Air defense specialists',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                //  at least two units in an Anti-Air Lance must possess an LBX autocannon, a standard autocannon, an artillery weapon, or the Anti-Aircraft Targeting Quirk
                const hasAntiAir = units.filter(u => LanceTypeIdentifierUtil.hasLBXAutocannon(u.getUnit()) || 
                    LanceTypeIdentifierUtil.hasAutocannon(u.getUnit()));
                const hasArtillery = units.filter(u => LanceTypeIdentifierUtil.hasArtillery(u.getUnit()));
                const hasQuirk = units.filter(u => u.getUnit().quirks.includes('Anti-Aircraft Targeting'));
                return hasAntiAir.length >= 2 || hasArtillery.length >= 2 || hasQuirk.length >= 2;
            }
        },

        {
            id: 'artillery-fire-lance',
            name: 'Artillery Fire Lance',
            description: 'Artillery support specialists',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const hasArtillery = units.filter(u => LanceTypeIdentifierUtil.hasArtillery(u.getUnit()));
                return hasArtillery.length >= 2;
            }
        },

        {
            id: 'direct-fire-lance',
            name: 'Direct Fire Lance',
            description: 'Direct fire heavy weapons',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least two units in this Formation must be heavy or larger
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                
                // and all units in this Formation must be able to deliver at least 10 points of damage at a range of 18 hexes or more.
                const longRangeHighDamage = units.every(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 10, 18));

                return heavyOrLarger.length >= 2 && longRangeHighDamage;
            }
        },

        {
            id: 'fire-support-lance',
            name: 'Fire Support Lance',
            description: 'Indirect fire specialists',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                const indirectCapable = units.filter(u => LanceTypeIdentifierUtil.hasLRM(u.getUnit()) || 
                    LanceTypeIdentifierUtil.hasArtillery(u.getUnit()));

                return indirectCapable.length >= 3;
            }
        },

        {
            id: 'light-fire-lance',
            name: 'Light Fire Lance',
            description: 'Light units with coordinated long-range fire',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // No unit of heavy weight or larger may be included. 
                const noHeavy = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) < 3);
                // At least 50 percent of the units in this Formation must have either the Missile Boat or Sniper Unit Roles. 
                const hasRequiredRoles = units.filter(u => ['Missile Boat', 'Sniper'].includes(u.getUnit().role));
                return noHeavy && hasRequiredRoles.length >= Math.floor(units.length * 0.5);
            }
        },

        // Clan Nova
        {
            id: 'nova',
            name: 'Nova',
            description: 'Clan OmniMech Star with mechanized battle armor',
            techBase: 'Clan',
            validator: (units: ForceUnit[]) => {
                if (units.length !== 10) return false;
                
                const mechs = units.filter(u => u.getUnit().type === 'Mek');
                const battleArmor = units.filter(u => u.getUnit().subtype === 'Battle Armor');
                
                if (mechs.length !== 5 || battleArmor.length !== 5) return false;
                
                const allOmni = mechs.every(u => u.getUnit().omni === 1);
                
                return allOmni;
            }
        },

        // Pursuit Lance variations
        {
            id: 'pursuit-lance',
            name: 'Pursuit Lance',
            description: 'Fast scout hunters with firepower',
            
            idealRole: 'Striker',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                //All units in this Formation must be light or medium
                const lightOrMedium = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) <= 1);
                // At least 75 percent of the units in this Formation must have a Walk/Cruise speed of 6 or more
                const fastUnits = units.filter(u => u.getUnit().walk >= 6);
                // At least one unit in the Pursuit Lance must have a weapon that can deal 5 or more points of damage at a range of 15 hexes or more
                const hasLongRange = units.some(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 5, 15));

                return lightOrMedium && fastUnits.length >= Math.floor(units.length * 0.75) && hasLongRange;
            }
        },

        {
            id: 'probe-lance',
            name: 'Probe Lance',
            description: 'Mobile reconnaissance force',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // No units of assault weight or larger may be included
                const noAssault = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) < 4);
                // 75 percent of the units in this Formation must have a Walk/Cruise speed of 6 or more
                const fastUnits = units.filter(u => u.getUnit().walk >= 6);
                // All units must be able to deliver at least 10 points of damage at a range of 9 hexes or more
                const hasDamage = units.every(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 10, 9));
                return noAssault && fastUnits.length >= Math.floor(units.length * 0.75) && hasDamage;
            }
        },

        {
            id: 'sweep-lance',
            name: 'Sweep Lance',
            description: 'Fast medium-range sweeping force',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must be light or medium
                const lightOrMedium = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) <= 1);
                // Walk/Cruise speed of 5 or more
                const fastUnits = units.every(u => u.getUnit().walk >= 5);
                // All Sweep Lance units must be able to deliver at least 10 points of damage at a range of 6 hexes or more.
                const hasDamage = units.every(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 10, 6));
                
                return lightOrMedium && fastUnits && hasDamage;
            }
        },

        // Recon Lance variations
        {
            id: 'recon-lance',
            name: 'Recon Lance',
            description: 'Fast reconnaissance specialists',
            
            idealRole: 'Scout',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must possess a minimum Walk/Cruise speed of 5
                const fastUnits = units.every(u => u.getUnit().walk >= 5);
                // At least two units in this Formation must have the Scout or Striker Unit Roles
                const scoutOrStriker = units.filter(u => u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
                return fastUnits && scoutOrStriker.length >= 2;
            }
        },

        {
            id: 'heavy-recon-lance',
            name: 'Heavy Recon Lance',
            description: 'Armored reconnaissance formation',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must have a Walk/Cruise speed of 4 or more
                const fastUnits = units.every(u => u.getUnit().walk >= 4);
                // and at least two must have a Walk/Cruise of 5 or more;
                const veryFast = units.filter(u => u.getUnit().walk >= 5);
                // At least one unit must be heavy or assault weight.
                const hasHeavyOrAssault = units.some(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                // At least two units in this Formation must have the Scout Unit Role
                const scoutUnits = units.filter(u => u.getUnit().role === 'Scout');
                return fastUnits && veryFast.length >= 2 && hasHeavyOrAssault && scoutUnits.length >= 2;
            }
        },

        {
            id: 'light-recon-lance',
            name: 'Light Recon Lance',
            description: 'Ultra-fast light reconnaissance',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must be light
                const allLight = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 0);
                // with a minimum Walk/Cruise speed of 6
                const veryFast = units.every(u => u.getUnit().walk >= 6);
                // all units in this Formation must have the Scout Unit Role
                const allScouts = units.every(u => u.getUnit().role === 'Scout');

                return allLight && veryFast && allScouts;
            }
        },

        // Security Lance
        {
            id: 'security-lance',
            name: 'Security Lance',
            description: 'Installation defense specialists',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least one unit in this Formation must have the Scout or Striker Unit Role
                const hasScoutOrStriker = units.some(u => u.getUnit().role === 'Scout' || u.getUnit().role === 'Striker');
                // and at least one unit must have the Sniper or Missile Boat Unit Role
                const hasSniperOrMissileBoat = units.some(u => u.getUnit().role === 'Sniper' || u.getUnit().role === 'Missile Boat');
                // Only one assault unit may be included in the Formation.
                const assaultCount = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 4).length;
                return assaultCount <= 1 && hasScoutOrStriker && hasSniperOrMissileBoat;
            }
        },

        // Striker/Cavalry Lance variations
        {
            id: 'striker-lance',
            name: 'Striker/Cavalry Lance',
            description: 'Fast mobile firepower',
            
            idealRole: 'Striker',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in a Striker/Cavalry Lance must have a minimum Walk/Cruise speed of 5, or a Jump movement of 4
                const fastUnits = units.every(u => u.getUnit().walk >= 5 || u.getUnit().jump >= 4);
                // No units in a Striker/Cavalry Lance may be of assault weight class or above
                const noAssault = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) < 4);
                // At least 50 percent of the Striker/Cavalry Lance must have the Striker or Skirmisher Unit Roles.
                const hasRequiredRoles = units.filter(u => u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
                return noAssault && fastUnits && hasRequiredRoles.length >= Math.floor(units.length * 0.5);
            }
        },

        {
            id: 'hammer-lance',
            name: 'Hammer Lance',
            description: 'Marik fast flanking force',
            
            exclusiveFaction: 'Free Worlds League',
            idealRole: 'Striker',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units must have a minimum Walk/Cruise speed of 5
                const fastUnits = units.every(u => u.getUnit().walk >= 5);
                return fastUnits;
            }
        },

        {
            id: 'heavy-striker-lance',
            name: 'Heavy Striker/Cavalry Lance',
            description: 'Heavy fast-moving formation',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must have a minimum Walk/Cruise speed of 4
                const fastUnits = units.every(u => u.getUnit().walk >= 4);
                // At least three units must be heavy or larger
                const heavyOrLarger = units.filter(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) >= 3);
                // light units may not be included
                const noLight = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) > 0);
                // At least one unit in this Formation must have a weapon that can do at least 5 damage at a range of 18 hexes or more.
                const hasLongRange = units.some(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 5, 18));
                // At least two units in this Formation must have the Striker or Skirmisher Unit Roles.
                const hasRequiredRoles = units.filter(u => u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');
                return fastUnits && heavyOrLarger.length >= 3 && noLight && hasLongRange && hasRequiredRoles.length >= 2;
            }
        },

        {
            id: 'horde',
            name: 'Horde',
            description: 'Mass light unit swarm tactics',
            
            minUnits: 5,
            validator: (units: ForceUnit[]) => {
                // The Formation must consist of five to ten units; 
                if (units.length < 5 || units.length > 10) return false;
                // All units must be light
                const allLight = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) === 0);
                // No unit may have the ability to do more than 10 damage at a range of 9 hexes or more
                const lowDamage = units.every(u => !LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 10, 9));
                
                return allLight && lowDamage;
            }
        },

        {
            id: 'light-striker-lance',
            name: 'Light Striker/Cavalry Lance',
            description: 'Fast light mobile force',
            
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // All units in this Formation must have a minimum Walk/Cruise speed of 5
                const fastUnits = units.every(u => u.getUnit().walk >= 5);
                // No unit may be heavy or larger
                const noHeavy = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) < 3);
                // and at least two units in this formation must have a weapon that can do at least 5 damage at a range of 18 hexes or more.
                const hasLongRange = units.filter(u => LanceTypeIdentifierUtil.canDealDamage(u.getUnit(), 5, 18));
                // At least two members of the Light Striker/Cavalry Lance must have the Striker or Skirmisher Unit Roles.
                const hasRequiredRoles = units.filter(u => u.getUnit().role === 'Striker' || u.getUnit().role === 'Skirmisher');

                return fastUnits && noHeavy && hasLongRange.length >= 2 && hasRequiredRoles.length >= 2;
            }
        },

        {
            id: 'ranger-lance',
            name: 'Ranger Lance',
            description: 'Terrain warfare specialists',
            
            idealRole: 'Skirmisher',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // No unit in this Formation may be assault weight or larger
                const noAssault = units.every(u => LanceTypeIdentifierUtil.getWeightClass(u.getUnit()) < 4);
                return noAssault;
            }
        },

        // Support Lance
        {
            id: 'support-lance',
            name: 'Support Lance',
            description: 'Multi-role formation backing other units',
            
            validator: (units: ForceUnit[]) => {
                // Support lance has no specific requirements
                return units.length >= 3;
            }
        },

        // Urban Combat Lance
        {
            id: 'urban-lance',
            name: 'Urban Combat Lance',
            description: 'City fighting specialists',
            
            idealRole: 'Ambusher',
            minUnits: 4,
            validator: (units: ForceUnit[]) => {
                // At least 50 percent of the units in this Formation must have jump movement or be infantry (Conventional or Battle Armor)
                const jumpOrInfantry = units.filter(u => u.getUnit().jump > 0 || u.getUnit().type === 'Infantry');
                // At least 50 percent of the units in this Formation must have a maximum Walk/Cruise speed of 4.
                const slowUnits = units.filter(u => u.getUnit().walk <= 4);
                
                return jumpOrInfantry.length >= Math.floor(units.length * 0.5) &&
                       slowUnits.length >= Math.floor(units.length * 0.5);
            }
        },

        // Aerospace Superiority Squadron
        {
            id: 'aerospace-superiority-squadron',
            name: 'Aerospace Superiority Squadron',
            description: 'Air superiority specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                // Has to be aerospace units only
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // More than 50 percent of the Formation’s units must have the Interceptor or Fast Dogfighter Unit Roles.
                const interceptorOrDogfighter = units.filter(u => u.getUnit().role === 'Interceptor' || u.getUnit().role === 'Fast Dogfighter');
                return interceptorOrDogfighter.length > Math.floor(units.length * 0.5);
            }
        },

        // Electronic Warfare Squadron
        {
            id: 'electronic-warfare-squadron',
            name: 'Electronic Warfare Squadron',
            description: 'Electronic warfare specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // Electronic Warfare squadrons do not have 
                // a Unit Role requirement, but more than 50 percent of the 
                // fighters in this Formation must each possess one or more of 
                // the following equipment: Beagle Probe, Active Probe, Angel 
                // ECM, Guardian ECM, ECM Suite, Bloodhound Probe, Light Probe, 
                // Light ECM, TAG, Light TAG, or Watchdog.
                const hasEWEquipment = units.filter(u => {
                    const eqNames = u.getUnit().comp?.map(c => c.n) || [];
                    return eqNames.some(name => [
                        'Beagle Probe', 'Active Probe', 'Angel ECM', 'Guardian ECM', 
                        'ECM Suite', 'Bloodhound Probe', 'Light Probe', 'Light ECM', 
                        'TAG', 'Light TAG', 'Watchdog'
                    ].includes(name));
                });
                return hasEWEquipment.length > Math.floor(units.length * 0.5);
            }
        },

        // Fire Support Squadron
        {
            id: 'fire-support-squadron',
            name: 'Fire Support Squadron',
            description: 'Fire support specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // At least 50 percent of the units in this Formation 
                // must have the Fire Support Unit Role. The remainder must have the 
                // Dogfighter Unit Role
                const hasFireSupportRole = units.filter(u => u.getUnit().role === 'Fire Support');
                const hasDogfighterRole = units.filter(u => u.getUnit().role && u.getUnit().role.includes('Dogfighter'));
                return hasFireSupportRole.length > Math.floor(units.length * 0.5) && hasDogfighterRole.length > 0;
            }
        },

        // Interceptor Squadron
        {
            id: 'interceptor-squadron',
            name: 'Interceptor Squadron',
            description: 'Interceptor specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // More than 50 percent of the units in this Formation must have the Interceptor Unit Role
                const hasInterceptorRole = units.filter(u => u.getUnit().role === 'Interceptor');
                return hasInterceptorRole.length > Math.floor(units.length * 0.5);
            }
        },

        // Strike Squadron
        {
            id: 'strike-squadron',
            name: 'Strike Squadron',
            description: 'Strike specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // More than 50 percent of the units in this Formation must have the Attack or Dogfighter Unit Roles.
                const hasAttackRole = units.filter(u => u.getUnit().role && u.getUnit().role.includes('Attack'));
                const hasDogfighterRole = units.filter(u => u.getUnit().role && u.getUnit().role.includes('Dogfighter'));
                return hasAttackRole.length > Math.floor(units.length * 0.5) && hasDogfighterRole.length > 0;
            }
        },

        // Transport Squadron
        // TODO: we don't have yet the "Transport" role in the unit data!!
        {
            id: 'transport-squadron',
            name: 'Transport Squadron',
            description: 'Transport specialists',
            
            minUnits: 6,
            validator: (units: ForceUnit[]) => {
                if (!units.every(u => u.getUnit().type === 'Aero')) return false;
                // More than 50 percent of the units in this Formation must have the Transport Unit Role.
                const hasTransportRole = units.filter(u => u.getUnit().role && u.getUnit().role.includes('Transport'));
                return hasTransportRole.length > Math.floor(units.length * 0.5);
            }
        },
    ];

    private static validateDefinition(definition: LanceTypeDefinition, units: ForceUnit[]): boolean {
        // If this definition has a parent, validate the parent first
        if (definition.parent) {
            const parentDefinition = this.definitions.find(d => d.id === definition.parent);
            if (!parentDefinition) {
                console.error(`Parent definition '${definition.parent}' not found for '${definition.id}'`);
                return false;
            }
            
            // Recursively validate the parent (which will validate its own parent if it has one)
            if (!this.validateDefinition(parentDefinition, units)) {
                return false;
            }
        }
        
        // Now validate this definition itself
        try {
            if (definition.minUnits && units.length < definition.minUnits) {
                return false;
            }
            // Before we scan for ideal role, if all units match that role then we don't have to validate at all, is already ideal
            if (definition.idealRole) {
                const allMatchIdeal = units.every(u => u.getUnit().role === definition.idealRole);
                if (allMatchIdeal) {
                    return true;
                }
            }
            return definition.validator(units);
        } catch (error) {
            console.error(`Error validating lance type ${definition.id}:`, error);
            return false;
        }
    }

    /**
     * Identifies all matching lance types for the given force units
     */
    public static identifyLanceTypes(units: ForceUnit[], techBase: string, factionName: string): LanceTypeDefinition[] {
        const matches: LanceTypeDefinition[] = [];
        
        for (const definition of this.definitions) {
            try {
                // Skip faction-exclusive lance types if the faction doesn't match
                if (definition.exclusiveFaction && !factionName.includes(definition.exclusiveFaction)) {
                    continue;
                }
                
                // Skip if tech base doesn't match (unless special or mixed)
                if (techBase && definition.techBase 
                    && definition.techBase != 'Special' 
                    && techBase !== 'Mixed' 
                    && definition.techBase !== techBase) {
                    continue;
                }
                if (this.validateDefinition(definition, units)) {
                    matches.push(definition);
                }
            } catch (error) {
                console.error(`Error validating lance type ${definition.id}:`, error);
            }
        }
        
        return matches;
    }

    /**
     * Gets the best matching lance type (most specific)
     */
    public static getBestMatch(units: ForceUnit[], techBase: string, factionName: string): LanceTypeDefinition | null {
        const matches = this.identifyLanceTypes(units, techBase, factionName);
        if (matches.length === 0) return null;
        // randomize but put weight on more specific matches.
        // Weights:
        // 1. Faction-specific lance types that match the current faction: x5
        // 2. Child definitions (those with parents) as they are more specific: x3
        // 3. Other lance types with specific requirements (non-generic): x2
        // 4. Generic lance types (support, command, battle): x1

        const weightedMatches: LanceTypeDefinition[] = [];
        for (const match of matches) {
            let weight = 1;
            if (match.exclusiveFaction && factionName.includes(match.exclusiveFaction)) {
                weight *= 5;
            } else
            if (match.parent) {
                weight *= 3;
            } else
            if (match.id !== 'support-lance' && match.id !== 'command-lance' && match.id !== 'battle-lance') {
                weight *= 2;
            }
            weightedMatches.push(...Array(weight).fill(match));
        }
        // Pick a random match from the weighted list
        return weightedMatches[Math.floor(Math.random() * weightedMatches.length)];
    }

    // Helper methods
    private static getWeightClass(unit: Unit): number {
        // 0 = Light (< 40), 1 = Medium (40-55), 2 = Heavy (56-75), 3 = Assault (76+)
        // For non-meks, use tonnage thresholds
        // We don't use unit.weightClass directly as this is simpler and faster (no string comparison)
        const tons = unit.tons;
        
        if (unit.type === 'Mek') {
            if (tons < 40) return 0;
            if (tons <= 55) return 1;
            if (tons <= 75) return 3;
            return 4;
        }
        
        // Simplified for other unit types
        if (tons < 40) return 0;
        if (tons < 60) return 1;
        if (tons < 80) return 3;
        return 4;
    }

    private static canDealDamage(unit: Unit, minDamage: number, atRange: number): boolean {
        // Check if unit can deal specified damage at specified range
        if (!unit.comp || unit.comp.length === 0) return false;
        
        let totalDamageAtRange = 0;
        for (const comp of unit.comp) {
            if (!comp.r) continue;
            const maxRange = Math.max(...comp.r.split('/').map(r => parseInt(r)));
            if (maxRange < atRange) continue;
            
            // Check damage
            if (comp.d) {
                const damage = parseInt(comp.d);
                if (!isNaN(damage)) {
                    totalDamageAtRange += damage;
                    if (totalDamageAtRange >= minDamage) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private static hasAutocannon(unit: Unit): boolean {
        return unit.comp?.some(c => c.n?.includes('AC/')) || false;
    }

    private static hasLBXAutocannon(unit: Unit): boolean {
        return unit.comp?.some(c => c.n?.includes('LB ')) || false;
    }

    private static hasLRM(unit: Unit): boolean {
        return unit.comp?.some(c => c.n?.includes('LRM')) || false;
    }

    private static hasSRM(unit: Unit): boolean {
        return unit.comp?.some(c => c.n?.includes('SRM')) || false;
    }

    private static hasArtillery(unit: Unit): boolean {
        return unit.comp?.some(c => c.t === 'A') || false;
    }
}