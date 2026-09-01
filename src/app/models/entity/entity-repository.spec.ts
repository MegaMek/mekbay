// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { WeaponEquipment } from '../equipment.model';
import { createTestEquipmentRegistry } from './testing/test-equipment-registry';
import {
    asSourceHash,
    asUnitUuid,
} from '../../services/unit-catalog/unit-catalog.types';
import {
    EntityRepository,
    type NativeEntitySource,
} from './entity-repository';
import { MekEntity } from './entities/mek/mek-entity';
import { VehicleEntity } from './entities/vehicle/vehicle-entity';

const UUID = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
const HASH = asSourceHash('A'.repeat(27));
const OTHER_HASH = asSourceHash(`${'A'.repeat(26)}E`);

describe('EntityRepository', () => {
    it('returns one canonical entity per supplied source hash and keeps load diagnostics on it', async () => {
        let source = nativeMtfSource(HASH);
        const repository = new EntityRepository(
            { read: async () => source },
            registry(),
        );

        const first = await repository.load({ uuid: UUID });
        const second = await repository.load({ uuid: UUID });

        expect(first.entity).toBeInstanceOf(MekEntity);
        expect(second.entity).toBe(first.entity);
        expect(first.entity.uuid()).toBe(UUID);
        expect(first.entity.equipment().map(mount => String(mount.mountId))).toEqual(['m1']);
        expect(first.entity.loadIssues()).toEqual(jasmine.any(Array));

        source = nativeMtfSource(OTHER_HASH);
        expect((await repository.load({ uuid: UUID })).entity)
            .not.toBe(first.entity);
    });

    it('loads BLK entities through the same UUID/source repository', async () => {
        const repository = new EntityRepository(
            { read: async () => nativeBlkSource(HASH) },
            registry(),
        );

        const loaded = await repository.load({ uuid: UUID });

        expect(loaded.entity).toBeInstanceOf(VehicleEntity);
        expect(loaded.entity.uuid()).toBe(UUID);
        expect(loaded.source.format).toBe('blk');
    });

    it('uses a catalog-supplied source revision before reopening native content', async () => {
        let reads = 0;
        const repository = new EntityRepository(
            { read: async () => {
                reads += 1;
                return nativeMtfSource(HASH);
            } },
            registry(),
        );
        const identity = {
            uuid: UUID,
            sourceHash: HASH,
        } as const;

        const first = await repository.load(identity);
        const second = await repository.load(identity);

        expect(second).toBe(first);
        expect(reads).toBe(1);
    });
});

function nativeMtfSource(sourceHash: typeof HASH | typeof OTHER_HASH): NativeEntitySource {
    return {
        uuid: UUID,
        format: 'mtf',
        sourceHash,
        bytes: new TextEncoder().encode(mtf()).buffer,
    };
}

function nativeBlkSource(sourceHash: typeof HASH): NativeEntitySource {
    return {
        uuid: UUID,
        format: 'blk',
        sourceHash,
        bytes: new TextEncoder().encode(vehicleBlk()).buffer,
    };
}

function registry() {
    const laser = new WeaponEquipment({
        id: 'ISMediumLaser',
        name: 'Medium Laser',
        type: 'weapon',
        aliases: ['Medium Laser'],
        flags: ['F_ENERGY'],
        stats: { criticalSlots: 1 },
    });
    return createTestEquipmentRegistry({ [laser.id]: laser });
}

function mtf(): string {
    const empty = Array.from({ length: 7 }, () => '-Empty-').join('\n');
    return `uuid:${UUID}
chassis:Nova
model:Prime
Config:Biped
techbase:Inner Sphere
era:3050
mass:20
engine:100 Fusion Engine
structure:Standard
heat sinks:10 Single
walk mp:5
jump mp:0
armor:Standard(Inner Sphere)
Left Arm:
Shoulder
Upper Arm Actuator
Lower Arm Actuator
Hand Actuator
ISMediumLaser
${empty}
`;
}

function vehicleBlk(): string {
    return `<UUID>
${UUID}
</UUID>
<UnitType>
Tank
</UnitType>
<Name>
Test Tank
</Name>
<year>
3075
</year>
<type>
IS Level 2
</type>
<motion_type>
Tracked
</motion_type>
<tonnage>
20
</tonnage>
<cruiseMP>
4
</cruiseMP>
<engine_type>
0
</engine_type>
<armor_type>
0
</armor_type>
<armor>
1
1
1
1
</armor>
`;
}
