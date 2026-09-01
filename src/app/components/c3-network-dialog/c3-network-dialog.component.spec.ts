// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal, type Signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { Force } from '../../models/force.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { SerializedC3NetworkGroup } from '../../models/force-serialization';
import {
    C3Capabilities,
    C3_FLAGS,
    C3Network,
    C3NetworkType,
    C3Role,
    type C3Component,
    type C3Node,
    type C3UnitView,
} from '../../models/c3-network.model';
import { GameSystem } from '../../models/common.model';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { ToastService } from '../../services/toast.service';
import { C3NetworkDialogComponent } from './c3-network-dialog.component';

interface ConnectionLineTestApi {
    id: string;
    color: string;
    hasArrow: boolean;
    unavailable: boolean;
    degraded: boolean;
}

interface SidebarNetworkTestApi {
    members: readonly SidebarMemberTestApi[];
}

interface SidebarMemberTestApi {
    id: string;
    brokenLink: boolean;
    networkVm?: SidebarNetworkTestApi;
}

interface C3NetworkDialogTestApi {
    nodes: WritableSignal<C3Node[]>;
    networks: WritableSignal<SerializedC3NetworkGroup[]>;
    autoConfigureNetworks(): Promise<void>;
    isPinConnected(node: C3Node, compIndex: number): boolean;
    getPinNetworkColor(node: C3Node, compIndex: number): string | null;
    getPinRoleLabel(node: C3Node, compIndex: number): string;
    removeNetwork(network: SerializedC3NetworkGroup): void;
    saveAndClose(): void;
    connectionLines: Signal<ConnectionLineTestApi[]>;
    sidebarNetworks: Signal<readonly SidebarNetworkTestApi[]>;
    nodeRuntimeStatuses: Signal<Map<string, readonly ('OFFLINE' | 'JAMMED' | 'DEGRADED')[]>>;
    emergencySidebarNetworks: Signal<readonly {
        displayName: string;
        displayColor: string;
        canRemoveNetwork: boolean;
        showBv: boolean;
        networkTax?: number;
        members: readonly { id: string; canRemove: boolean }[];
    }[]>;
}

interface TestC3Unit extends C3UnitView {
    getSummary?(): UnitSummary;
    getBaseBv(): number;
    tagBV(): number;
    externalStoresBv(): number;
    gunnerySkill(): number;
    pilotingSkill(): number;
}

interface TestUnitState {
    unit: TestC3Unit;
    jammed: WritableSignal<boolean>;
    destroyedComponents: WritableSignal<ReadonlySet<number>>;
    actionUnavailableComponents: WritableSignal<ReadonlySet<number>>;
}

function c3Unit(id: string, flags: readonly string[]): TestUnitState {
    return c3UnitWithComponents(id, [flags]);
}

function c3UnitWithComponents(id: string, componentFlags: readonly (readonly string[])[]): TestUnitState {
    const jammed = signal(false);
    const destroyedComponents = signal<ReadonlySet<number>>(new Set());
    const actionUnavailableComponents = signal<ReadonlySet<number>>(new Set());
    const components = componentFlags.map((flags, index) => c3Component(flags, index));
    const unit: TestC3Unit = {
        id,
        alias: () => '',
        getSummary: () => ({ name: id, chassis: id, model: '' }) as UnitSummary,
        getC3Specials: () => [],
        getC3Presentation: () => ({ chassis: id, model: '', icon: '', tons: 0, walk: 0 }),
        c3Components: components,
        getBaseBv: () => 0,
        tagBV: () => 0,
        externalStoresBv: () => 0,
        gunnerySkill: () => 4,
        pilotingSkill: () => 5,
        isC3EndpointOperational: (index: number) => index < components.length
            && !destroyedComponents().has(index)
            && !actionUnavailableComponents().has(index),
        isC3Jammed: () => jammed(),
        c3Position: () => null,
    };
    return { unit, jammed, destroyedComponents, actionUnavailableComponents };
}

