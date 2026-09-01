// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type { CBTForceMember, CBTMekForceMember } from '../../models/force-member.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import { TestBipedMekEntity, TestTankEntity } from '../../models/entity/testing/test-entities';

const ZERO_HIT = Object.freeze({
    profile: Object.freeze([0]), value: 0, changed: false, weakened: false,
    modifierBreakdown: Object.freeze([]),
});
const ZERO_HITS_BY_RANGE = Object.freeze({
    short: ZERO_HIT, medium: ZERO_HIT, long: ZERO_HIT, extreme: ZERO_HIT,
});
import type { MekTurnPanelSnapshot } from '../../models/runtime/mek-turn-panel';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ToastService } from '../../services/toast.service';
import { EquipmentDialogComponent } from './equipment-dialog.component';
import type { EquipmentDialogData } from './equipment-dialog.model';

function createTurnSnapshot(
    patch: Partial<MekTurnPanelSnapshot> = {},
): MekTurnPanelSnapshot {
    return {
        entityUuid: 'entity:crab',
        stateRevision: 1,
        movement: { kind: 'supported', rulesFlavor: 'core-2026', immobile: false },
        movementState: {
            movement: null,
            action: null,
            standAttempts: 0,
            carefulStand: false,
            checks: [],
            damageThisPhase: 0,
            automaticFalls: [],
        },
        activeBoosterComponentIds: [],
        defenseModifierTotal: { modifier: 0 },
        turn: {
            airborne: null,
            cover: null,
            weaponsHeat: 0,
            acknowledgedHeatSources: new Set(),
            heatDissipationConsumed: 0,
            spotting: false,
            phaseStateChanged: false,
        },
        cover: {
            partiallyUnderwater: false,
            submerged: false,
            building: { level: null, modifier: 0 },
        },
        heat: { current: 0, heatsinksOff: 0 },
        heatProjection: { kind: 'unsupported', blockers: [] },
        ruleChecks: [],
        conditions: [],
        ...patch,
    } as unknown as MekTurnPanelSnapshot;
}

interface MemberFixture {
    readonly id: string;
    readonly chassis: string;
    readonly model: string;
    readonly turnSnapshot?: MekTurnPanelSnapshot;
}

function createMembers(definitions: readonly MemberFixture[]): CBTMekForceMember[] {
    const changed = new Subject<void>();
    let members: CBTMekForceMember[] = [];
    const byId = new Map(definitions.map(definition => [definition.id, definition] as const));
    const force = {
        changed,
        members: () => members,
        readOnly: () => false,
        getEquipmentPanelSnapshot: (id: string) => {
            const definition = byId.get(id)!;
            return {
                displayName: `${definition.chassis} ${definition.model}`,
                unitType: 'Mek',
                tracksHeat: true,
                stateRevision: 1,
                targetRegistryRevision: 1,
                crew: { gunnery: 3, piloting: 4 },
                components: [],
                physicalAttacks: [],
                targets: [],
                heat: { current: 0, pending: null, sinksOff: 0 },
            };
        },
        getEquipmentInteractions: () => [],
        getAttackerTargeting: () => ({ stateRevision: 1, registryRevision: 1, state: {} }),
        getMekTurnPanelSnapshot: (id: string) => byId.get(id)?.turnSnapshot ?? createTurnSnapshot(),
        getC3State: () => 'none',
        getMekRecordSheetSnapshot: () => ({ conditions: [] }),
    };
    members = definitions.map(definition => {
        const entity = new TestBipedMekEntity();
        entity.chassis.set(definition.chassis);
        entity.model.set(definition.model);
        return {
            kind: 'cbt',
            id: definition.id,
            entity,
            force,
        } as unknown as CBTMekForceMember;
    });
    return members;
}

function createMember(turnSnapshot = createTurnSnapshot()): CBTMekForceMember {
    return createMembers([{
        id: 'unit:crab',
        chassis: 'Crab',
        model: 'CRB-20',
        turnSnapshot,
    }])[0]!;
}

