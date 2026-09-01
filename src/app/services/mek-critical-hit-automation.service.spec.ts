// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { AmmoEquipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { CriticalSlot } from '../models/force-serialization';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { CORE_2026_GAME_RULES } from '../models/rules/game-rules';
import { CBTAutomationService } from './cbt-automation.service';
import { MekCriticalHitAutomationService } from './mek-critical-hit-automation.service';
import { ToastService } from './toast.service';

describe('MekCriticalHitAutomationService', () => {
    let service: MekCriticalHitAutomationService;
    let resolveAutomation: jasmine.Spy;
    let showToast: jasmine.Spy;

    beforeEach(() => {
        resolveAutomation = jasmine.createSpy('resolve');
        showToast = jasmine.createSpy('showToast');
        TestBed.configureTestingModule({
            providers: [
                MekCriticalHitAutomationService,
                { provide: CBTAutomationService, useValue: { resolve: resolveAutomation } },
                { provide: ToastService, useValue: { showToast } },
            ],
        });
        service = TestBed.inject(MekCriticalHitAutomationService);
    });

    it('applies an accepted explosion and describes its damage before mutation', async () => {
        const fixture = explodingAmmoUnit('yes');
        resolveAutomation.and.callFake((_key: string, events: Array<{ id: string }>) =>
            Promise.resolve(new Set([events[0].id])));

        const resolution = await service.applyRoll(fixture.unit, 'LT', [1, 1], true);

        expect(resolveAutomation).toHaveBeenCalledOnceWith(
            'internalExplosionsCheck',
            [jasmine.objectContaining({
                subject: 'Archer ARC-2D',
                event: 'Internal explosion',
                description: 'AC/10 Ammo in Left Torso · 100 damage',
                effects: [
                    'Left Torso: 12 internal',
                    'Center Torso: 8 internal · 12 rear armor',
                    'MechWarrior feedback: 1 hit',
                ],
            })],
            jasmine.any(Object),
        );
        expect(resolution.cancelled).toBeFalse();
        expect(resolution.outcome?.explosion?.rawDamage).toBe(100);
        expect(fixture.slot.hits).toBe(1);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.get('LT')).toBe(12);
        expect(showToast).toHaveBeenCalledWith(
            'Archer ARC-2D — Internal explosion: AC/10 Ammo, 100 damage in Left Torso; 1 pilot hit applied',
            'error',
        );
    });

    it('applies the manually selected critical but not its rejected explosion', async () => {
        const fixture = explodingAmmoUnit();
        resolveAutomation.and.resolveTo(new Set<string>());

        const resolution = await service.applySlot(fixture.unit, fixture.slot, true);

        expect(resolution.cancelled).toBeFalse();
        expect(resolution.outcome?.applied).toBeTrue();
        expect(resolution.outcome?.explosion).toBeUndefined();
        expect(fixture.slot.hits).toBe(1);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.size).toBe(0);
    });

    it('applies nothing when explosion review is cancelled', async () => {
        const fixture = explodingAmmoUnit();
        resolveAutomation.and.resolveTo(null);

        const resolution = await service.applyRoll(fixture.unit, 'LT', [1, 1], true);

        expect(resolution).toEqual({ cancelled: true, outcome: null });
        expect(fixture.slot.hits).toBe(0);
        expect(fixture.slot.consumed).toBe(0);
        expect(fixture.internalHits.size).toBe(0);
    });
});

function explodingAmmoUnit(automationMode: 'yes' | 'ask' = 'ask'): {
    readonly unit: CBTForceUnit;
    readonly slot: CriticalSlot;
    readonly internalHits: Map<string, number>;
} {
    const ammo = new AmmoEquipment({
        id: 'TestAC10Ammo',
        name: 'AC/10 Ammo',
        type: 'ammo',
        stats: { explosive: true },
        ammo: { type: 'AC', rackSize: 10, shots: 10, damagePerShot: 1 },
    });
    const slot: CriticalSlot = {
        id: 'ammo@LT',
        name: ammo.name,
        loc: 'LT',
        slot: 0,
        totalAmmo: 10,
        consumed: 0,
        hits: 0,
        eq: ammo,
    };
    const internalPoints = new Map<string, number>([['LT', 12], ['CT', 31]]);
    const armorPoints = new Map<string, number>([['LT', 16], ['CT', 31], ['CT-rear', 12]]);
    const internalHits = new Map<string, number>();
    const armorHits = new Map<string, number>();
    let pilotHits = 0;
    const unit = {
        id: 'unit-a',
        gameRules: CORE_2026_GAME_RULES,
        rules: { mountedCriticalDamageDestructionThreshold: () => 1 },
        locations: { internal: internalPoints },
        getNotificationDisplayName: () => 'Archer ARC-2D',
        automationMode: () => automationMode,
        getCritSlots: () => [slot],
        getCritSlot: (location: string, index: number) =>
            location === slot.loc && index === slot.slot ? slot : null,
        getInventory: () => [],
        getEquipmentStatus: () => 'available',
        isEquipmentOperational: () => true,
        getCriticalDelayedExplosion: () => null,
        getInventoryControlSelectedAmmo: () => null,
        getEquipmentRegistry: () => EMPTY_EQUIPMENT_REGISTRY,
        getInventoryControlRules: () => ({}),
        getUnit: () => ({ structureType: '', armorType: 'Standard', features: [], comp: [] }),
        getArmorTypeAt: () => 'STANDARD',
        getStructureKindAt: () => 'standard',
        getCrewMember: () => ({
            getHits: () => pilotHits,
            setHits: (hits: number) => { pilotHits = hits; },
        }),
        applyInternalExplosionCrewHits: (hits: number) => {
            pilotHits += hits;
            return hits;
        },
        applyHitToCritSlot: (critical: CriticalSlot) => {
            critical.hits = (critical.hits ?? 0) + 1;
            critical.destroying = Date.now();
        },
        getInternalPoints: (location: string) => internalPoints.get(location) ?? 0,
        getInternalHits: (location: string) => internalHits.get(location) ?? 0,
        addInternalHits: (location: string, damage: number) => {
            internalHits.set(location, (internalHits.get(location) ?? 0) + damage);
        },
        getArmorPoints: (location: string, rear: boolean) =>
            armorPoints.get(`${location}${rear ? '-rear' : ''}`) ?? 0,
        getArmorHits: (location: string, rear: boolean) =>
            armorHits.get(`${location}${rear ? '-rear' : ''}`) ?? 0,
        addArmorHits: (location: string, damage: number, rear: boolean) => {
            const key = `${location}${rear ? '-rear' : ''}`;
            armorHits.set(key, (armorHits.get(key) ?? 0) + damage);
        },
    } as unknown as CBTForceUnit;

    return { unit, slot, internalHits };
}