function c3Component(flags: readonly string[], index: number): C3Component {
    if (flags.includes(C3_FLAGS.C3M) || flags.includes(C3_FLAGS.C3MBS)) {
        return {
            networkType: C3NetworkType.C3,
            role: C3Role.MASTER,
            boosted: flags.includes(C3_FLAGS.C3MBS),
            index,
        };
    }
    if (flags.includes(C3_FLAGS.C3S)
        || flags.includes(C3_FLAGS.C3SBS)
        || flags.includes(C3_FLAGS.C3EM)) {
        return {
            networkType: C3NetworkType.C3,
            role: C3Role.SLAVE,
            boosted: flags.includes(C3_FLAGS.C3SBS),
            emergency: flags.includes(C3_FLAGS.C3EM),
            index,
        };
    }
    const flag = flags.find(candidate => candidate !== C3_FLAGS.ANY_C3);
    if (flag === C3_FLAGS.NOVA) {
        return { networkType: C3NetworkType.NOVA, role: C3Role.PEER, boosted: false, index };
    }
    if (flag === C3_FLAGS.NAVAL_C3) {
        return { networkType: C3NetworkType.NAVAL, role: C3Role.PEER, boosted: false, index };
    }
    return { networkType: C3NetworkType.C3I, role: C3Role.PEER, boosted: false, index };
}

function node(state: TestUnitState, x: number, y: number): C3Node {
    return {
        unit: state.unit,
        x,
        y,
        zIndex: 0,
        c3Components: [...new C3Capabilities(state.unit).components],
        pinOffsetsX: [0],
    };
}