function createTankMember(): CBTForceMember {
    const changed = new Subject<void>();
    const entity = new TestTankEntity();
    entity.chassis.set('Vedette');
    entity.model.set('Medium Tank');
    let member: CBTForceMember;
    const force = {
        changed,
        members: () => [member],
        readOnly: () => false,
        getEquipmentPanelSnapshot: () => ({
            displayName: 'Vedette Medium Tank',
            unitType: 'Tank',
            tracksHeat: false,
            stateRevision: 1,
            targetRegistryRevision: 1,
            crew: { gunnery: 4, piloting: 5 },
            components: [{
                componentId: 'mount:ac-10' as ComponentId,
                label: 'AC/10',
                locations: [],
                status: 'available',
                previewStatus: 'available',
                modes: [],
                jammed: false,
                weapon: {
                    heat: 3,
                    firingHeat: 3,
                    selectable: true,
                    damage: 10,
                    damageText: '10',
                    damageTextByRange: { short: '10', medium: '10', long: '10', extreme: '10' },
                    hit: { default: ZERO_HIT, byRange: ZERO_HITS_BY_RANGE, indirectByRange: ZERO_HITS_BY_RANGE },
                    toHitModifier: 0,
                    hitModifierBreakdown: [],
                    ranges: [5, 10, 15, 20],
                    minimumRange: 0,
                    selection: { kind: 'selected' as const },
                    ammoSources: [],
                    underwater: false,
                    attackerSubmerged: false,
                    disabledTargetReasons: {},
                },
            }],
            physicalAttacks: [],
            physicalAttackBlockers: [],
            targets: [],
            heat: { current: 0, pending: null, sinksOff: 0 },
        }),
        getEquipmentInteractions: () => [],
        getAttackerTargeting: () => ({ stateRevision: 1, registryRevision: 1, state: {} }),
        getUnitSnapshot: () => null,
        getC3State: () => 'none',
    };
    member = {
        kind: 'cbt',
        id: 'unit:vedette',
        entity,
        force,
    } as unknown as CBTForceMember;
    return member;
}

function createDialog(data: EquipmentDialogData) {
    const dialogRef = { close: jasmine.createSpy('close') };
    const overlayManager = {
        has: jasmine.createSpy('has').and.returnValue(false),
        closeManagedOverlay: jasmine.createSpy('closeManagedOverlay'),
        createManagedOverlay: jasmine.createSpy('createManagedOverlay'),
    };
    const toast = jasmine.createSpyObj('ToastService', ['showToast']);
    const keyboardShortcuts = { register: jasmine.createSpy('register') };
    TestBed.configureTestingModule({
        imports: [EquipmentDialogComponent],
        providers: [
            { provide: DIALOG_DATA, useValue: data },
            { provide: DialogRef, useValue: dialogRef },
            { provide: OverlayManagerService, useValue: overlayManager },
            { provide: OptionsService, useValue: {
                options: () => ({ trackPhaseAndTurn: true }),
                cbtAutomationMode: () => 'yes',
            } },
            { provide: ToastService, useValue: toast },
            { provide: KeyboardShortcutService, useValue: keyboardShortcuts },
        ],
    });
    const fixture = TestBed.createComponent(EquipmentDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, dialogRef, keyboardShortcuts };
}

