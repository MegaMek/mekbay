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
 */

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    signal,
    viewChild,
    AfterViewInit
} from '@angular/core';
import { NgClass, NgStyle, NgTemplateOutlet } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceUnit } from '../../models/force-unit.model';
import { C3NetworkUtil } from '../../utils/c3-network.util';
import {
    C3Component,
    C3NetworkType,
    C3Role,
    C3_NETWORK_COLORS,
    C3_NETWORK_LIMITS
} from '../../models/c3-network.model';
import { SerializedC3NetworkGroup } from '../../models/force-serialization';
import { ToastService } from '../../services/toast.service';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';

export interface C3NetworkDialogData {
    units: ForceUnit[];
    networks: SerializedC3NetworkGroup[];
    readOnly?: boolean;
}

export interface C3NetworkDialogResult {
    networks: SerializedC3NetworkGroup[];
    updated: boolean;
}

interface C3Node {
    unit: ForceUnit;
    c3Components: C3Component[];
    x: number;
    y: number;
}

interface ConnectionLine {
    id: string;
    x1: number; y1: number;
    x2: number; y2: number;
    color: string;
    hasArrow: boolean;
    arrowAngle: number;
}

interface HubPoint {
    id: string;
    x: number; y: number;
    color: string;
}

@Component({
    selector: 'c3-network-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgClass, NgStyle, NgTemplateOutlet, UnitIconComponent],
    host: { class: 'fullscreen-dialog-host' },
    templateUrl: './c3-network-dialog.component.html',
    styleUrls: ['./c3-network-dialog.component.scss']
})
export class C3NetworkDialogComponent implements AfterViewInit {
    private dialogRef = inject(DialogRef<C3NetworkDialogResult>);
    protected data = inject<C3NetworkDialogData>(DIALOG_DATA);
    private toastService = inject(ToastService);
    private container = viewChild<ElementRef<HTMLDivElement>>('container');

    // State
    protected nodes = signal<C3Node[]>([]);
    protected networks = signal<SerializedC3NetworkGroup[]>([]);
    protected hasModifications = signal(false);

    // Drag state
    protected draggedNode = signal<C3Node | null>(null);
    protected dragOffset = signal({ x: 0, y: 0 });

    // Connection drawing state
    protected connectingFrom = signal<{ node: C3Node; compIndex: number; role: C3Role } | null>(null);
    protected connectingEnd = signal({ x: 0, y: 0 });
    protected hoveredNode = signal<C3Node | null>(null);
    protected hoveredPinIndex = signal<number | null>(null);

