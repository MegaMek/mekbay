// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    type ElementRef,
    inject,
    signal,
    untracked,
    viewChild,
    type AfterViewInit
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import type { ForceUnit } from '../../models/force-unit.model';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { C3NetworkEditor, type C3NetworkContext } from '../../models/c3-network-editor';
import { C3Capabilities, C3Network, C3TaxCalculator, c3NetworkTypeName, c3RoleName, C3NetworkType, type C3Node, C3Role, C3_NETWORK_LIMITS } from '../../models/c3-network.model';
import type { Force, UnitGroup } from '../../models/force.model';
import type { SerializedC3NetworkGroup } from '../../models/force-serialization';
import { GameSystem } from '../../models/common.model';
import { ToastService } from '../../services/toast.service';
import { OptionsService } from '../../services/options.service';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { BVCalculatorUtil } from '../../utils/bv-calculator.util';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;
const BROKEN_LINK_COLOR = '#8B0000';

export interface C3NetworkDialogData {
    force: Force;
    readOnly?: boolean;
}

export interface C3NetworkDialogResult {
    networks: SerializedC3NetworkGroup[];
    updated: boolean;
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
    unavailable: boolean;
    degraded: boolean;
}

type C3NodeRuntimeStatus = 'OFFLINE' | 'JAMMED' | 'DEGRADED';

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
    displayColor: string;
    members: SidebarMemberVm[];
    subNetworks: SidebarNetworkVm[];
    canRemoveNetwork: boolean;
    showBv: boolean;
    /** Total C3 tax for this network tree (root networks only) */
    networkTax?: number;
}

interface SidebarMemberVm {
    id: string;
    name: string;
    role: SidebarMemberRole;
    canRemove: boolean;
    brokenLink: boolean;
    isSelfConnection?: boolean;
    memberStr?: string;
    node: C3Node | null;
    network?: SerializedC3NetworkGroup;
    networkVm?: SidebarNetworkVm;
    /** Base BV (pilot adjusted) */
    baseBv?: number;
    /** Tag BV for this unit */
    tagBv?: number;
    /** C³ BV for this unit */
    c3Bv?: number;
    /** External Stores BV for this unit */
    externalStoresBv?: number;
    /** Pilot Skills BV for this unit */
    pilotBv?: number;
    /** Adjusted BV for this unit */
    adjustedBv?: number;
}

interface Vec2 {
    x: number;
    y: number;
}

@Component({
    selector: 'c3-network-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgTemplateOutlet],
    host: {
        class: 'fullscreen-dialog-host fullheight tv-fade',
        '[class.read-only]': 'data.readOnly'
    },
    templateUrl: './c3-network-dialog.component.html',
    styleUrls: ['./c3-network-dialog.component.scss']
})
export class C3NetworkDialogComponent implements AfterViewInit {
    private dialogRef = inject(DialogRef<C3NetworkDialogResult>);
    protected data = inject<C3NetworkDialogData>(DIALOG_DATA);
    private toastService = inject(ToastService);
    private dialogsService = inject(DialogsService);
    private destroyRef = inject(DestroyRef);
    private optionsService = inject(OptionsService);
    protected layoutService = inject(LayoutService);
    private spriteService = inject(SpriteStorageService);
    private svgCanvas = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');

    protected readonly NODE_RADIUS = 170;
    protected readonly PIN_RADIUS = 13;
    protected readonly PIN_GAP = 40;
    protected readonly PIN_Y_OFFSET = 18;
    protected readonly NODE_BOTTOM_SIDE_WIDTH = this.NODE_RADIUS / 2;
    protected readonly NODE_BOTTOM_SIDE_X = -this.NODE_BOTTOM_SIDE_WIDTH / 2;
    protected readonly NODE_BOTTOM_Y = Math.sin(Math.PI / 3) * (this.NODE_RADIUS / 2);
    protected readonly NODE_STATUS_HEIGHT = 18;

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
    protected showBvDetails = signal(false);
    protected connectionsAboveNodes = computed(() => this.optionsService.options().c3NetworkConnectionsAboveNodes);
    protected isClassicGame = computed(() => this.data.force.gameSystem === GameSystem.CLASSIC);

    // Flag to skip initial effect trigger
    private initialized = false;

    protected nodesById = computed(() => {
        const map = new Map<string, C3Node>();
        for (const node of this.nodes()) map.set(node.unit.id, node);
        return map;
    });

    protected sortedNodes = computed(() => [...this.nodes()].sort((a, b) => a.zIndex - b.zIndex));

    // Drag state
    protected draggedNode = signal<C3Node | null>(null);
    private dragStartPos = { x: 0, y: 0 };
    private nodeStartPos = { x: 0, y: 0 };

    // Connection drawing state
    protected connectingFrom = signal<{ node: C3Node; compIndex: number; role: C3Role } | null>(null);
    protected connectingEnd = signal({ x: 0, y: 0 });
    protected hoveredNode = signal<C3Node | null>(null);
    protected hoveredPinIndex = signal<number | null>(null);

    // Pan/zoom state
    protected viewOffset = signal({ x: 0, y: 0 });
    protected zoom = signal(1);

    private lastPanPoint: { x: number; y: number } | null = null;
    private pendingMoveEvent: PointerEvent | null = null;
    private moveRafId: number | null = null;
    private hasGlobalPointerListeners = false;
    private pinchStartDistance = 0;
    private pinchStartZoom = 1;
    private activeTouches = new Map<number, PointerEvent>();

    // Color tracking
    private masterPinColors = new Map<string, string>();

    // Extracted icon data URLs (small, cached, Safari compatible)
    protected nodeIconUrls = signal<Map<string, string>>(new Map());
    protected readonly FALLBACK_ICON = '/images/unknown.png';

    constructor() {
        this.destroyRef.onDestroy(() => this.cleanupGlobalPointerState());
        this.watchForRemoteUpdates();
    }

    /** Get current units value from force */
    private getUnits(): ForceUnit[] {
        return this.data.force.units();
    }

    /** Get current networks value from force */
    private getNetworks(): SerializedC3NetworkGroup[] {
        return this.data.force.c3Networks();
    }

    /** Get groups from force for auto-configure */
    private getGroups(): UnitGroup[] {
        return this.data.force.groups();
    }

    /**
     * Watches for remote force updates and syncs C3 network data.
     * When the force is updated via WebSocket, this effect will detect
     * changes to the provided signals and update the dialog accordingly.
     */
    private watchForRemoteUpdates(): void {
        effect(() => {
            // Read the current values from the force signals (this creates dependencies)
            const forceNetworks = this.data.force.c3Networks();
            const forceUnits = this.data.force.units();

            // Use untracked to avoid circular dependencies when reading local state
            untracked(() => {
                // Skip the initial effect trigger before dialog is fully initialized
                if (!this.initialized) return;

                // Only sync if we haven't made local modifications
                // If user has modified, they will save or cancel explicitly
                if (this.hasModifications()) {
                    // User has local changes - show a toast notification
                    this.toastService.showToast(
                        'C3 network was updated remotely. Your local changes will be kept.',
                        'info'
                    );
                    return;
                }

                // Sync networks from force to dialog
                this.networks.set([...forceNetworks]);

                // Update nodes for any new/removed units
                this.syncNodesWithUnits(forceUnits);

                // Re-initialize master pin colors
                this.initializeMasterPinColors();
            });
        });
    }

    /**
     * Syncs the dialog's nodes with the current force units.
     * Adds nodes for new C3-capable units and removes nodes for deleted units.
     * Also syncs positions from unit.c3Position() for existing nodes.
     */
    private syncNodesWithUnits(forceUnits: ForceUnit[]): void {
        const capabilities = new Map(forceUnits.map(unit => [unit.id, new C3Capabilities(unit)]));
        const c3Units = forceUnits.filter(unit => capabilities.get(unit.id)?.hasC3);
        const currentNodes = this.nodes();
        const currentNodeIds = new Set(currentNodes.map(n => n.unit.id));
        const newUnitIds = new Set(c3Units.map(u => u.id));

        // Remove nodes for units that no longer exist
        const nodesToKeep = currentNodes.filter(n => newUnitIds.has(n.unit.id));

        // Replace existing nodes so signal consumers observe capability and unit-reference changes.
        for (let index = 0; index < nodesToKeep.length; index++) {
            const node = nodesToKeep[index];
            const updatedUnit = c3Units.find(u => u.id === node.unit.id);
            if (updatedUnit) {
                const c3Components = [...capabilities.get(updatedUnit.id)!.components];
                const pos = updatedUnit.c3Position();
                const hasPosition = !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
                nodesToKeep[index] = {
                    ...node,
                    unit: updatedUnit,
                    c3Components,
                    pinOffsetsX: this.computePinOffsetsX(c3Components.length),
                    x: hasPosition ? pos.x : node.x,
                    y: hasPosition ? pos.y : node.y,
                };
            }
        }

        // Add nodes for new units
        const newUnits = c3Units.filter(u => !currentNodeIds.has(u.id));
        if (newUnits.length > 0) {
            const el = this.svgCanvas()?.nativeElement;
            const canvasW = el?.clientWidth || 800;
            const canvasH = el?.clientHeight || 600;
            const maxZ = nodesToKeep.length > 0 ? Math.max(...nodesToKeep.map(n => n.zIndex)) : 0;

            for (let i = 0; i < newUnits.length; i++) {
                const unit = newUnits[i];
                const pos = unit.c3Position();
                const x = pos?.x ?? canvasW / 2 + (i * 200);
                const y = pos?.y ?? canvasH / 2;
                const c3Components = [...capabilities.get(unit.id)!.components];
                const pinOffsetsX = this.computePinOffsetsX(c3Components.length);

                nodesToKeep.push({
                    unit,
                    x,
                    y,
                    zIndex: maxZ + i + 1,
                    c3Components,
                    pinOffsetsX
                });
            }
        }

        this.nodes.set(nodesToKeep);
    }

    /**
     * Computes the X offsets for pins based on the number of C3 components.
     */
    private computePinOffsetsX(componentCount: number): number[] {
        if (componentCount <= 1) return [0];
        const totalWidth = (componentCount - 1) * this.PIN_GAP;
        const startX = -totalWidth / 2;
        return Array.from({ length: componentCount }, (_, i) => startX + i * this.PIN_GAP);
    }

