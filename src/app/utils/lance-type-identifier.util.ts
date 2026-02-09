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
import { GameSystem } from '../models/common.model';
import { FormationTypeDefinition } from './formation-type.model';
import { CBTLanceTypeIdentifierUtil } from './cbt-lance-type-identifier.util';
import { ASLanceTypeIdentifierUtil } from './as-lance-type-identifier.util';

export type { FormationTypeDefinition } from './formation-type.model';

/*
 * Author: Drake
 *
 * Facade that routes formation identification to the correct
 * game-system-specific implementation (CBT or Alpha Strike).
 */

export class LanceTypeIdentifierUtil {

    /**
     * Identifies all matching formation types for the given force units.
     */
    public static identifyLanceTypes(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem
    ): FormationTypeDefinition[] {
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            return ASLanceTypeIdentifierUtil.identifyLanceTypes(units, techBase, factionName);
        }
        return CBTLanceTypeIdentifierUtil.identifyLanceTypes(units, techBase, factionName);
    }

    /**
     * Looks up a formation definition by its ID in the appropriate game system.
     */
    public static getDefinitionById(id: string, gameSystem: GameSystem): FormationTypeDefinition | null {
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            return ASLanceTypeIdentifierUtil.getDefinitionById(id);
        }
        return CBTLanceTypeIdentifierUtil.getDefinitionById(id);
    }

    /**
     * Gets the best matching formation type (most specific, weighted random).
     */
    public static getBestMatch(
        units: ForceUnit[],
        techBase: string,
        factionName: string,
        gameSystem: GameSystem
    ): FormationTypeDefinition | null {
        if (gameSystem === GameSystem.ALPHA_STRIKE) {
            return ASLanceTypeIdentifierUtil.getBestMatch(units, techBase, factionName);
        }
        return CBTLanceTypeIdentifierUtil.getBestMatch(units, techBase, factionName);
    }
}
