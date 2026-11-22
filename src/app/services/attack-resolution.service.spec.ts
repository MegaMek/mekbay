// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import type { AttackResolutionDialogData } from '../components/attack-resolution-dialog/attack-resolution-dialog.component';
import type { CBTForceMember } from '../models/force-member.model';
import { asEncounterTargetId } from '../models/runtime/encounter-runtime';
import { projectMekEquipmentPanel } from '../models/runtime/equipment-panel';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { AttackResolutionService } from './attack-resolution.service';
import { DialogsService } from './dialogs.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { GameEventsService } from './game-events.service';
import { InventoryControlOpforService } from './inventory-control-opfor.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';
import { UnitNameService } from './unit-name.service';

describe('AttackResolutionService hit locations', () => {
    const dialog = jasmine.createSpy('createDialog').and.returnValue({ closed: of(undefined) });
    beforeEach(() => {
        dialog.calls.reset();
        TestBed.configureTestingModule({ providers: [
            { provide: OptionsService, useValue: { options: () => ({ attackResolution: true, CBTOptionalRules: {} }) } },
            { provide: DialogsService, useValue: { createDialog: dialog } },
            { provide: GameEventsService, useValue: { received: EMPTY } },
            { provide: InventoryControlOpforService, useValue: { resolveOpforTarget: () => null } },
            { provide: ForceWorkspaceStateService, useValue: {} },
            { provide: UnitNameService, useValue: { name: () => 'Attacker' } },
            { provide: ToastService, useValue: {} },
        ] });
    });

    for (const ruleset of ['core-2026', 'total-warfare'] as const) {
        it(`resolves semi-guided indirect fire and aimed shots against water cover under ${ruleset}`, async () => {
            const fixture = createDirectMekRuntimeFixture(ruleset);
            const targetId = asEncounterTargetId('target:water');
            const registry = { revision: 0, targets: [{ id: targetId, letter: 'A', name: 'Target', color: '#abc',
                unitType: 'mek-biped', tnCalculator: { waterDepth: 'underwater-depth-1', tagged: true, immobile: true },
            }] } as const;
            const member = { id: fixture.instance.instanceId, entity: fixture.entity,
                force: { getUnitSnapshot: () => null } } as unknown as CBTForceMember;
            for (const indirectFire of [true, false]) {
                const weapon = fixture.equipmentComponent(indirectFire ? 'Test Artemis Launcher' : 'ISMediumLaser');
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-target-facts', targetId,
                        facts: { distance: 3, ...(indirectFire ? { calculator: { indirectFire: true } } : {}) } },
                }, registry, false).changed).toBeTrue();
                expect(fixture.instance.dispatchAttackerTargeting({ type: 'edit-attacker-targeting',
                    edit: { kind: 'set-component-selection', componentId: weapon.id,
                        selection: { kind: 'target', targetId, ...(indirectFire ? {} : { aim: 'CT' }) } },
                }, registry, false).changed).toBeTrue();
                const panel = projectMekEquipmentPanel(fixture.entity, fixture.index, ruleset, fixture.instance.query(), registry, {});
                await TestBed.inject(AttackResolutionService).rollAttacks(member, panel, {
                    gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false,
                    missingMovementModifier: false, attackModifierBreakdown: [], c3Available: true, c3DegradationSource: 'none',
                });
                const data: AttackResolutionDialogData = dialog.calls.mostRecent().args[1].data;
                const profile = data.targets[0].profiles.find(entry => entry.componentId === weapon.id)!;
                expect(profile.partialCover).toBe(indirectFire && ruleset === 'core-2026');
                if (!indirectFire) expect(profile.aim?.rerollLegs).toBeTrue();
            }
        });
    }
});