describe('EquipmentDialogComponent', () => {
    it('opens the original ammo panel directly from one retained Mek authority', () => {
        const { fixture, component } = createDialog({ member: createMember(), initialTab: 'ammo' });

        expect(component.activeTab()).toBe('ammo');
        expect(component.unitTitle()).toBe('Crab CRB-20');
        expect(fixture.nativeElement.querySelector('ammo-loadout-panel')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('weapons-equipment-panel')).toBeNull();
    });

    it('keeps the original weapons footer and dismiss action', () => {
        const { fixture, dialogRef } = createDialog({ member: createMember() });

        const footer = fixture.nativeElement.querySelector('.equipment-dialog-footer-center') as HTMLElement;
        expect(footer.textContent).toContain('DISMISS');
        (footer.querySelector('button:last-child') as HTMLButtonElement).click();
        expect(dialogRef.close).toHaveBeenCalledOnceWith();
    });

    it('shows shared Tank targeting and fire controls without exposing Mek turn tools', () => {
        const member = createTankMember();
        const { fixture, component } = createDialog({ member });
        const open = spyOn((component as any).targetsOverlay, 'open');

        const targetButton = fixture.nativeElement.querySelector('button[aria-label="Targets"]') as HTMLButtonElement;
        expect(targetButton).not.toBeNull();
        expect(fixture.nativeElement.querySelector('button[aria-label="Turn summary"]')).toBeNull();
        expect(fixture.nativeElement.querySelector('.fire-button')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('weapons-equipment-panel')).not.toBeNull();

        targetButton.click();
        expect(open).toHaveBeenCalledOnceWith(jasmine.objectContaining({ member }));
    });

    it('ports previous/next navigation over direct force members and updates page selection', () => {
        const [first, second] = createMembers([
            { id: 'unit:crab', chassis: 'Crab', model: 'CRB-20' },
            { id: 'unit:atlas', chassis: 'Atlas', model: 'AS7-D' },
        ]);
        const onMemberChange = jasmine.createSpy('onMemberChange');
        const { fixture, component } = createDialog({ member: first!, onMemberChange });

        expect(component.hasPrev()).toBeFalse();
        expect(component.hasNext()).toBeTrue();
        expect(fixture.nativeElement.querySelector('.footer-nav-right')).not.toBeNull();

        component.onNext();
        fixture.detectChanges();

        expect(component.unit()).toBe(second!);
        expect(component.runtime().member).toBe(second!);
        expect(component.unitTitle()).toBe('Atlas AS7-D');
        expect(onMemberChange).toHaveBeenCalledOnceWith(second!, 1);
        expect(component.hasPrev()).toBeTrue();
        expect(component.hasNext()).toBeFalse();
    });

    it('registers production left/right shortcuts for direct member navigation', () => {
        const [first, second] = createMembers([
            { id: 'unit:crab', chassis: 'Crab', model: 'CRB-20' },
            { id: 'unit:atlas', chassis: 'Atlas', model: 'AS7-D' },
        ]);
        const { component, keyboardShortcuts } = createDialog({ member: first! });
        const registration = keyboardShortcuts.register.calls.mostRecent().args[0];

        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBeTrue();
        expect(component.unit()).toBe(second!);
        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBeTrue();
        expect(component.unit()).toBe(first!);
        expect(registration.handle(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }))).toBeFalse();
    });

    it('exposes no legacy unit-list or command-context input', () => {
        const data: EquipmentDialogData = { member: createMember() };
        expect(Object.keys(data)).toEqual(['member']);
    });

    it('uses the shared direct-runtime phase and falling state for the title control', () => {
        const movementSelected = createTurnSnapshot({
            defenseModifierTotal: { modifier: 1 },
            movementState: {
                movement: {
                    schemaVersion: 1,
                    mode: 'walk',
                    distance: 1,
                    boosterComponentIds: [],
                },
                action: null,
                standAttempts: 0,
                carefulStand: false,
                checks: [],
                damageThisPhase: 0,
                automaticFalls: [{
                    triggerKind: 'leg-destroyed-auto-fall',
                    locationIds: ['location:left-leg' as never],
                }],
            },
        });
        const { component } = createDialog({ member: createMember(movementSelected) });

        expect(component.turnSummaryPhase()).toBe('W');
        expect(component.turnSummaryMovement()).toEqual({ color: 'walk', letter: 'W1' });
        expect(component.turnSummaryFalling()).toBeTrue();
        expect(component.turnSummaryDirty()).toBeTrue();
    });

    it('does not confuse a committed prone condition with the in-phase falling warning', () => {
        const { component } = createDialog({
            member: createMember(createTurnSnapshot({ conditions: ['prone'] })),
        });

        expect(component.turnSummaryPhase()).toBe('M');
        expect(component.turnSummaryFalling()).toBeFalse();
    });
});
