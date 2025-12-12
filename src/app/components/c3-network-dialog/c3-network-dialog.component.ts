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
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
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
    zIndex: number;
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
    
    // Trigger for recalculating pin positions (incremented when nodes move or zoom changes)
    private pinPositionTrigger = signal(0);

    // Drag state
    protected draggedNode = signal<C3Node | null>(null);
    protected dragOffset = signal({ x: 0, y: 0 });

    // Connection drawing state
    protected connectingFrom = signal<{ node: C3Node; compIndex: number; role: C3Role } | null>(null);
    protected connectingEnd = signal({ x: 0, y: 0 });
    protected hoveredNode = signal<C3Node | null>(null);
    protected hoveredPinIndex = signal<number | null>(null);

    // Pan/zoom state
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);

    // Unified pan tracking (works for both single-touch and pinch gestures)
    private lastPanPoint: { x: number; y: number } | null = null;

    // Pinch zoom state
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private activeTouches = new Map<number, PointerEvent>();

    // Z-index counter for node layering
    private maxZIndex = signal(0);

    // Color tracking
    private nextColorIndex = 0;
    private masterPinColors = new Map<string, string>();

    /**
     * Comprehensive connection state computed once when drag starts.
     * Contains all valid target units and their valid pins.
     */
    protected connectionState = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) {
            return {
                isConnecting: false,
                validTargetIds: new Set<string>(),
                validPinsByUnit: new Map<string, number[]>()
            };
        }
        
        const sourceComp = conn.node.c3Components[conn.compIndex];
        const validTargetIds = new Set<string>();
        const validPinsByUnit = new Map<string, number[]>();
        const networks = this.networks();
        
        for (const node of this.nodes()) {
            const validPins: number[] = [];
            
            for (let i = 0; i < node.c3Components.length; i++) {
                const targetComp = node.c3Components[i];
                if (!C3NetworkUtil.areComponentsCompatible(sourceComp, targetComp)) continue;

                const result = C3NetworkUtil.canConnectToPin(
                    conn.node.unit.id,
                    conn.compIndex,
                    sourceComp.role,
                    sourceComp.networkType,
                    node.unit.id,
                    i,
                    targetComp.role,
                    networks
                );
                if (result.valid) {
                    validPins.push(i);
                }
            }
            
            if (validPins.length > 0) {
                validTargetIds.add(node.unit.id);
                validPinsByUnit.set(node.unit.id, validPins);
            }
        }
        
        return {
            isConnecting: true,
            validTargetIds,
            validPinsByUnit
        };
    });

    // Convenience accessor for valid target IDs
    protected validTargets = computed(() => this.connectionState().validTargetIds);

    // Connection lines
    protected connectionLines = computed<ConnectionLine[]>(() => {
        const lines: ConnectionLine[] = [];
        const nodes = this.nodes();
        const networks = this.networks();
        // Trigger dependency on pin positions for accurate line rendering
        this.pinPositions();

        for (const network of networks) {
            if (network.peerIds && network.peerIds.length > 1) {
                // Peer network - lines from hub to each peer
                const peerNodes = network.peerIds
                    .map(id => nodes.find(n => n.unit.id === id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        return this.getPinCenter(node, Math.max(0, compIdx));
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
                const masterPos = this.getPinCenter(masterNode, compIdx);

                for (const member of network.members || []) {
                    const parsed = C3NetworkUtil.parseMember(member);
                    const memberNode = nodes.find(n => n.unit.id === parsed.unitId);
                    if (!memberNode) continue;

                    // Find the appropriate pin on the member
                    let memberCompIdx = 0;
                    if (parsed.compIndex !== undefined) {
                        // Master member - use the specified component index
                        memberCompIdx = parsed.compIndex;
                    } else {
                        // Slave member - find the slave pin specifically
                        memberCompIdx = memberNode.c3Components.findIndex(c => 
                            c.role === C3Role.SLAVE
                        );
                        if (memberCompIdx < 0) memberCompIdx = 0;
                    }

                    const memberPos = this.getPinCenter(memberNode, memberCompIdx);
                    const angle = Math.atan2(memberPos.y - masterPos.y, memberPos.x - masterPos.x);

                    // Shorten the line so arrow stops at pin edge (not center)
                    const pinRadius = this.PIN_CONNECTOR_SIZE / 2;
                    const arrowMarkerLength = 10; // SVG marker refX is 10
                    const shortenBy = pinRadius + arrowMarkerLength - 6;
                    const endX = memberPos.x - Math.cos(angle) * shortenBy;
                    const endY = memberPos.y - Math.sin(angle) * shortenBy;

                    lines.push({
                        id: `${network.id}-member-${member}`,
                        x1: masterPos.x, y1: masterPos.y, x2: endX, y2: endY,
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
        // Trigger dependency on pin positions
        this.pinPositions();

        for (const network of this.networks()) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds
                    .map(id => nodes.find(n => n.unit.id === id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        return this.getPinCenter(node, Math.max(0, compIdx));
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
        const pinPos = this.getPinCenter(conn.node, conn.compIndex);
        return {
            x1: pinPos.x,
            y1: pinPos.y,
            x2: this.connectingEnd().x,
            y2: this.connectingEnd().y
        };
    });

    // ==================== Cached Sidebar Data ====================

    /** Top-level networks (not sub-networks of another) */
    protected topLevelNetworks = computed(() => 
        C3NetworkUtil.getTopLevelNetworks(this.networks())
    );

    /** Map of network ID to its sub-networks */
    protected subNetworksMap = computed(() => {
        const map = new Map<string, SerializedC3NetworkGroup[]>();
        const networks = this.networks();
        for (const net of networks) {
            map.set(net.id, C3NetworkUtil.findSubNetworks(net, networks));
        }
        return map;
    });

    /** Map of network ID to detailed member info */
    protected networkMembersMap = computed(() => {
        const map = new Map<string, { 
            id: string; 
            name: string; 
            role: 'master' | 'slave' | 'peer' | 'sub-master'; 
            canRemove: boolean; 
            memberStr?: string 
        }[]>();
        
        const nodes = this.nodes();
        const networks = this.networks();
        
        for (const network of networks) {
            const members: typeof map extends Map<string, infer V> ? V : never = [];
            
            if (network.peerIds) {
                for (const id of network.peerIds) {
                    const node = nodes.find(n => n.unit.id === id);
                    members.push({ id, name: node?.unit.getUnit().chassis || 'Unknown', role: 'peer', canRemove: true });
                }
            } else if (network.masterId) {
                const masterNode = nodes.find(n => n.unit.id === network.masterId);
                if (masterNode) {
                    members.push({ id: network.masterId, name: masterNode.unit.getUnit().chassis, role: 'master', canRemove: false });
                }

                for (const memberStr of network.members || []) {
                    const parsed = C3NetworkUtil.parseMember(memberStr);
                    const node = nodes.find(n => n.unit.id === parsed.unitId);
                    const isMaster = parsed.compIndex !== undefined;
                    
                    let hasChildren = false;
                    if (isMaster) {
                        const subNet = C3NetworkUtil.findMasterNetwork(parsed.unitId, parsed.compIndex!, networks);
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
            
            map.set(network.id, members);
        }
        
        return map;
    });

    /** Map of network ID to display name */
    protected networkDisplayNames = computed(() => {
        const map = new Map<string, string>();
        const nodes = this.nodes();
        
        for (const network of this.networks()) {
            let name: string;
            if (network.peerIds) {
                name = `${C3NetworkUtil.getNetworkTypeName(network.type as C3NetworkType)} (${network.peerIds.length} peers)`;
            } else if (network.masterId) {
                const masterNode = nodes.find(n => n.unit.id === network.masterId);
                const memberCount = network.members?.length || 0;
                name = `${masterNode?.unit.getUnit().chassis || 'Unknown'} (${memberCount} ${memberCount === 1 ? 'member' : 'members'})`;
            } else {
                name = 'Unknown Network';
            }
            map.set(network.id, name);
        }
        
        return map;
    });

    // ==================== Cached Pin State ====================

    /** Map of "unitId:compIndex" to pin connection state */
    protected pinConnectionState = computed(() => {
        const state = new Map<string, { connected: boolean; disabled: boolean; color: string | null }>();
        const nodes = this.nodes();
        const networks = this.networks();
        
        for (const node of nodes) {
            const unitId = node.unit.id;
            
            for (let compIndex = 0; compIndex < node.c3Components.length; compIndex++) {
                const comp = node.c3Components[compIndex];
                const key = `${unitId}:${compIndex}`;
                
                let connected = false;
                let disabled = false;
                let color: string | null = null;
                
                if (comp.role === C3Role.MASTER) {
                    const net = C3NetworkUtil.findMasterNetwork(unitId, compIndex, networks);
                    connected = !!(net?.members && net.members.length > 0);
                    disabled = C3NetworkUtil.isUnitSlaveConnected(unitId, networks);
                    color = net?.color || this.masterPinColors.get(key) || null;
                } else if (comp.role === C3Role.SLAVE) {
                    connected = networks.some(n => n.members?.includes(unitId));
                    disabled = C3NetworkUtil.isUnitMasterConnected(unitId, networks);
                    for (const net of networks) {
                        if (net.members?.includes(unitId)) {
                            color = net.color;
                            break;
                        }
                    }
                } else if (comp.role === C3Role.PEER) {
                    const net = C3NetworkUtil.findPeerNetwork(unitId, networks);
                    connected = !!(net?.peerIds && net.peerIds.length >= 2);
                    color = net?.color || null;
                }
                
                state.set(key, { connected, disabled, color });
            }
        }
        
        return state;
    });

    /** Map of unitId to node border colors */
    protected nodeBorderColors = computed(() => {
        const map = new Map<string, string[]>();
        const networks = this.networks();
        
        for (const node of this.nodes()) {
            const unitId = node.unit.id;
            const colors: string[] = [];
            
            // 1. Check if unit is a member (slave or sub-master) of any network
            for (const net of networks) {
                if (!net.members) continue;
                for (const member of net.members) {
                    const parsed = C3NetworkUtil.parseMember(member);
                    if (parsed.unitId === unitId && !colors.includes(net.color)) {
                        colors.push(net.color);
                        break;
                    }
                }
            }
            
            // 2. Check if unit is a peer in any peer network
            for (const net of networks) {
                if (net.peerIds?.includes(unitId) && !colors.includes(net.color)) {
                    colors.push(net.color);
                }
            }
            
            // 3. Check if unit is a master with members
            for (const net of networks) {
                if (net.masterId === unitId && net.members?.length && !colors.includes(net.color)) {
                    colors.push(net.color);
                }
            }
            
            map.set(unitId, colors);
        }
        
        return map;
    });

    /** Map of unitId to whether unit is connected to any network */
    protected unitConnectionStatus = computed(() => {
        const map = new Map<string, boolean>();
        const networks = this.networks();
        
        for (const node of this.nodes()) {
            map.set(node.unit.id, C3NetworkUtil.isUnitConnected(node.unit.id, networks));
        }
        
        return map;
    });

    // ==================== Pre-computed Node UI State ====================
    
    /** 
     * Pre-computed map of node classes for each unit.
     * Reduces template function calls by caching results in a computed signal.
     */
    protected nodeClassesMap = computed(() => {
        const map = new Map<string, Record<string, boolean>>();
        const unitStatus = this.unitConnectionStatus();
        const connState = this.connectionState();
        const isConnecting = connState.isConnecting;
        const draggedNode = this.draggedNode();
        const hoveredNode = this.hoveredNode();
        const connectingFromNode = this.connectingFrom()?.node;
        
        for (const node of this.nodes()) {
            const unitId = node.unit.id;
            const isLinked = unitStatus.get(unitId) ?? false;
            map.set(unitId, {
                linked: isLinked,
                disconnected: !isLinked,
                dragging: draggedNode === node,
                'valid-target': connState.validTargetIds.has(unitId) && isConnecting,
                'invalid-target': !connState.validTargetIds.has(unitId) && isConnecting && connectingFromNode !== node,
                hovered: hoveredNode === node && connState.validTargetIds.has(unitId)
            });
        }
        
        return map;
    });

    /**
     * Pre-computed map of node styles for each unit.
     * Separates dynamic position from static styling to reduce recalculations.
     */
    protected nodeStylesMap = computed(() => {
        const map = new Map<string, Record<string, string>>();
        const offset = this.viewOffset();
        const scale = this.zoom();
        const borderColors = this.nodeBorderColors();
        const unitStatus = this.unitConnectionStatus();
        
        for (const node of this.nodes()) {
            const unitId = node.unit.id;
            const colors = borderColors.get(unitId) || [];
            const isConnected = unitStatus.get(unitId) ?? false;
            
            const style: Record<string, string> = {
                left: `${offset.x + node.x * scale}px`,
                top: `${offset.y + node.y * scale}px`,
                transform: `translate(-50%, -50%) scale(${scale})`,
                zIndex: `${node.zIndex}`
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

            if (!isConnected) {
                style['borderStyle'] = 'dashed';
            }

            map.set(unitId, style);
        }
        
        return map;
    });

    ngAfterViewInit() {
        this.initializeNodes();
        this.networks.set([...(this.data.networks || [])]);
        this.initializeMasterPinColors();
        // Initialize pin positions after DOM is ready
        requestAnimationFrame(() => this.invalidatePinPositions());
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
                y: pos?.y ?? startY + Math.floor(idx / cols) * spacing,
                zIndex: idx
            };
        }));
        this.maxZIndex.set(c3Units.length);
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

    // Pin visual constants
    private readonly PIN_CONNECTOR_SIZE = 14; // Width/height of .pin-connector in px
    private readonly PIN_GAP = 13; // Gap between pins from SCSS

    /**
     * Get the actual center position of a pin-connector element relative to the container.
     * This reads directly from the DOM for pixel-perfect accuracy.
     */
    private getPinConnectorCenter(unitId: string, compIndex: number): { x: number; y: number } | null {
        const containerEl = this.container()?.nativeElement;
        if (!containerEl) return null;

        const nodeEl = containerEl.querySelector(`.node[data-unit-id="${unitId}"]`);
        if (!nodeEl) return null;

        const pinEl = nodeEl.querySelector(`.pin[data-comp-index="${compIndex}"] .pin-connector`);
        if (!pinEl) return null;

        const containerRect = containerEl.getBoundingClientRect();
        const pinRect = pinEl.getBoundingClientRect();

        return {
            x: pinRect.left + pinRect.width / 2 - containerRect.left,
            y: pinRect.top + pinRect.height / 2 - containerRect.top
        };
    }

    /**
     * Computed map of all pin positions, recalculated when nodes/zoom/offset change.
     * Key: "unitId:compIndex", Value: { x, y } center position in container coordinates
     */
    protected pinPositions = computed(() => {
        // Dependencies that should trigger recalculation
        this.nodes();
        this.viewOffset();
        this.zoom();
        this.pinPositionTrigger();
        
        const positions = new Map<string, { x: number; y: number }>();
        
        // Need to defer to next frame to ensure DOM is updated
        // For now, calculate based on node positions and measured offsets
        const containerEl = this.container()?.nativeElement;
        if (!containerEl) return positions;

        for (const node of this.nodes()) {
            for (let i = 0; i < node.c3Components.length; i++) {
                const key = `${node.unit.id}:${i}`;
                const center = this.getPinConnectorCenter(node.unit.id, i);
                if (center) {
                    positions.set(key, center);
                }
            }
        }
        
        return positions;
    });

    /**
     * Get pin center position, falling back to calculated position if DOM not ready
     */
    private getPinCenter(node: C3Node, compIndex: number): { x: number; y: number } {
        const key = `${node.unit.id}:${compIndex}`;
        const cached = this.pinPositions().get(key);
        if (cached) return cached;
        
        // Fallback: calculate approximate position from node position
        // This is used before first render or if DOM query fails
        const offset = this.viewOffset();
        const scale = this.zoom();
        const numPins = node.c3Components.length;
        const pinTotalWidth = (numPins - 1) * (this.PIN_CONNECTOR_SIZE + this.PIN_GAP);
        const pinX = -pinTotalWidth / 2 + compIndex * (this.PIN_CONNECTOR_SIZE + this.PIN_GAP);
        
        return {
            x: offset.x + (node.x + pinX) * scale,
            y: offset.y + (node.y + 25) * scale // Approximate Y offset to pin area
        };
    }

    /**
     * Force recalculation of pin positions (call after DOM updates)
     */
    private invalidatePinPositions(): void {
        this.pinPositionTrigger.update(v => v + 1);
    }

    // ==================== Connection Logic ====================

    /** Get valid pins for a target node from pre-computed connection state */
    protected getValidPinsForTarget(targetNode: C3Node): number[] {
        return this.connectionState().validPinsByUnit.get(targetNode.unit.id) || [];
    }

    protected isPinValidTarget(node: C3Node, compIndex: number): boolean {
        const validPins = this.connectionState().validPinsByUnit.get(node.unit.id);
        return validPins?.includes(compIndex) ?? false;
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

        // Bring node to front (z-index layering)
        this.bringNodeToFront(node);

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

    /**
     * Bring a node to the front by giving it the highest z-index
     */
    private bringNodeToFront(node: C3Node): void {
        const newZ = this.maxZIndex() + 1;
        this.maxZIndex.set(newZ);
        node.zIndex = newZ;
        // Trigger re-render by updating nodes signal
        this.nodes.set([...this.nodes()]);
    }

    protected onContainerPointerDown(event: PointerEvent) {
        if ((event.target as HTMLElement).closest('.node')) return;
        
        // Track touch for pinch-to-zoom and pan
        this.activeTouches.set(event.pointerId, event);
        
        // Initialize pan point (either single touch or center of two)
        this.lastPanPoint = this.getEffectivePanPoint();
        
        if (this.activeTouches.size === 2) {
            // Start pinch gesture - store initial distance for zoom calculation
            this.startPinchGesture();
        }
        
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
    }

    /**
     * Get the effective pan point - single touch position or center of two touches
     */
    private getEffectivePanPoint(): { x: number; y: number } {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length === 0) return { x: 0, y: 0 };
        if (touches.length === 1) return { x: touches[0].clientX, y: touches[0].clientY };
        // Two or more touches - use center
        return this.getTouchCenter(touches[0], touches[1]);
    }

    /**
     * Initialize pinch gesture state from current active touches
     */
    private startPinchGesture(): void {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length !== 2) return;
        
        this.pinchStartDistance = this.getTouchDistance(touches[0], touches[1]);
        this.pinchStartZoom = this.zoom();
    }

    /**
     * Calculate distance between two touch points
     */
    private getTouchDistance(t1: PointerEvent, t2: PointerEvent): number {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate center point between two touches
     */
    private getTouchCenter(t1: PointerEvent, t2: PointerEvent): { x: number; y: number } {
        return {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2
        };
    }

    private onGlobalPointerMove = (event: PointerEvent) => {
        // Update tracked touch position
        if (this.activeTouches.has(event.pointerId)) {
            this.activeTouches.set(event.pointerId, event);
        }

        if (this.draggedNode()) {
            const node = this.draggedNode()!;
            const offset = this.viewOffset();
            const scale = this.zoom();
            const drag = this.dragOffset();
            node.x = (event.clientX - drag.x - offset.x) / scale;
            node.y = (event.clientY - drag.y - offset.y) / scale;
            this.nodes.set([...this.nodes()]);
            this.hasModifications.set(true);
            // Recalculate pin positions after node move
            requestAnimationFrame(() => this.invalidatePinPositions());
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
        } else if (this.activeTouches.size > 0 && this.lastPanPoint) {
            // Unified pan handling (works for both single-touch and pinch)
            const currentPanPoint = this.getEffectivePanPoint();
            const panDeltaX = currentPanPoint.x - this.lastPanPoint.x;
            const panDeltaY = currentPanPoint.y - this.lastPanPoint.y;
            
            let newOffsetX = this.viewOffset().x + panDeltaX;
            let newOffsetY = this.viewOffset().y + panDeltaY;
            
            // Handle pinch-to-zoom if two touches are active
            if (this.activeTouches.size === 2) {
                const touches = Array.from(this.activeTouches.values());
                const currentDistance = this.getTouchDistance(touches[0], touches[1]);
                const scale = currentDistance / this.pinchStartDistance;
                const newZoom = Math.max(0.3, Math.min(3, this.pinchStartZoom * scale));
                
                // Adjust offset to zoom towards pinch center
                const oldZoom = this.zoom();
                if (newZoom !== oldZoom) {
                    const el = this.container()?.nativeElement;
                    if (el) {
                        const rect = el.getBoundingClientRect();
                        const centerX = currentPanPoint.x - rect.left;
                        const centerY = currentPanPoint.y - rect.top;
                        const zoomRatio = newZoom / oldZoom;
                        newOffsetX = centerX - (centerX - newOffsetX) * zoomRatio;
                        newOffsetY = centerY - (centerY - newOffsetY) * zoomRatio;
                    }
                }
                this.zoom.set(newZoom);
            }
            
            this.viewOffset.set({ x: newOffsetX, y: newOffsetY });
            this.lastPanPoint = currentPanPoint;
            requestAnimationFrame(() => this.invalidatePinPositions());
        }
    };

    private onGlobalPointerUp = (event: PointerEvent) => {
        // Remove touch from tracking
        this.activeTouches.delete(event.pointerId);
        
        // Update pan point for remaining touches (smooth transition from pinch to single-touch pan)
        if (this.activeTouches.size > 0) {
            this.lastPanPoint = this.getEffectivePanPoint();
            // Re-initialize pinch if still have 2 touches
            if (this.activeTouches.size === 2) {
                this.startPinchGesture();
            }
        }

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
        
        // Clean up when no touches remain
        if (this.activeTouches.size === 0) {
            this.lastPanPoint = null;
            document.removeEventListener('pointermove', this.onGlobalPointerMove);
            document.removeEventListener('pointerup', this.onGlobalPointerUp);
        }
    };

    protected onWheel(event: WheelEvent) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        this.zoom.set(Math.max(0.3, Math.min(3, this.zoom() * delta)));
        // Recalculate pin positions after zoom
        requestAnimationFrame(() => this.invalidatePinPositions());
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
                // Check if reverse connection exists (target is parent of source)
                const reverseExists = this.isChildOfMaster(
                    from.node.unit.id, from.compIndex,
                    targetNode.unit.id, targetPinIndex
                );
                
                if (reverseExists) {
                    // Remove the reverse connection first
                    this.removeChildFromMaster(
                        targetNode.unit.id, targetPinIndex,
                        from.node.unit.id, from.compIndex
                    );
                }
                
                // Now add the new connection
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

    /**
     * Check if a master component is a child of another master's network
     */
    private isChildOfMaster(
        childId: string, childCompIdx: number,
        parentId: string, parentCompIdx: number
    ): boolean {
        const parentNet = C3NetworkUtil.findMasterNetwork(parentId, parentCompIdx, this.networks());
        if (!parentNet?.members) return false;
        
        const childMemberStr = C3NetworkUtil.createMasterMember(childId, childCompIdx);
        return parentNet.members.includes(childMemberStr);
    }

    /**
     * Remove a master child from another master's network
     */
    private removeChildFromMaster(
        parentId: string, parentCompIdx: number,
        childId: string, childCompIdx: number
    ): void {
        const networks = [...this.networks()];
        const parentNet = networks.find(n => 
            n.masterId === parentId && n.masterCompIndex === parentCompIdx
        );
        if (!parentNet?.members) return;

        const childMemberStr = C3NetworkUtil.createMasterMember(childId, childCompIdx);
        parentNet.members = parentNet.members.filter(m => m !== childMemberStr);

        // Remove network if empty
        if (parentNet.members.length === 0) {
            const idx = networks.indexOf(parentNet);
            networks.splice(idx, 1);
        }

        this.networks.set(networks);
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

    protected getNodeClasses(node: C3Node): Record<string, boolean> {
        return this.nodeClassesMap().get(node.unit.id) ?? {};
    }

    protected getNodeStyle(node: C3Node): Record<string, string> {
        return this.nodeStylesMap().get(node.unit.id) ?? {};
    }

    protected getPinNetworkColor(node: C3Node, compIndex: number): string | null {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        return state?.color ?? null;
    }

    protected isPinConnected(node: C3Node, compIndex: number): boolean {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        return state?.connected ?? false;
    }

    /**
     * Check if a pin is disabled due to mutual exclusion (M/S on same unit)
     */
    protected isPinDisabled(node: C3Node, compIndex: number): boolean {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        return state?.disabled ?? false;
    }

    protected getRoleLabel(role: C3Role): string {
        return C3NetworkUtil.getRoleName(role);
    }

    protected getNetworkTypeLabel(type: C3NetworkType): string {
        return C3NetworkUtil.getNetworkTypeName(type);
    }

    protected getNetworkDisplayName(network: SerializedC3NetworkGroup): string {
        return this.networkDisplayNames().get(network.id) || 'Unknown Network';
    }

    protected getSubNetworks(network: SerializedC3NetworkGroup): SerializedC3NetworkGroup[] {
        return this.subNetworksMap().get(network.id) || [];
    }

    protected getNetworkMembersDetailed(network: SerializedC3NetworkGroup) {
        return this.networkMembersMap().get(network.id) || [];
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