    // Pan/zoom state
    protected isPanning = signal(false);
    protected panStart = signal({ x: 0, y: 0 });
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);

    // Color tracking
    private nextColorIndex = 0;
    private masterPinColors = new Map<string, string>();

    // Valid targets for connection
    protected validTargets = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return new Set<string>();
        
        const validIds = new Set<string>();
        const sourceComp = conn.node.c3Components[conn.compIndex];
        
        for (const node of this.nodes()) {
            if (this.canConnect(conn.node, conn.compIndex, node)) {
                validIds.add(node.unit.id);
            }
        }
        return validIds;
    });

    // Connection lines
    protected connectionLines = computed<ConnectionLine[]>(() => {
        const lines: ConnectionLine[] = [];
        const nodes = this.nodes();
        const networks = this.networks();
        const offset = this.viewOffset();
        const scale = this.zoom();

        for (const network of networks) {
            if (network.peerIds && network.peerIds.length > 1) {
                // Peer network - lines from hub to each peer
                const peerNodes = network.peerIds
                    .map(id => nodes.find(n => n.unit.id === id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        const pinOff = this.getPinOffset(node, Math.max(0, compIdx));
                        return {
                            x: offset.x + (node.x + pinOff.x) * scale,
                            y: offset.y + (node.y + pinOff.y) * scale
                        };
                    });
                    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
                    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;

                    positions.forEach((p, idx) => {
                        lines.push({
                            id: `${network.id}-peer-${idx}`,
                            x1: cx, y1: cy, x2: p.x, y2: p.y,
                            color: network.color,
                            hasArrow: false, arrowAngle: 0
                        });
                    });
                }
            } else if (network.masterId) {
                // Master network - draw lines to members
                const masterNode = nodes.find(n => n.unit.id === network.masterId);
                if (!masterNode) continue;

                const compIdx = network.masterCompIndex ?? 0;
                const masterPin = this.getPinOffset(masterNode, compIdx);
                const mx = offset.x + (masterNode.x + masterPin.x) * scale;
                const my = offset.y + (masterNode.y + masterPin.y) * scale;

                for (const member of network.members || []) {
                    const parsed = C3NetworkUtil.parseMember(member);
                    const memberNode = nodes.find(n => n.unit.id === parsed.unitId);
                    if (!memberNode) continue;

                    // Find the appropriate pin on the member
                    let memberCompIdx = 0;
                    if (parsed.compIndex !== undefined) {
                        memberCompIdx = parsed.compIndex;
                    } else {
                        // Find slave pin
                        memberCompIdx = memberNode.c3Components.findIndex(c => 
                            c.role === C3Role.SLAVE || c.role === C3Role.MASTER
                        );
                        if (memberCompIdx < 0) memberCompIdx = 0;
                    }

                    const memberPin = this.getPinOffset(memberNode, memberCompIdx);
                    const sx = offset.x + (memberNode.x + memberPin.x) * scale;
                    const sy = offset.y + (memberNode.y + memberPin.y) * scale;
                    const angle = Math.atan2(sy - my, sx - mx);

                    lines.push({
                        id: `${network.id}-member-${member}`,
                        x1: mx, y1: my, x2: sx, y2: sy,
                        color: network.color,
                        hasArrow: true, arrowAngle: angle
                    });
                }
            }
        }
        return lines;
    });

    // Hub points for peer networks
    protected hubPoints = computed<HubPoint[]>(() => {
        const hubs: HubPoint[] = [];
        const nodes = this.nodes();
        const offset = this.viewOffset();
        const scale = this.zoom();

        for (const network of this.networks()) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds
                    .map(id => nodes.find(n => n.unit.id === id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        const pinOff = this.getPinOffset(node, Math.max(0, compIdx));
                        return {
                            x: offset.x + (node.x + pinOff.x) * scale,
                            y: offset.y + (node.y + pinOff.y) * scale
                        };
                    });
                    hubs.push({
                        id: `hub-${network.id}`,
                        x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
                        y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
                        color: network.color
                    });
                }
            }
        }
        return hubs;
    });

    // Active drag line
    protected activeDragLine = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return null;
        const offset = this.viewOffset();
        const scale = this.zoom();
        const pinOff = this.getPinOffset(conn.node, conn.compIndex);
        return {
            x1: offset.x + (conn.node.x + pinOff.x) * scale,
            y1: offset.y + (conn.node.y + pinOff.y) * scale,
            x2: this.connectingEnd().x,
            y2: this.connectingEnd().y
        };
    });

    ngAfterViewInit() {
        this.initializeNodes();
        this.networks.set([...(this.data.networks || [])]);
        this.initializeMasterPinColors();
    }

    private initializeNodes() {
        const c3Units = this.data.units.filter(u => C3NetworkUtil.hasC3(u.getUnit()));
        const el = this.container()?.nativeElement;
        const w = el?.clientWidth || 800;
        const h = el?.clientHeight || 600;
        const spacing = 180;
        const cols = Math.max(1, Math.floor((w - 100) / spacing));
        const rows = Math.ceil(c3Units.length / cols);
        const gridW = (cols - 1) * spacing;
        const gridH = (rows - 1) * spacing;
        const startX = (w - gridW) / 2;
        const startY = Math.max(100, (h - gridH) / 2);

        this.nodes.set(c3Units.map((unit, idx) => {
            const pos = unit.c3Position();
            return {
                unit,
                c3Components: C3NetworkUtil.getC3Components(unit.getUnit()),
                x: pos?.x ?? startX + (idx % cols) * spacing,
                y: pos?.y ?? startY + Math.floor(idx / cols) * spacing
            };
        }));
    }

    private initializeMasterPinColors() {
        // Assign colors from existing networks
        for (const net of this.networks()) {
            if (net.masterId && net.masterCompIndex !== undefined) {
                this.masterPinColors.set(`${net.masterId}:${net.masterCompIndex}`, net.color);
            }
        }
        this.nextColorIndex = this.networks().length;

        // Assign colors to unassigned master pins
        for (const node of this.nodes()) {
            node.c3Components.forEach((comp, idx) => {
                if (comp.role === C3Role.MASTER) {
                    const key = `${node.unit.id}:${idx}`;
                    if (!this.masterPinColors.has(key)) {
                        this.masterPinColors.set(key, this.getNextColor());
                    }
                }
            });
        }
    }

    private getNextColor(): string {
        return C3_NETWORK_COLORS[this.nextColorIndex++ % C3_NETWORK_COLORS.length];
    }

    private generateNetworkId(): string {
        return `net_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getPinOffset(node: C3Node, compIndex: number): { x: number; y: number } {
        const numPins = node.c3Components.length;
        if (numPins === 0) return { x: 0, y: 20 };
        const spacing = 38;
        const totalW = (numPins - 1) * spacing;
        return { x: -totalW / 2 + compIndex * spacing, y: 18 };
    }

    // ==================== Connection Logic ====================

    private canConnect(sourceNode: C3Node, sourceCompIdx: number, targetNode: C3Node): boolean {
        const sourceComp = sourceNode.c3Components[sourceCompIdx];
        if (!sourceComp) return false;

        // Find compatible target pins
        for (let i = 0; i < targetNode.c3Components.length; i++) {
            const targetComp = targetNode.c3Components[i];
            if (!C3NetworkUtil.areComponentsCompatible(sourceComp, targetComp)) continue;

            // Same unit, same pin - not allowed
            if (sourceNode.unit.id === targetNode.unit.id && sourceCompIdx === i) continue;

            // Check based on roles
            if (sourceComp.role === C3Role.PEER && targetComp.role === C3Role.PEER) {
                return true; // Peers can always connect to peers
            }
            if (sourceComp.role === C3Role.MASTER) {
                if (targetComp.role === C3Role.SLAVE) {
                    const result = C3NetworkUtil.canSlaveConnectToMaster(
                        sourceNode.unit.id, sourceCompIdx, targetNode.unit.id, this.networks()
                    );
                    if (result.valid) return true;
                }
                if (targetComp.role === C3Role.MASTER) {
                    const result = C3NetworkUtil.canMasterConnectToMaster(
                        sourceNode.unit.id, sourceCompIdx, targetNode.unit.id, i, this.networks()
                    );
                    if (result.valid) return true;
                }
            }
            if (sourceComp.role === C3Role.SLAVE && targetComp.role === C3Role.MASTER) {
                const result = C3NetworkUtil.canSlaveConnectToMaster(
                    targetNode.unit.id, i, sourceNode.unit.id, this.networks()
                );
                if (result.valid) return true;
            }
        }
        return false;
    }

    protected getValidPinsForTarget(targetNode: C3Node): number[] {
        const conn = this.connectingFrom();
        if (!conn) return [];
        const sourceComp = conn.node.c3Components[conn.compIndex];
        if (!sourceComp) return [];

        const validPins: number[] = [];
        for (let i = 0; i < targetNode.c3Components.length; i++) {
            const targetComp = targetNode.c3Components[i];
            if (!C3NetworkUtil.areComponentsCompatible(sourceComp, targetComp)) continue;
            if (conn.node.unit.id === targetNode.unit.id && conn.compIndex === i) continue;

            if (sourceComp.role === C3Role.PEER && targetComp.role === C3Role.PEER) {
                validPins.push(i);
            } else if (sourceComp.role === C3Role.MASTER) {
                if (targetComp.role === C3Role.SLAVE || targetComp.role === C3Role.MASTER) {
                    validPins.push(i);
                }
            } else if (sourceComp.role === C3Role.SLAVE && targetComp.role === C3Role.MASTER) {
                validPins.push(i);
            }
        }
        return validPins;
    }

    protected isPinValidTarget(node: C3Node, compIndex: number): boolean {
        return this.getValidPinsForTarget(node).includes(compIndex);
    }

    // ==================== Event Handlers ====================

    protected onPinPointerDown(event: PointerEvent, node: C3Node, compIndex: number) {
        event.preventDefault();
        event.stopPropagation();
        const comp = node.c3Components[compIndex];
        if (!comp) return;

        this.connectingFrom.set({ node, compIndex, role: comp.role });
        const el = this.container()?.nativeElement;
        if (el) {
            const rect = el.getBoundingClientRect();
            this.connectingEnd.set({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    protected onNodePointerDown(event: PointerEvent, node: C3Node) {
        event.preventDefault();
        event.stopPropagation();
        if ((event.target as HTMLElement).closest('.pin')) return;

        const scale = this.zoom();
        const offset = this.viewOffset();
        this.dragOffset.set({
            x: event.clientX - (offset.x + node.x * scale),
            y: event.clientY - (offset.y + node.y * scale)
        });
        this.draggedNode.set(node);
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    protected onContainerPointerDown(event: PointerEvent) {
        if ((event.target as HTMLElement).closest('.node')) return;
        this.isPanning.set(true);
        this.panStart.set({ x: event.clientX, y: event.clientY });
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    private onGlobalPointerMove = (event: PointerEvent) => {
        if (this.draggedNode()) {
            const node = this.draggedNode()!;
            const offset = this.viewOffset();
            const scale = this.zoom();
            const drag = this.dragOffset();
            node.x = (event.clientX - drag.x - offset.x) / scale;
            node.y = (event.clientY - drag.y - offset.y) / scale;
            this.nodes.set([...this.nodes()]);
            this.hasModifications.set(true);
        } else if (this.connectingFrom()) {
            const el = this.container()?.nativeElement;
            if (el) {
                const rect = el.getBoundingClientRect();
                this.connectingEnd.set({ x: event.clientX - rect.left, y: event.clientY - rect.top });
            }
            // Update hover state
            const target = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = target?.closest('.node');
            const pinEl = target?.closest('.pin');
            if (nodeEl) {
                const unitId = nodeEl.getAttribute('data-unit-id');
                const targetNode = this.nodes().find(n => n.unit.id === unitId);
                if (targetNode && this.validTargets().has(targetNode.unit.id)) {
                    this.hoveredNode.set(targetNode);
                    if (pinEl) {
                        const idx = parseInt(pinEl.getAttribute('data-comp-index') || '-1', 10);
                        this.hoveredPinIndex.set(this.isPinValidTarget(targetNode, idx) ? idx : null);
                    } else {
                        this.hoveredPinIndex.set(null);
                    }
                } else {
                    this.hoveredNode.set(null);
                    this.hoveredPinIndex.set(null);
                }
            } else {
                this.hoveredNode.set(null);
                this.hoveredPinIndex.set(null);
            }
        } else if (this.isPanning()) {
            const start = this.panStart();
            const current = this.viewOffset();
            this.viewOffset.set({
                x: current.x + event.clientX - start.x,
                y: current.y + event.clientY - start.y
            });
            this.panStart.set({ x: event.clientX, y: event.clientY });
        }
    };

    private onGlobalPointerUp = (event: PointerEvent) => {
        if (this.connectingFrom()) {
            const target = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = target?.closest('.node');
            const pinEl = target?.closest('.pin');
            if (nodeEl) {
                const unitId = nodeEl.getAttribute('data-unit-id');
                const targetNode = this.nodes().find(n => n.unit.id === unitId);
                const conn = this.connectingFrom()!;
                if (targetNode && this.validTargets().has(targetNode.unit.id)) {
                    let targetPin = pinEl ? parseInt(pinEl.getAttribute('data-comp-index') || '-1', 10) : -1;
                    if (targetPin < 0 || !this.isPinValidTarget(targetNode, targetPin)) {
                        const validPins = this.getValidPinsForTarget(targetNode);
                        targetPin = validPins.length > 0 ? validPins[0] : -1;
                    }
                    if (targetPin >= 0) {
                        this.createConnection(conn, targetNode, targetPin);
                    }
                }
            }
            this.connectingFrom.set(null);
            this.hoveredNode.set(null);
            this.hoveredPinIndex.set(null);
        }
        this.draggedNode.set(null);
        this.isPanning.set(false);
        document.removeEventListener('pointermove', this.onGlobalPointerMove);
        document.removeEventListener('pointerup', this.onGlobalPointerUp);
    };

    protected onWheel(event: WheelEvent) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        this.zoom.set(Math.max(0.3, Math.min(3, this.zoom() * delta)));
    }

    // ==================== Network Management ====================

    private createConnection(
        from: { node: C3Node; compIndex: number; role: C3Role },
        targetNode: C3Node,
        targetPinIndex: number
    ) {
        if (this.data.readOnly) return;

        const sourceComp = from.node.c3Components[from.compIndex];
        const targetComp = targetNode.c3Components[targetPinIndex];
        if (!sourceComp || !targetComp) return;

        if (sourceComp.role === C3Role.PEER) {
            this.createPeerConnection(from.node, targetNode, sourceComp.networkType);
        } else if (sourceComp.role === C3Role.MASTER) {
            if (targetComp.role === C3Role.SLAVE) {
                this.addMemberToMaster(from.node, from.compIndex, targetNode.unit.id);
            } else if (targetComp.role === C3Role.MASTER) {
                this.addMemberToMaster(from.node, from.compIndex, targetNode.unit.id, targetPinIndex);
            }
        } else if (sourceComp.role === C3Role.SLAVE && targetComp.role === C3Role.MASTER) {
            this.addMemberToMaster(targetNode, targetPinIndex, from.node.unit.id);
        }
    }

    private createPeerConnection(node1: C3Node, node2: C3Node, networkType: C3NetworkType) {
        const networks = [...this.networks()];
        const net1 = C3NetworkUtil.findPeerNetwork(node1.unit.id, networks);
        const net2 = C3NetworkUtil.findPeerNetwork(node2.unit.id, networks);

        if (net1 && net2 && net1.id !== net2.id) {
            // Merge networks
            const n1 = networks.find(n => n.id === net1.id)!;
            const n2idx = networks.findIndex(n => n.id === net2.id);
            for (const id of networks[n2idx].peerIds || []) {
                if (!n1.peerIds!.includes(id)) n1.peerIds!.push(id);
            }
            networks.splice(n2idx, 1);
        } else if (net1) {
            const n = networks.find(n => n.id === net1.id)!;
            if (!n.peerIds!.includes(node2.unit.id)) n.peerIds!.push(node2.unit.id);
        } else if (net2) {
            const n = networks.find(n => n.id === net2.id)!;
            if (!n.peerIds!.includes(node1.unit.id)) n.peerIds!.push(node1.unit.id);
        } else {
            networks.push({
                id: this.generateNetworkId(),
                type: networkType as 'c3' | 'c3i' | 'naval' | 'nova',
                color: this.getNextColor(),
                peerIds: [node1.unit.id, node2.unit.id]
            });
        }
        this.networks.set(networks);
        this.hasModifications.set(true);
        this.toastService.show('Peer connection established', 'success');
    }

    /**
     * Add a member (slave or master) to a master's network.
     * If memberCompIndex is provided, the member is a master; otherwise it's a slave.
     */
    private addMemberToMaster(masterNode: C3Node, masterCompIdx: number, memberId: string, memberCompIdx?: number) {
        const networks = [...this.networks()];
        const masterComp = masterNode.c3Components[masterCompIdx];

        // Create member string (unitId for slaves, unitId:compIndex for masters)
        const memberStr = memberCompIdx !== undefined 
            ? C3NetworkUtil.createMasterMember(memberId, memberCompIdx)
            : memberId;

        // Find or create master's network
        let network = C3NetworkUtil.findMasterNetwork(masterNode.unit.id, masterCompIdx, networks);
        if (!network) {
            const pinKey = `${masterNode.unit.id}:${masterCompIdx}`;
            network = {
                id: this.generateNetworkId(),
                type: masterComp.networkType as 'c3' | 'c3i' | 'naval' | 'nova',
                color: this.masterPinColors.get(pinKey) || this.getNextColor(),
                masterId: masterNode.unit.id,
                masterCompIndex: masterCompIdx,
                members: []
            };
            networks.push(network);
        }

        // Initialize members array if needed
        if (!network.members) network.members = [];

        // Remove member from any existing network first (a unit can only be in one network)
        for (const net of networks) {
            if (net.members) {
                net.members = net.members.filter(m => {
                    const parsed = C3NetworkUtil.parseMember(m);
                    return parsed.unitId !== memberId;
                });
            }
        }

        // Add member
        if (!network.members.includes(memberStr)) {
            network.members.push(memberStr);
        }

        // Clean up empty networks
        const filtered = networks.filter(n => 
            (n.peerIds && n.peerIds.length > 0) ||
            (n.masterId && (n.members?.length || 0) > 0) ||
            n.masterId === masterNode.unit.id
        );

        this.networks.set(filtered);
        this.hasModifications.set(true);
        
        const memberNode = this.nodes().find(n => n.unit.id === memberId);
        this.toastService.show(
            `Connected ${memberNode?.unit.getUnit().chassis || 'unit'} to ${masterNode.unit.getUnit().chassis}`,
            'success'
        );
    }

    private removeMemberFromNetwork(networkId: string, memberStr: string) {
        const networks = [...this.networks()];
        const network = networks.find(n => n.id === networkId);
        if (!network?.members) return;

        network.members = network.members.filter(m => m !== memberStr);

        // Remove network if empty
        if (network.members.length === 0) {
            const idx = networks.indexOf(network);
            networks.splice(idx, 1);
        }

        this.networks.set(networks);
        this.hasModifications.set(true);
    }

    protected removeNetwork(network: SerializedC3NetworkGroup) {
        if (this.data.readOnly) return;
        this.networks.set(this.networks().filter(n => n.id !== network.id));
        this.hasModifications.set(true);
    }

    protected clearAllNetworks() {
        if (this.data.readOnly) return;
        this.networks.set([]);
        this.hasModifications.set(true);
    }

    // ==================== UI Helpers ====================

    protected getNodeClasses(node: C3Node) {
        const isLinked = C3NetworkUtil.isUnitConnected(node.unit.id, this.networks());
        const isConnecting = this.connectingFrom() !== null;
        return {
            linked: isLinked,
            disconnected: !isLinked,
            dragging: this.draggedNode() === node,
            'valid-target': this.validTargets().has(node.unit.id) && isConnecting,
            'invalid-target': !this.validTargets().has(node.unit.id) && isConnecting && this.connectingFrom()?.node !== node,
            hovered: this.hoveredNode() === node && this.validTargets().has(node.unit.id)
        };
    }

    protected getNodeStyle(node: C3Node): Record<string, string> {
        const offset = this.viewOffset();
        const scale = this.zoom();
        const colors = this.getNodeBorderColors(node);

        const style: Record<string, string> = {
            left: `${offset.x + node.x * scale}px`,
            top: `${offset.y + node.y * scale}px`,
            transform: `translate(-50%, -50%) scale(${scale})`
        };

        if (colors.length === 0) {
            style['borderColor'] = '#666';
        } else if (colors.length === 1) {
            style['borderColor'] = colors[0];
        } else {
            const angle = 360 / colors.length;
            const stops = colors.map((c, i) => `${c} ${i * angle}deg ${(i + 1) * angle}deg`).join(', ');
            style['borderImage'] = `conic-gradient(from 180deg, ${stops}) 1`;
            style['borderImageSlice'] = '1';
        }

        if (!C3NetworkUtil.isUnitConnected(node.unit.id, this.networks()) && 
            !node.c3Components.every(c => c.role === C3Role.MASTER)) {
            style['borderStyle'] = 'dashed';
        }

        return style;
    }

    private getNodeBorderColors(node: C3Node): string[] {
        const colors: string[] = [];
        for (let i = 0; i < node.c3Components.length; i++) {
            const color = this.getPinNetworkColor(node, i);
            if (color && !colors.includes(color)) {
                colors.push(color);
            }
        }
        return colors;
    }

    protected getPinNetworkColor(node: C3Node, compIndex: number): string | null {
        const comp = node.c3Components[compIndex];
        if (!comp) return null;

        if (comp.role === C3Role.MASTER) {
            const net = C3NetworkUtil.findMasterNetwork(node.unit.id, compIndex, this.networks());
            if (net) return net.color;
            return this.masterPinColors.get(`${node.unit.id}:${compIndex}`) || null;
        }

        if (comp.role === C3Role.SLAVE) {
            // Check if this unit is a member of any master network
            for (const net of this.networks()) {
                if (net.members?.includes(node.unit.id)) return net.color;
            }
        }

        if (comp.role === C3Role.PEER) {
            const net = C3NetworkUtil.findPeerNetwork(node.unit.id, this.networks());
            return net?.color || null;
        }

        return null;
    }

    protected isPinConnected(node: C3Node, compIndex: number): boolean {
        const comp = node.c3Components[compIndex];
        if (!comp) return false;

        if (comp.role === C3Role.MASTER) {
            const net = C3NetworkUtil.findMasterNetwork(node.unit.id, compIndex, this.networks());
            return !!(net?.members && net.members.length > 0);
        }

        if (comp.role === C3Role.SLAVE) {
            return this.networks().some(n => n.members?.includes(node.unit.id));
        }

        if (comp.role === C3Role.PEER) {
            const net = C3NetworkUtil.findPeerNetwork(node.unit.id, this.networks());
            return !!(net?.peerIds && net.peerIds.length >= 2);
        }

        return false;
    }

    protected getRoleLabel(role: C3Role): string {
        return C3NetworkUtil.getRoleName(role);
    }

    protected getNetworkTypeLabel(type: C3NetworkType): string {
        return C3NetworkUtil.getNetworkTypeName(type);
    }

    protected getNetworkDisplayName(network: SerializedC3NetworkGroup): string {
        if (network.peerIds) {
            return `${this.getNetworkTypeLabel(network.type as C3NetworkType)} (${network.peerIds.length} peers)`;
        } else if (network.masterId) {
            const masterNode = this.nodes().find(n => n.unit.id === network.masterId);
            const memberCount = network.members?.length || 0;
            return `${masterNode?.unit.getUnit().chassis || 'Unknown'} (${memberCount} ${memberCount === 1 ? 'member' : 'members'})`;
        }
        return 'Unknown Network';
    }

    protected getTopLevelNetworks(): SerializedC3NetworkGroup[] {
        return C3NetworkUtil.getTopLevelNetworks(this.networks());
    }

    protected getSubNetworks(network: SerializedC3NetworkGroup): SerializedC3NetworkGroup[] {
        return C3NetworkUtil.findSubNetworks(network, this.networks());
    }

    protected getNetworkMembersDetailed(network: SerializedC3NetworkGroup): { 
        id: string; 
        name: string; 
        role: 'master' | 'slave' | 'peer' | 'sub-master'; 
        canRemove: boolean; 
        memberStr?: string 
    }[] {
        const members: { id: string; name: string; role: 'master' | 'slave' | 'peer' | 'sub-master'; canRemove: boolean; memberStr?: string }[] = [];

        if (network.peerIds) {
            for (const id of network.peerIds) {
                const node = this.nodes().find(n => n.unit.id === id);
                members.push({ id, name: node?.unit.getUnit().chassis || 'Unknown', role: 'peer', canRemove: true });
            }
        } else if (network.masterId) {
            const masterNode = this.nodes().find(n => n.unit.id === network.masterId);
            if (masterNode) {
                members.push({ id: network.masterId, name: masterNode.unit.getUnit().chassis, role: 'master', canRemove: false });
            }

            for (const memberStr of network.members || []) {
                const parsed = C3NetworkUtil.parseMember(memberStr);
                const node = this.nodes().find(n => n.unit.id === parsed.unitId);
                const isMaster = parsed.compIndex !== undefined;
                
                // Check if this master member has its own network with children
                let hasChildren = false;
                if (isMaster) {
                    const subNet = C3NetworkUtil.findMasterNetwork(parsed.unitId, parsed.compIndex!, this.networks());
                    hasChildren = !!(subNet?.members && subNet.members.length > 0);
                }

                members.push({
                    id: parsed.unitId,
                    name: node?.unit.getUnit().chassis || 'Unknown',
                    role: hasChildren ? 'sub-master' : 'slave',
                    canRemove: true,
                    memberStr
                });
            }
        }

        return members;
    }

    protected removeUnitFromNetwork(network: SerializedC3NetworkGroup, unitId: string, memberStr?: string) {
        if (this.data.readOnly) return;

        if (network.peerIds) {
            const networks = [...this.networks()];
            const net = networks.find(n => n.id === network.id);
            if (net) {
                net.peerIds = net.peerIds?.filter(id => id !== unitId);
                if (!net.peerIds || net.peerIds.length < 2) {
                    const idx = networks.indexOf(net);
                    networks.splice(idx, 1);
                }
                this.networks.set(networks);
                this.hasModifications.set(true);
            }
        } else if (memberStr) {
            this.removeMemberFromNetwork(network.id, memberStr);
        }
    }

    protected saveAndClose() {
        for (const node of this.nodes()) {
            node.unit.setC3Position({ x: node.x, y: node.y });
        }
        this.dialogRef.close({ networks: this.networks(), updated: this.hasModifications() });
    }

    protected close() {
        this.dialogRef.close({ networks: this.data.networks || [], updated: false });
    }
}