describe('C3NetworkDialogComponent runtime visualization', () => {
    async function createComponent(
        units: readonly TestUnitState[] = [],
        readOnly = true,
    ): Promise<{
        component: C3NetworkDialogTestApi;
        fixture: ComponentFixture<C3NetworkDialogComponent>;
        requestConfirmation: jasmine.Spy;
        close: jasmine.Spy;
    }> {
        const requestConfirmation = jasmine.createSpy('requestConfirmation').and.resolveTo(false);
        const close = jasmine.createSpy('close');
        const members = signal(units.map(state => state.unit));
        const force = {
            gameSystem: GameSystem.CBT,
            units: members,
            members,
            c3Networks: signal([]),
            groups: signal([]),
            changed: new Subject<void>(),
        } as unknown as Force;

        await TestBed.configureTestingModule({
            imports: [C3NetworkDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: { close } },
                { provide: DIALOG_DATA, useValue: { force, readOnly } },
                { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
                { provide: DialogsService, useValue: { requestConfirmation } },
                {
                    provide: OptionsService,
                    useValue: { options: signal({ c3NetworkConnectionsAboveNodes: false }) },
                },
                { provide: LayoutService, useValue: { isMobile: signal(false) } },
                { provide: SpriteStorageService, useValue: {} },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(C3NetworkDialogComponent);
        return {
            component: fixture.componentInstance as unknown as C3NetworkDialogTestApi,
            fixture,
            requestConfirmation,
            close,
        };
    }

    it('returns detached positions for the owner commit', async () => {
        const first = c3Unit('first', [C3_FLAGS.C3I]);
        const second = c3Unit('second', [C3_FLAGS.C3I]);
        const { component, close } = await createComponent([first, second], false);
        component.nodes.set([node(first, 10, 20), node(second, 30, 40)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.C3I, color: '#abc', peerIds: ['first', 'second'],
        }]);

        component.saveAndClose();

        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            positions: [
                { unitId: 'first', x: 10, y: 20 },
                { unitId: 'second', x: 30, y: 40 },
            ],
        }));
    });

    it('does not auto-connect an unused internal Master endpoint', async () => {
        const naginata = c3UnitWithComponents('naginata', [[C3_FLAGS.C3M], [C3_FLAGS.C3M]]);
        const avatar = c3Unit('avatar', [C3_FLAGS.C3M]);
        const slaves = [1, 2, 3].map(index => c3Unit(`slave-${index}`, [C3_FLAGS.C3S]));
        const units = [naginata, avatar, ...slaves];
        const { component, requestConfirmation } = await createComponent(units, false);
        component.nodes.set(units.map((state, index) => node(state, index * 200, 0)));

        await component.autoConfigureNetworks();

        const model = new C3Network(component.networks());
        expect(model.masterNetwork('avatar', 0)?.members).toEqual(['slave-1', 'slave-2', 'slave-3']);
        const naginataGrandMaster = model.masterNetwork('naginata', 0)
            ?? model.masterNetwork('naginata', 1);
        expect(naginataGrandMaster?.members).toEqual(['avatar:0']);
        const unusedIndex = naginataGrandMaster?.masterCompIndex === 0 ? 1 : 0;
        expect(model.masterNetwork('naginata', unusedIndex)).toBeUndefined();
        expect(model.parentNetworkForEndpoint('naginata', unusedIndex)).toBeUndefined();
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('removes an existing empty internal Master branch during auto-configuration', async () => {
        const naginata = c3UnitWithComponents('naginata', [[C3_FLAGS.C3M], [C3_FLAGS.C3M]]);
        const avatar = c3Unit('avatar', [C3_FLAGS.C3M]);
        const slaves = [1, 2, 3].map(index => c3Unit(`slave-${index}`, [C3_FLAGS.C3S]));
        const units = [naginata, avatar, ...slaves];
        const { component } = await createComponent(units, false);
        component.nodes.set(units.map((state, index) => node(state, index * 200, 0)));
        component.networks.set([
            {
                id: 'grand-master', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'naginata', masterCompIndex: 0, members: ['avatar:0', 'naginata:1'],
            },
            {
                id: 'avatar-branch', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'avatar', masterCompIndex: 0, members: ['slave-1', 'slave-2', 'slave-3'],
            },
        ]);

        await component.autoConfigureNetworks();

        const model = new C3Network(component.networks());
        expect(model.masterNetwork('naginata', 0)?.members).toEqual(['avatar:0']);
        expect(model.masterNetwork('naginata', 1)).toBeUndefined();
        expect(model.parentNetworkForEndpoint('naginata', 1)).toBeUndefined();
        expect(model.masterNetwork('avatar', 0)?.members).toEqual(['slave-1', 'slave-2', 'slave-3']);
    });

    it('preserves and renders an external terminal Master during auto-configuration', async () => {
        const root = c3Unit('root', [C3_FLAGS.C3M]);
        const middle = c3Unit('middle', [C3_FLAGS.C3M]);
        const terminal = c3Unit('terminal', [C3_FLAGS.C3M]);
        const units = [root, middle, terminal];
        const { component } = await createComponent(units, false);
        const nodes = units.map((state, index) => node(state, index * 200, 0));
        component.nodes.set(nodes);
        component.networks.set([
            {
                id: 'root-network', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'root', masterCompIndex: 0, members: ['middle:0'],
            },
            {
                id: 'middle-network', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'middle', masterCompIndex: 0, members: ['terminal:0'],
            },
        ]);

        await component.autoConfigureNetworks();

        expect(new C3Network(component.networks()).masterNetwork('middle', 0)?.members).toContain('terminal:0');
        expect(component.isPinConnected(nodes[2], 0)).toBeTrue();
        expect(component.getPinNetworkColor(nodes[2], 0)).toBe('#7B1FA2');
        expect(component.getPinRoleLabel(nodes[2], 0)).toBe('M');
    });

    it('removes a selected standard C3 network and all descendant tiers', async () => {
        const { component } = await createComponent([], false);
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'root', type: C3NetworkType.C3, color: '#1',
                masterId: 'root-master', masterCompIndex: 0, members: ['branch-master:0'],
            },
            {
                id: 'branch', type: C3NetworkType.C3, color: '#2',
                masterId: 'branch-master', masterCompIndex: 0, members: ['slave'],
            },
            { id: 'peer', type: C3NetworkType.C3I, color: '#3', peerIds: ['peer-a', 'peer-b'] },
        ];
        component.networks.set(networks);

        component.removeNetwork(networks[0]);

        expect(component.networks()).toEqual([networks[2]]);
    });

    it('preserves an internal Master branch that has children during auto-configuration', async () => {
        const naginata = c3UnitWithComponents('naginata', [[C3_FLAGS.C3M], [C3_FLAGS.C3M]]);
        const slave = c3Unit('slave', [C3_FLAGS.C3S]);
        const units = [naginata, slave];
        const { component } = await createComponent(units, false);
        component.nodes.set(units.map((state, index) => node(state, index * 200, 0)));
        component.networks.set([
            {
                id: 'grand-master', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'naginata', masterCompIndex: 0, members: ['naginata:1'],
            },
            {
                id: 'internal-branch', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'naginata', masterCompIndex: 1, members: ['slave'],
            },
        ]);

        await component.autoConfigureNetworks();

        const model = new C3Network(component.networks());
        expect(model.masterNetwork('naginata', 0)?.members).toEqual(['naginata:1']);
        expect(model.masterNetwork('naginata', 1)?.members).toEqual(['slave']);
        expect(model.parentNetworkForEndpoint('naginata', 1)?.masterCompIndex).toBe(0);
    });

    it('auto-configures all C3 units below the twelve-unit limit', async () => {
        const command = c3UnitWithComponents('command', [
            [C3_FLAGS.C3M], [C3_FLAGS.C3M], [C3_FLAGS.C3M], [C3_FLAGS.C3M],
        ]);
        const slaves = Array.from({ length: 9 }, (_, index) => c3Unit(`slave-${index}`, [C3_FLAGS.C3S]));
        const units = [command, ...slaves];
        const { component } = await createComponent(units, false);
        component.nodes.set(units.map((state, index) => node(state, index * 200, 0)));
        component.networks.set([
            {
                id: 'root', type: C3NetworkType.C3, color: '#1565C0',
                masterId: 'command', masterCompIndex: 0,
                members: ['command:1', 'command:2', 'command:3'],
            },
            {
                id: 'branch-1', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'command', masterCompIndex: 1,
                members: ['slave-0', 'slave-1', 'slave-2'],
            },
            {
                id: 'branch-2', type: C3NetworkType.C3, color: '#00897B',
                masterId: 'command', masterCompIndex: 2,
                members: ['slave-3', 'slave-4', 'slave-5'],
            },
            {
                id: 'branch-3', type: C3NetworkType.C3, color: '#E65100',
                masterId: 'command', masterCompIndex: 3,
                members: ['slave-6', 'slave-7'],
            },
        ]);

        await component.autoConfigureNetworks();

        const model = new C3Network(component.networks());
        const root = model.topLevelNetworks.find(network => network.type === C3NetworkType.C3);
        expect(root).toBeDefined();
        expect(model.treeUnitIds(root!.id).size).toBe(10);
        expect(model.treeEndpointKeys(root!.id).size).toBe(13);
        const connectedSlaves = slaves.filter(slave => model.isUnitSlaveConnected(slave.unit.id));
        expect(connectedSlaves.length).toBe(9);
        expect(slaves.filter(slave => !model.isUnitConnected(slave.unit.id)).length).toBe(0);
    });

    it('keeps configured arrows and adds the effective C3EM takeover arrow', async () => {
        const { component } = await createComponent();
        const master = c3Unit('master', [C3_FLAGS.C3M]);
        const emergencyMaster = c3Unit('emergency', [C3_FLAGS.C3S, C3_FLAGS.C3EM]);
        const leaf = c3Unit('leaf', [C3_FLAGS.C3S]);
        master.jammed.set(true);
        component.nodes.set([node(master, 0, 0), node(emergencyMaster, 200, 0), node(leaf, 400, 0)]);
        component.networks.set([{
            id: 'network',
            type: C3NetworkType.C3,
            color: '#7B1FA2',
            masterId: 'master',
            masterCompIndex: 0,
            members: ['emergency', 'leaf'],
        }]);

        const lines = component.connectionLines();
        const configured = lines.filter(line => line.id.includes('-configured-'));
        const emergency = lines.filter(line => line.id.includes('-emergency-'));

        expect(configured.length).toBe(2);
        expect(configured.every(line => line.hasArrow && line.unavailable)).toBeTrue();
        expect(emergency.length).toBe(1);
        expect(emergency[0]).toEqual(jasmine.objectContaining({
            color: '#7B1FA2',
            hasArrow: true,
            unavailable: false,
            degraded: false,
        }));
        const emergencyVm = component.emergencySidebarNetworks()[0];
        expect(component.emergencySidebarNetworks().length).toBe(1);
        expect(emergencyVm.displayName).toBe('EMERGENCY');
        expect(emergencyVm.displayColor).toBe('#7B1FA2');
        expect(emergencyVm.canRemoveNetwork).toBeFalse();
        expect(emergencyVm.showBv).toBeFalse();
        expect(emergencyVm.networkTax).toBeUndefined();
        expect(emergencyVm.members.map(member => member.id)).toEqual(['emergency', 'leaf']);
        expect(emergencyVm.members.every(member => !member.canRemove)).toBeTrue();
    });

    it('marks only effectively disconnected sidebar entries when the grand master shuts down', async () => {
        const { component } = await createComponent();
        const grandMaster = c3Unit('grand-master', [C3_FLAGS.C3M]);
        const subordinateMaster = c3Unit('subordinate-master', [C3_FLAGS.C3M]);
        const directLeaf = c3Unit('direct-leaf', [C3_FLAGS.C3S]);
        const childLeaf = c3Unit('child-leaf', [C3_FLAGS.C3S]);
        grandMaster.actionUnavailableComponents.set(new Set([0]));

        component.nodes.set([
            node(grandMaster, 0, 0),
            node(subordinateMaster, 200, 0),
            node(directLeaf, 400, 0),
            node(childLeaf, 600, 0),
        ]);
        component.networks.set([
            {
                id: 'parent', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'grand-master', masterCompIndex: 0,
                members: ['subordinate-master:0', 'direct-leaf'],
            },
            {
                id: 'child', type: C3NetworkType.C3, color: '#E65100',
                masterId: 'subordinate-master', masterCompIndex: 0,
                members: ['child-leaf'],
            },
        ]);

        const root = component.sidebarNetworks()[0]!;
        expect(root.members.find(member => member.id === 'grand-master')?.brokenLink).toBeTrue();
        expect(root.members.find(member => member.id === 'direct-leaf')?.brokenLink).toBeTrue();

        const subordinate = root.members.find(member => member.id === 'subordinate-master');
        expect(subordinate?.brokenLink).toBeFalse();
        expect(subordinate?.networkVm?.members.every(member => !member.brokenLink)).toBeTrue();
    });

    it('marks a jammed master and only its direct slave leaf as degraded', async () => {
        const { component } = await createComponent();
        const grandMaster = c3Unit('grand-master', [C3_FLAGS.C3M]);
        const subordinateMaster = c3Unit('subordinate-master', [C3_FLAGS.C3M]);
        const leafMaster = c3Unit('leaf-master', [C3_FLAGS.C3M]);
        const directLeaf = c3Unit('direct-leaf', [C3_FLAGS.C3S]);
        const childLeaf = c3Unit('child-leaf', [C3_FLAGS.C3S]);
        grandMaster.jammed.set(true);
        component.nodes.set([
            node(grandMaster, 0, 0),
            node(subordinateMaster, 200, 0),
            node(leafMaster, 300, 0),
            node(directLeaf, 400, 0),
            node(childLeaf, 600, 0),
        ]);
        component.networks.set([
            {
                id: 'parent', type: C3NetworkType.C3, color: '#7B1FA2',
                masterId: 'grand-master', masterCompIndex: 0,
                members: ['subordinate-master:0', 'leaf-master:0', 'direct-leaf'],
            },
            {
                id: 'child', type: C3NetworkType.C3, color: '#E65100',
                masterId: 'subordinate-master', masterCompIndex: 0,
                members: ['child-leaf'],
            },
        ]);

        const statuses = component.nodeRuntimeStatuses();
        const lines = component.connectionLines();

        expect(statuses.get('grand-master')).toEqual(['JAMMED']);
        expect(statuses.get('leaf-master')).toEqual(['DEGRADED']);
        expect(statuses.get('direct-leaf')).toEqual(['DEGRADED']);
        expect(statuses.has('subordinate-master')).toBeFalse();
        expect(statuses.has('child-leaf')).toBeFalse();
        expect(lines.find(line => line.id === 'parent-configured-direct-leaf')?.degraded).toBeTrue();
        expect(lines.find(line => line.id === 'parent-configured-subordinate-master:0')?.degraded).toBeTrue();
        expect(lines.find(line => line.id === 'parent-configured-leaf-master:0')?.degraded).toBeTrue();
        expect(lines.find(line => line.id === 'child-configured-child-leaf')?.degraded).toBeFalse();

        childLeaf.jammed.set(true);

        expect(component.nodeRuntimeStatuses().get('subordinate-master')).toEqual(['DEGRADED']);
        expect(component.connectionLines().find(line => line.id === 'child-configured-child-leaf')?.degraded).toBeTrue();
    });

    it('shows OFFLINE when the configured C3 component is destroyed or action-unavailable', async () => {
        const { component } = await createComponent();
        const master = c3UnitWithComponents('master', [[C3_FLAGS.C3M], [C3_FLAGS.C3M]]);
        const leaf = c3Unit('leaf', [C3_FLAGS.C3S]);
        component.nodes.set([node(master, 0, 0), node(leaf, 200, 0)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.C3, color: '#7B1FA2',
            masterId: 'master', masterCompIndex: 1, members: ['leaf'],
        }]);

        master.destroyedComponents.set(new Set([0]));
        expect(component.nodeRuntimeStatuses().has('master')).toBeFalse();

        master.destroyedComponents.set(new Set([1]));
        expect(component.nodeRuntimeStatuses().get('master')).toEqual(['OFFLINE']);

        master.destroyedComponents.set(new Set());
        master.actionUnavailableComponents.set(new Set([1]));
        expect(component.nodeRuntimeStatuses().get('master')).toEqual(['OFFLINE']);
    });

    it('uses endpoint operation for OFFLINE', async () => {
        const { component } = await createComponent();
        const master = c3Unit('master', [C3_FLAGS.NOVA]);
        master.actionUnavailableComponents.set(new Set([0]));
        component.nodes.set([node(master, 0, 0)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.NOVA, color: '#7B1FA2',
            peerIds: ['master'],
        }]);

        expect(component.nodeRuntimeStatuses().get('master')).toEqual(['OFFLINE']);
    });

    it('does not show OFFLINE for a local endpoint when only its remote endpoint is unavailable', async () => {
        const { component } = await createComponent();
        const master = c3Unit('master', [C3_FLAGS.C3M]);
        const leaf = c3Unit('leaf', [C3_FLAGS.C3S]);
        leaf.actionUnavailableComponents.set(new Set([0]));
        component.nodes.set([node(master, 0, 0), node(leaf, 200, 0)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.C3, color: '#7B1FA2',
            masterId: 'master', masterCompIndex: 0, members: ['leaf'],
        }]);

        expect(component.nodeRuntimeStatuses().has('master')).toBeFalse();
        expect(component.nodeRuntimeStatuses().get('leaf')).toEqual(['OFFLINE']);
    });

    it('prioritizes OFFLINE over JAMMED and DEGRADED', async () => {
        const { component } = await createComponent();
        const master = c3Unit('master', [C3_FLAGS.C3M]);
        master.jammed.set(true);
        master.actionUnavailableComponents.set(new Set([0]));
        component.nodes.set([node(master, 0, 0)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.C3, color: '#7B1FA2',
            masterId: 'master', masterCompIndex: 0, members: [],
        }]);

        expect(component.nodeRuntimeStatuses().get('master')).toEqual(['OFFLINE']);
    });

    it('renders runtime statuses as native square SVG badges', async () => {
        const { component, fixture } = await createComponent();
        fixture.detectChanges();
        const master = c3Unit('master', [C3_FLAGS.C3M]);
        master.jammed.set(true);
        component.nodes.set([node(master, 0, 0)]);
        component.networks.set([{
            id: 'network',
            type: C3NetworkType.C3,
            color: '#7B1FA2',
            masterId: 'master',
            masterCompIndex: 0,
            members: [],
        }]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const status = host.querySelector('.node-runtime-status');
        const rect = status?.querySelector('rect');
        expect(status?.querySelector('text')?.textContent?.trim()).toBe('JAMMED');
        expect(rect).not.toBeNull();
        expect(rect?.hasAttribute('rx')).toBeFalse();
        expect(rect?.hasAttribute('ry')).toBeFalse();
        expect(host.querySelector('.node-runtime-status-container foreignObject')).toBeNull();
    });

    it('renders OFFLINE as the only native runtime badge', async () => {
        const { component, fixture } = await createComponent();
        fixture.detectChanges();
        const master = c3Unit('master', [C3_FLAGS.C3M]);
        master.jammed.set(true);
        master.actionUnavailableComponents.set(new Set([0]));
        component.nodes.set([node(master, 0, 0)]);
        component.networks.set([{
            id: 'network', type: C3NetworkType.C3, color: '#7B1FA2',
            masterId: 'master', masterCompIndex: 0, members: [],
        }]);

        fixture.detectChanges();

        const badges = fixture.nativeElement.querySelectorAll('.node-runtime-status') as NodeListOf<SVGGElement>;
        expect(badges.length).toBe(1);
        expect(badges[0].classList.contains('offline')).toBeTrue();
        expect(badges[0].querySelector('text')?.textContent?.trim()).toBe('OFFLINE');
    });
});
