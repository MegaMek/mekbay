// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createConstructionEntity } from '../construction/domain/construction-factory';
import { UnitsCatalogService } from '../services/catalogs/units-catalog.service';
import { DataService } from '../services/data.service';
import { LoggerService } from '../services/logger.service';
import { SpriteStorageService } from '../services/sprite-storage.service';
import { EntityUnitSummaryProjector } from '../services/unit-catalog/entity-summary-projector';
import { asSourceHash,asUnitUuid,makeUnitFileName,MM_DATA_UNIT_PROVIDER_ID } from '../services/unit-catalog/unit-catalog.types';
import { UnitDetailsSummaryService } from '../services/unit-details-summary.service';
import { RecordSheetSvgGenerator } from '../utils/sheets/record-sheet-svg-generator';
import { formatWholeNumber } from '../utils/sheets/record-sheet-svg-rendering';
import { currentUnitBaseBattleValue,pristineUnitBattleValue } from './cbt-force-battle-value';
import type { CBTRuleset } from './cbt-ruleset.model';
import type { CBTForceMember } from './force-member.model';
import { encodeNativeEntity } from './entity/write-entity';
import { TestBipedMekEntity } from './entity/testing/test-entities';
import { createTestEquipmentRegistry } from './entity/testing/test-equipment-registry';
import { addTestEquipment } from './entity/testing/test-mounted-equipment';
import { EntityMountedEquipment } from './entity/types';
import { AmmoEquipment,WeaponEquipment } from './equipment.model';
import { createMekUnit } from './runtime/cbt-mek-unit';

/** Caseless AC ammo is worth twice its standard round under TW and the standard round under Core. */
describe('unit BV under each ruleset', () => {
    const autocannon = new WeaponEquipment({
        id: 'Test AC/5', name: 'AC/5', type: 'weapon', flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'],
        stats: { criticalSlots: 4, bv: 70 },
        weapon: { ammoType: 'AC', rackSize: 5, damage: 5, heat: 1, ranges: [3, 6, 12, 18] },
    });
    const standard = new AmmoEquipment({
        id: 'Test AC/5 Ammo', name: 'AC/5 Ammo', type: 'ammo', stats: { bv: 9 },
        ammo: { type: 'AC', rackSize: 5, shots: 20 },
    });
    const caseless = new AmmoEquipment({
        id: 'Test AC/5 Caseless', name: 'AC/5 Caseless Ammo', type: 'ammo', stats: { bv: 9 },
        ammo: { type: 'AC', rackSize: 5, shots: 40, baseAmmo: standard.id, munitionType: ['M_CASELESS'] },
    });

    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5ec');
    const registry = () => createTestEquipmentRegistry({
        [autocannon.id]: autocannon, [standard.id]: standard, [caseless.id]: caseless,
    });

    function caselessMek() {
        const entity = new TestBipedMekEntity(registry());
        entity.uuid.set(uuid);
        entity.setTonnage(50);
        entity.setEquipment([
            mount('weapon:1', autocannon, 'RT'),
            mount('ammo:1', caseless, 'RT', 40),
        ]);
        return entity;
    }

    /** A complete construction design, so it round trips through its native BLK source. */
    function caselessTank() {
        const entity = createConstructionEntity('Tank', registry());
        entity.uuid.set(uuid);
        addTestEquipment(entity, autocannon, { location: 'Front' });
        addTestEquipment(entity, caseless, { location: 'Body' });
        return entity;
    }

    async function undamagedUnit(ruleset: CBTRuleset) {
        return createMekUnit({ uuid, instanceId: `unit:bv-${ruleset}` }, caselessMek(), uuid, {
            initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset },
        });
    }

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`reports the same pristine and current BV for an undamaged unit under ${ruleset}`, async () => {
            const unit = await undamagedUnit(ruleset);
            // An undamaged unit shows one BV on its sheet, not "current (pristine)".
            expect(pristineUnitBattleValue(unit)).toBe(currentUnitBaseBattleValue(unit)!);
        });
    }

    it('values the caseless bin by the bound ruleset', async () => {
        const core = currentUnitBaseBattleValue(await undamagedUnit('core-2026'))!;
        const tw = currentUnitBaseBattleValue(await undamagedUnit('total-warfare'))!;
        expect(tw).toBeGreaterThan(core);
    });

    it("prices a force member's details summary under the rules it plays", () => {
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { getUnitByUuid: () => undefined } },
                { provide: UnitsCatalogService, useValue: {} },
                { provide: LoggerService, useValue: {} },
                { provide: SpriteStorageService, useValue: { resolveIconPath: () => '' } },
            ],
        });
        const entity = caselessMek();
        const ruleset = signal<CBTRuleset>('total-warfare');
        const member = {
            id: 'unit:details', entity, ruleset, force: { getUnitSnapshot: () => null },
        } as unknown as CBTForceMember;
        const details = TestBed.inject(UnitDetailsSummaryService);

        expect(entity.battleValue('total-warfare')).toBeGreaterThan(entity.battleValue('core-2026'));
        expect(details.resolveForceMember(member).bv).toBe(entity.battleValue('total-warfare'));
        ruleset.set('core-2026');
        expect(details.resolveForceMember(member).bv).toBe(entity.battleValue('core-2026'));
    });

    it("prints the sheet's own ruleset BV on generated Mek and vehicle record sheets", async () => {
        for (const entity of [caselessMek(), caselessTank()]) {
            for (const ruleset of ['core-2026', 'total-warfare'] as const) {
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                expect(svg.querySelector('#bv')?.textContent).withContext(`${entity.entityType} ${ruleset}`)
                    .toBe(formatWholeNumber(entity.battleValue(ruleset)));
            }
        }
    });

    it('keeps catalog summaries at Core BV', async () => {
        const entity = caselessTank();
        const bytes = new TextEncoder().encode(encodeNativeEntity(entity)).buffer;
        const { summary } = await new EntityUnitSummaryProjector(entity.getEquipmentRegistry()).project({
            entryKey: {
                origin: 'megamek',
                design: { provider: MM_DATA_UNIT_PROVIDER_ID, uuid },
                sourceRevision: asSourceHash('A'.repeat(27)),
            },
            format: 'blk',
            file: makeUnitFileName(uuid, 'blk'),
            bytes,
        });
        expect(entity.battleValue('total-warfare')).toBeGreaterThan(entity.battleValue('core-2026'));
        expect(summary.bv).toBe(entity.battleValue('core-2026'));
    });
});

function mount(mountId: string, equipment: WeaponEquipment | AmmoEquipment, location: string, shotsCount?: number) {
    return new EntityMountedEquipment({
        mountId, equipment, equipmentId: equipment.id,
        allocation: { kind: 'location', location },
        ...(shotsCount === undefined ? {} : { shotsCount }),
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
    });
}