    /** Create the network context for mutations */
    private getNetworkContext(): C3NetworkContext {
        return {
            networks: this.networks(),
            getNextColor: () => C3NetworkEditor.nextColor(this.networks(), this.masterPinColors),
            masterPinColors: this.masterPinColors
        };
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
            (el as unknown as { setPointerCapture?: (pointerId: number) => void })?.setPointerCapture?.(event.pointerId);
        } catch { /* best-effort */ }
    }

    private updateNodes(mutator: (nodes: C3Node[]) => void): void {
        const nodes = this.nodes();
        mutator(nodes);
        this.nodes.set([...nodes]);
    }

    protected unitDisplayName = computed(() => this.optionsService.options().unitDisplayName);

    protected svgTransform = computed(() => {
        const offset = this.viewOffset();
        return `translate(${offset.x}, ${offset.y}) scale(${this.zoom()})`;
    });

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
                if (sourceComp.networkType !== targetComp.networkType) continue;

                const existingConnection = this.networkModel().connectionBetween(
                    { unitId: conn.node.unit.id, compIndex: conn.compIndex }, sourceComp.role,
                    { unitId: node.unit.id, compIndex: i }, targetComp.role, sourceComp.networkType);
                if (existingConnection) {
                    connectedPins.push(i);
                    validPins.push(i);
                    continue;
                }

                const result = C3NetworkEditor.canConnect(conn.node, conn.compIndex, node, i, networks);
                if (result.valid) validPins.push(i);
            }

            if (validPins.length > 0) {
                validTargetIds.add(node.unit.id);
                validPinsByUnit.set(node.unit.id, validPins);
            }
            if (connectedPins.length > 0) {
                alreadyConnectedPins.set(node.unit.id, connectedPins);
            }
        }

        return { isConnecting: true, validTargetIds, validPinsByUnit, alreadyConnectedPins };
    });

    protected validTargets = computed(() => this.connectionState().validTargetIds);

    private networkModel = computed(() => new C3Network(
        this.networks(), this.nodes().map(node => node.unit),
    ));

    private taxCalculator = computed(() => new C3TaxCalculator(
        this.networks(), this.nodes().map(node => node.unit as CBTForceUnit),
    ));

    protected connectionLines = computed<ConnectionLine[]>(() => {
        const lines: ConnectionLine[] = [];
        const nodesById = this.nodesById();
        const runtimeGraph = this.networkModel();

        for (const network of this.networks()) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds.map(id => nodesById.get(id)).filter((n): n is C3Node => !!n);
                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = runtimeGraph.resolveComponentIndex(node.unit.id, network, C3Role.PEER);
                        return this.getPinWorldPosition(node, Math.max(0, compIdx ?? -1));
                    });
                    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
                    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
                    const nodeCx = peerNodes.reduce((s, n) => s + n.x, 0) / peerNodes.length;
                    const nodeCy = peerNodes.reduce((s, n) => s + n.y, 0) / peerNodes.length;

                    positions.forEach((p, idx) => {
                        const peerId = peerNodes[idx].unit.id;
                        const unavailable = runtimeGraph.hasOnlyBrokenIncidentLinks(network.id, peerId);
                        lines.push({
                            id: `${network.id}-peer-${idx}`,
                            x1: cx, y1: cy, x2: p.x, y2: p.y,
                            nodeX1: nodeCx, nodeY1: nodeCy,
                            nodeX2: peerNodes[idx].x, nodeY2: peerNodes[idx].y,
                            color: unavailable ? BROKEN_LINK_COLOR : network.color,
                            hasArrow: false,
                            arrowAngle: 0,
                            selfConnection: false,
                            unavailable,
                            degraded: runtimeGraph.stateForNetwork(peerId, network.id).degraded,
                        });
                    });
                }
            } else if (network.masterId) {
                const configuredSource = { unitId: network.masterId, compIndex: network.masterCompIndex ?? 0 };
                const runtimeLinks = runtimeGraph.linksForNetwork(network.id);
                const addLine = (id: string, source: typeof configuredSource, target: typeof configuredSource, unavailable: boolean, degraded: boolean) => {
                    const sourceNode = nodesById.get(source.unitId);
                    const targetNode = nodesById.get(target.unitId);
                    if (!sourceNode || !targetNode) return;
                    const sourcePos = this.getPinWorldPosition(sourceNode, source.compIndex);
                    const targetPos = this.getPinWorldPosition(targetNode, target.compIndex);
                    const angle = Math.atan2(targetPos.y - sourcePos.y, targetPos.x - sourcePos.x);
                    const shortenBy = this.PIN_RADIUS + 10;
                    lines.push({
                        id,
                        x1: sourcePos.x,
                        y1: sourcePos.y,
                        x2: targetPos.x - Math.cos(angle) * shortenBy,
                        y2: targetPos.y - Math.sin(angle) * shortenBy,
                        nodeX1: sourceNode.x,
                        nodeY1: sourceNode.y,
                        nodeX2: targetNode.x - Math.cos(angle) * 10,
                        nodeY2: targetNode.y - Math.sin(angle) * 10,
                        color: unavailable ? BROKEN_LINK_COLOR : network.color,
                        hasArrow: true,
                        arrowAngle: angle,
                        selfConnection: source.unitId === target.unitId,
                        unavailable,
                        degraded,
                    });
                };

                for (const member of network.members ?? []) {
                    const parsed = C3Network.parseMember(member);
                    const role = parsed.compIndex === undefined ? C3Role.SLAVE : C3Role.MASTER;
                    const targetIndex = parsed.compIndex ?? runtimeGraph.resolveComponentIndex(parsed.unitId, network, role);
                    if (targetIndex === undefined) continue;
                    const target = { unitId: parsed.unitId, compIndex: targetIndex };
                    const runtimeLink = runtimeGraph.findLink(network.id, configuredSource, target);
                    addLine(
                        `${network.id}-configured-${member}`,
                        configuredSource,
                        target,
                        !runtimeLink?.operational,
                        runtimeGraph.stateForNetwork(target.unitId, network.id).degraded,
                    );
                }

                runtimeLinks.forEach((runtimeLink, index) => {
                    if (runtimeLink.source.unitId === configuredSource.unitId
                        && runtimeLink.source.compIndex === configuredSource.compIndex) return;
                    addLine(
                        `${network.id}-emergency-${index}-${runtimeLink.source.unitId}-${runtimeLink.target.unitId}`,
                        runtimeLink.source,
                        runtimeLink.target,
                        !runtimeLink.operational,
                        runtimeGraph.stateForNetwork(runtimeLink.target.unitId, network.id).degraded,
                    );
                });
            }
        }
        return lines;
    });

    protected hubPoints = computed<HubPoint[]>(() => {
        const hubs: HubPoint[] = [];
        const nodesById = this.nodesById();

        for (const network of this.networks()) {
            if (network.peerIds && network.peerIds.length > 1) {
                const peerNodes = network.peerIds.map(id => nodesById.get(id)).filter((n): n is C3Node => !!n);
                if (peerNodes.length >= 2) {
                    const positions = peerNodes.map(node => {
                        const compIdx = this.networkModel().resolveComponentIndex(node.unit.id, network, C3Role.PEER);
                        return this.getPinWorldPosition(node, Math.max(0, compIdx ?? -1));
                    });
                    hubs.push({
                        id: `hub-${network.id}`,
                        nodeX: peerNodes.reduce((s, n) => s + n.x, 0) / peerNodes.length,
                        nodeY: peerNodes.reduce((s, n) => s + n.y, 0) / peerNodes.length,
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

    protected activeDragLine = computed(() => {
        const conn = this.connectingFrom();
        if (!conn) return null;
        const pinPos = this.getPinWorldPosition(conn.node, conn.compIndex);
        return { x1: pinPos.x, y1: pinPos.y, x2: this.connectingEnd().x, y2: this.connectingEnd().y };
    });

    protected sidebarNetworks = computed<SidebarNetworkVm[]>(() => {
        const networks = this.networks();
        const nodesById = this.nodesById();
        const runtimeGraph = this.networkModel();
        const topology = runtimeGraph;
        const topLevel = topology.topLevelNetworks;
        const visited = new Set<string>();
        const isClassic = this.isClassicGame();
        const allUnits = isClassic ? this.nodes().map(n => n.unit as CBTForceUnit) : [];
        const taxCalculator = isClassic ? this.taxCalculator() : undefined;

        const getUnitBvData = (node: C3Node | null): { baseBv?: number; tagBv?: number; c3Bv?: number; externalStoresBv?: number; pilotBv?: number, adjustedBv?: number } => {
            if (!isClassic || !node) return {};
            const cbtUnit = node.unit as CBTForceUnit;
            const unit = cbtUnit.getUnit();
            const baseBv = cbtUnit.getBaseBv();
            const tagBv = cbtUnit.tagBV();
            const c3Bv = cbtUnit.rules.calculateC3Tax(networks, allUnits, taxCalculator);
            const externalStoresBv = cbtUnit.externalStoresBv();
            const preSkillAdjustedBv = baseBv + tagBv + c3Bv + externalStoresBv;
            const adjustedBv = BVCalculatorUtil.calculateAdjustedBV(unit, preSkillAdjustedBv, cbtUnit.gunnerySkill(), cbtUnit.pilotingSkill());
            const pilotBv = adjustedBv - preSkillAdjustedBv;
            return { baseBv: baseBv, tagBv, c3Bv, externalStoresBv, pilotBv, adjustedBv };
        };

        const buildNetworkVm = (network: SerializedC3NetworkGroup, isTopLevel: boolean): SidebarNetworkVm | null => {
            if (visited.has(network.id)) return null;
            visited.add(network.id);

            const members: SidebarMemberVm[] = [];
            const subNetworks: SidebarNetworkVm[] = [];

            if (network.peerIds) {
                for (const id of network.peerIds) {
                    const node = nodesById.get(id) ?? null;
                    members.push({
                        id, name: node?.unit.getUnit().chassis || 'Unknown',
                        role: 'peer', canRemove: !this.data.readOnly, node,
                        brokenLink: runtimeGraph.hasOnlyBrokenIncidentLinks(network.id, id),
                        ...getUnitBvData(node)
                    });
                }
            } else if (network.masterId) {
                const masterNode = nodesById.get(network.masterId) ?? null;
                members.push({
                    id: network.masterId,
                    name: masterNode?.unit.getUnit().chassis || 'Unknown',
                    role: 'master', canRemove: false, node: masterNode, network,
                    brokenLink: runtimeGraph.hasOnlyBrokenIncidentLinks(network.id, network.masterId),
                    ...getUnitBvData(masterNode)
                });

                for (const memberStr of network.members ?? []) {
                    const parsed = C3Network.parseMember(memberStr);
                    const node = nodesById.get(parsed.unitId) ?? null;
                    const isSelfConnection = parsed.unitId === network.masterId;

                    if (parsed.compIndex !== undefined) {
                        const childNet = topology.masterNetwork(parsed.unitId, parsed.compIndex);
                        const hasChildren = !!(childNet?.members?.length);

                        if (childNet && hasChildren) {
                            const childVm = buildNetworkVm(childNet, false);
                            members.push({
                                id: parsed.unitId,
                                name: node?.unit.getUnit().chassis || 'Unknown',
                                role: 'sub-master', canRemove: !this.data.readOnly, isSelfConnection,
                                memberStr, node, network: childNet, networkVm: childVm ?? undefined,
                                brokenLink: runtimeGraph.childLinkBroken(network.id, {
                                    unitId: parsed.unitId,
                                    compIndex: parsed.compIndex,
                                }),
                                ...getUnitBvData(node)
                            });
                            if (childVm) subNetworks.push(childVm);
                            continue;
                        }
                    }

                    members.push({
                        id: parsed.unitId,
                        name: node?.unit.getUnit().chassis || 'Unknown',
                        role: 'slave', canRemove: !this.data.readOnly, isSelfConnection, memberStr, node,
                        brokenLink: runtimeGraph.childLinkBroken(network.id, {
                            unitId: parsed.unitId,
                            compIndex: parsed.compIndex,
                        }),
                        ...getUnitBvData(node)
                    });
                }
            }

            let displayName = 'Unknown Network';
            if (network.peerIds) {
                displayName = `${c3NetworkTypeName(network.type as C3NetworkType)} (${network.peerIds.length} peers)`;
            } else if (network.masterId) {
                const memberCount = topology.treeEndpointKeys(network.id).size;
                displayName = `${c3NetworkTypeName(network.type as C3NetworkType)} (${memberCount} ${memberCount > 1 ? 'members' : 'member'})`;
            }

            // Calculate network tax for top-level networks only
            let networkTax: number | undefined;
            if (isTopLevel && isClassic) {
                // Sum the tax of all unique units in the network
                const collectTaxes = (vm: Pick<SidebarNetworkVm, 'members' | 'subNetworks'>, seen: Set<string>): number => {
                    let sum = 0;
                    for (const m of vm.members) {
                        if (!m.isSelfConnection && m.c3Bv !== undefined && !seen.has(m.id)) {
                            seen.add(m.id);
                            sum += m.c3Bv;
                        }
                    }
                    for (const sub of vm.subNetworks) {
                        sum += collectTaxes(sub, seen);
                    }
                    return sum;
                };
                networkTax = collectTaxes({ members, subNetworks }, new Set<string>());
            }

            const displayColor = runtimeGraph.stateForNetwork(network.masterId ?? network.peerIds?.[0] ?? '', network.id).color
                ?? network.color;
            return {
                network, displayName, displayColor, members, subNetworks, networkTax,
                canRemoveNetwork: !this.data.readOnly,
                showBv: true,
            };
        };

        return topLevel.map(net => buildNetworkVm(net, true)).filter((vm): vm is SidebarNetworkVm => vm !== null);
    });

    protected emergencySidebarNetworks = computed<SidebarNetworkVm[]>(() => {
        const runtime = this.networkModel();
        const nodesById = this.nodesById();
        return this.networks().flatMap(network => {
            const master = runtime.effectiveEmergencyMasterForNetwork(network.id);
            if (!master) return [];
            const links = runtime.linksForNetwork(network.id).filter(link => link.operational
                && link.source.unitId === master.unitId && link.source.compIndex === master.compIndex);
            const unitIds = [master.unitId, ...links.map(link => link.target.unitId)];
            const members: SidebarMemberVm[] = [...new Set(unitIds)].map((id, index) => {
                const node = nodesById.get(id) ?? null;
                return {
                    id,
                    name: node?.unit.getUnit().chassis || 'Unknown',
                    role: index === 0 ? 'master' : 'slave',
                    canRemove: false,
                    brokenLink: false,
                    node,
                };
            });
            return [{
                network,
                displayName: 'EMERGENCY',
                displayColor: runtime.stateForNetwork(master.unitId, network.id).color ?? network.color,
                members,
                subNetworks: [],
                canRemoveNetwork: false,
                showBv: false,
            }];
        });
    });

    /** Total BV summary for all C3 units */
    protected bvTotals = computed(() => {
        if (!this.isClassicGame()) return null;
        const nodes = this.nodes();
        const networks = this.networks();
        const allUnits = nodes.map(n => n.unit as CBTForceUnit);
        const taxCalculator = this.taxCalculator();
        
        let totalBaseBv = 0;
        let totalTagBv = 0;
        let totalC3Bv = 0;
        let totalExternalStoresBv = 0;
        let totalPilotSkillsBv = 0;
        let grandTotal = 0;
        
        for (const node of nodes) {
            const cbtUnit = node.unit as CBTForceUnit;
            const unit = cbtUnit.getUnit();
            const baseBv = cbtUnit.getBaseBv();
            const tagBv = cbtUnit.tagBV();
            const c3Bv = cbtUnit.rules.calculateC3Tax(networks, allUnits, taxCalculator);
            const externalStoresBv = cbtUnit.externalStoresBv();
            const preSkillAdjustedBv = baseBv + tagBv + c3Bv + externalStoresBv;
            const finalBv = BVCalculatorUtil.calculateAdjustedBV(unit, preSkillAdjustedBv, cbtUnit.gunnerySkill(), cbtUnit.pilotingSkill());
            totalBaseBv += baseBv;
            totalTagBv += tagBv;
            totalC3Bv += c3Bv;
            totalExternalStoresBv += externalStoresBv;
            totalPilotSkillsBv += finalBv - baseBv - tagBv - c3Bv - externalStoresBv;
            grandTotal += finalBv;
        }
        
        return { totalBaseBv, totalTagBv, totalC3Bv, totalExternalStoresBv, totalPilotSkillsBv, grandTotal };
    });

    protected pinConnectionState = computed(() => {
        const state = new Map<string, { connected: boolean; disabled: boolean; color: string | null, roleLabel: string }>();
        const networks = this.networks();
        const topology = this.networkModel();

        for (const node of this.nodes()) {
            const unitId = node.unit.id;
            for (let compIndex = 0; compIndex < node.c3Components.length; compIndex++) {
                const comp = node.c3Components[compIndex];
                const key = `${unitId}:${compIndex}`;
                let connected = false, disabled = false, color: string | null = null;
                let roleLabel = c3RoleName(comp.role);
                if (comp.role === C3Role.MASTER) {
                    const net = topology.masterNetwork(unitId, compIndex);
                    const parent = topology.parentNetworkForEndpoint(unitId, compIndex);
                    connected = !!(net?.members?.length || parent);
                    color = net?.color || parent?.color || this.masterPinColors.get(key) || null;
                    if (net && net.members) {
                        const owningParent = topology.parentOf(net.id);
                        if (!owningParent) {
                            const subnetworks = topology.childrenOf(net.id);
                            if (subnetworks.length > 0) {
                                roleLabel = 'GM';
                            }
                        }
                    }
                } else if (comp.role === C3Role.SLAVE) {
                    connected = topology.networksForUnit(unitId).some(n => n.members?.includes(unitId)
                        && topology.resolveComponentIndex(unitId, n, C3Role.SLAVE) === compIndex);
                    for (const net of topology.networksForUnit(unitId)) {
                        if (net.members?.includes(unitId)
                            && topology.resolveComponentIndex(unitId, net, C3Role.SLAVE) === compIndex) {
                            color = net.color; break;
                        }
                    }
                } else if (comp.role === C3Role.PEER) {
                    const net = topology.peerNetwork(unitId, comp.networkType);
                    connected = !!(net?.peerIds && net.peerIds.length >= 2
                        && topology.resolveComponentIndex(unitId, net, C3Role.PEER) === compIndex);
                    color = net?.color || null;
                }

                state.set(key, { connected, disabled, color, roleLabel });
            }
        }
        return state;
    });

    protected nodeBorderColors = computed(() => {
        const map = new Map<string, string[]>();
        const topology = this.networkModel();

        for (const node of this.nodes()) {
            const runtimeColors = topology.statesFor(node.unit.id)
                .filter(state => state.linked && !!state.color)
                .map(state => state.color!);
            map.set(node.unit.id, [...new Set(runtimeColors.length
                ? runtimeColors : topology.colorsForUnit(node.unit.id))]);
        }
        return map;
    });

    protected nodeBorderSegments = computed(() => {
        const map = new Map<string, BorderSegment[]>();
        const colorsByNode = this.nodeBorderColors();
        const radius = this.NODE_RADIUS / 2;
        const perimeter = 6 * radius;

        for (const node of this.nodes()) {
            const colors = colorsByNode.get(node.unit.id) || [];
            if (colors.length <= 1) { map.set(node.unit.id, []); continue; }

            const segmentLen = perimeter / colors.length;
            const dasharray = `${segmentLen} ${perimeter - segmentLen}`;
            map.set(node.unit.id, colors.map((color, index) => ({
                id: `${node.unit.id}-seg-${index}`, color, dasharray, dashoffset: -segmentLen * index
            })));
        }
        return map;
    });

    protected unitConnectionStatus = computed(() => {
        const map = new Map<string, boolean>();
        const topology = this.networkModel();
        for (const node of this.nodes()) {
            map.set(node.unit.id, topology.isUnitConnected(node.unit.id));
        }
        return map;
    });

    protected damageDisconnectedNodes = computed(() => {
        const operationalUnitIds = new Set<string>();
        for (const link of this.networkModel().links) {
            if (!link.operational) continue;
            operationalUnitIds.add(link.source.unitId);
            operationalUnitIds.add(link.target.unitId);
        }

        const disconnected = new Set<string>();
        for (const [unitId, structurallyConnected] of this.unitConnectionStatus()) {
            if (structurallyConnected && !operationalUnitIds.has(unitId)) disconnected.add(unitId);
        }
        return disconnected;
    });

    protected nodeRuntimeStatuses = computed(() => {
        const statuses = new Map<string, readonly C3NodeRuntimeStatus[]>();
        const runtime = this.networkModel();
        for (const node of this.nodes()) {
            if (this.isNodeOffline(node, runtime)) {
                statuses.set(node.unit.id, ['OFFLINE']);
                continue;
            }

            const nodeStatuses: C3NodeRuntimeStatus[] = [];
            const jammed = node.unit.isC3Jammed();
            if (jammed) nodeStatuses.push('JAMMED');
            const networkTypes = new Set(node.c3Components.map(component => component.networkType));
            const linkedStates = [...networkTypes]
                .map(networkType => runtime.stateFor(node.unit.id, networkType))
                .filter(state => state.linked);
            if (!jammed && linkedStates.some(state => state.degraded)) {
                nodeStatuses.push('DEGRADED');
            }
            if (nodeStatuses.length) statuses.set(node.unit.id, nodeStatuses);
        }
        return statuses;
    });

    private isNodeOffline(node: C3Node, runtime: C3Network): boolean {
        const componentIndexes = new Set<number>();
        for (const network of runtime.networksForUnit(node.unit.id)) {
            if (network.masterId === node.unit.id) {
                const index = runtime.resolveComponentIndex(node.unit.id, network, C3Role.MASTER);
                if (index !== undefined) componentIndexes.add(index);
            }
            if (network.peerIds?.includes(node.unit.id)) {
                const index = runtime.resolveComponentIndex(node.unit.id, network, C3Role.PEER);
                if (index !== undefined) componentIndexes.add(index);
            }
            for (const member of network.members ?? []) {
                const parsed = C3Network.parseMember(member);
                if (parsed.unitId !== node.unit.id) continue;
                const role = parsed.compIndex === undefined ? C3Role.SLAVE : C3Role.MASTER;
                const index = runtime.resolveComponentIndex(node.unit.id, network, role);
                if (index !== undefined) componentIndexes.add(index);
            }
        }

        if (componentIndexes.size === 0) return false;
        return [...componentIndexes].every(index => {
            const component = runtime.capability(node.unit.id)?.component(index);
            if (!component) return false;
            return component.mount
                ? !component.mount.owner.canPerformEquipmentAction(component.mount, 'configure-network')
                : !node.unit.isC3EndpointOperational(index, component);
        });
    }

    ngAfterViewInit() {
        this.initializeNodes();
        this.resolveAllNodeCollisions();
        this.networks.set([...this.getNetworks()]);
        this.initializeMasterPinColors();
        this.fitViewToNodes();
        this.initialized = true;
    }

    private resolveAllNodeCollisions(): void {
        const nodes = this.nodes();
        if (nodes.length < 2) return;

        let changed = false;
        for (let pass = 0; pass < 10; pass++) {
            let passChanged = false;
            for (const node of nodes) {
                if (this.resolveNodeCollisions(node)) passChanged = true;
            }
            changed ||= passChanged;
            if (!passChanged) break;
        }

        if (changed) {
            this.nodes.set([...nodes]);
            this.hasModifications.set(true);
        }
    }

    private initializeNodes() {
        const c3Units = this.getUnits().filter(unit => new C3Capabilities(unit).hasC3);
        if (c3Units.length === 0) return;

        const el = this.svgCanvas()?.nativeElement;
        const canvasW = el?.clientWidth || 800;
        const canvasH = el?.clientHeight || 600;
        const spacing = 180;

        const unitsWithPos: ForceUnit[] = [];
        const unitsWithoutPos: ForceUnit[] = [];

        for (const unit of c3Units) {
            const pos = unit.c3Position();
            (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? unitsWithPos : unitsWithoutPos).push(unit);
        }

        const positionsById = new Map<string, Vec2>();
        const placed: Vec2[] = [];

        for (const unit of unitsWithPos) {
            const pos = unit.c3Position()!;
            positionsById.set(unit.id, { x: pos.x, y: pos.y });
            placed.push({ x: pos.x, y: pos.y });
        }

        const startX = spacing, startY = spacing;
        const minCenterDistance = this.NODE_RADIUS + 12;
        const wouldOverlap = (x: number, y: number) => placed.some(p => Math.hypot(p.x - x, p.y - y) < minCenterDistance);

        if (unitsWithoutPos.length > 0) {
            const aspectRatio = canvasW / canvasH;
            let bestCols = 1, bestRows = unitsWithoutPos.length, bestRatioDiff = Infinity;

            for (let cols = 1; cols <= unitsWithoutPos.length; cols++) {
                const rows = Math.ceil(unitsWithoutPos.length / cols);
                const diff = Math.abs(cols / rows - aspectRatio);
                if (diff < bestRatioDiff) { bestRatioDiff = diff; bestCols = cols; bestRows = rows; }
            }

            const basePositions = Array.from({ length: unitsWithoutPos.length }, (_, idx) => ({
                x: startX + (idx % bestCols) * spacing,
                y: startY + Math.floor(idx / bestCols) * spacing
            }));

            const step = spacing / 2;
            const ringOffsets = (ring: number): Vec2[] => ring === 0 ? [{ x: 0, y: 0 }] : [
                { x: ring * step, y: 0 }, { x: -ring * step, y: 0 },
                { x: 0, y: ring * step }, { x: 0, y: -ring * step },
                { x: ring * step, y: ring * step }, { x: ring * step, y: -ring * step },
                { x: -ring * step, y: ring * step }, { x: -ring * step, y: -ring * step }
            ];

            for (const unit of unitsWithoutPos) {
                let chosen: Vec2 | null = null;

                for (let ring = 0; ring <= 12 && !chosen; ring++) {
                    for (const base of basePositions) {
                        for (const off of ringOffsets(ring)) {
                            const x = base.x + off.x, y = base.y + off.y;
                            if (!wouldOverlap(x, y)) { chosen = { x, y }; break; }
                        }
                        if (chosen) break;
                    }
                }

                if (!chosen) {
                    let x = startX, y = startY + Math.max(1, bestRows) * spacing, guard = 0;
                    while (wouldOverlap(x, y) && guard < 200) {
                        x += spacing;
                        if (x > startX + 10 * spacing) { x = startX; y += spacing; }
                        guard++;
                    }
                    chosen = { x, y };
                }

                positionsById.set(unit.id, chosen);
                placed.push(chosen);
            }
        }

        this.nodes.set(c3Units.map((unit, idx) => {
            const pos = positionsById.get(unit.id);
            const comps = [...new C3Capabilities(unit).components];
            const numPins = Math.max(1, comps.length);
            const totalWidth = (numPins - 1) * this.PIN_GAP;
            return {
                unit,
                c3Components: comps,
                x: pos?.x ?? startX + (idx % c3Units.length) * spacing,
                y: pos?.y ?? startY + Math.floor(idx / c3Units.length) * spacing,
                zIndex: idx,
                pinOffsetsX: Array.from({ length: numPins }, (_, i) => -totalWidth / 2 + i * this.PIN_GAP)
            };
        }));

        // Extract icons async (cached in sprite service, only runs once per unique icon)
        this.loadNodeIcons(c3Units);
    }

    /**
     * Load extracted icon data URLs for all nodes.
     * Uses sprite service caching
     */
    private async loadNodeIcons(units: ForceUnit[]): Promise<void> {
        const urlMap = new Map<string, string>();

        // Extract all icons in parallel
        await Promise.all(units.map(async (unit) => {
            const iconPath = unit.getUnit().icon;
            if (!iconPath) return;

            const url = await this.spriteService.getExtractedIconUrl(iconPath);
            if (url) {
                urlMap.set(unit.id, url);
            }
        }));

        this.nodeIconUrls.set(urlMap);
    }

    private fitViewToNodes(): void {
        const nodes = this.nodes();
        if (nodes.length === 0) return;
        const el = this.svgCanvas()?.nativeElement;
        if (!el) return;

        const canvasW = el.clientWidth, canvasH = el.clientHeight, padding = 20;
        const nodeRadius = this.NODE_RADIUS / 2;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const node of nodes) {
            minX = Math.min(minX, node.x - nodeRadius);
            minY = Math.min(minY, node.y - nodeRadius);
            maxX = Math.max(maxX, node.x + nodeRadius);
            maxY = Math.max(maxY, node.y + nodeRadius + 60);
        }

        const contentW = maxX - minX, contentH = maxY - minY;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM / 2, Math.min((canvasW - padding * 2) / contentW, (canvasH - padding * 2) / contentH)));
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;

        this.zoom.set(newZoom);
        this.viewOffset.set({ x: canvasW / 2 - centerX * newZoom, y: canvasH / 2 - centerY * newZoom });
    }

    private initializeMasterPinColors() {
        for (const net of this.networks()) {
            if (net.masterId && net.masterCompIndex !== undefined) {
                this.masterPinColors.set(`${net.masterId}:${net.masterCompIndex}`, net.color);
            }
        }

        for (const node of this.nodes()) {
            node.c3Components.forEach((comp, idx) => {
                if (comp.role === C3Role.MASTER) {
                    const key = `${node.unit.id}:${idx}`;
                    if (!this.masterPinColors.has(key)) {
                        this.masterPinColors.set(key, C3NetworkEditor.nextColor(this.networks(), this.masterPinColors));
                    }
                }
            });
        }
    }

    private getPinWorldPosition(node: C3Node, compIndex: number): { x: number; y: number } {
        return { x: node.x + (node.pinOffsetsX[compIndex] ?? 0), y: node.y + this.PIN_Y_OFFSET };
    }

    private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
        const svg = this.svgCanvas()?.nativeElement;
        if (!svg) return { x: screenX, y: screenY };
        const rect = svg.getBoundingClientRect();
        const offset = this.viewOffset();
        const scale = this.zoom();
        return { x: (screenX - rect.left - offset.x) / scale, y: (screenY - rect.top - offset.y) / scale };
    }

    private resolveNodeCollisions(draggedNode: C3Node): boolean {
        const nodes = this.nodes();
        const collisionRadius = this.NODE_RADIUS / 2 + 6;
        const nodesToCheck = new Set<C3Node>([draggedNode]);
        const checkedPairs = new Set<string>();
        let hadCollision = false, iterations = 0;

        while (nodesToCheck.size > 0 && iterations < 20) {
            iterations++;
            const currentNode = nodesToCheck.values().next().value as C3Node;
            nodesToCheck.delete(currentNode);

            for (const other of nodes) {
                if (other === currentNode) continue;
                const pairKey = [currentNode.unit.id, other.unit.id].sort().join('-');
                if (checkedPairs.has(pairKey)) continue;
                checkedPairs.add(pairKey);

                const mtv = this.getHexOverlapMtv(currentNode, other, collisionRadius);
                if (!mtv) continue;

                const dx = other.x - currentNode.x, dy = other.y - currentNode.y;
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

    private static getHexRelativeVertices(radius: number): Vec2[] {
        return Array.from({ length: 6 }, (_, i) => ({
            x: radius * Math.cos((Math.PI / 3) * i),
            y: radius * Math.sin((Math.PI / 3) * i)
        }));
    }

    private static toSvgPoints(verts: Vec2[]): string {
        return verts.map(v => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ');
    }

    private getHexWorldVertices(node: C3Node, radius: number): Vec2[] {
        return C3NetworkDialogComponent.getHexRelativeVertices(radius).map(v => ({ x: node.x + v.x, y: node.y + v.y }));
    }

    private getHexOverlapMtv(a: C3Node, b: C3Node, radius: number): Vec2 | null {
        const aVerts = this.getHexWorldVertices(a, radius);
        const bVerts = this.getHexWorldVertices(b, radius);

        const getAxes = (verts: Vec2[]) => verts.map((p1, i) => {
            const p2 = verts[(i + 1) % verts.length];
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            return len === 0 ? { x: 1, y: 0 } : { x: -(p2.y - p1.y) / len, y: (p2.x - p1.x) / len };
        });

        const project = (verts: Vec2[], axis: Vec2) => {
            let min = Infinity, max = -Infinity;
            for (const v of verts) {
                const p = v.x * axis.x + v.y * axis.y;
                if (p < min) min = p;
                if (p > max) max = p;
            }
            return { min, max };
        };

        const axes = [...getAxes(aVerts), ...getAxes(bVerts)];
        let smallestOverlap = Infinity;
        let smallestAxis: Vec2 | null = null;

        for (const axis of axes) {
            const p1 = project(aVerts, axis), p2 = project(bVerts, axis);
            const overlap = Math.min(p1.max, p2.max) - Math.max(p1.min, p2.min);
            if (overlap <= 0) return null;
            if (overlap < smallestOverlap) { smallestOverlap = overlap; smallestAxis = axis; }
        }

        return smallestAxis && Number.isFinite(smallestOverlap)
            ? { x: smallestAxis.x * smallestOverlap, y: smallestAxis.y * smallestOverlap }
            : null;
    }

    protected getValidPinsForTarget(targetNode: C3Node): number[] {
        return this.connectionState().validPinsByUnit.get(targetNode.unit.id) || [];
    }

    protected isPinValidTarget(node: C3Node, compIndex: number): boolean {
        return this.connectionState().validPinsByUnit.get(node.unit.id)?.includes(compIndex) ?? false;
    }

    protected isAlreadyConnectedPin(node: C3Node, compIndex: number): boolean {
        return this.connectionState().alreadyConnectedPins.get(node.unit.id)?.includes(compIndex) ?? false;
    }

    protected isNodeDisconnectTarget(node: C3Node): boolean {
        // Don't show disconnect target on the same node we're connecting from
        // (user must target specific pins for self-connections)
        const conn = this.connectingFrom();
        if (conn && conn.node.unit.id === node.unit.id) return false;

        return (this.connectionState().alreadyConnectedPins.get(node.unit.id)?.length ?? 0) > 0;
    }

    protected onPinPointerDown(event: PointerEvent, node: C3Node, compIndex: number) {
        if (this.data.readOnly) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.setPointerCaptureIfAvailable(event);

        const comp = node.c3Components[compIndex];
        if (!comp) return;

        this.activeTouches.set(event.pointerId, event);
        this.connectingFrom.set({ node, compIndex, role: comp.role });
        this.connectingEnd.set(this.screenToWorld(event.clientX, event.clientY));
        this.addGlobalPointerListeners();
    }

    protected onPinContextMenu(event: MouseEvent, node: C3Node, compIndex: number): void {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.data.readOnly) return;

        const comp = node.c3Components[compIndex];
        if (!comp) return;

        const result = C3NetworkEditor.disconnect(
            this.networks(), node.unit.id, compIndex, comp.role, comp.networkType);
        if (result.success) {
            this.networks.set(result.networks);
            this.hasModifications.set(true);
        }
    }

    protected onNodePointerDown(event: PointerEvent, node: C3Node) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.setPointerCaptureIfAvailable(event);

        this.activeTouches.set(event.pointerId, event);
        this.bringNodeToFront(node);
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        this.nodeStartPos = { x: node.x, y: node.y };
        this.draggedNode.set(node);
        this.addGlobalPointerListeners();
    }

    private bringNodeToFront(node: C3Node): void {
        this.updateNodes(nodes => {
            const currentZ = node.zIndex;
            for (const n of nodes) { if (n.zIndex > currentZ) n.zIndex--; }
            const target = nodes.find(n => n.unit.id === node.unit.id);
            if (target) target.zIndex = nodes.length - 1;
        });
    }

    protected onCanvasPointerDown(event: PointerEvent) {
        this.setPointerCaptureIfAvailable(event);
        this.activeTouches.set(event.pointerId, event);
        this.lastPanPoint = this.getEffectivePanPoint();
        if (this.activeTouches.size === 2) this.startPinchGesture();
        this.addGlobalPointerListeners();
    }

    private getEffectivePanPoint(): { x: number; y: number } {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length === 0) return { x: 0, y: 0 };
        if (touches.length === 1) return { x: touches[0].clientX, y: touches[0].clientY };
        return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
    }

    private startPinchGesture(): void {
        const touches = Array.from(this.activeTouches.values());
        if (touches.length !== 2) return;
        this.pinchStartDistance = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
        this.pinchStartZoom = this.zoom();
    }

    private onGlobalPointerMove = (event: PointerEvent) => {
        this.activeTouches.set(event.pointerId, event);

        if (this.activeTouches.size >= 2 && (this.draggedNode() || this.connectingFrom())) {
            this.draggedNode.set(null);
            this.connectingFrom.set(null);
            this.hoveredNode.set(null);
            this.hoveredPinIndex.set(null);
            this.startPinchGesture();
            this.lastPanPoint = this.getEffectivePanPoint();
        }

        this.pendingMoveEvent = event;
        if (this.moveRafId !== null) return;
        this.moveRafId = requestAnimationFrame(() => {
            this.moveRafId = null;
            if (this.pendingMoveEvent) this.processPointerMove(this.pendingMoveEvent);
        });
    };

    private processPointerMove(event: PointerEvent): void {
        const dragged = this.draggedNode();
        if (dragged) {
            const scale = this.zoom();
            const deltaX = (event.clientX - this.dragStartPos.x) / scale;
            const deltaY = (event.clientY - this.dragStartPos.y) / scale;

            this.updateNodes(nodes => {
                const node = nodes.find(n => n.unit.id === dragged.unit.id);
                if (node) { node.x = this.nodeStartPos.x + deltaX; node.y = this.nodeStartPos.y + deltaY; }
            });
            this.hasModifications.set(true);
            return;
        }

        if (this.connectingFrom()) {
            this.connectingEnd.set(this.screenToWorld(event.clientX, event.clientY));

            const target = document.elementFromPoint(event.clientX, event.clientY);
            const nodeEl = target?.closest('.node-group');
            const pinEl = target?.closest('.pin');

            if (!nodeEl) { this.hoveredNode.set(null); this.hoveredPinIndex.set(null); return; }

            const unitId = nodeEl.getAttribute('data-unit-id') || '';
            const targetNode = this.nodesById().get(unitId);
            if (!targetNode || !this.validTargets().has(targetNode.unit.id)) {
                this.hoveredNode.set(null); this.hoveredPinIndex.set(null); return;
            }

            this.hoveredNode.set(targetNode);
            if (!pinEl) { this.hoveredPinIndex.set(null); return; }

            // pinEl is inside .pin-container, get index of .pin-container within .pins-container
            const pinContainer = pinEl.closest('.pin-container');
            const pinsContainer = pinContainer?.parentElement;
            const idx = Array.from(pinsContainer?.querySelectorAll(':scope > .pin-container') || []).indexOf(pinContainer!);
            this.hoveredPinIndex.set(this.isPinValidTarget(targetNode, idx) ? idx : null);
            return;
        }

        if (this.activeTouches.size > 0 && this.lastPanPoint) {
            const currentPanPoint = this.getEffectivePanPoint();
            let newOffsetX = this.viewOffset().x + currentPanPoint.x - this.lastPanPoint.x;
            let newOffsetY = this.viewOffset().y + currentPanPoint.y - this.lastPanPoint.y;

            if (this.activeTouches.size === 2) {
                const touches = Array.from(this.activeTouches.values());
                const currentDistance = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
                const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartZoom * currentDistance / this.pinchStartDistance));
                const oldZoom = this.zoom();

                if (newZoom !== oldZoom) {
                    const svg = this.svgCanvas()?.nativeElement;
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
                        const centerX = currentPanPoint.x - rect.left, centerY = currentPanPoint.y - rect.top;
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
        this.activeTouches.delete(event.pointerId);
        this.pendingMoveEvent = null;

        if (this.activeTouches.size > 0) {
            this.lastPanPoint = this.getEffectivePanPoint();
            if (this.activeTouches.size === 2) this.startPinchGesture();
        }

        const dragged = this.draggedNode();
        if (dragged) {
            if (this.resolveNodeCollisions(dragged)) this.nodes.set([...this.nodes()]);
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
                    // pinEl is inside .pin-container, get index of .pin-container within .pins-container
                    const pinContainer = pinEl?.closest('.pin-container');
                    const pinsContainer = pinContainer?.parentElement;
                    const explicitTargetPin = pinContainer ? Array.from(pinsContainer?.querySelectorAll(':scope > .pin-container') || []).indexOf(pinContainer) : -1;
                    let targetPin = explicitTargetPin;
                    if (targetPin < 0 || !this.isPinValidTarget(targetNode, targetPin)) {
                        const validPins = this.getValidPinsForTarget(targetNode);
                        targetPin = validPins.length > 0 ? validPins[0] : -1;
                    }

                    if (targetPin >= 0) {
                        const sourceComp = conn.node.c3Components[conn.compIndex];
                        const targetComp = targetNode.c3Components[targetPin];
                        const existingConnection = this.networkModel().connectionBetween(
                            { unitId: conn.node.unit.id, compIndex: conn.compIndex }, sourceComp.role,
                            { unitId: targetNode.unit.id, compIndex: targetPin }, targetComp.role,
                            sourceComp.networkType);

                        if (existingConnection) {
                            // For self-connections (same unit), only allow removal if:
                            // 1. User explicitly targeted a valid pin (not auto-selected)
                            // 2. The target pin is different from the source pin
                            const isSelfConnection = conn.node.unit.id === targetNode.unit.id;
                            const isExplicitDifferentPin = explicitTargetPin >= 0 
                                && this.isPinValidTarget(targetNode, explicitTargetPin) 
                                && explicitTargetPin !== conn.compIndex;
                            
                            if (!isSelfConnection || isExplicitDifferentPin) {
                                if (existingConnection.member) {
                                    const result = C3NetworkEditor.removeConnection(
                                        this.networks(), existingConnection.networkId, existingConnection.member);
                                    this.networks.set(result.networks);
                                } else {
                                    const result = C3NetworkEditor.disconnect(
                                        this.networks(), conn.node.unit.id, conn.compIndex,
                                        sourceComp.role, sourceComp.networkType);
                                    this.networks.set(result.networks);
                                }
                                this.hasModifications.set(true);
                                this.toastService.showToast('Connection removed', 'success');
                            }
                        } else if (!this.data.readOnly) {
                            const result = C3NetworkEditor.connect(this.getNetworkContext(), conn.node, conn.compIndex, targetNode, targetPin);
                            if (result.success) {
                                this.networks.set(result.networks);
                                this.hasModifications.set(true);
                                this.toastService.showToast(result.message || 'Connected', 'success');
                            }
                        }
                    }
                }
            }

            this.connectingFrom.set(null);
            this.hoveredNode.set(null);
            this.hoveredPinIndex.set(null);
        }

        this.draggedNode.set(null);
        if (this.activeTouches.size === 0) this.cleanupGlobalPointerState();
    };

    protected onWheel(event: WheelEvent) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = this.zoom();
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * delta));

        const svg = this.svgCanvas()?.nativeElement;
        if (svg && newZoom !== oldZoom) {
            const rect = svg.getBoundingClientRect();
            const mouseX = event.clientX - rect.left, mouseY = event.clientY - rect.top;
            const offset = this.viewOffset();
            const zoomRatio = newZoom / oldZoom;
            this.viewOffset.set({ x: mouseX - (mouseX - offset.x) * zoomRatio, y: mouseY - (mouseY - offset.y) * zoomRatio });
        }
        this.zoom.set(newZoom);
    }

    public toggleConnectionsAboveNodes() {
        this.optionsService.setOption('c3NetworkConnectionsAboveNodes', !this.optionsService.options().c3NetworkConnectionsAboveNodes);
    }

    protected removeNetwork(network: SerializedC3NetworkGroup) {
        if (this.data.readOnly) return;
        this.networks.update(networks => {
            const removeIds = new Set(new C3Network(networks).treeNetworks(network.id).map(member => member.id));
            return networks.filter(member => !removeIds.has(member.id));
        });
        this.hasModifications.set(true);
    }

    protected clearAllNetworks() {
        if (this.data.readOnly) return;
        this.networks.set([]);
        this.hasModifications.set(true);
    }

    protected isNodeLinked(node: C3Node): boolean {
        return this.unitConnectionStatus().get(node.unit.id) ?? false;
    }

    protected getNodeBorderColor(node: C3Node): string {
        const colors = this.nodeBorderColors().get(node.unit.id) || [];
        return colors.length > 0 ? colors[0] : '#666';
    }

    protected getPinStrokeColor(node: C3Node, compIndex: number): string {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        if (state?.disabled) return '#555';
        if (state?.color) return state.color;

        const comp = node.c3Components[compIndex];
        if (comp?.role === C3Role.MASTER) {
            return this.masterPinColors.get(`${node.unit.id}:${compIndex}`) || '#666';
        }
        return '#666';
    }

    protected getPinFillColor(node: C3Node, compIndex: number): string {
        const state = this.pinConnectionState().get(`${node.unit.id}:${compIndex}`);
        if (state?.disabled) return '#2a2a2a';

        const comp = node.c3Components[compIndex];
        if (comp?.role === C3Role.MASTER) {
            return state?.connected && state?.color ? state.color : '#333';
        }
        return state?.connected && state?.color ? state.color : '#333';
    }

    protected getPinNetworkColor(node: C3Node, compIndex: number): string | null {
        return this.pinConnectionState().get(`${node.unit.id}:${compIndex}`)?.color ?? null;
    }

    protected isPinConnected(node: C3Node, compIndex: number): boolean {
        return this.pinConnectionState().get(`${node.unit.id}:${compIndex}`)?.connected ?? false;
    }

    protected isPinDisabled(node: C3Node, compIndex: number): boolean {
        return this.pinConnectionState().get(`${node.unit.id}:${compIndex}`)?.disabled ?? false;
    }

    protected getPinRoleLabel(node: C3Node, compIndex: number): string {
        return this.pinConnectionState().get(`${node.unit.id}:${compIndex}`)?.roleLabel ?? '?';
    }

    protected getNetworkTypeLabel(type: C3NetworkType, boosted?: boolean): string {
        const name = c3NetworkTypeName(type);
        return boosted && type === C3NetworkType.C3 ? name + '(B)' : name;
    }

    protected removeUnitFromNetwork(network: SerializedC3NetworkGroup, unitId: string, memberStr?: string) {
        if (this.data.readOnly) return;

        if (network.peerIds) {
            const result = C3NetworkEditor.removeConnection(this.networks(), network.id, undefined, unitId);
            this.networks.set(result.networks);
        } else if (memberStr) {
            const result = C3NetworkEditor.removeConnection(this.networks(), network.id, memberStr);
            this.networks.set(result.networks);
        }
        this.hasModifications.set(true);
    }

    /**
     * Auto-configure networks based on groups and C3 rules.
     * - For peer networks: connect units in the same group first, balance network sizes
     * - For master-slave networks: connect internal pins first, then connect slaves to masters
     */
    protected async autoConfigureNetworks(): Promise<void> {
        if (this.data.readOnly) return;

        const nodes = this.nodes();
        const groups = this.getGroups();
        let networks = [...this.networks()];

        // Prune only empty same-unit internal branches. An external C3M remains a valid
        // terminal Master child even when it has no children of its own.
        let removedEmptyMasterBranch = true;
        while (removedEmptyMasterBranch) {
            removedEmptyMasterBranch = false;
            const model = new C3Network(networks);
            networks = networks.flatMap(network => {
                if (network.type !== C3NetworkType.C3 || !network.members) return [network];
                const members = network.members.filter(member => {
                    const endpoint = C3Network.parseMember(member);
                    if (endpoint.compIndex === undefined) return true;
                    if (endpoint.unitId !== network.masterId) return true;
                    const branch = model.masterNetwork(endpoint.unitId, endpoint.compIndex);
                    return !!branch?.members?.length;
                });
                if (members.length !== network.members.length) removedEmptyMasterBranch = true;
                return members.length ? [{ ...network, members }] : [];
            });
        }

        // Build group membership map
        const unitGroupMap = new Map<string, string>();
        for (const group of groups) {
            for (const unit of group.units()) {
                unitGroupMap.set(unit.id, group.id);
            }
        }

        // Separate nodes by network type
        const peerNodes: C3Node[] = [];
        const masterNodes: C3Node[] = [];
        const slaveOnlyNodes: C3Node[] = [];

        for (const node of nodes) {
            const hasPeer = node.c3Components.some(c => c.role === C3Role.PEER);
            const hasMaster = node.c3Components.some(c => c.role === C3Role.MASTER);
            const hasSlave = node.c3Components.some(c => c.role === C3Role.SLAVE);

            if (hasPeer) {
                peerNodes.push(node);
            } else if (hasMaster) {
                masterNodes.push(node);
            } else if (hasSlave) {
                slaveOnlyNodes.push(node);
            }
        }

        // ========== PEER NETWORKS (with balanced distribution) ==========
        // Group peers by network type first
        const peersByType = new Map<C3NetworkType, C3Node[]>();
        for (const node of peerNodes) {
            const peerComp = node.c3Components.find(c => c.role === C3Role.PEER);
            if (!peerComp) continue;
            const existing = peersByType.get(peerComp.networkType) || [];
            existing.push(node);
            peersByType.set(peerComp.networkType, existing);
        }

        for (const [networkType, allPeersOfType] of peersByType) {
            const limit = C3_NETWORK_LIMITS[networkType];

            // Skip peers that are already in a network: don't re-wire them
            const peerModel = new C3Network(networks);
            const unconnectedPeers = allPeersOfType.filter(n => !peerModel.isUnitConnected(n.unit.id));
            if (unconnectedPeers.length < 2) continue;

            // Sort peers by group to keep same-group units together
            unconnectedPeers.sort((a, b) => {
                const aGroup = unitGroupMap.get(a.unit.id) || '';
                const bGroup = unitGroupMap.get(b.unit.id) || '';
                return aGroup.localeCompare(bGroup);
            });

            const totalPeers = unconnectedPeers.length;

            // Calculate balanced network distribution
            // numNetworks = ceil(totalPeers / limit)
            // base = floor(totalPeers / numNetworks)
            // remainder = totalPeers % numNetworks
            // Create (numNetworks - remainder) networks with base members
            // Create remainder networks with (base + 1) members
            const numNetworks = Math.ceil(totalPeers / limit);
            const base = Math.floor(totalPeers / numNetworks);
            const remainder = totalPeers % numNetworks;

            // Build balanced chunks
            const chunks: C3Node[][] = [];
            let idx = 0;
            for (let i = 0; i < numNetworks; i++) {
                const chunkSize = i < (numNetworks - remainder) ? base : base + 1;
                if (chunkSize >= 2) {
                    chunks.push(unconnectedPeers.slice(idx, idx + chunkSize));
                }
                idx += chunkSize;
            }

            // Connect peers within each balanced chunk
            for (const chunk of chunks) {
                if (chunk.length < 2) continue;
                
                const ctx = this.getNetworkContext();
                ctx.networks = networks;
                
                // Connect all to the first node
                for (let j = 1; j < chunk.length; j++) {
                    const peerComp0 = chunk[0].c3Components.findIndex(c => c.role === C3Role.PEER);
                    const peerCompJ = chunk[j].c3Components.findIndex(c => c.role === C3Role.PEER);
                    if (peerComp0 >= 0 && peerCompJ >= 0) {
                        const canConnect = C3NetworkEditor.canConnect(chunk[0], peerComp0, chunk[j], peerCompJ, ctx.networks);
                        if (canConnect.valid) {
                            const result = C3NetworkEditor.connect(ctx, chunk[0], peerComp0, chunk[j], peerCompJ);
                            if (result.success) {
                                networks = result.networks;
                                ctx.networks = networks;
                            }
                        }
                    }
                }
            }
        }

        // ========== MASTER-SLAVE NETWORKS ==========
        // The goal is to:
        // 1. Connect all slaves to master pins (prefer single-pin masters first)
        // 2. Connect master networks together using multi-pin masters as Grand Masters
        // 3. Leave unused Master endpoints disconnected

        // Collect all master pins with metadata
        interface MasterPin {
            node: C3Node;
            compIndex: number;
            pinCount: number; // total master pins on this node
        }
        const allMasterPins: MasterPin[] = [];
        for (const node of masterNodes) {
            const masterComps = node.c3Components
                .map((c, idx) => ({ comp: c, idx }))
                .filter(x => x.comp.role === C3Role.MASTER);
            for (const mc of masterComps) {
                allMasterPins.push({
                    node,
                    compIndex: mc.idx,
                    pinCount: masterComps.length
                });
            }
        }

        // Sort master pins: prefer single-pin masters first (they must be regular masters, not GMs)
        // Within same pin count, sort by group
        allMasterPins.sort((a, b) => {
            if (a.pinCount !== b.pinCount) return a.pinCount - b.pinCount;
            const aGroup = unitGroupMap.get(a.node.unit.id) || '';
            const bGroup = unitGroupMap.get(b.node.unit.id) || '';
            return aGroup.localeCompare(bGroup);
        });

        const slaveLimit = 3; // C3 slaves per master pin

        // Helper to count how many more slaves a master pin can accept
        const getAvailableSlaveSlots = (pin: MasterPin, nets: SerializedC3NetworkGroup[]): number => {
            const net = new C3Network(nets).masterNetwork(pin.node.unit.id, pin.compIndex);
            if (!net) return slaveLimit;
            return slaveLimit - (net.members?.length ?? 0);
        };

        // Helper to check if a pin is already a child of another master
        const isPinChild = (pin: MasterPin, nets: SerializedC3NetworkGroup[]): boolean => {
            return !!new C3Network(nets).parentNetworkForEndpoint(pin.node.unit.id, pin.compIndex);
        };

        // Helper to check if a pin has an active network
        const pinHasNetwork = (pin: MasterPin, nets: SerializedC3NetworkGroup[]): boolean => {
            const net = new C3Network(nets).masterNetwork(pin.node.unit.id, pin.compIndex);
            return !!(net && net.members && net.members.length > 0);
        };

        // Step 1: Connect all slaves to master pins
        // Pre-populate connectedSlaves from existing networks so we don't re-wire them
        const connectedSlaves = new Set<string>();
        for (const slaveNode of slaveOnlyNodes) {
            if (new C3Network(networks).isUnitConnected(slaveNode.unit.id)) {
                connectedSlaves.add(slaveNode.unit.id);
            }
        }
        const allSlaveNodes = [...slaveOnlyNodes].sort((a, b) => {
            const aGroup = unitGroupMap.get(a.unit.id) || '';
            const bGroup = unitGroupMap.get(b.unit.id) || '';
            return aGroup.localeCompare(bGroup);
        });

        for (const slaveNode of allSlaveNodes) {
            if (connectedSlaves.has(slaveNode.unit.id)) continue;
            
            const slaveCompIdx = slaveNode.c3Components.findIndex(c => c.role === C3Role.SLAVE);
            if (slaveCompIdx < 0) continue;
            
            const slaveGroup = unitGroupMap.get(slaveNode.unit.id) || '';
            
            // Find best master pin: only same group, then prefer single-pin masters, then heavier/slower
            // Hard-filter to same group when the slave has a group assignment
            const eligiblePins = slaveGroup
                ? allMasterPins.filter(p => unitGroupMap.get(p.node.unit.id) === slaveGroup)
                : allMasterPins;
            const candidates = [...eligiblePins].sort((a, b) => {
                // Prefer single-pin masters (they can only be sub-masters)
                if (a.pinCount !== b.pinCount) return a.pinCount - b.pinCount;
                
                // Prefer heavier units as masters (higher tonnage = lower sort value)
                const aTonnage = a.node.unit.getUnit().tons ?? 0;
                const bTonnage = b.node.unit.getUnit().tons ?? 0;
                if (aTonnage !== bTonnage) return bTonnage - aTonnage;
                
                // Prefer slower units as masters (lower movement = lower sort value)
                const aMove = a.node.unit.getUnit().walk ?? 99;
                const bMove = b.node.unit.getUnit().walk ?? 99;
                return aMove - bMove;
            });
            
            for (const masterPin of candidates) {
                const available = getAvailableSlaveSlots(masterPin, networks);
                if (available <= 0) continue;
                
                const ctx = this.getNetworkContext();
                ctx.networks = networks;
                
                const canConnect = C3NetworkEditor.canConnect(
                    masterPin.node, masterPin.compIndex, 
                    slaveNode, slaveCompIdx, 
                    networks
                );
                
                if (canConnect.valid) {
                    const result = C3NetworkEditor.connect(
                        ctx, 
                        masterPin.node, masterPin.compIndex, 
                        slaveNode, slaveCompIdx
                    );
                    if (result.success) {
                        networks = result.networks;
                        connectedSlaves.add(slaveNode.unit.id);
                        break;
                    }
                }
            }
        }

        // Step 2: Connect master networks into hierarchies
        // Algorithm:
        // 1. Try external connections for ALL masters first
        // 2. Only if no external connection was possible, try ONE internal connection
        // 3. After any internal connection, restart external check for all (it may unlock new GMs)
        
        const gmLimit = 3;
        
        // Helper to get available slots under a GM pin
        const getGmAvailableSlots = (pin: MasterPin, nets: SerializedC3NetworkGroup[]): number => {
            const net = new C3Network(nets).masterNetwork(pin.node.unit.id, pin.compIndex);
            return gmLimit - (net?.members?.length ?? 0);
        };
        
        let hierarchyChanged = true;
        while (hierarchyChanged) {
            hierarchyChanged = false;
            
            // Get all masters that have networks but are not yet children
            const mastersNeedingGm = () => allMasterPins.filter(pin => {
                const hasNet = pinHasNetwork(pin, networks);
                const isChild = isPinChild(pin, networks);
                return hasNet && !isChild;
            });
            
            // Pass 1: Try external connections for ALL masters
            let externalConnectionMade = false;
            for (const masterPin of mastersNeedingGm()) {
                const masterGroup = unitGroupMap.get(masterPin.node.unit.id) || '';
                
                // Find external GM candidates only (other nodes, same group)
                const externalCandidates = allMasterPins.filter(candidate => {
                    if (candidate.node.unit.id === masterPin.node.unit.id) return false; // Same node = internal
                    if (masterGroup && unitGroupMap.get(candidate.node.unit.id) !== masterGroup) return false; // Same group only
                    if (isPinChild(candidate, networks)) return false;
                    return getGmAvailableSlots(candidate, networks) > 0;
                });
                
                // Sort: prefer those with networks, then heavier/slower units as GMs
                externalCandidates.sort((a, b) => {
                    const aHasNet = pinHasNetwork(a, networks) ? 0 : 1;
                    const bHasNet = pinHasNetwork(b, networks) ? 0 : 1;
                    if (aHasNet !== bHasNet) return aHasNet - bHasNet;
                    
                    // Prefer heavier units as GMs (higher tonnage = lower sort value)
                    const aTonnage = a.node.unit.getUnit().tons ?? 0;
                    const bTonnage = b.node.unit.getUnit().tons ?? 0;
                    if (aTonnage !== bTonnage) return bTonnage - aTonnage;
                    
                    // Prefer slower units as GMs (lower movement = lower sort value)
                    const aMove = a.node.unit.getUnit().walk ?? 99;
                    const bMove = b.node.unit.getUnit().walk ?? 99;
                    return aMove - bMove;
                });
                
                for (const gmPin of externalCandidates) {
                    const ctx = this.getNetworkContext();
                    ctx.networks = networks;
                    
                    const canConnect = C3NetworkEditor.canConnect(
                        gmPin.node, gmPin.compIndex,
                        masterPin.node, masterPin.compIndex,
                        networks
                    );
                    
                    if (canConnect.valid) {
                        const result = C3NetworkEditor.connect(
                            ctx,
                            gmPin.node, gmPin.compIndex,
                            masterPin.node, masterPin.compIndex
                        );
                        if (result.success) {
                            networks = result.networks;
                            externalConnectionMade = true;
                            hierarchyChanged = true;
                            break;
                        }
                    }
                }
                
                if (externalConnectionMade) break; // Restart the whole loop
            }
            
            // Pass 2: If no external connection was made, promote ONE internal endpoint
            // above this useful branch. Never attach an empty internal endpoint as a child.
            // Only consider masters on nodes with multiple pins (single-pin masters can't have internal connections)
            if (!externalConnectionMade) {
                for (const masterPin of mastersNeedingGm().filter(p => p.pinCount > 1)) {
                    // Find internal GM candidates (same node, different pin)
                    const internalCandidates = allMasterPins.filter(candidate => {
                        if (candidate.node.unit.id !== masterPin.node.unit.id) return false; // Must be same node
                        if (candidate.compIndex === masterPin.compIndex) return false; // Not same pin
                        if (isPinChild(candidate, networks)) return false;
                        return getGmAvailableSlots(candidate, networks) > 0;
                    });
                    for (const gmPin of internalCandidates) {
                        const ctx = this.getNetworkContext();
                        ctx.networks = networks;
                        
                        const canConnect = C3NetworkEditor.canConnect(
                            gmPin.node, gmPin.compIndex,
                            masterPin.node, masterPin.compIndex,
                            networks
                        );
                        if (canConnect.valid) {
                            const result = C3NetworkEditor.connect(
                                ctx,
                                gmPin.node, gmPin.compIndex,
                                masterPin.node, masterPin.compIndex
                            );
                            if (result.success) {
                                networks = result.networks;
                                hierarchyChanged = true; // Restart to try external again for everyone
                                break;
                            }
                        }
                    }
                    
                    if (hierarchyChanged) break; // Only do ONE internal, then restart external
                }
            }
        }

        // ========== CROSS-GROUP PASS ==========
        // Run the cross-group linking on a cloned network to see if it produces any real changes.
        // If it does, prompt the user before applying.

        const preCrossGroupNetworks = networks.map(n => ({ ...n, members: n.members ? [...n.members] : undefined, peerIds: n.peerIds ? [...n.peerIds] : undefined }));
        const preCrossGroupSlaves = new Set(connectedSlaves);

        // --- Cross-group linking function (operates on the live `networks` variable) ---
        const runCrossGroupPass = () => {
            // (a) Orphan slaves to cross-group masters with existing networks
            const unconnectedSlaves = slaveOnlyNodes.filter(n => !connectedSlaves.has(n.unit.id));
            for (const slaveNode of unconnectedSlaves) {
                const slaveCompIdx = slaveNode.c3Components.findIndex(c => c.role === C3Role.SLAVE);
                if (slaveCompIdx < 0) continue;

                const candidates = allMasterPins
                    .filter(p => pinHasNetwork(p, networks) && getAvailableSlaveSlots(p, networks) > 0)
                    .sort((a, b) => {
                        const aTonnage = a.node.unit.getUnit().tons ?? 0;
                        const bTonnage = b.node.unit.getUnit().tons ?? 0;
                        if (aTonnage !== bTonnage) return bTonnage - aTonnage;
                        const aMove = a.node.unit.getUnit().walk ?? 99;
                        const bMove = b.node.unit.getUnit().walk ?? 99;
                        return aMove - bMove;
                    });

                for (const masterPin of candidates) {
                    const ctx = this.getNetworkContext();
                    ctx.networks = networks;
                    const canConnect = C3NetworkEditor.canConnect(
                        masterPin.node, masterPin.compIndex, slaveNode, slaveCompIdx, networks
                    );
                    if (canConnect.valid) {
                        const result = C3NetworkEditor.connect(ctx, masterPin.node, masterPin.compIndex, slaveNode, slaveCompIdx);
                        if (result.success) {
                            networks = result.networks;
                            connectedSlaves.add(slaveNode.unit.id);
                            break;
                        }
                    }
                }
            }

            // (b) Root network masters → find cross-group GM
            const linkRootMasters = () => {
                let changed = true;
                while (changed) {
                    changed = false;
                    const roots = allMasterPins.filter(pin => pinHasNetwork(pin, networks) && !isPinChild(pin, networks));

                    for (const rootPin of roots) {
                        const gmCandidates = allMasterPins
                            .filter(c => {
                                if (c.node.unit.id === rootPin.node.unit.id) return false;
                                if (isPinChild(c, networks)) return false;
                                return getGmAvailableSlots(c, networks) > 0;
                            })
                            .sort((a, b) => {
                                const aHasNet = pinHasNetwork(a, networks) ? 0 : 1;
                                const bHasNet = pinHasNetwork(b, networks) ? 0 : 1;
                                if (aHasNet !== bHasNet) return aHasNet - bHasNet;

                                const aTonnage = a.node.unit.getUnit().tons ?? 0;
                                const bTonnage = b.node.unit.getUnit().tons ?? 0;
                                if (aTonnage !== bTonnage) return bTonnage - aTonnage;
                                const aMove = a.node.unit.getUnit().walk ?? 99;
                                const bMove = b.node.unit.getUnit().walk ?? 99;
                                return aMove - bMove;
                            });

                        for (const gmPin of gmCandidates) {
                            const ctx = this.getNetworkContext();
                            ctx.networks = networks;
                            const canConnect = C3NetworkEditor.canConnect(
                                gmPin.node, gmPin.compIndex, rootPin.node, rootPin.compIndex, networks
                            );
                            if (canConnect.valid) {
                                const result = C3NetworkEditor.connect(ctx, gmPin.node, gmPin.compIndex, rootPin.node, rootPin.compIndex);
                                if (result.success) {
                                    networks = result.networks;
                                    changed = true;
                                    break;
                                }
                            }
                        }
                        if (changed) break;
                    }
                }
            };
            linkRootMasters();

            // (c) Remaining orphan slaves → attach to any master with available slots
            const stillUnconnectedSlaves = slaveOnlyNodes.filter(n => !connectedSlaves.has(n.unit.id));
            for (const slaveNode of stillUnconnectedSlaves) {
                const slaveCompIdx = slaveNode.c3Components.findIndex(c => c.role === C3Role.SLAVE);
                if (slaveCompIdx < 0) continue;

                const candidates = allMasterPins
                    .filter(p => getAvailableSlaveSlots(p, networks) > 0)
                    .sort((a, b) => {
                        const aTonnage = a.node.unit.getUnit().tons ?? 0;
                        const bTonnage = b.node.unit.getUnit().tons ?? 0;
                        if (aTonnage !== bTonnage) return bTonnage - aTonnage;
                        const aMove = a.node.unit.getUnit().walk ?? 99;
                        const bMove = b.node.unit.getUnit().walk ?? 99;
                        return aMove - bMove;
                    });

                for (const masterPin of candidates) {
                    const ctx = this.getNetworkContext();
                    ctx.networks = networks;
                    const canConnect = C3NetworkEditor.canConnect(
                        masterPin.node, masterPin.compIndex, slaveNode, slaveCompIdx, networks
                    );
                    if (canConnect.valid) {
                        const result = C3NetworkEditor.connect(ctx, masterPin.node, masterPin.compIndex, slaveNode, slaveCompIdx);
                        if (result.success) {
                            networks = result.networks;
                            connectedSlaves.add(slaveNode.unit.id);
                            break;
                        }
                    }
                }
            }

            // (d) Final re-check
            linkRootMasters();
        };

        // Run cross-group pass on the live networks variable
        runCrossGroupPass();

        // Compare: did cross-group actually change anything?
        const crossGroupChanged = JSON.stringify(networks) !== JSON.stringify(preCrossGroupNetworks);

        if (crossGroupChanged) {
            // Cross-group made real changes: ask the user
            const postCrossGroupNetworks = networks;
            const doCrossGroup = await this.dialogsService.requestConfirmation(
                'Cross-group connections are available. Apply cross-group linking?',
                'Cross-Group Linking',
                'info'
            );
            // Pick the appropriate network state based on user choice
            networks = doCrossGroup ? postCrossGroupNetworks : preCrossGroupNetworks;
        }

        // Validate and clean the networks
        const unitsMap = new Map(this.getUnits().map(u => [u.id, u]));
        networks = C3NetworkEditor.clean(networks, unitsMap);

        this.networks.set(networks);

        // ========== ARRANGE NODES BY NETWORK ==========
        this.arrangeNodesByNetwork(networks);
        this.resolveAllNodeCollisions();

        this.hasModifications.set(true);
        this.toastService.showToast('Networks auto-configured', 'success');

        // Fit view to show all nodes
        setTimeout(() => this.fitViewToNodes(), 50);
    }

    /**
     * Arrange nodes visually by their network membership.
     * - Peer networks: arranged in a circle
     * - Master-slave networks: master in center with slaves around it
     * - Unconnected nodes: placed in a separate area
     */
    private arrangeNodesByNetwork(networks: SerializedC3NetworkGroup[]): void {
        const nodes = this.nodes();
        const nodesById = this.nodesById();
        const nodeSpacing = this.NODE_RADIUS + 20;
        const groupSpacing = 700; // Fixed spacing between network groups

        // Track which nodes have been positioned
        const positionedNodeIds = new Set<string>();

        // Collect network groups for layout
        interface NetworkLayout {
            type: 'peer' | 'master-slave';
            nodeIds: string[];
            masterId?: string;
        }
        const networkLayouts: NetworkLayout[] = [];

        // Process peer networks
        for (const net of networks) {
            if (net.peerIds && net.peerIds.length >= 2) {
                const validIds = net.peerIds.filter(id => nodesById.has(id));
                if (validIds.length > 0) {
                    networkLayouts.push({
                        type: 'peer',
                        nodeIds: validIds
                    });
                }
            }
        }

        // Process master-slave networks (only top-level ones)
        const layoutModel = new C3Network(networks);
        const topLevelNetworks = layoutModel.topLevelNetworks;
        for (const net of topLevelNetworks) {
            if (net.masterId && net.members && net.members.length > 0) {
                const nodeIds: string[] = [net.masterId];
                
                // Collect all member unit IDs (including sub-networks)
                const collectMembers = (network: SerializedC3NetworkGroup) => {
                    for (const memberStr of network.members || []) {
                        const parsed = C3Network.parseMember(memberStr);
                        if (parsed.unitId !== network.masterId && !nodeIds.includes(parsed.unitId)) {
                            nodeIds.push(parsed.unitId);
                        }
                        if (parsed.compIndex !== undefined) {
                            const subNet = layoutModel.masterNetwork(parsed.unitId, parsed.compIndex);
                            if (subNet) collectMembers(subNet);
                        }
                    }
                };
                collectMembers(net);

                const validIds = nodeIds.filter(id => nodesById.has(id));
                if (validIds.length > 0) {
                    networkLayouts.push({
                        type: 'master-slave',
                        nodeIds: validIds,
                        masterId: net.masterId
                    });
                }
            }
        }

        // Add unconnected nodes as individual "groups"
        const unconnectedNodes = nodes.filter(n => {
            const id = n.unit.id;
            return !networkLayouts.some(l => l.nodeIds.includes(id));
        });

        // Get aspect ratio from canvas (for grid shape preference)
        const el = this.svgCanvas()?.nativeElement;
        const canvasW = el?.clientWidth || 1200;
        const canvasH = el?.clientHeight || 800;
        const aspectRatio = canvasW / canvasH;

        // Calculate grid layout based on aspect ratio
        const totalGroups = networkLayouts.length + (unconnectedNodes.length > 0 ? 1 : 0);
        if (totalGroups === 0) {
            this.nodes.set([...nodes]);
            return;
        }

        // Determine grid columns/rows based on aspect ratio
        let cols = Math.max(1, Math.round(Math.sqrt(totalGroups * aspectRatio)));
        let rows = Math.ceil(totalGroups / cols);
        
        // Adjust to better fill the space
        while (cols > 1 && (cols - 1) * rows >= totalGroups) cols--;
        rows = Math.ceil(totalGroups / cols);

        // Position each network group in a grid cell with fixed spacing
        let groupIndex = 0;
        for (const layout of networkLayouts) {
            const layoutNodes = layout.nodeIds.map(id => nodesById.get(id)).filter((n): n is C3Node => !!n);
            if (layoutNodes.length === 0) continue;
            if (layoutNodes.every(n => positionedNodeIds.has(n.unit.id))) continue;

            const col = groupIndex % cols;
            const row = Math.floor(groupIndex / cols);
            
            // Use fixed spacing for cell centers
            const centerX = groupSpacing / 2 + col * groupSpacing;
            const centerY = groupSpacing / 2 + row * groupSpacing;

            if (layout.type === 'peer') {
                const count = layoutNodes.length;
                const radius = count <= 3 ? nodeSpacing * 0.8 : (count * nodeSpacing) / (2 * Math.PI);

                for (let i = 0; i < count; i++) {
                    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
                    layoutNodes[i].x = centerX + radius * Math.cos(angle);
                    layoutNodes[i].y = centerY + radius * Math.sin(angle);
                    positionedNodeIds.add(layoutNodes[i].unit.id);
                }
            } else {
                const masterNode = layoutNodes.find(n => n.unit.id === layout.masterId);
                const slaveNodes = layoutNodes.filter(n => n.unit.id !== layout.masterId);
                const slaveCount = slaveNodes.length;

                if (masterNode) {
                    masterNode.x = centerX;
                    masterNode.y = centerY;
                    positionedNodeIds.add(masterNode.unit.id);
                }

                const radius = slaveCount <= 3 ? nodeSpacing * 0.8 : (slaveCount * nodeSpacing) / (2 * Math.PI);
                for (let i = 0; i < slaveCount; i++) {
                    const angle = (2 * Math.PI * i) / slaveCount - Math.PI / 2;
                    slaveNodes[i].x = centerX + radius * Math.cos(angle);
                    slaveNodes[i].y = centerY + radius * Math.sin(angle);
                    positionedNodeIds.add(slaveNodes[i].unit.id);
                }
            }

            groupIndex++;
        }

        // Position unconnected nodes in remaining cell(s)
        if (unconnectedNodes.length > 0) {
            const col = groupIndex % cols;
            const row = Math.floor(groupIndex / cols);
            const cellCenterX = groupSpacing / 2 + col * groupSpacing;
            const cellCenterY = groupSpacing / 2 + row * groupSpacing;

            // Arrange in a small grid within the cell
            const unconnectedCols = Math.ceil(Math.sqrt(unconnectedNodes.length * aspectRatio));
            const unconnectedRows = Math.ceil(unconnectedNodes.length / unconnectedCols);
            const startX = cellCenterX - ((unconnectedCols - 1) * nodeSpacing) / 2;
            const startY = cellCenterY - ((unconnectedRows - 1) * nodeSpacing) / 2;

            for (let i = 0; i < unconnectedNodes.length; i++) {
                const c = i % unconnectedCols;
                const r = Math.floor(i / unconnectedCols);
                unconnectedNodes[i].x = startX + c * nodeSpacing;
                unconnectedNodes[i].y = startY + r * nodeSpacing;
            }
        }

        // Trigger update
        this.nodes.set([...nodes]);
    }

    protected saveAndClose() {
        for (const node of this.nodes()) {
            node.unit.setC3Position({ x: node.x, y: node.y });
        }
        const unitsMap = new Map(this.getUnits().map(u => [u.id, u]));
        this.networks.set(C3NetworkEditor.clean(this.networks(), unitsMap));
        this.dialogRef.close({ networks: this.networks(), updated: this.hasModifications() });
    }

    protected close() {
        this.dialogRef.close({ networks: this.getNetworks(), updated: false });
    }
}
