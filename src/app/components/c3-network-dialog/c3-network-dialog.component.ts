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
    DestroyRef,
    ElementRef,
    inject,
    signal,
    viewChild,
    AfterViewInit
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
import { ImageStorageService } from '../../services/image-storage.service';
import { OptionsService } from '../../services/options.service';
import { LayoutService } from '../../services/layout.service';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;

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
    iconUrl: string;
    pinOffsetsX: number[];
}

interface ConnectionLine {
    id: string;
    x1: number; y1: number;
    x2: number; y2: number;
    nodeX1: number; nodeY1: number;
    nodeX2: number; nodeY2: number;
    color: string;
    hasArrow: boolean;
    arrowAngle: number;
    selfConnection: boolean;
}

interface HubPoint {
    id: string;
    nodeX: number; nodeY: number;
    x: number; y: number;
    color: string;
    nodesCount: number;
}

interface BorderSegment {
    id: string;
    color: string;
    dasharray: string;
    dashoffset: number;
}

type SidebarMemberRole = 'master' | 'slave' | 'peer' | 'sub-master';

interface SidebarNetworkVm {
    network: SerializedC3NetworkGroup;
    displayName: string;
    members: SidebarMemberVm[];
    subNetworks: SidebarNetworkVm[];
}

interface SidebarMemberVm {
    id: string;
    name: string;
    role: SidebarMemberRole;
    canRemove: boolean;
    /** True if this entry is a self/internal connection (member unitId equals the network's masterId). */
    isSelfConnection?: boolean;
    memberStr?: string;
    node: C3Node | null;
    /** Present for members that are masters (including sub-masters). */
    network?: SerializedC3NetworkGroup;
    /** Present for sub-masters with children, used for nested rendering. */
    networkVm?: SidebarNetworkVm;
}

interface Vec2 {
    x: number;
    y: number;
}

@Component({
    selector: 'c3-network-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgTemplateOutlet],
    host: { class: 'fullscreen-dialog-host' },
    templateUrl: './c3-network-dialog.component.html',
    styleUrls: ['./c3-network-dialog.component.scss']
})
export class C3NetworkDialogComponent implements AfterViewInit {
    private dialogRef = inject(DialogRef<C3NetworkDialogResult>);
    protected data = inject<C3NetworkDialogData>(DIALOG_DATA);
    private toastService = inject(ToastService);
    private imageService = inject(ImageStorageService);
    private destroyRef = inject(DestroyRef);
    private optionsService = inject(OptionsService);
    protected layoutService = inject(LayoutService);
    private svgCanvas = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');

    // Fallback icon for units without icons
    protected readonly FALLBACK_ICON = '/images/unknown.png';

    // Node layout constants (exposed for template)
    protected readonly NODE_RADIUS = 170;
    protected readonly PIN_RADIUS = 13;
    protected readonly PIN_GAP = 40; // Gap between pin centers
    protected readonly PIN_Y_OFFSET = 18; // Y offset from node center to pins

    // Hex node geometry (flat-top hex)
    protected readonly NODE_HEX_POINTS = C3NetworkDialogComponent.toSvgPoints(
        C3NetworkDialogComponent.getHexRelativeVertices(this.NODE_RADIUS / 2)
    );
    protected readonly NODE_HEX_INNER_POINTS = C3NetworkDialogComponent.toSvgPoints(
        C3NetworkDialogComponent.getHexRelativeVertices(this.NODE_RADIUS / 2 - 8)
    );
    protected readonly NODE_HEX_GLOW_POINTS = C3NetworkDialogComponent.toSvgPoints(
        C3NetworkDialogComponent.getHexRelativeVertices(this.NODE_RADIUS / 2 + 4)
    );

    // State
    protected nodes = signal<C3Node[]>([]);
    protected networks = signal<SerializedC3NetworkGroup[]>([]);
    protected hasModifications = signal(false);
    protected sidebarOpen = signal(false);
    protected sidebarAnimated = signal(false);
    protected connectionsAboveNodes = computed(() => this.optionsService.options().c3NetworkConnectionsAboveNodes);

    /** Fast lookup to avoid repeated linear searches during computed layout. */
    protected nodesById = computed(() => {
        const map = new Map<string, C3Node>();
        for (const node of this.nodes()) {
            map.set(node.unit.id, node);
        }
        return map;
    });

    /**
     * SVG layering is controlled by DOM order (not CSS z-index), so we render nodes
     * sorted by zIndex to ensure bringNodeToFront() actually brings the node above.
     */
    protected sortedNodes = computed(() => {
        return [...this.nodes()].sort((a, b) => a.zIndex - b.zIndex);
    });

    // Drag state
    protected draggedNode = signal<C3Node | null>(null);
    private dragStartPos = { x: 0, y: 0 };
    private nodeStartPos = { x: 0, y: 0 };

    // Connection drawing state
    protected connectingFrom = signal<{ node: C3Node; compIndex: number; role: C3Role } | null>(null);
    protected connectingEnd = signal({ x: 0, y: 0 });
    protected hoveredNode = signal<C3Node | null>(null);
    protected hoveredPinIndex = signal<number | null>(null);

