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
import { NgClass, NgStyle } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ForceUnit } from '../../models/force-unit.model';
import { C3NetworkUtil } from '../../utils/c3-network.util';
import {
    C3Component,
    C3NetworkType,
    C3Role,
    C3_NETWORK_COLORS
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

/** Represents a connection line to render in SVG */
interface ConnectionLine {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    hasArrow: boolean;
    arrowAngle: number;
}

/** Represents a hub point for peer networks */
interface HubPoint {
    id: string;
    x: number;
    y: number;
    color: string;
}

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

@Component({
    selector: 'c3-network-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgClass, NgStyle, UnitIconComponent],
    host: {
        class: 'fullscreen-dialog-host',
    },
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

    // Drag state for nodes
    protected draggedNode = signal<C3Node | null>(null);
    protected dragOffset = signal({ x: 0, y: 0 });

    // Connection drawing state - now tracks existing link being dragged
    protected connectingFrom = signal<{
        node: C3Node;
        compIndex: number;
        role: C3Role;
        existingNetworkId?: string; // If dragging from already-linked unit
    } | null>(null);
    protected connectingEnd = signal({ x: 0, y: 0 });
    protected hoveredNode = signal<C3Node | null>(null);

    // Panning state
    protected isPanning = signal(false);
    protected panStart = signal({ x: 0, y: 0 });
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);

    // Color tracking
    private nextColorIndex = 0;

    // Valid targets for connection
    protected validTargets = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return new Set<string>();

        const validIds = new Set<string>();
        const sourceComp = conn.node.c3Components[conn.compIndex];
        if (!sourceComp) return validIds;

        for (const node of this.nodes()) {
            if (node === conn.node) continue;

            // Check if target has compatible C3
            const targetComp = node.c3Components.find(c => c.networkType === sourceComp.networkType);
            if (!targetComp) continue;

            // For peer networks, just need same type
            if (sourceComp.role === C3Role.PEER) {
                // Check if already connected in a peer network
                const existingNetwork = this.findPeerNetworkContaining(node.unit.id, sourceComp.networkType);
                if (existingNetwork && conn.existingNetworkId && existingNetwork.id === conn.existingNetworkId) {
                    // Same network - skip (would be a no-op)
                    continue;
                }
                validIds.add(node.unit.id);
            } else if (sourceComp.role === C3Role.MASTER) {
                // Master can connect to slaves OR other masters (master becomes slave)
                // Target needs to be able to be a slave (have slave role OR master role - masters can be slaves too)
                if (targetComp.role === C3Role.SLAVE || targetComp.role === C3Role.MASTER) {
                    if (this.canAddSlaveToMaster(conn.node.unit.id, conn.compIndex, node.unit.id)) {
                        validIds.add(node.unit.id);
                    }
                }
            } else if (sourceComp.role === C3Role.SLAVE) {
                // Slave can connect to master (masters can accept slaves)
                if (targetComp.role === C3Role.MASTER) {
                    validIds.add(node.unit.id);
                }
            }
        }
        return validIds;
    });

    // Get node border color based on network membership
    protected getNodeBorderColor(node: C3Node): string {
        // Find all networks this node belongs to
        const nodeNetworks = this.networks().filter(net => {
            if (net.peerIds?.includes(node.unit.id)) return true;
            if (net.masterId === node.unit.id) return true;
            if (net.slaveIds?.includes(node.unit.id)) return true;
            return false;
        });

        if (nodeNetworks.length === 0) return '#888'; // Unlinked
        if (nodeNetworks.length === 1) return nodeNetworks[0].color;
        // Multiple networks - return first one (or could blend)
        return nodeNetworks[0].color;
    }

    // Computed: All connection lines to render
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
                    const pinPositions = peerNodes.map(node => {
                        const compIndex = node.c3Components.findIndex(c =>
                            c.networkType === network.type && c.role === C3Role.PEER
                        );
                        const pinOffset = this.getPinOffset(node, Math.max(0, compIndex));
                        return {
                            x: offset.x + (node.x + pinOffset.x) * scale,
                            y: offset.y + (node.y + pinOffset.y) * scale
                        };
                    });

                    const centerX = pinPositions.reduce((sum, p) => sum + p.x, 0) / pinPositions.length;
                    const centerY = pinPositions.reduce((sum, p) => sum + p.y, 0) / pinPositions.length;

                    pinPositions.forEach((pinPos, idx) => {
                        lines.push({
                            id: `${network.id}-peer-${idx}`,
                            x1: centerX,
                            y1: centerY,
                            x2: pinPos.x,
                            y2: pinPos.y,
                            color: network.color,
                            hasArrow: false,
                            arrowAngle: 0
                        });
                    });
                }
            } else if (network.masterId && network.slaveIds && network.slaveIds.length > 0) {
                // Master-slave network
                const masterNode = nodes.find(n => n.unit.id === network.masterId);
                if (!masterNode) continue;

                const compIndex = network.masterComponentIndex ?? 0;
                const masterPinOffset = this.getPinOffset(masterNode, compIndex);
                const masterPinX = offset.x + (masterNode.x + masterPinOffset.x) * scale;
                const masterPinY = offset.y + (masterNode.y + masterPinOffset.y) * scale;

                for (const slaveId of network.slaveIds) {
                    const slaveNode = nodes.find(n => n.unit.id === slaveId);
                    if (!slaveNode) continue;

                    const slaveCompIndex = slaveNode.c3Components.findIndex(c =>
                        c.networkType === network.type && (c.role === C3Role.SLAVE || c.role === C3Role.MASTER)
                    );
                    const slavePinOffset = this.getPinOffset(slaveNode, Math.max(0, slaveCompIndex));
                    const slavePinX = offset.x + (slaveNode.x + slavePinOffset.x) * scale;
                    const slavePinY = offset.y + (slaveNode.y + slavePinOffset.y) * scale;

                    const angle = Math.atan2(slavePinY - masterPinY, slavePinX - masterPinX);

                    lines.push({
                        id: `${network.id}-slave-${slaveId}`,
                        x1: masterPinX,
                        y1: masterPinY,
                        x2: slavePinX,
                        y2: slavePinY,
                        color: network.color,
                        hasArrow: true,
                        arrowAngle: angle
                    });
                }
            }
        }

        return lines;
    });

    // Computed: Hub points for peer networks
    protected hubPoints = computed<HubPoint[]>(() => {
        const hubs: HubPoint[] = [];
        const nodes = this.nodes();
        const networks = this.networks();
        const offset = this.viewOffset();
        const scale = this.zoom();

        for (const network of networks) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds
                    .map(id => nodes.find(n => n.unit.id === id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const pinPositions = peerNodes.map(node => {
                        const compIndex = node.c3Components.findIndex(c =>
                            c.networkType === network.type && c.role === C3Role.PEER
                        );
                        const pinOffset = this.getPinOffset(node, Math.max(0, compIndex));
                        return {
                            x: offset.x + (node.x + pinOffset.x) * scale,
                            y: offset.y + (node.y + pinOffset.y) * scale
                        };
                    });

                    const centerX = pinPositions.reduce((sum, p) => sum + p.x, 0) / pinPositions.length;
                    const centerY = pinPositions.reduce((sum, p) => sum + p.y, 0) / pinPositions.length;

                    hubs.push({
                        id: `hub-${network.id}`,
                        x: centerX,
                        y: centerY,
                        color: network.color
                    });
                }
            }
        }

        return hubs;
    });

    // Computed: Active drag line
    protected activeDragLine = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return null;

        const offset = this.viewOffset();
        const scale = this.zoom();
        const pinOffset = this.getPinOffset(conn.node, conn.compIndex);
        const startX = offset.x + (conn.node.x + pinOffset.x) * scale;
        const startY = offset.y + (conn.node.y + pinOffset.y) * scale;
        const end = this.connectingEnd();

        return { x1: startX, y1: startY, x2: end.x, y2: end.y };
    });

    ngAfterViewInit() {
        this.initializeNodes();
        this.networks.set([...(this.data.networks || [])]);
        this.nextColorIndex = this.networks().length;
    }

    private initializeNodes() {
        const c3Units = this.data.units.filter(u => C3NetworkUtil.hasC3(u.getUnit()));
        const containerEl = this.container()?.nativeElement;
        const width = containerEl?.clientWidth || 800;
        const height = containerEl?.clientHeight || 600;

        // Calculate grid with proper spacing - nodes are ~140px wide, use 180px spacing
        const nodeSpacing = 180;
        const cols = Math.max(1, Math.floor((width - 100) / nodeSpacing));
        const rows = Math.ceil(c3Units.length / cols);
        
        // Center the grid
        const gridWidth = (cols - 1) * nodeSpacing;
        const gridHeight = (rows - 1) * nodeSpacing;
        const startX = (width - gridWidth) / 2;
        const startY = Math.max(100, (height - gridHeight) / 2);

        const nodes: C3Node[] = c3Units.map((unit, idx) => {
            const pos = unit.c3Position();
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            return {
                unit,
                c3Components: C3NetworkUtil.getC3Components(unit.getUnit()),
                x: pos?.x ?? startX + col * nodeSpacing,
                y: pos?.y ?? startY + row * nodeSpacing
            };
        });

        this.nodes.set(nodes);
    }

    private findPeerNetworkContaining(unitId: string, networkType: C3NetworkType): SerializedC3NetworkGroup | null {
        return this.networks().find(net =>
            net.type === networkType && net.peerIds?.includes(unitId)
        ) || null;
    }

    private findMasterSlaveNetwork(masterId: string, compIndex: number): SerializedC3NetworkGroup | null {
        return this.networks().find(net =>
            net.masterId === masterId && net.masterComponentIndex === compIndex
        ) || null;
    }

    /**
     * Find if a unit is already a slave in any master/slave network
     */
    private findNetworkWhereUnitIsSlave(unitId: string, networkType: C3NetworkType): SerializedC3NetworkGroup | null {
        return this.networks().find(net =>
            net.type === networkType && net.slaveIds?.includes(unitId)
        ) || null;
    }

    /**
     * Check if a unit can be added as a slave to a master.
     * A slave can only have ONE master, so check if already linked elsewhere.
     */
    private canAddSlaveToMaster(masterId: string, compIndex: number, slaveId: string): boolean {
        const existingNet = this.findMasterSlaveNetwork(masterId, compIndex);
        
        // Check if already linked to THIS master
        if (existingNet?.slaveIds?.includes(slaveId)) return false;

        // Check capacity
        const masterNode = this.nodes().find(n => n.unit.id === masterId);
        if (!masterNode) return false;
        const comp = masterNode.c3Components[compIndex];
        if (!comp) return false;

        const maxSlaves = C3NetworkUtil.getMaxSlaves(comp.networkType);
        const currentSlaves = existingNet?.slaveIds?.length || 0;
        if (currentSlaves >= maxSlaves) return false;

        // A slave can only have one master - check if already linked to another master
        // (This will be handled by unlinking first when connecting)
        return true;
    }

    /**
     * Check if a unit is already a slave to some master (for validation display)
     */
    private isAlreadySlave(unitId: string, networkType: C3NetworkType): boolean {
        return this.findNetworkWhereUnitIsSlave(unitId, networkType) !== null;
    }

    private getNextColor(): string {
        const color = C3_NETWORK_COLORS[this.nextColorIndex % C3_NETWORK_COLORS.length];
        this.nextColorIndex++;
        return color;
    }

    private generateNetworkId(): string {
        return `net_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Calculate the pin position offset from node center for a given component index.
     * The node is positioned at its center via CSS transform: translate(-50%, -50%).
     * We need to calculate the offset from the node's center to the pin connector's center.
     */
    private getPinOffset(node: C3Node, compIndex: number): { x: number; y: number } {
        const numPins = node.c3Components.length;
        if (numPins === 0) return { x: 0, y: 20 };
        
        // Horizontal spacing: pins are in a flex container with gap: 8px
        // Each pin is roughly 30px wide (label + connector area)
        // So total pin width including gap is ~38px per pin
        const pinSpacing = 38;
        const totalWidth = (numPins - 1) * pinSpacing;
        const startX = -totalWidth / 2;
        
        // Vertical offset: from node center to pin connector center
        // Node structure from center point:
        // - Header takes up space above the middle
        // - Pins area is roughly in the middle-lower portion
        // The pin connector is approximately 15-20px below the node's center point
        return {
            x: startX + compIndex * pinSpacing,
            y: 18 // Offset from node center to pin connector center
        };
    }

    // --- Event Handlers ---

    /**
     * Handle pointer down on a pin - starts connection drawing
     * Note: We no longer auto-disconnect when clicking a pin. Users must disconnect via sidebar.
     */
    protected onPinPointerDown(event: PointerEvent, node: C3Node, compIndex: number) {
        event.preventDefault();
        event.stopPropagation();

        const comp = node.c3Components[compIndex];
        if (!comp) return;

        // Track if we're already in a network (for validation purposes)
        let existingNetworkId: string | undefined;

        if (comp.role === C3Role.PEER) {
            const peerNet = this.findPeerNetworkContaining(node.unit.id, comp.networkType);
            if (peerNet) {
                existingNetworkId = peerNet.id;
                // Don't auto-disconnect peers - user must use sidebar to disconnect
            }
        } else if (comp.role === C3Role.SLAVE) {
            // Find existing network but don't disconnect - will be handled in createMasterSlaveConnection
            const networks = this.networks();
            for (const net of networks) {
                if (net.slaveIds?.includes(node.unit.id) && net.type === comp.networkType) {
                    existingNetworkId = net.id;
                    break;
                }
            }
        }
        // Masters keep their network when dragging

        this.connectingFrom.set({ node, compIndex, role: comp.role, existingNetworkId });
        this.connectingEnd.set({ x: event.clientX, y: event.clientY });

        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    protected onNodePointerDown(event: PointerEvent, node: C3Node) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target as HTMLElement;

        // Check if clicking on a connection pin (or child of pin)
        const pinEl = target.closest('.pin');
        if (pinEl) {
            // Pin has its own handler, don't drag node
            return;
        }

        // Start dragging the node
        const scale = this.zoom();
        const offset = this.viewOffset();
        const nodeScreenX = offset.x + node.x * scale;
        const nodeScreenY = offset.y + node.y * scale;

        this.dragOffset.set({
            x: event.clientX - nodeScreenX,
            y: event.clientY - nodeScreenY
        });
        this.draggedNode.set(node);

        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    protected onContainerPointerDown(event: PointerEvent) {
        const target = event.target as HTMLElement;
        if (target.closest('.node')) return;

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
            const dragOff = this.dragOffset();

            node.x = (event.clientX - dragOff.x - offset.x) / scale;
            node.y = (event.clientY - dragOff.y - offset.y) / scale;

            this.nodes.set([...this.nodes()]);
            this.hasModifications.set(true);
        } else if (this.connectingFrom()) {
            this.connectingEnd.set({ x: event.clientX, y: event.clientY });

            // Find hovered node
            const el = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = el?.closest('.node');

            if (nodeEl) {
                const unitId = nodeEl.getAttribute('data-unit-id');
                const targetNode = this.nodes().find(n => n.unit.id === unitId);
                if (targetNode && this.validTargets().has(targetNode.unit.id)) {
                    this.hoveredNode.set(targetNode);
                } else {
                    this.hoveredNode.set(null);
                }
            } else {
                this.hoveredNode.set(null);
            }
        } else if (this.isPanning()) {
            const start = this.panStart();
            const current = this.viewOffset();

            this.viewOffset.set({
                x: current.x + (event.clientX - start.x),
                y: current.y + (event.clientY - start.y)
            });
            this.panStart.set({ x: event.clientX, y: event.clientY });
        }
    };

    private onGlobalPointerUp = (event: PointerEvent) => {
        if (this.connectingFrom()) {
            const el = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = el?.closest('.node');

            if (nodeEl) {
                const targetUnitId = nodeEl.getAttribute('data-unit-id');
                const targetNode = this.nodes().find(n => n.unit.id === targetUnitId);
                const conn = this.connectingFrom()!;

                if (targetNode && targetNode !== conn.node && this.validTargets().has(targetNode.unit.id)) {
                    this.createConnection(conn, targetNode);
                }
            }

            this.connectingFrom.set(null);
            this.hoveredNode.set(null);
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

    // --- Network Management ---

    private createConnection(from: { node: C3Node; compIndex: number; role: C3Role; existingNetworkId?: string }, targetNode: C3Node) {
        if (this.data.readOnly) {
            this.toastService.show('Cannot modify in read-only mode', 'error');
            return;
        }

        const sourceComp = from.node.c3Components[from.compIndex];
        if (!sourceComp) return;

        if (sourceComp.role === C3Role.PEER) {
            this.createPeerConnection(from.node, targetNode, sourceComp.networkType);
        } else if (sourceComp.role === C3Role.MASTER) {
            this.createMasterSlaveConnection(from.node, from.compIndex, targetNode);
        } else if (sourceComp.role === C3Role.SLAVE) {
            // Slave connecting to a master - find compatible master component on target
            const targetComp = targetNode.c3Components.find(c =>
                c.networkType === sourceComp.networkType &&
                c.role === C3Role.MASTER
            );
            if (targetComp) {
                const compIndex = targetNode.c3Components.indexOf(targetComp);
                this.createMasterSlaveConnection(targetNode, compIndex, from.node);
            }
        }
    }

    private createPeerConnection(node1: C3Node, node2: C3Node, networkType: C3NetworkType) {
        const networks = [...this.networks()];

        // Check if either node is already in a peer network of this type
        const existingNet1 = this.findPeerNetworkContaining(node1.unit.id, networkType);
        const existingNet2 = this.findPeerNetworkContaining(node2.unit.id, networkType);

        if (existingNet1 && existingNet2) {
            // Both in networks - merge them
            if (existingNet1.id !== existingNet2.id) {
                // Merge net2 into net1
                const net1 = networks.find(n => n.id === existingNet1.id)!;
                const net2Idx = networks.findIndex(n => n.id === existingNet2.id);
                const net2 = networks[net2Idx];

                for (const peerId of net2.peerIds || []) {
                    if (!net1.peerIds!.includes(peerId)) {
                        net1.peerIds!.push(peerId);
                    }
                }

                networks.splice(net2Idx, 1);
            }
        } else if (existingNet1) {
            // Add node2 to node1's network
            const net = networks.find(n => n.id === existingNet1.id)!;
            if (!net.peerIds!.includes(node2.unit.id)) {
                net.peerIds!.push(node2.unit.id);
            }
        } else if (existingNet2) {
            // Add node1 to node2's network
            const net = networks.find(n => n.id === existingNet2.id)!;
            if (!net.peerIds!.includes(node1.unit.id)) {
                net.peerIds!.push(node1.unit.id);
            }
        } else {
            // Create new peer network
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

    private createMasterSlaveConnection(masterNode: C3Node, compIndex: number, slaveNode: C3Node) {
        let networks = [...this.networks()];
        const masterComp = masterNode.c3Components[compIndex];

        // Check for circular reference: if slaveNode is already a master of masterNode, reverse the direction
        const reverseNetwork = networks.find(n =>
            n.type === masterComp.networkType &&
            n.masterId === slaveNode.unit.id &&
            n.slaveIds?.includes(masterNode.unit.id)
        );
        
        if (reverseNetwork) {
            // Reverse direction: remove masterNode from being slave of slaveNode
            // and make slaveNode a slave of masterNode instead
            reverseNetwork.slaveIds = reverseNetwork.slaveIds?.filter(id => id !== masterNode.unit.id);
            if (!reverseNetwork.slaveIds || reverseNetwork.slaveIds.length === 0) {
                networks = networks.filter(n => n.id !== reverseNetwork.id);
            }
            this.toastService.show('Reversed connection direction', 'info');
        }

        // A slave can only have ONE master - remove from old master first if connected elsewhere
        const existingSlaveNetwork = networks.find(n => 
            n.type === masterComp.networkType && 
            n.slaveIds?.includes(slaveNode.unit.id)
        );
        if (existingSlaveNetwork) {
            existingSlaveNetwork.slaveIds = existingSlaveNetwork.slaveIds?.filter(id => id !== slaveNode.unit.id);
            // Remove network if no slaves left
            if (!existingSlaveNetwork.slaveIds || existingSlaveNetwork.slaveIds.length === 0) {
                networks = networks.filter(n => n.id !== existingSlaveNetwork.id);
            }
        }

        let network = networks.find(n =>
            n.masterId === masterNode.unit.id &&
            n.masterComponentIndex === compIndex
        );

        if (!network) {
            network = {
                id: this.generateNetworkId(),
                type: masterComp.networkType as 'c3' | 'c3i' | 'naval' | 'nova',
                color: this.getNextColor(),
                masterId: masterNode.unit.id,
                masterComponentIndex: compIndex,
                slaveIds: []
            };
            networks.push(network);
        }

        if (!network.slaveIds!.includes(slaveNode.unit.id)) {
            network.slaveIds!.push(slaveNode.unit.id);
        }

        this.networks.set(networks);
        this.hasModifications.set(true);
        this.toastService.show(`Connected ${slaveNode.unit.getUnit().chassis} to ${masterNode.unit.getUnit().chassis}`, 'success');
    }

    private unlinkFromPeerNetwork(unitId: string, networkId: string) {
        const networks = [...this.networks()];
        const netIdx = networks.findIndex(n => n.id === networkId);
        if (netIdx === -1) return;

        const network = networks[netIdx];
        network.peerIds = network.peerIds?.filter(id => id !== unitId);

        // Remove network if less than 2 peers
        if (!network.peerIds || network.peerIds.length < 2) {
            networks.splice(netIdx, 1);
        }

        this.networks.set(networks);
        this.hasModifications.set(true);
    }

    private unlinkSlaveFromNetwork(slaveId: string, networkId: string) {
        const networks = [...this.networks()];
        const network = networks.find(n => n.id === networkId);
        if (!network) return;

        network.slaveIds = network.slaveIds?.filter(id => id !== slaveId);

        // Remove network if no slaves
        if (!network.slaveIds || network.slaveIds.length === 0) {
            const idx = networks.indexOf(network);
            networks.splice(idx, 1);
        }

        this.networks.set(networks);
        this.hasModifications.set(true);
    }

    protected removeNetwork(network: SerializedC3NetworkGroup) {
        if (this.data.readOnly) return;

        const networks = this.networks().filter(n => n.id !== network.id);
        this.networks.set(networks);
        this.hasModifications.set(true);
    }

    protected clearAllNetworks() {
        if (this.data.readOnly) return;

        this.networks.set([]);
        this.hasModifications.set(true);
    }

    // --- UI Helpers ---

    protected getNodeClasses(node: C3Node) {
        const isLinked = this.isUnitLinked(node.unit.id);
        const isDragging = this.draggedNode() === node;
        const isValidTarget = this.validTargets().has(node.unit.id);
        const isHovered = this.hoveredNode() === node;
        const isConnecting = this.connectingFrom() !== null;

        return {
            linked: isLinked,
            disconnected: !isLinked,
            dragging: isDragging,
            'valid-target': isValidTarget && isConnecting,
            'invalid-target': !isValidTarget && isConnecting && this.connectingFrom()?.node !== node,
            hovered: isHovered && isValidTarget
        };
    }

    protected getNodeStyle(node: C3Node) {
        const offset = this.viewOffset();
        const scale = this.zoom();
        return {
            left: `${offset.x + node.x * scale}px`,
            top: `${offset.y + node.y * scale}px`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            borderColor: this.getNodeBorderColor(node)
        };
    }

    protected isUnitLinked(unitId: string): boolean {
        return this.networks().some(net =>
            net.peerIds?.includes(unitId) ||
            net.masterId === unitId ||
            net.slaveIds?.includes(unitId)
        );
    }

    /**
     * Get the network color for a specific pin (component) on a node.
     * Masters show their network color even without slaves.
     * Each pin on a multi-master unit has its own independent network.
     */
    protected getPinNetworkColor(node: C3Node, compIndex: number): string | null {
        const comp = node.c3Components[compIndex];
        if (!comp) return null;

        // For masters: find network where this unit is master with this component index
        if (comp.role === C3Role.MASTER) {
            const network = this.networks().find(n =>
                n.masterId === node.unit.id && n.masterComponentIndex === compIndex
            );
            return network?.color || null;
        }

        // For slaves: find network where this unit is a slave
        if (comp.role === C3Role.SLAVE) {
            const network = this.networks().find(n =>
                n.type === comp.networkType && n.slaveIds?.includes(node.unit.id)
            );
            return network?.color || null;
        }

        // For peers: find peer network containing this unit
        if (comp.role === C3Role.PEER) {
            const network = this.networks().find(n =>
                n.type === comp.networkType && n.peerIds?.includes(node.unit.id)
            );
            return network?.color || null;
        }

        return null;
    }

    /**
     * Check if a specific pin is connected to a network
     */
    protected isPinConnected(node: C3Node, compIndex: number): boolean {
        const comp = node.c3Components[compIndex];
        if (!comp) return false;

        // For masters: connected if they have any slaves OR are themselves a slave
        if (comp.role === C3Role.MASTER) {
            const asMaster = this.networks().some(n =>
                n.masterId === node.unit.id && 
                n.masterComponentIndex === compIndex &&
                n.slaveIds && n.slaveIds.length > 0
            );
            const asSlave = this.networks().some(n =>
                n.type === comp.networkType && n.slaveIds?.includes(node.unit.id)
            );
            return asMaster || asSlave;
        }

        // For slaves: connected if in any slave network
        if (comp.role === C3Role.SLAVE) {
            return this.networks().some(n =>
                n.type === comp.networkType && n.slaveIds?.includes(node.unit.id)
            );
        }

        // For peers: connected if in a peer network with 2+ members
        if (comp.role === C3Role.PEER) {
            return this.networks().some(n =>
                n.type === comp.networkType && 
                n.peerIds?.includes(node.unit.id) &&
                (n.peerIds?.length || 0) >= 2
            );
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
            return `${masterNode?.unit.getUnit().chassis || 'Unknown'}'s Network (${network.slaveIds?.length || 0} slaves)`;
        }
        return 'Unknown Network';
    }

    protected getNetworkMembers(network: SerializedC3NetworkGroup): string[] {
        if (network.peerIds) {
            return network.peerIds.map(id => {
                const node = this.nodes().find(n => n.unit.id === id);
                return node?.unit.getUnit().chassis || 'Unknown';
            });
        } else if (network.masterId) {
            const members: string[] = [];
            const masterNode = this.nodes().find(n => n.unit.id === network.masterId);
            if (masterNode) members.push(`${masterNode.unit.getUnit().chassis} (M)`);
            for (const slaveId of network.slaveIds || []) {
                const slaveNode = this.nodes().find(n => n.unit.id === slaveId);
                if (slaveNode) members.push(slaveNode.unit.getUnit().chassis);
            }
            return members;
        }
        return [];
    }

    /**
     * Get network members with their IDs and roles for sidebar display with remove buttons
     */
    protected getNetworkMembersDetailed(network: SerializedC3NetworkGroup): { id: string; name: string; role: 'master' | 'slave' | 'peer'; canRemove: boolean }[] {
        const members: { id: string; name: string; role: 'master' | 'slave' | 'peer'; canRemove: boolean }[] = [];
        
        if (network.peerIds) {
            for (const id of network.peerIds) {
                const node = this.nodes().find(n => n.unit.id === id);
                members.push({
                    id,
                    name: node?.unit.getUnit().chassis || 'Unknown',
                    role: 'peer',
                    canRemove: true // Peers can always be removed
                });
            }
        } else if (network.masterId) {
            // Master - can only be removed if there are no slaves (which deletes network)
            const masterNode = this.nodes().find(n => n.unit.id === network.masterId);
            if (masterNode) {
                members.push({
                    id: network.masterId,
                    name: masterNode.unit.getUnit().chassis,
                    role: 'master',
                    canRemove: false // Can't remove master without removing network
                });
            }
            // Slaves
            for (const slaveId of network.slaveIds || []) {
                const slaveNode = this.nodes().find(n => n.unit.id === slaveId);
                if (slaveNode) {
                    members.push({
                        id: slaveId,
                        name: slaveNode.unit.getUnit().chassis,
                        role: 'slave',
                        canRemove: true
                    });
                }
            }
        }
        return members;
    }

    /**
     * Remove a specific unit from a network
     */
    protected removeUnitFromNetwork(network: SerializedC3NetworkGroup, unitId: string) {
        if (this.data.readOnly) return;

        if (network.peerIds) {
            this.unlinkFromPeerNetwork(unitId, network.id);
        } else if (network.slaveIds?.includes(unitId)) {
            this.unlinkSlaveFromNetwork(unitId, network.id);
        }
    }

    protected saveAndClose() {
        // Save positions to units
        for (const node of this.nodes()) {
            node.unit.setC3Position({ x: node.x, y: node.y });
        }

        this.dialogRef.close({
            networks: this.networks(),
            updated: this.hasModifications()
        });
    }

    protected close() {
        this.dialogRef.close({ networks: this.data.networks || [], updated: false });
    }
}
