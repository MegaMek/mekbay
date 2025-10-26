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

/*
 * Author: Drake
 */
import { IEquipment } from "./equipment.model";
import { Era } from "./eras.model";

// Weapon/component info for comp.w
export interface UnitComponent {
    id: string;     // Internal Name
    q: number;      // quantity
    q2?: number;     // used for ammo count (as q is used for the tons)
    n: string;      // Display Name
    /**
     * type:
     * E: Energy
     * M: Missile
     * B: Ballistic
     * A: Artillery
     * P: Physical
     * O: Other
     * X: Ammo
     */
    t: 'E' | 'M' | 'B' | 'A' | 'X' | 'P' | 'O' | 'HIDDEN'; // type
    p: number; // the location id 
    l: string;      // location (RA, LT, LA, etc. Can contain multiple locations if component is split: LA/LT)
    r?: string;      // range (e.g. "6/12/18")
    m?: string;      // minimum range or other info
    d?: string;      // damage per shot
    md?: string;     // max damage
    c?: string;      // slots/criticals
    os?: number;     // oneshot (0 = no, 1 = oneshot, 2 = double oneshot)
    bay?: UnitComponent[];
    eq?: IEquipment;
}
export interface Unit {
    name: string;
    id: number; // MUL id (unique)
    chassis: string;
    model: string;
    year: number;
    weightClass: string;
    tons: number;
    bv: number;
    pv: number;
    cost: number;
    level: number;
    techBase: string;
    techRating: string;
    type: string;
    subtype: string;
    omni: number;
    engine: string;
    engineRating: number;
    source: string;
    role: string;
    armorType: string;
    structureType: string;
    armor: number;
    armorPer: number; // Armor %
    internal: number;
    heat: number;
    dissipation: number;
    moveType: string;
    walk: number;
    run: number; // Without MASC systems
    run2: number; // With MASC systems
    jump: number;
    c3: string;
    dpt: number;
    comp: UnitComponent[];
    su: number;
    crewSize: number;
    quirks: string[];
    icon: string;
    fluff?: {
        img?: string;
        manufacturer?: string;
        primaryFactory?: string;
        capabilities?: string;
        overview?: string;
        deployment?: string;
        history?: string;
        notes?: string;
        systems?: { label?: string, manufacturer?: string, model?: string }[];
    };
    cargo?: {
        n: number; // number of the cargo bay
        type: string; // type of cargo bay
        capacity: string; // capacity of the cargo bay
        doors: number; // number of doors
    }[];
    sheets: string[];
    as: AlphaStrikeUnitStats;
    _chassis?: string; // For pre-compiled search
    _model?: string; // For pre-compiled search
    _displayType: string;
    _maxRange: number; // Max range of any weapon on this unit
    _dissipationEfficiency: number; // Dissipation - Heat
    _mdSumNoPhysical: number; // Max damage sum for all weapons except physical
    _mdSumNoPhysicalNoOneshots: number; // Max damage sum for all weapons except physical, ignoring oneshots
    _era?: Era; // Cached era for this unit
    _tags: string[]; // Cached tags for this unit
}

export interface Units {
    version: string;
    etag: string;
    units: Unit[];
}

/*
"as":{"move":"14v","role":"Scout","armor":"1","size":"3","specials":["ATMO","BAR","CT10","ENE","FC","LG","SEAL","SOA"],"astype":"SV","structure":"3"}},
"as":{"damage":"2/2/0","move":"12j","role":"Scout","armor":"7","size":"3","specials":["AMS","ECM","PRB","RCN"],"astype":"BM","structure":"3"}},
"as":{"damage":"6/6/4","move":"10","role":"Missile Boat","armor":"7","size":"3","specials":["CASE","ECM","IF2","LRM2/2/2"],"astype":"BM","structure":"4"}},
"as":{"nose":"53/54/22/8, CAP149/149/149/53, MSL8/8/8/8, PNT4","move":"2","side":"46/46/35/16, CAP62/62/62/38, MSL3/3/3/3, PNT2","role":"None","armor":"495","size":"4","specials":["AT50-D8","CK415-D12","CRW9","DT8","HPG","KF","LF","MFB2","SPC","ST20-D12"],"astype":"WS","aft":"22/23/14/-, CAP15/15/15/15, MSL3/3/3/3, PNT2","structure":"90"}},
*/

export interface AlphaStrikeUnitStats {
    damage?: string;
    move: string;
    role?: string;
    armor: number;
    structure: number;
    size: string;
    specials: string[];
    asType: string;
    nose?: string;
    side?: string;
    aft?: string;
}