    // Pan/zoom state - now using SVG viewBox/transform approach
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);

    // Unified pan tracking (works for both single-touch and pinch gestures)
    private lastPanPoint: { x: number; y: number } | null = null;

    // Pointermove throttling (reduces jank on iOS)
    private pendingMoveEvent: PointerEvent | null = null;
    private moveRafId: number | null = null;
    private hasGlobalPointerListeners = false;

    // Pinch zoom state
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private activeTouches = new Map<number, PointerEvent>();

    // Color tracking
    private nextColorIndex = 0;
    private masterPinColors = new Map<string, string>();

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.cleanupGlobalPointerState();
        });
    }

    private addGlobalPointerListeners(): void {
        if (this.hasGlobalPointerListeners) return;
        document.addEventListener('pointermove', this.onGlobalPointerMove);
        document.addEventListener('pointerup', this.onGlobalPointerUp);
        this.hasGlobalPointerListeners = true;
    }

    private cleanupGlobalPointerState(): void {
        if (this.moveRafId !== null) {
            cancelAnimationFrame(this.moveRafId);
            this.moveRafId = null;
        }
        this.pendingMoveEvent = null;
        this.activeTouches.clear();
        this.lastPanPoint = null;
        this.draggedNode.set(null);
        this.connectingFrom.set(null);
        this.hoveredNode.set(null);
        this.hoveredPinIndex.set(null);

        if (this.hasGlobalPointerListeners) {
            document.removeEventListener('pointermove', this.onGlobalPointerMove);
            document.removeEventListener('pointerup', this.onGlobalPointerUp);
            this.hasGlobalPointerListeners = false;
        }
    }

    private setPointerCaptureIfAvailable(event: PointerEvent): void {
        const el = event.currentTarget as Element | null;
        try {
            (el as unknown as { setPointerCapture?: (pointerId: number) => void })?.setPointerCapture?.(
                event.pointerId
            );
        } catch {
            // best-effort; ignore
        }
    }

    private updateNodes(mutator: (nodes: C3Node[]) => void): void {
        const nodes = this.nodes();
        mutator(nodes);
        this.nodes.set([...nodes]);
    }

    protected unitDisplayName = computed(() => this.optionsService.options().unitDisplayName);

    /** SVG transform string computed from pan/zoom state */
    protected svgTransform = computed(() => {
        const offset = this.viewOffset();
        const scale = this.zoom();
        return `translate(${offset.x}, ${offset.y}) scale(${scale})`;
    });

    /**
     * Comprehensive connection state computed once when drag starts.
     * Contains all valid target units and their valid pins.
     * Also includes pins that are already connected (for drag-to-disconnect).
     */
    protected connectionState = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) {
            return {
                isConnecting: false,
                validTargetIds: new Set<string>(),
                validPinsByUnit: new Map<string, number[]>(),
                alreadyConnectedPins: new Map<string, number[]>()
            };
        }
        
        const sourceComp = conn.node.c3Components[conn.compIndex];
        const validTargetIds = new Set<string>();
        const validPinsByUnit = new Map<string, number[]>();
        const alreadyConnectedPins = new Map<string, number[]>();
        const networks = this.networks();
        
        for (const node of this.nodes()) {
            const validPins: number[] = [];
            const connectedPins: number[] = [];
            
            for (let i = 0; i < node.c3Components.length; i++) {
                const targetComp = node.c3Components[i];
                if (!C3NetworkUtil.areComponentsCompatible(sourceComp, targetComp)) continue;

                // Check if already connected (for drag-to-disconnect)
                const existingConnection = this.findConnectionBetweenPins(
                    conn.node.unit.id, conn.compIndex, sourceComp.role,
                    node.unit.id, i, targetComp.role
                );
                if (existingConnection) {
                    connectedPins.push(i);
                    validPins.push(i); // Already-connected pins are valid targets for disconnection
                    continue;
                }

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
            if (connectedPins.length > 0) {
                alreadyConnectedPins.set(node.unit.id, connectedPins);
            }
        }
        
        return {
            isConnecting: true,
            validTargetIds,
            validPinsByUnit,
            alreadyConnectedPins
        };
    });

    // Convenience accessor for valid target IDs
    protected validTargets = computed(() => this.connectionState().validTargetIds);

    // Connection lines - now in SVG world coordinates (before transform)
    protected connectionLines = computed<ConnectionLine[]>(() => {
        const lines: ConnectionLine[] = [];
        const nodesById = this.nodesById();
        const networks = this.networks();

        for (const network of networks) {
            if (network.peerIds && network.peerIds.length > 1) {
                // Peer network - lines from hub to each peer
                const peerNodes = network.peerIds
                    .map(id => nodesById.get(id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        return this.getPinWorldPosition(node, Math.max(0, compIdx));
                    });
                    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
                    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;

                    const nodeCx = peerNodes.reduce((s, n) => s + n.x, 0) / peerNodes.length;
                    const nodeCy = peerNodes.reduce((s, n) => s + n.y, 0) / peerNodes.length;

                    positions.forEach((p, idx) => {
                        const peerNode = peerNodes[idx];
                        lines.push({
                            id: `${network.id}-peer-${idx}`,
                            x1: cx, y1: cy, x2: p.x, y2: p.y,
                            nodeX1: nodeCx, nodeY1: nodeCy,
                            nodeX2: peerNode.x, nodeY2: peerNode.y,
                            color: network.color,
                            hasArrow: false,
                            arrowAngle: 0,
                            selfConnection: false
                        });
                    });
                }
            } else if (network.masterId) {
                // Master network - draw lines to members
                const masterNode = nodesById.get(network.masterId);
                if (!masterNode) continue;

                const compIdx = network.masterCompIndex ?? 0;
                const masterPos = this.getPinWorldPosition(masterNode, compIdx);

                for (const member of network.members || []) {
                    const parsed = C3NetworkUtil.parseMember(member);
                    const memberNode = nodesById.get(parsed.unitId);
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

                    const memberPos = this.getPinWorldPosition(memberNode, memberCompIdx);
                    const angle = Math.atan2(memberPos.y - masterPos.y, memberPos.x - masterPos.x);

                    const isSelfConnection = parsed.unitId === network.masterId;

                    // Shorten the line so it ends before the arrow marker (refX=10 in marker)
                    // Arrow marker is 12px wide, refX=10 means arrow tip is 2px past the line end
                    // We want the line to stop before the pin, leaving room for the arrow
                    const arrowMarkerRefX = 10;
                    const shortenBy = this.PIN_RADIUS + arrowMarkerRefX;

                    lines.push({
                        id: `${network.id}-member-${member}`,
                        x1: masterPos.x, 
                        y1: masterPos.y, 
                        x2: memberPos.x - Math.cos(angle) * shortenBy, 
                        y2: memberPos.y - Math.sin(angle) * shortenBy,
                        nodeX1: masterNode.x, 
                        nodeY1: masterNode.y,
                        nodeX2: memberNode.x - Math.cos(angle) * arrowMarkerRefX, 
                        nodeY2: memberNode.y - Math.sin(angle) * arrowMarkerRefX,
                        color: network.color,
                        hasArrow: true,
                        arrowAngle: angle,
                        selfConnection: isSelfConnection
                    });
                }
            }
        }
        return lines;
    });

    // Hub points for peer networks - in SVG world coordinates
    protected hubPoints = computed<HubPoint[]>(() => {
        const hubs: HubPoint[] = [];
        const nodesById = this.nodesById();

        for (const network of this.networks()) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds
                    .map(id => nodesById.get(id))
                    .filter((n): n is C3Node => !!n);

                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = node.c3Components.findIndex(c => c.role === C3Role.PEER);
                        return this.getPinWorldPosition(node, Math.max(0, compIdx));
                    });

                    const nodeX = peerNodes.reduce((s, n) => s + n.x, 0) / peerNodes.length;
                    const nodeY = peerNodes.reduce((s, n) => s + n.y, 0) / peerNodes.length;

                    hubs.push({
                        id: `hub-${network.id}`,
                        nodeX,
                        nodeY,
                        x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
                        y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
                        color: network.color,
                        nodesCount: peerNodes.length
                    });
                }
            }
        }
        return hubs;
    });

    // Active drag line - in SVG world coordinates
    protected activeDragLine = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return null;
        const pinPos = this.getPinWorldPosition(conn.node, conn.compIndex);
        return {
            x1: pinPos.x,
            y1: pinPos.y,
            x2: this.connectingEnd().x,
            y2: this.connectingEnd().y
        };
    });

    // ==================== Cached Sidebar Data ====================

    /** View-model for the Networks sidebar (single computed source of truth). */
    protected sidebarNetworks = computed<SidebarNetworkVm[]>(() => {
        const networks = this.networks();
        const nodesById = this.nodesById();
        const topLevel = C3NetworkUtil.getTopLevelNetworks(networks);

        const visited = new Set<string>();

        const buildNetworkVm = (network: SerializedC3NetworkGroup): SidebarNetworkVm | null => {
            if (visited.has(network.id)) return null;
            visited.add(network.id);

            const members: SidebarMemberVm[] = [];
            const subNetworks: SidebarNetworkVm[] = [];

            if (network.peerIds) {
                for (const id of network.peerIds) {
                    const node = nodesById.get(id) ?? null;
                    members.push({
                        id,
                        name: node?.unit.getUnit().chassis || 'Unknown',
                        role: 'peer',
                        canRemove: true,
                        node
                    });
                }
            } else if (network.masterId) {
                const masterNode = nodesById.get(network.masterId) ?? null;
                members.push({
                    id: network.masterId,
                    name: masterNode?.unit.getUnit().chassis || 'Unknown',
                    role: 'master',
                    canRemove: false,
                    node: masterNode,
                    network
                });

                for (const memberStr of network.members || []) {
                    const parsed = C3NetworkUtil.parseMember(memberStr);
                    const node = nodesById.get(parsed.unitId) ?? null;
                    const isSelfConnection = parsed.unitId === network.masterId;

                    // A member with a compIndex is a master component attached to this network.
                    // We treat it as a sub-master only if that master has children of its own.
                    if (parsed.compIndex !== undefined) {
                        const childNet = C3NetworkUtil.findMasterNetwork(parsed.unitId, parsed.compIndex, networks);
                        const hasChildren = !!(childNet?.members && childNet.members.length > 0);

                        if (childNet && hasChildren) {
                            const childVm = buildNetworkVm(childNet);
                            const vm = {
                                id: parsed.unitId,
                                name: node?.unit.getUnit().chassis || 'Unknown',
                                role: 'sub-master' as const,
                                canRemove: true,
                                isSelfConnection,
                                memberStr,
                                node,
                                network: childNet,
                                networkVm: childVm ?? undefined
                            };
                            members.push(vm);
                            if (childVm) {
                                subNetworks.push(childVm);
                            }
                            continue;
                        }
                    }

                    members.push({
                        id: parsed.unitId,
                        name: node?.unit.getUnit().chassis || 'Unknown',
                        role: 'slave',
                        canRemove: true,
                        isSelfConnection,
                        memberStr,
                        node
                    });
                }
            }

            // Display name
            let displayName = 'Unknown Network';
            if (network.peerIds) {
                displayName = `${C3NetworkUtil.getNetworkTypeName(network.type as C3NetworkType)} (${network.peerIds.length} peers)`;
            } else if (network.masterId) {
                const countNonSelfMembers = (net: SerializedC3NetworkGroup): number => {
                    if (!net.masterId) return net.members?.length ?? 0;
                    return (net.members ?? []).reduce((count, member) => {
                        const parsed = C3NetworkUtil.parseMember(member);
                        return parsed.unitId === net.masterId ? count : count + 1;
                    }, 0);
                };

                // Include the master itself, but exclude any "self-connection" members.
                const memberCount = countNonSelfMembers(network) + 1;
                const subNetMemberCount = subNetworks.reduce((sum, child) => sum + countNonSelfMembers(child.network), 0);
                const memberStr = (memberCount + subNetMemberCount) > 1 ? 'members' : 'member';
                const networkTypeName = C3NetworkUtil.getNetworkTypeName(network.type as C3NetworkType);
                displayName = `${networkTypeName} (${memberCount + subNetMemberCount} ${memberStr})`;
            }

            return {
                network,
                displayName,
                members,
                subNetworks
            };
        };

        return topLevel
            .map(net => buildNetworkVm(net))
            .filter((vm): vm is SidebarNetworkVm => vm !== null);
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

    /**
     * Precomputed stroke segments for nodes in multiple networks.
     * Each segment is rendered as its own dashed circle: one visible arc + one long gap.
     */
    protected nodeBorderSegments = computed(() => {
        const map = new Map<string, BorderSegment[]>();
        const colorsByNode = this.nodeBorderColors();

        const radius = this.NODE_RADIUS / 2;
        // For a regular hexagon with circumradius R, side length is R and perimeter is 6R.
        const perimeter = 6 * radius;

        for (const node of this.nodes()) {
            const colors = colorsByNode.get(node.unit.id) || [];
            if (colors.length <= 1) {
                map.set(node.unit.id, []);
                continue;
            }

            const segmentLen = perimeter / colors.length;
            const gapLen = perimeter - segmentLen;
            const dasharray = `${segmentLen} ${gapLen}`;

            map.set(
                node.unit.id,
                colors.map((color, index) => ({
                    id: `${node.unit.id}-seg-${index}`,
                    color,
                    dasharray,
                    dashoffset: -segmentLen * index
                }))
            );
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

    ngAfterViewInit() {
        this.initializeNodes();
        this.resolveAllNodeCollisions();
        this.networks.set([...(this.data.networks || [])]);
        this.initializeMasterPinColors();
        this.fitViewToNodes();
    }

    /**
     * Resolve any initial overlaps after nodes are first laid out.
     * Uses multiple passes to handle cascaded collisions.
     */
    private resolveAllNodeCollisions(): void {
        const nodes = this.nodes();
        if (nodes.length < 2) return;

        const maxPasses = 10;
        let changed = false;

        for (let pass = 0; pass < maxPasses; pass++) {
            let passChanged = false;
            for (const node of nodes) {
                if (this.resolveNodeCollisions(node)) {
                    passChanged = true;
                }
            }

            changed ||= passChanged;
            if (!passChanged) break;
        }

        if (changed) {
            // Force recomputation of computed geometry that depends on node positions.
            this.nodes.set([...nodes]);
            this.hasModifications.set(true);
        }
    }

    private initializeNodes() {
        const c3Units = this.data.units.filter(u => C3NetworkUtil.hasC3(u.getUnit()));
        if (c3Units.length === 0) return;

        const el = this.svgCanvas()?.nativeElement;
        const canvasW = el?.clientWidth || 800;
        const canvasH = el?.clientHeight || 600;
        const spacing = 180;

        // Calculate optimal grid dimensions based on canvas aspect ratio
        const aspectRatio = canvasW / canvasH;
        const totalNodes = c3Units.length;
        
        // Find cols/rows that best match aspect ratio
        // cols/rows ≈ aspectRatio, and cols * rows >= totalNodes
        let bestCols = 1;
        let bestRows = totalNodes;
        let bestRatioDiff = Infinity;
        
        for (let cols = 1; cols <= totalNodes; cols++) {
            const rows = Math.ceil(totalNodes / cols);
            const gridRatio = cols / rows;
            const ratioDiff = Math.abs(gridRatio - aspectRatio);
            if (ratioDiff < bestRatioDiff) {
                bestRatioDiff = ratioDiff;
                bestCols = cols;
                bestRows = rows;
            }
        }

        const cols = bestCols;
        const startX = spacing; // Start with some margin
        const startY = spacing;

        this.nodes.set(c3Units.map((unit, idx) => {
            const pos = unit.c3Position();
            const iconPath = unit.getUnit().icon;
            const comps = C3NetworkUtil.getC3Components(unit.getUnit());
            const numPins = Math.max(1, comps.length);
            const totalWidth = (numPins - 1) * this.PIN_GAP;
            const pinOffsetsX = Array.from({ length: numPins }, (_, i) => -totalWidth / 2 + i * this.PIN_GAP);
            return {
                unit,
                c3Components: comps,
                x: pos?.x ?? startX + (idx % cols) * spacing,
                y: pos?.y ?? startY + Math.floor(idx / cols) * spacing,
                zIndex: idx,
                iconUrl: iconPath ? (this.imageService.getCachedUrl(iconPath) || this.FALLBACK_ICON) : this.FALLBACK_ICON,
                pinOffsetsX
            };
        }));

        // Load icon URLs asynchronously for any that weren't cached
        this.loadMissingIconUrls(c3Units);
    }

    /**
     * Auto-adjust zoom and pan to fit all nodes within the visible canvas.
     */
    private fitViewToNodes(): void {
        const nodes = this.nodes();
        if (nodes.length === 0) return;

        const el = this.svgCanvas()?.nativeElement;
        if (!el) return;

        const canvasW = el.clientWidth;
        const canvasH = el.clientHeight;
        const padding = 20; // Padding around the content

        // Calculate bounding box of all nodes
        const nodeRadius = this.NODE_RADIUS / 2;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of nodes) {
            minX = Math.min(minX, node.x - nodeRadius);
            minY = Math.min(minY, node.y - nodeRadius);
            maxX = Math.max(maxX, node.x + nodeRadius);
            maxY = Math.max(maxY, node.y + nodeRadius + 60); // Extra for pin labels
        }

        const contentW = maxX - minX;
        const contentH = maxY - minY;

        // Calculate zoom to fit content with padding
        const availableW = canvasW - padding * 2;
        const availableH = canvasH - padding * 2;
        const scaleX = availableW / contentW;
        const scaleY = availableH / contentH;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM / 2, Math.min(scaleX, scaleY)));
        
        // Calculate offset to center the content
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = canvasW / 2 - centerX * newZoom;
        const offsetY = canvasH / 2 - centerY * newZoom;

        this.zoom.set(newZoom);
        this.viewOffset.set({ x: offsetX, y: offsetY });
    }

    private async loadMissingIconUrls(units: ForceUnit[]) {
        const nodes = this.nodes();
        const nodesById = new Map<string, C3Node>();
        for (const node of nodes) {
            nodesById.set(node.unit.id, node);
        }
        let updated = false;
        
        for (const unit of units) {
            const node = nodesById.get(unit.id);
            if (!node || node.iconUrl !== this.FALLBACK_ICON) continue;
            
            const iconPath = unit.getUnit().icon;
            if (!iconPath) continue;
            
            try {
                const url = await this.imageService.getImage(iconPath);
                if (url && url !== this.FALLBACK_ICON) {
                    node.iconUrl = url;
                    updated = true;
                }
            } catch {
                // Keep fallback
            }
        }
        
        if (updated) {
            this.nodes.set([...nodes]);
        }
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
        const usedColors = new Set(this.networks().map(n => n.color));
        
        // Try to find an unused color first
        for (let i = 0; i < C3_NETWORK_COLORS.length; i++) {
            const color = C3_NETWORK_COLORS[(this.nextColorIndex + i) % C3_NETWORK_COLORS.length];
            if (!usedColors.has(color)) {
                this.nextColorIndex = (this.nextColorIndex + i + 1) % C3_NETWORK_COLORS.length;
                return color;
            }
        }
        
        // All colors are used, just cycle through
        return C3_NETWORK_COLORS[this.nextColorIndex++ % C3_NETWORK_COLORS.length];
    }

    private generateNetworkId(): string {
        return `net_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ==================== SVG Coordinate Helpers ====================

    /**
     * Get pin position in SVG world coordinates (before any transforms).
     * This is used for drawing connection lines.
     */
    private getPinWorldPosition(node: C3Node, compIndex: number): { x: number; y: number } {
        return {
            x: node.x + (node.pinOffsetsX[compIndex] ?? 0),
            y: node.y + this.PIN_Y_OFFSET
        };
    }

    /**
     * Convert screen coordinates to SVG world coordinates.
     * Accounts for pan offset and zoom scale.
     */
    private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
        const svg = this.svgCanvas()?.nativeElement;
        if (!svg) return { x: screenX, y: screenY };
        
        const rect = svg.getBoundingClientRect();
        const offset = this.viewOffset();
        const scale = this.zoom();
        
        return {
            x: (screenX - rect.left - offset.x) / scale,
            y: (screenY - rect.top - offset.y) / scale
        };
    }

    /**
     * Resolve collisions between the dragged node and other nodes.
     * Pushes colliding nodes away from the dragged node, cascading to other nodes.
     */
    private resolveNodeCollisions(draggedNode: C3Node): boolean {
        const nodes = this.nodes();
        const padding = 12; // Minimum gap between nodes
        const maxIterations = 20; // Prevent infinite loops

        let hadCollision = false;

        // Expand collision hex slightly to preserve a visible gap
        const collisionRadius = this.NODE_RADIUS / 2 + padding / 2;
        
        // Use a queue for cascade collision resolution
        const nodesToCheck = new Set<C3Node>([draggedNode]);
        const checkedPairs = new Set<string>();
        let iterations = 0;
        
        while (nodesToCheck.size > 0 && iterations < maxIterations) {
            iterations++;
            const currentNode = nodesToCheck.values().next().value as C3Node;
            nodesToCheck.delete(currentNode);
            
            for (const other of nodes) {
                if (other === currentNode) continue;
                
                // Create a unique pair key to avoid checking the same pair twice
                const pairKey = [currentNode.unit.id, other.unit.id].sort().join('-');
                if (checkedPairs.has(pairKey)) continue;
                checkedPairs.add(pairKey);
                
                const dx = other.x - currentNode.x;
                const dy = other.y - currentNode.y;

                const mtv = this.getHexOverlapMtv(currentNode, other, collisionRadius);
                if (!mtv) continue;

                // Ensure MTV pushes "other" away from current.
                const dot = mtv.x * dx + mtv.y * dy;
                const push = dot >= 0 ? mtv : { x: -mtv.x, y: -mtv.y };

                other.x += push.x;
                other.y += push.y;

                hadCollision = true;

                nodesToCheck.add(other);
            }
        }

        return hadCollision;
    }

    // ==================== Hex Geometry / Collision ====================

    private static getHexRelativeVertices(radius: number): Vec2[] {
        // Flat-top hex: vertices at angles 0, 60, 120, 180, 240, 300 degrees.
        const verts: Vec2[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            verts.push({
                x: radius * Math.cos(angle),
                y: radius * Math.sin(angle)
            });
        }
        return verts;
    }

    private static toSvgPoints(verts: Vec2[]): string {
        return verts.map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ');
    }

    private getHexWorldVertices(node: C3Node, radius: number): Vec2[] {
        const rel = C3NetworkDialogComponent.getHexRelativeVertices(radius);
        return rel.map(v => ({ x: node.x + v.x, y: node.y + v.y }));
    }

    private static normalize(v: Vec2): Vec2 {
        const len = Math.hypot(v.x, v.y);
        if (len === 0) return { x: 1, y: 0 };
        return { x: v.x / len, y: v.y / len };
    }

    private static dot(a: Vec2, b: Vec2): number {
        return a.x * b.x + a.y * b.y;
    }

    private static getAxes(verts: Vec2[]): Vec2[] {
        const axes: Vec2[] = [];
        for (let i = 0; i < verts.length; i++) {
            const p1 = verts[i];
            const p2 = verts[(i + 1) % verts.length];
            const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
            // Perpendicular axis
            const axis = C3NetworkDialogComponent.normalize({ x: -edge.y, y: edge.x });
            axes.push(axis);
        }
        return axes;
    }

    private static project(verts: Vec2[], axis: Vec2): { min: number; max: number } {
        let min = Infinity;
        let max = -Infinity;
        for (const v of verts) {
            const p = C3NetworkDialogComponent.dot(v, axis);
            if (p < min) min = p;
            if (p > max) max = p;
        }
        return { min, max };
    }

    /**
     * Returns the minimum-translation vector (MTV) to separate `b` from `a`.
     * If no overlap, returns null.
     */
    private getHexOverlapMtv(a: C3Node, b: C3Node, radius: number): Vec2 | null {
        const aVerts = this.getHexWorldVertices(a, radius);
        const bVerts = this.getHexWorldVertices(b, radius);

        const axes = [
            ...C3NetworkDialogComponent.getAxes(aVerts),
            ...C3NetworkDialogComponent.getAxes(bVerts)
        ];

        let smallestOverlap = Infinity;
        let smallestAxis: Vec2 | null = null;

        for (const axis of axes) {
            const p1 = C3NetworkDialogComponent.project(aVerts, axis);
            const p2 = C3NetworkDialogComponent.project(bVerts, axis);
            const overlap = Math.min(p1.max, p2.max) - Math.max(p1.min, p2.min);
            if (overlap <= 0) return null;
            if (overlap < smallestOverlap) {
                smallestOverlap = overlap;
                smallestAxis = axis;
            }
        }

        if (!smallestAxis || !Number.isFinite(smallestOverlap)) return null;

        // MTV = axis * overlap
        return {
            x: smallestAxis.x * smallestOverlap,
            y: smallestAxis.y * smallestOverlap
        };
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

    /** Check if a pin is already connected to the source (would disconnect on drop) */
    protected isAlreadyConnectedPin(node: C3Node, compIndex: number): boolean {
        const connectedPins = this.connectionState().alreadyConnectedPins.get(node.unit.id);
        return connectedPins?.includes(compIndex) ?? false;
    }

    /** Check if a node contains any pins that are already connected (disconnect target) */
    protected isNodeDisconnectTarget(node: C3Node): boolean {
        const connectedPins = this.connectionState().alreadyConnectedPins.get(node.unit.id);
        return (connectedPins?.length ?? 0) > 0;
    }

    // ==================== Event Handlers ====================

    protected onPinPointerDown(event: PointerEvent, node: C3Node, compIndex: number) {
        event.preventDefault();
        event.stopPropagation();

        this.setPointerCaptureIfAvailable(event);

        const comp = node.c3Components[compIndex];
        if (!comp) return;

        // Track touch for potential pinch-zoom transition
        this.activeTouches.set(event.pointerId, event);

        this.connectingFrom.set({ node, compIndex, role: comp.role });
        // Set initial connecting end in world coordinates
        const worldPos = this.screenToWorld(event.clientX, event.clientY);
        this.connectingEnd.set(worldPos);

        this.addGlobalPointerListeners();
    }

    /**
     * Removes the existing link for a pin (if any).
     * This is used to support "redrawing" an existing link by dragging from it.
     */
    private cancelExistingConnectionForPin(node: C3Node, compIndex: number): void {
        if (this.data.readOnly) return;

        const comp = node.c3Components[compIndex];
        if (!comp) return;

        const unitId = node.unit.id;
        const networks = this.networks();

        // Slave pins are stored as plain unitId members on a master network.
        if (comp.role === C3Role.SLAVE) {
            const net = networks.find(n => n.members?.includes(unitId));
            if (net) {
                this.removeMemberFromNetwork(net.id, unitId);
            }
            return;
        }

        // Master pins can be connected as a child (sub-master) via "unitId:compIndex".
        if (comp.role === C3Role.MASTER) {
            const memberStr = C3NetworkUtil.createMasterMember(unitId, compIndex);
            const net = networks.find(n => n.members?.includes(memberStr));
            if (net) {
                this.removeMemberFromNetwork(net.id, memberStr);
            }
            return;
        }

        // Peer pins participate via peerIds.
        if (comp.role === C3Role.PEER) {
            const net = C3NetworkUtil.findPeerNetwork(unitId, networks);
            if (!net) return;

            const updated = [...networks];
            const target = updated.find(n => n.id === net.id);
            if (!target?.peerIds) return;

            target.peerIds = target.peerIds.filter(id => id !== unitId);
            // Peer networks are only meaningful with 2+ peers.
            if (target.peerIds.length < 2) {
                const idx = updated.indexOf(target);
                if (idx >= 0) updated.splice(idx, 1);
            }

            this.networks.set(updated);
            this.hasModifications.set(true);
        }
    }

    /**
     * Checks if two pins are already connected to each other.
     * Returns the connection info if found, null otherwise.
     */
    private findConnectionBetweenPins(
        sourceUnitId: string, sourceCompIndex: number, sourceRole: C3Role,
        targetUnitId: string, targetCompIndex: number, targetRole: C3Role
    ): { networkId: string; memberStr?: string } | null {
        const networks = this.networks();

        // Master -> Slave connection
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.SLAVE) {
            const net = C3NetworkUtil.findMasterNetwork(sourceUnitId, sourceCompIndex, networks);
            if (net?.members?.includes(targetUnitId)) {
                return { networkId: net.id, memberStr: targetUnitId };
            }
        }

        // Slave -> Master connection (reverse check)
        if (sourceRole === C3Role.SLAVE && targetRole === C3Role.MASTER) {
            const net = C3NetworkUtil.findMasterNetwork(targetUnitId, targetCompIndex, networks);
            if (net?.members?.includes(sourceUnitId)) {
                return { networkId: net.id, memberStr: sourceUnitId };
            }
        }

        // Master -> Master connection (sub-master)
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.MASTER) {
            const memberStr = C3NetworkUtil.createMasterMember(targetUnitId, targetCompIndex);
            const net = C3NetworkUtil.findMasterNetwork(sourceUnitId, sourceCompIndex, networks);
            if (net?.members?.includes(memberStr)) {
                return { networkId: net.id, memberStr };
            }
            // Also check reverse (target is parent of source)
            const reverseMemberStr = C3NetworkUtil.createMasterMember(sourceUnitId, sourceCompIndex);
            const reverseNet = C3NetworkUtil.findMasterNetwork(targetUnitId, targetCompIndex, networks);
            if (reverseNet?.members?.includes(reverseMemberStr)) {
                return { networkId: reverseNet.id, memberStr: reverseMemberStr };
            }
        }

        // Peer -> Peer connection
        if (sourceRole === C3Role.PEER && targetRole === C3Role.PEER) {
            // we ignore ourselves from the peer network
            if (sourceUnitId === targetUnitId) return null;
            const net = C3NetworkUtil.findPeerNetwork(sourceUnitId, networks);
            if (net?.peerIds?.includes(targetUnitId)) {
                return { networkId: net.id };
            }
        }

        return null;
    }

    /**
     * Right-click handler for pins to cancel existing connections.
     */
    protected onPinContextMenu(event: MouseEvent, node: C3Node, compIndex: number): void {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        this.cancelExistingConnectionForPin(node, compIndex);
    }

    protected onNodePointerDown(event: PointerEvent, node: C3Node) {
        event.preventDefault();
        event.stopPropagation();

        this.setPointerCaptureIfAvailable(event);
        
        // Check if clicking on a pin
        const target = event.target as Element;
        if (target.closest('.pin')) return;

        // Track touch for potential pinch-zoom transition
        this.activeTouches.set(event.pointerId, event);

        // Bring node to front (z-index layering)
        this.bringNodeToFront(node);

        // Store starting positions for drag
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        this.nodeStartPos = { x: node.x, y: node.y };
        this.draggedNode.set(node);

        this.addGlobalPointerListeners();
    }

    /**
     * Bring a node to the front by reordering z-indexes.
     * Normalizes all z-indexes to stay within a compact range.
     */
    private bringNodeToFront(node: C3Node): void {
        this.updateNodes(nodes => {
            const currentZ = node.zIndex;

            // Shift down all nodes that were above this one
            for (const n of nodes) {
                if (n.zIndex > currentZ) {
                    n.zIndex--;
                }
            }

            // Put this node at the top
            const target = nodes.find(n => n.unit.id === node.unit.id);
            if (target) {
                target.zIndex = nodes.length - 1;
            }
        });
    }

    protected onCanvasPointerDown(event: PointerEvent) {
        const target = event.target as Element;
        if (target.closest('.node-group')) return;

        this.setPointerCaptureIfAvailable(event);
        
        // Track touch for pinch-to-zoom and pan
        this.activeTouches.set(event.pointerId, event);
        
        // Initialize pan point (either single touch or center of two)
        this.lastPanPoint = this.getEffectivePanPoint();
        
        if (this.activeTouches.size === 2) {
            // Start pinch gesture - store initial distance for zoom calculation
            this.startPinchGesture();
        }

        this.addGlobalPointerListeners();
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
        // Always keep touch tracking up-to-date immediately (required for pinch correctness).
        this.activeTouches.set(event.pointerId, event);

        // If we now have 2+ touches, cancel any drag/connection and switch to pinch-zoom immediately.
        if (this.activeTouches.size >= 2 && (this.draggedNode() || this.connectingFrom())) {
            this.draggedNode.set(null);
            this.connectingFrom.set(null);
            this.hoveredNode.set(null);
            this.hoveredPinIndex.set(null);
            this.startPinchGesture();
            this.lastPanPoint = this.getEffectivePanPoint();
        }

        // Throttle heavier processing to one run per animation frame.
        this.pendingMoveEvent = event;
        if (this.moveRafId !== null) return;

        this.moveRafId = requestAnimationFrame(() => {
            this.moveRafId = null;
            const e = this.pendingMoveEvent;
            if (!e) return;
            this.processPointerMove(e);
        });
    };

    private processPointerMove(event: PointerEvent): void {
        const dragged = this.draggedNode()!;
        if (dragged) {
            // Drag node - calculate new position in world coordinates
            const scale = this.zoom();
            const deltaX = (event.clientX - this.dragStartPos.x) / scale;
            const deltaY = (event.clientY - this.dragStartPos.y) / scale;

            this.updateNodes(nodes => {
                const node = nodes.find(n => n.unit.id === dragged.unit.id);
                if (!node) return;

                node.x = this.nodeStartPos.x + deltaX;
                node.y = this.nodeStartPos.y + deltaY;
            });

            this.hasModifications.set(true);
            return;
        }

        if (this.connectingFrom()) {
            // Update connecting line end in world coordinates
            const worldPos = this.screenToWorld(event.clientX, event.clientY);
            this.connectingEnd.set(worldPos);

            // Update hover state
            const target = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = target?.closest('.node-group');
            const pinEl = target?.closest('.pin');

            if (!nodeEl) {
                this.hoveredNode.set(null);
                this.hoveredPinIndex.set(null);
                return;
            }

            const unitId = nodeEl.getAttribute('data-unit-id') || '';
            const targetNode = this.nodesById().get(unitId);
            if (!targetNode || !this.validTargets().has(targetNode.unit.id)) {
                this.hoveredNode.set(null);
                this.hoveredPinIndex.set(null);
                return;
            }

            this.hoveredNode.set(targetNode);
            if (!pinEl) {
                this.hoveredPinIndex.set(null);
                return;
            }

            const pinGroup = pinEl as SVGGElement;
            const siblings = Array.from(pinGroup.parentElement?.querySelectorAll('.pin') || []);
            const idx = siblings.indexOf(pinGroup);
            this.hoveredPinIndex.set(this.isPinValidTarget(targetNode, idx) ? idx : null);
            return;
        }

        if (this.activeTouches.size > 0 && this.lastPanPoint) {
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
                const scaleChange = currentDistance / this.pinchStartDistance;
                const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * scaleChange));

                // Adjust offset to zoom towards pinch center
                const oldZoom = this.zoom();
                if (newZoom !== oldZoom) {
                    const svg = this.svgCanvas()?.nativeElement;
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
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
        }
    }

    private onGlobalPointerUp = (event: PointerEvent) => {
        // Remove touch from tracking
        this.activeTouches.delete(event.pointerId);

        // If a move is queued, it may run after this up; clear to reduce stale work.
        this.pendingMoveEvent = null;
        
        // Update pan point for remaining touches (smooth transition from pinch to single-touch pan)
        if (this.activeTouches.size > 0) {
            this.lastPanPoint = this.getEffectivePanPoint();
            // Re-initialize pinch if still have 2 touches
            if (this.activeTouches.size === 2) {
                this.startPinchGesture();
            }
        }

        const dragged = this.draggedNode();
        if (dragged) {
            const hadCollision = this.resolveNodeCollisions(dragged);
            if (hadCollision) {
                // Collisions update node positions in-place; re-setting forces recomputation
                // of computed geometry like connectionLines/hubPoints.
                this.nodes.set([...this.nodes()]);
            }
        }

        if (this.connectingFrom()) {
            const target = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = target?.closest('.node-group');
            const pinEl = target?.closest('.pin');
            if (nodeEl) {
                const unitId = nodeEl.getAttribute('data-unit-id');
                const targetNode = this.nodesById().get(unitId || '');
                const conn = this.connectingFrom()!;
                if (targetNode && this.validTargets().has(targetNode.unit.id)) {
                    let targetPin = -1;
                    if (pinEl) {
                        const pinGroup = pinEl as SVGGElement;
                        const siblings = Array.from(pinGroup.parentElement?.querySelectorAll('.pin') || []);
                        targetPin = siblings.indexOf(pinGroup);
                    }
                    if (targetPin < 0 || !this.isPinValidTarget(targetNode, targetPin)) {
                        const validPins = this.getValidPinsForTarget(targetNode);
                        targetPin = validPins.length > 0 ? validPins[0] : -1;
                    }
                    if (targetPin >= 0) {
                        // Check if this is an already-connected pin (drag-to-disconnect)
                        const sourceComp = conn.node.c3Components[conn.compIndex];
                        const targetComp = targetNode.c3Components[targetPin];
                        const existingConnection = this.findConnectionBetweenPins(
                            conn.node.unit.id, conn.compIndex, sourceComp.role,
                            targetNode.unit.id, targetPin, targetComp.role
                        );
                        
                        if (existingConnection) {
                            // Remove the existing connection
                            if (existingConnection.memberStr) {
                                this.removeMemberFromNetwork(existingConnection.networkId, existingConnection.memberStr);
                            } else {
                                // Peer network - remove the source unit from the peer network
                                this.cancelExistingConnectionForPin(conn.node, conn.compIndex);
                            }
                            this.toastService.show('Connection removed', 'success');
                        } else {
                            this.createConnection(conn, targetNode, targetPin);
                        }
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
            this.cleanupGlobalPointerState();
        }
    };

    protected onWheel(event: WheelEvent) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = this.zoom();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * delta));
        
        // Zoom towards mouse cursor
        const svg = this.svgCanvas()?.nativeElement;
        if (svg && newZoom !== oldZoom) {
            const rect = svg.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const offset = this.viewOffset();
            const zoomRatio = newZoom / oldZoom;
            this.viewOffset.set({
                x: mouseX - (mouseX - offset.x) * zoomRatio,
                y: mouseY - (mouseY - offset.y) * zoomRatio
            });
        }
        
        this.zoom.set(newZoom);
    }

    public toggleConnectionsAboveNodes() {
        const current = this.optionsService.options().c3NetworkConnectionsAboveNodes;
        this.optionsService.setOption('c3NetworkConnectionsAboveNodes', !current);
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
        
        const memberNode = this.nodesById().get(memberId);
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

    /** Check if a node is linked to any network */
    protected isNodeLinked(node: C3Node): boolean {
        return this.unitConnectionStatus().get(node.unit.id) ?? false;
    }

    /** Get the border color for a node (first network color or default) */
    protected getNodeBorderColor(node: C3Node): string {
        const colors = this.nodeBorderColors().get(node.unit.id) || [];
        return colors.length > 0 ? colors[0] : '#666';
    }

    /** Get pin stroke color (for the circle outline) */
    protected getPinStrokeColor(node: C3Node, compIndex: number): string {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        if (state?.disabled) return '#555';
        if (state?.color) return state.color;
        
        // Master pins always show their assigned color on the border
        const comp = node.c3Components[compIndex];
        if (comp?.role === C3Role.MASTER) {
            const key = `${node.unit.id}:${compIndex}`;
            return this.masterPinColors.get(key) || '#666';
        }
        
        return '#666';
    }

    /** Get pin fill color (for connected pins) */
    protected getPinFillColor(node: C3Node, compIndex: number): string {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        if (state?.disabled) return '#2a2a2a';
        
        const comp = node.c3Components[compIndex];
        
        // Master pins: fill when connected (has slaves)
        if (comp?.role === C3Role.MASTER) {
            if (state?.connected && state?.color) {
                return state.color;
            }
            return '#333';
        }
        
        // Slave/peer pins: fill when connected
        if (state?.connected && state?.color) {
            return state.color;
        }
        
        return '#333';
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
