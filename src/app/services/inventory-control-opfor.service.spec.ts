// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import type { Force } from '../models/force.model';
import { CBTForce, type InventoryControlTargetRosterRow } from '../models/cbt-force.model';
import { asStateRevision, asUnitInstanceId } from '../models/runtime/runtime-state';
import {
    asEncounterTargetId,
    type EncounterTarget,
    type TargetRegistryCommand,
    type TargetRegistryRejectionReason,
} from '../models/runtime/encounter-runtime';
import { InventoryControlOpforService } from './inventory-control-opfor.service';

describe('InventoryControlOpforService', () => {
    function createOpforHarness() {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        let targets: EncounterTarget[] = [];
        let revision = asStateRevision(0);
        let rejection: TargetRegistryRejectionReason | 'FORCE_READ_ONLY' | null = null;
        const enabled = signal(true);
        const dispatch = jasmine.createSpy('dispatchInventoryControlTargetRegistry').and.callFake(
            (command: TargetRegistryCommand, authority: 'user' | 'opfor-sync' | 'registry-reset') => {
                const snapshot = { revision, targets: [...targets] };
                if (rejection) {
                    const reason = rejection;
                    rejection = null;
                    return { accepted: false as const, changed: false as const, reason, snapshot };
                }
                const nextTargets = command.kind === 'replace-targets' && authority === 'opfor-sync'
                    ? [
                        ...targets.filter(target => target.source !== 'opfor'),
                        ...command.targets,
                    ]
                    : command.kind === 'reset-targets' && authority === 'registry-reset'
                        ? []
                        : null;
                if (!nextTargets) {
                    throw new Error('Expected an authorized OPFOR replacement');
                }
                if (JSON.stringify(targets) === JSON.stringify(nextTargets)) {
                    return { accepted: true as const, changed: false as const, snapshot };
                }
                const previousRevision = revision;
                revision = asStateRevision(Number(revision) + 1);
                targets = [...nextTargets];
                return {
                    accepted: true as const,
                    changed: true as const,
                    previousRevision,
                    snapshot: { revision, targets: [...targets] },
                };
            },
        );
        const force = {
            inventoryControlOpforEnabled: enabled,
            queryInventoryControlTargetRegistry: () => ({ revision, targets: [...targets] }),
            dispatchInventoryControlTargetRegistry: dispatch,
            getInventoryControlTargetRoster: () => [],
            units: () => [],
        } as unknown as CBTForce;
        (service as any).logger = { error: jasmine.createSpy('logger.error') };
        (service as any).toastService = { showToast: jasmine.createSpy('showToast') };
        spyOn(service, 'isAvailable').and.returnValue(true);

        return {
            service,
            force,
            enabled,
            dispatch,
            targets: () => targets,
            setTargets: (nextTargets: EncounterTarget[]) => targets = [...nextTargets],
            setRevision: (nextRevision: number) => revision = asStateRevision(nextRevision),
            rejectNext: (reason: TargetRegistryRejectionReason | 'FORCE_READ_ONLY') => rejection = reason,
            logger: (service as any).logger,
            toastService: (service as any).toastService,
        };
    }

    function rosterRow(
        id: string,
        name: string,
        overrides: Partial<InventoryControlTargetRosterRow> = {},
    ): InventoryControlTargetRosterRow {
        const instanceId = asUnitInstanceId(id);
        return Object.freeze({
            instanceId,
            targetId: asEncounterTargetId(`opfor:${instanceId}`),
            name,
            unitType: 'mek-biped',
            tnCalculator: Object.freeze({
                isAirborne: false,
                targetMovementBracket: null,
                skidding: false,
                prone: false,
                immobile: false,
            }),
            projection: 'v2',
            ...overrides,
        });
    }

    function manualTarget(letter: string): EncounterTarget {
        return {
            id: asEncounterTargetId(`manual:${letter}`),
            letter,
            name: `Target ${letter}`,
            color: '#fff',
            source: 'manual',
        };
    }

    function createAlignedCBTForce(roster: readonly InventoryControlTargetRosterRow[] = []): CBTForce {
        return Object.assign(Object.create(CBTForce.prototype), {
            units: () => [],
            inventoryControlOpforEnabled: signal(false),
            getInventoryControlTargetRoster: () => roster,
        }) as CBTForce;
    }

    function configureLoadedForces(
        service: InventoryControlOpforService,
        slots: Array<{ force: Force; alignment: 'friendly' | 'enemy' }>
    ): void {
        (service as any).loadedForces = signal(slots.map(slot => ({ ...slot, changeSub: null })));
    }

    it('resolves enemy CBT target rosters as OPFOR for a friendly force', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const firstEnemyRow = rosterRow('enemy-1', 'First Enemy');
        const secondEnemyRow = rosterRow('enemy-2', 'Second Enemy');
        const source = createAlignedCBTForce([rosterRow('friendly-1', 'Friendly')]);
        const friendlyPeer = createAlignedCBTForce([rosterRow('friendly-2', 'Friendly Peer')]);
        const firstEnemy = createAlignedCBTForce([firstEnemyRow]);
        const secondEnemy = createAlignedCBTForce([secondEnemyRow]);
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: friendlyPeer, alignment: 'friendly' },
            { force: firstEnemy, alignment: 'enemy' },
            { force: secondEnemy, alignment: 'enemy' }
        ]);

        expect(service.isAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTTargetRoster(source)).toEqual([firstEnemyRow, secondEnemyRow]);
    });

    it('resolves all non-enemy CBT rosters as OPFOR for an enemy force', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const firstFriendlyRow = rosterRow('friendly-1', 'First Friendly');
        const secondFriendlyRow = rosterRow('friendly-2', 'Second Friendly');
        const firstFriendly = createAlignedCBTForce([firstFriendlyRow]);
        const secondFriendly = createAlignedCBTForce([secondFriendlyRow]);
        const source = createAlignedCBTForce([rosterRow('enemy-1', 'Source Enemy')]);
        const enemyPeer = createAlignedCBTForce([rosterRow('enemy-2', 'Enemy Peer')]);
        configureLoadedForces(service, [
            { force: firstFriendly, alignment: 'friendly' },
            { force: source, alignment: 'enemy' },
            { force: enemyPeer, alignment: 'enemy' },
            { force: secondFriendly, alignment: 'friendly' }
        ]);

        expect(service.isAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTTargetRoster(source)).toEqual([firstFriendlyRow, secondFriendlyRow]);
    });

    it('keeps same-named unit instances from different opposing forces as distinct targets', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const source = createAlignedCBTForce();
        const first = rosterRow('shared-unit', 'First Atlas', {
            targetId: asEncounterTargetId('opfor:force-a:shared-unit'),
        });
        const second = rosterRow('shared-unit', 'Second Atlas', {
            targetId: asEncounterTargetId('opfor:force-b:shared-unit'),
        });
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: createAlignedCBTForce([first]), alignment: 'enemy' },
            { force: createAlignedCBTForce([second]), alignment: 'enemy' },
        ]);

        expect((service as any).opposingCBTTargetRoster(source).map((row: InventoryControlTargetRosterRow) => String(row.targetId))).toEqual([
            'opfor:force-a:shared-unit',
            'opfor:force-b:shared-unit',
        ]);
    });

    it('does not expose OPFOR for unloaded forces or forces with only same-side CBT peers', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const source = createAlignedCBTForce();
        const friendlyPeer = createAlignedCBTForce();
        const unloaded = createAlignedCBTForce();
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: friendlyPeer, alignment: 'friendly' }
        ]);

        expect(service.isAvailable(source)).toBeFalse();
        expect(service.isAvailable(unloaded)).toBeFalse();
        expect((service as any).opposingCBTTargetRoster(source)).toEqual([]);
    });

    it('does not treat a non-CBT opposing force as inventory-control OPFOR', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const source = createAlignedCBTForce();
        const alphaStrikeForce = { units: () => [] } as unknown as Force;
        configureLoadedForces(service, [
            { force: source, alignment: 'enemy' },
            { force: alphaStrikeForce, alignment: 'friendly' }
        ]);

        expect(service.isAvailable(source)).toBeFalse();
        expect((service as any).opposingCBTTargetRoster(source)).toEqual([]);
    });

    it('keeps OPFOR available when the opposing CBT force is empty', () => {
        const service = Object.create(InventoryControlOpforService.prototype) as InventoryControlOpforService;
        const source = createAlignedCBTForce();
        const emptyEnemy = createAlignedCBTForce();
        configureLoadedForces(service, [
            { force: source, alignment: 'friendly' },
            { force: emptyEnemy, alignment: 'enemy' }
        ]);

        expect(service.isAvailable(source)).toBeTrue();
        expect((service as any).opposingCBTTargetRoster(source)).toEqual([]);
    });

    it('imports roster rows through authorized explicit-revision dispatch only', () => {
        const harness = createOpforHarness();
        const enemy = rosterRow('enemy-1', 'Atlas AS7-D');

        (harness.service as any).synchronize(harness.force, [enemy], true);
        const imported = harness.targets()[0];
        expect(imported).toEqual(jasmine.objectContaining({
            id: 'opfor:enemy-1',
            name: 'Atlas AS7-D',
            source: 'opfor',
            readOnly: true,
            unitType: 'mek-biped',
        }));
        expect(imported as unknown as Record<string, unknown>).not.toEqual(jasmine.objectContaining({ distance: jasmine.anything() }));
        expect(harness.dispatch.calls.mostRecent().args[0].expectedRevision).toBe(asStateRevision(0));
        expect(harness.dispatch.calls.mostRecent().args[1]).toBe('opfor-sync');

        harness.setTargets([{ ...imported, color: '#abcdef' }]);
        const renamedVehicle = rosterRow('enemy-1', 'Demolisher', {
            unitType: 'vehicle',
        });
        (harness.service as any).synchronize(harness.force, [renamedVehicle], true);

        expect(harness.targets()[0]).toEqual(jasmine.objectContaining({
            id: 'opfor:enemy-1',
            name: 'Demolisher',
            color: '#abcdef',
            unitType: 'vehicle',
        }));
    });

    it('does not dispatch semantically unchanged OPFOR targets', () => {
        const harness = createOpforHarness();
        const enemy = rosterRow('enemy-1', 'Atlas AS7-D');
        (harness.service as any).synchronize(harness.force, [enemy], true);
        const imported = harness.targets()[0];
        harness.setTargets([{
            tnCalculator: {
                isAirborne: imported.tnCalculator?.isAirborne,
                targetMovementBracket: imported.tnCalculator?.targetMovementBracket,
                skidding: imported.tnCalculator?.skidding,
                prone: imported.tnCalculator?.prone,
                immobile: imported.tnCalculator?.immobile,
                targetHexCover: imported.tnCalculator?.targetHexCover,
                waterDepth: imported.tnCalculator?.waterDepth,
                buildingCover: imported.tnCalculator?.buildingCover,
                largeTarget: imported.tnCalculator?.largeTarget,
                narcAboveWater: imported.tnCalculator?.narcAboveWater,
                narcUnderwater: imported.tnCalculator?.narcUnderwater,
                tagged: imported.tnCalculator?.tagged,
                ecmShielded: imported.tnCalculator?.ecmShielded,
            },
            unitType: imported.unitType,
            readOnly: imported.readOnly,
            source: imported.source,
            color: imported.color,
            name: imported.name,
            letter: imported.letter,
            id: imported.id
        }]);
        harness.dispatch.calls.reset();

        (harness.service as any).synchronize(harness.force, [enemy], true);

        expect(harness.dispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch after adding a manual target beside an unchanged OPFOR target', () => {
        const harness = createOpforHarness();
        const enemy = rosterRow('enemy-1', 'Atlas');
        (harness.service as any).synchronize(harness.force, [enemy], true);
        const linkedTarget = harness.targets()[0];
        harness.setTargets([linkedTarget, manualTarget('B')]);
        harness.dispatch.calls.reset();

        (harness.service as any).synchronize(harness.force, [enemy], true);

        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.targets().map(target => [target.id, target.letter])).toEqual([
            ['opfor:enemy-1', 'A'],
            ['manual:B', 'B']
        ]);
    });

    it('gives manual targets priority, sorts deterministically, and caps the registry at twelve', () => {
        const harness = createOpforHarness();
        harness.setTargets('ABCDEFGHIJK'.split('').map(manualTarget));
        const source = harness.force;
        const enemy = createAlignedCBTForce([
            rosterRow('z-enemy', 'Zulu'),
            rosterRow('a-enemy', 'Alpha'),
            rosterRow('m-enemy', 'Mike'),
        ]);
        configureLoadedForces(harness.service, [
            { force: source, alignment: 'friendly' },
            { force: enemy, alignment: 'enemy' },
        ]);
        (harness.service.isAvailable as jasmine.Spy).and.callThrough();

        expect(harness.service.setEnabled(source, true)).toBeTrue();

        expect(harness.targets()).toHaveSize(12);
        expect(harness.targets().filter(target => target.source !== 'opfor')).toHaveSize(11);
        expect(harness.targets().filter(target => target.source === 'opfor').map(target => String(target.id))).toEqual(['opfor:a-enemy']);
        expect(harness.targets()[11].letter).toBe('L');
    });

    it('includes a detached retained-V2 opponent row', () => {
        const harness = createOpforHarness();
        const retained = rosterRow('retained-1', 'Retained Marauder');
        const enemy = createAlignedCBTForce([retained]);
        configureLoadedForces(harness.service, [
            { force: harness.force, alignment: 'friendly' },
            { force: enemy, alignment: 'enemy' },
        ]);
        (harness.service.isAvailable as jasmine.Spy).and.callThrough();

        harness.service.setEnabled(harness.force, true);

        expect(harness.targets()[0]).toEqual(jasmine.objectContaining({
            id: 'opfor:retained-1',
            name: 'Retained Marauder',
            source: 'opfor',
            readOnly: true,
        }));
    });

    it('removes derived targets when OPFOR synchronization is disabled', () => {
        const harness = createOpforHarness();
        (harness.service as any).synchronize(harness.force, [rosterRow('enemy-1', 'Atlas')], true);

        harness.enabled.set(false);
        (harness.service as any).synchronize(harness.force, [], false);

        expect(harness.targets()).toEqual([]);
    });

    it('surfaces and logs a stale OPFOR rejection without enabling the toggle', () => {
        const harness = createOpforHarness();
        const enemy = createAlignedCBTForce([rosterRow('enemy-1', 'Atlas')]);
        configureLoadedForces(harness.service, [
            { force: harness.force, alignment: 'friendly' },
            { force: enemy, alignment: 'enemy' },
        ]);
        (harness.service.isAvailable as jasmine.Spy).and.callThrough();
        harness.enabled.set(false);
        harness.setRevision(7);
        harness.rejectNext('STALE_REVISION');

        expect(harness.service.setEnabled(harness.force, true)).toBeFalse();

        expect(harness.dispatch.calls.mostRecent().args[0].expectedRevision).toBe(asStateRevision(7));
        expect(harness.enabled()).toBeFalse();
        expect(harness.targets()).toEqual([]);
        expect(harness.logger.error).toHaveBeenCalledWith(jasmine.stringContaining('STALE_REVISION'));
        expect(harness.toastService.showToast).toHaveBeenCalledWith(jasmine.stringContaining('STALE_REVISION'), 'error');
    });

});
