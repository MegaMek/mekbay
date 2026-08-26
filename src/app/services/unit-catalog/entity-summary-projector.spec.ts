// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentRegistry } from '../../models/equipment-lookup';
import { ArmorEquipment } from '../../models/equipment.model';
import { sha1Base64Url } from '../../utils/sha1.util';
import { EntityCoreUnitSummaryProjector } from './entity-summary-projector';
import {
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
    MM_DATA_UNIT_PROVIDER_ID,
} from './unit-catalog.types';

describe('EntityCoreUnitSummaryProjector', () => {
    it('uses the real BLK parser and summary builder exactly once for a direct-runtime family', async () => {
        const uuid = asUnitUuid('019f583e-b5e8-7032-b925-ba6c429a0687');
        const bytes = new TextEncoder().encode(`
<UUID>
${uuid}
</UUID>
<UnitType>
GunEmplacement
</UnitType>
<Name>
Medium Sniper Turret
</Name>
<Model>
(3075)
</Model>
<year>
3075
</year>
<type>
IS Level 3
</type>
`).buffer;
        const sourceHash = asSourceHash(await sha1Base64Url(bytes));
        const file = makeUnitFileName(uuid, 'blk');
        const standardArmor = new ArmorEquipment({
            id: 'Standard Armor',
            name: 'Standard',
            type: 'armor',
            armor: { type: 'STANDARD' },
            tech: { base: 'All' },
        });
        const projector = new EntityCoreUnitSummaryProjector(new EquipmentRegistry({
            [standardArmor.id]: standardArmor,
        }), {
        });

        const projected = await projector.project({
            entryKey: {
                origin: 'megamek',
                design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
                sourceRevision: sourceHash,
            },
            format: 'blk',
            file,
            bytes,
        });

        expect(projected.summary.uuid).toBe(uuid);
        expect(projected.summary.entityType).toBe('GunEmplacement');
        expect(projected.summary.hash).toBe(sourceHash);
        expect(projected.summary.summaryVersion).toBeGreaterThan(0);
        expect(Object.prototype.hasOwnProperty.call(projected.summary, 'sourceRef')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(projected.summary, 'readiness')).toBeFalse();
    });
});
