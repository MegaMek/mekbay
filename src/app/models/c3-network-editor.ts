// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { SerializedC3NetworkGroup } from './force-serialization';
import {
    type C3Component,
    type C3CapabilityView,
    C3Capabilities,
    C3Network,
    C3NetworkType,
    type C3Node,
    C3Role,
    C3_MAX_NETWORK_DEPTH,
    C3_MAX_NETWORK_TOTAL,
    C3_NETWORK_COLORS,
    C3_NETWORK_LIMITS,
} from './c3-network.model';
import { uuidv7 } from '../utils/uuid.util';
import { jsonValuesEqual } from '../utils/json-value.util';

export interface NetworkMutationResult {
    networks: SerializedC3NetworkGroup[];
    success: boolean;
    message?: string;
}

export interface C3NetworkContext {
    networks: SerializedC3NetworkGroup[];
    getNextColor: () => string;
    masterPinColors?: Map<string, string>;
}

type Validation = { valid: boolean; reason?: string };
type Endpoint = { node: C3Node; compIndex: number };
type EndpointStatus = {
    network?: SerializedC3NetworkGroup;
    parent?: SerializedC3NetworkGroup;
    connected: boolean;
};
type MasterConnectionResolution = {
    parent: Endpoint;
    child: Endpoint;
    validation: Validation;
};

/** Immutable C3 mutations and editing validation. Structural reads belong to C3Network. */
export class C3NetworkEditor {
    static canConnect(sourceNode: C3Node, sourceCompIndex: number, targetNode: C3Node,
        targetCompIndex: number, networks: SerializedC3NetworkGroup[]): Validation {
        const source = { node: sourceNode, compIndex: sourceCompIndex };
        const target = { node: targetNode, compIndex: targetCompIndex };
        const sourceComponent = this.component(source);
        const targetComponent = this.component(target);
        if (!sourceComponent || !targetComponent) return this.invalid('Invalid component');
        if (sourceComponent.networkType !== targetComponent.networkType) return this.invalid('Incompatible network types');
        if (sourceNode.unit.id === targetNode.unit.id && sourceCompIndex === targetCompIndex) {
            return this.invalid('Cannot connect pin to itself');
        }
        const model = new C3Network(networks);
        if (sourceComponent.role === C3Role.PEER && targetComponent.role === C3Role.PEER) {
            return this.canConnectPeers(source, target, sourceComponent.networkType, model);
        }
        if (sourceComponent.role === C3Role.MASTER && targetComponent.role === C3Role.SLAVE) {
            return this.canConnectSlave(source, target, model);
        }
        if (sourceComponent.role === C3Role.SLAVE && targetComponent.role === C3Role.MASTER) {
            return this.canConnectSlave(target, source, model);
        }
        if (sourceComponent.role === C3Role.MASTER && targetComponent.role === C3Role.MASTER) {
            return this.resolveMasterConnection(source, target, model).validation;
        }
        return this.invalid('Incompatible connection types');
    }

    static connect(context: C3NetworkContext, sourceNode: C3Node, sourceCompIndex: number,
        targetNode: C3Node, targetCompIndex: number): NetworkMutationResult {
        const validation = this.canConnect(sourceNode, sourceCompIndex, targetNode, targetCompIndex, context.networks);
        if (!validation.valid) return this.failure(context.networks, validation.reason ?? 'Invalid connection');
        const source = { node: sourceNode, compIndex: sourceCompIndex };
        const target = { node: targetNode, compIndex: targetCompIndex };
        const sourceRole = this.component(source)!.role;
        const targetRole = this.component(target)!.role;
        if (sourceRole === C3Role.PEER) {
            return this.connectPeers(context, sourceNode, targetNode, this.component(source)!.networkType);
        }
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.SLAVE) return this.addMember(context, source, targetNode.unit.id);
        if (sourceRole === C3Role.SLAVE && targetRole === C3Role.MASTER) return this.addMember(context, target, sourceNode.unit.id);
        if (sourceRole === C3Role.MASTER && targetRole === C3Role.MASTER) {
            const model = new C3Network(context.networks);
            const resolution = this.resolveMasterConnection(source, target, model);
            if (!resolution.validation.valid) {
                return this.failure(context.networks, resolution.validation.reason ?? 'Invalid connection');
            }
            return this.addMember(
                context,
                resolution.parent,
                resolution.child.node.unit.id,
                resolution.child.compIndex,
            );
        }
        return this.failure(context.networks, 'Incompatible roles');
    }

    static disconnect(networks: SerializedC3NetworkGroup[], unitId: string, compIndex: number,
        role: C3Role, networkType?: C3NetworkType): NetworkMutationResult {
        const model = new C3Network(networks);
        if (role === C3Role.SLAVE) {
            const network = model.networksForUnit(unitId).find(candidate => candidate.members?.includes(unitId));
            if (network) return this.removeConnection(networks, network.id, unitId);
        } else if (role === C3Role.MASTER) {
            const member = C3Network.masterMember(unitId, compIndex);
            const network = model.parentNetworkForEndpoint(unitId, compIndex);
            if (network) return this.removeConnection(networks, network.id, member);
        } else if (role === C3Role.PEER && networkType) {
            const network = model.peerNetwork(unitId, networkType);
            if (network) return this.removeConnection(networks, network.id, undefined, unitId);
        }
        return this.failure(networks, 'No connection found');
    }

    static removeConnection(networks: SerializedC3NetworkGroup[], networkId: string,
        member?: string, peerId?: string): NetworkMutationResult {
        if (peerId) return this.removePeer(networks, networkId, peerId);
        const index = networks.findIndex(network => network.id === networkId);
        if (index < 0 || !member || !networks[index].members) return this.failure([...networks], 'Network not found');
        const result = [...networks];
        const network = result[index];
        const members = network.members!.filter(candidate => candidate !== member);
        if (members.length) result[index] = { ...network, members }; else result.splice(index, 1);
        const parsed = C3Network.parseMember(member);
        if (parsed.compIndex !== undefined && parsed.unitId === network.masterId) {
            const subnetwork = new C3Network(result).masterNetwork(parsed.unitId, parsed.compIndex);
            if (subnetwork) result.splice(result.findIndex(candidate => candidate.id === subnetwork.id), 1);
        }
        return { networks: result, success: true };
    }

    static removeUnit(networks: SerializedC3NetworkGroup[], unitId: string): NetworkMutationResult {
        const model = new C3Network(networks);
        const removeIds = new Set<string>();
        for (const network of model.networksForUnit(unitId)) {
            if (network.masterId === unitId) {
                for (const descendant of model.treeNetworks(network.id)) removeIds.add(descendant.id);
            }
        }
        return {
            networks: networks.flatMap(network => {
                if (removeIds.has(network.id)) return [];
                if (network.peerIds?.includes(unitId)) {
                    const peerIds = network.peerIds.filter(id => id !== unitId);
                    return peerIds.length >= 2 ? [{ ...network, peerIds }] : [];
                }
                if (network.members?.some(member => C3Network.parseMember(member).unitId === unitId)) {
                    const members = network.members.filter(member => C3Network.parseMember(member).unitId !== unitId);
                    return members.length ? [{ ...network, members }] : [];
                }
                return [network];
            }),
            success: true,
        };
    }

    static nextColor(networks: readonly SerializedC3NetworkGroup[], assigned?: ReadonlyMap<string, string>): string {
        const usage = new Map<string, number>(C3_NETWORK_COLORS.map(color => [color, 0]));
        for (const network of networks) usage.set(network.color, (usage.get(network.color) ?? 0) + 1);
        for (const color of assigned?.values() ?? []) usage.set(color, (usage.get(color) ?? 0) + 1);
        let selected: string = C3_NETWORK_COLORS[0];
        for (const [color, count] of usage) if (count < usage.get(selected)!) selected = color;
        return selected;
    }

    /** True only when the supplied graph is already canonical under the editor's exact rules. */
    static validate(
        networks: readonly SerializedC3NetworkGroup[],
        unitsById: ReadonlyMap<string, C3CapabilityView>,
    ): boolean {
        const candidate = structuredClone(networks) as SerializedC3NetworkGroup[];
        return jsonValuesEqual(networks, this.clean(candidate, unitsById));
    }

    static clean(
        networks: SerializedC3NetworkGroup[],
        unitsById: ReadonlyMap<string, C3CapabilityView>,
    ): SerializedC3NetworkGroup[] {
        if (!networks?.length) return [];
        const capabilities = new Map<string, C3Capabilities>();
        for (const [id, unit] of unitsById) capabilities.set(id, new C3Capabilities(unit));
        const seenIds = new Set<string>();
        let result = networks.flatMap(network => {
            if (!network.id || seenIds.has(network.id)) return [];
            seenIds.add(network.id);
            const validated = this.validateNetwork(network, capabilities);
            return validated ? [validated] : [];
        });
        result = this.cleanDepth(result);
        result = this.cleanTotalUnits(result);
        result = this.cleanMixedMembers(result);
        result = this.cleanNonCanonicalMasterTiers(result);
        return this.cleanSplitUnitTrees(result);
    }

    private static canConnectPeers(source: Endpoint, target: Endpoint, type: C3NetworkType, model: C3Network): Validation {
        const sourceNetwork = model.peerNetwork(source.node.unit.id, type);
        const targetNetwork = model.peerNetwork(target.node.unit.id, type);
        const sourceOtherNetwork = model.networksForUnit(source.node.unit.id)
            .some(network => network.id !== sourceNetwork?.id);
        const targetOtherNetwork = model.networksForUnit(target.node.unit.id)
            .some(network => network.id !== targetNetwork?.id);
        if (sourceOtherNetwork || targetOtherNetwork) {
            return this.invalid('Unit is already part of another network');
        }
        if (sourceNetwork && targetNetwork && sourceNetwork.id === targetNetwork.id) return this.invalid('Already in same network');
        const limit = C3_NETWORK_LIMITS[type];
        const sourceCount = sourceNetwork?.peerIds?.length ?? 1;
        const targetCount = targetNetwork?.peerIds?.length ?? 1;
        return sourceCount >= limit && targetCount >= limit
            ? this.invalid(`Both networks are at limit of ${limit}`) : { valid: true };
    }

    private static canConnectSlave(master: Endpoint, slave: Endpoint, model: C3Network): Validation {
        const masterId = master.node.unit.id;
        const slaveId = slave.node.unit.id;
        if (masterId === slaveId) return this.invalid('Cannot connect same unit');
        if (this.externalParentCount(slaveId, model.networks) > 0) {
            return this.invalid('Unit already has an external master');
        }
        if (this.networkRootIds(slaveId, model.networks).size > 0) {
            return this.invalid('Connection would split the slave unit across multiple networks');
        }
        const masterRoots = this.networkRootIds(masterId, model.networks);
        if (masterRoots.size > 1) {
            return this.invalid('Master unit is split across multiple networks');
        }
        if (model.networksForUnit(masterId).some(network => !!network.peerIds)) {
            return this.invalid('Unit is already part of another network');
        }
        const alternate = this.validateAlternateMasterPin(master, model, true);
        if (!alternate.valid) return alternate;
        const status = this.endpointStatus(master, model);
        if (status.network) {
            const limit = C3_NETWORK_LIMITS[status.network.type];
            if ((status.network.members?.length ?? 0) >= limit) return this.invalid(`Master has max ${limit} children`);
            if (status.network.members?.some(member => C3Network.parseMember(member).compIndex !== undefined)) {
                return this.invalid('Cannot mix slaves with sub-masters');
            }
            if (model.depthOf(status.network.id) >= C3_MAX_NETWORK_DEPTH) return this.invalid(`Would exceed depth ${C3_MAX_NETWORK_DEPTH}`);
        } else if (status.parent && model.depthOf(status.parent.id) + 1 >= C3_MAX_NETWORK_DEPTH) {
            return this.invalid(`Would exceed depth ${C3_MAX_NETWORK_DEPTH}`);
        }
        const root = status.network ? model.rootOf(status.network.id)
            : status.parent ? model.rootOf(status.parent.id)
                : masterRoots.size === 1 ? model.network([...masterRoots][0]) : undefined;
        const unitIds = new Set(root ? model.treeUnitIds(root.id) : []);
        unitIds.add(masterId);
        unitIds.add(slaveId);
        return unitIds.size > C3_MAX_NETWORK_TOTAL
            ? this.invalid(`Would exceed ${C3_MAX_NETWORK_TOTAL}-unit C3 limit`) : { valid: true };
    }

    private static canConnectMasters(parent: Endpoint, child: Endpoint, model: C3Network): Validation {
        const parentId = parent.node.unit.id;
        const childId = child.node.unit.id;
        if (parentId === childId && parent.compIndex === child.compIndex) return this.invalid('Cannot connect to itself');
        const parentRoots = this.networkRootIds(parentId, model.networks);
        const childRoots = parentId === childId ? parentRoots : this.networkRootIds(childId, model.networks);
        if (parentRoots.size > 1 || childRoots.size > 1) {
            return this.invalid('Unit is split across multiple networks');
        }
        if (parentId !== childId) {
            if ([...parentRoots].some(rootId => childRoots.has(rootId))) {
                return this.invalid('Units are already in the same hierarchy');
            }
            if (parentRoots.size > 0 && !this.endpointStatus(parent, model).connected
                && !this.hasConnectedMasterComponent(parent.node, model)) {
                return this.invalid('Parent component would create a second network for its unit');
            }
            if (this.externalParentCount(childId, model.networks) > 0) {
                return this.invalid('Unit already has an external master');
            }
            if (childRoots.size > 0 && !this.endpointStatus(child, model).connected) {
                return this.invalid('Connection would split the child unit across multiple networks');
            }
        } else if (parentRoots.size > 0
            && !this.endpointStatus(parent, model).connected
            && !this.endpointStatus(child, model).connected) {
            return this.invalid('Internal connection would create a second component network');
        }
        const parentStatus = this.endpointStatus(parent, model);
        const childStatus = this.endpointStatus(child, model);
        if (parentStatus.network) {
            const limit = C3_NETWORK_LIMITS[parentStatus.network.type];
            if ((parentStatus.network.members?.length ?? 0) >= limit) return this.invalid(`Parent has max ${limit} children`);
            if (parentStatus.network.members?.some(member => C3Network.parseMember(member).compIndex === undefined)) {
                return this.invalid('Cannot mix sub-masters with slaves');
            }
        }
        const parentAlternate = parentId === childId
            ? { valid: true }
            : this.validateAlternateMasterPin(parent, model, false);
        if (!parentAlternate.valid) return parentAlternate;
        const childAlternate = this.validateChildPin(child, model, parentId === childId);
        if (!childAlternate.valid) return childAlternate;
        if (childStatus.network && model.parentOf(childStatus.network.id)) return this.invalid('Child already in hierarchy');
        if (childStatus.network?.members?.some(member => model.isMasterBranchMember(member))) {
            return this.invalid('A subordinate Master cannot contain Master branches');
        }
        const autoLinkDepth = parentAlternate.reason ? 1 : 0;
        const parentDepth = parentStatus.network ? model.depthOf(parentStatus.network.id)
            : parentStatus.parent ? model.depthOf(parentStatus.parent.id) + 1 : 0;
        if (parentDepth + autoLinkDepth >= C3_MAX_NETWORK_DEPTH) return this.invalid(`Would exceed parent depth ${C3_MAX_NETWORK_DEPTH}`);
        const childDepth = childStatus.network ? 1 + model.subTreeDepth(childStatus.network.id) : 0;
        if (parentDepth + 1 + autoLinkDepth + childDepth > C3_MAX_NETWORK_DEPTH) return this.invalid(`Would exceed depth ${C3_MAX_NETWORK_DEPTH}`);
        const parentRoot = parentStatus.network ? model.rootOf(parentStatus.network.id)
            : parentRoots.size === 1 ? model.network([...parentRoots][0]) : undefined;
        const combinedUnitIds = new Set(parentRoot ? model.treeUnitIds(parentRoot.id) : []);
        combinedUnitIds.add(parentId);
        if (childStatus.network) {
            for (const unitId of model.treeUnitIds(childStatus.network.id)) combinedUnitIds.add(unitId);
        }
        combinedUnitIds.add(childId);
        return combinedUnitIds.size > C3_MAX_NETWORK_TOTAL
            ? this.invalid(`Would exceed ${C3_MAX_NETWORK_TOTAL}-unit C3 limit`) : { valid: true };
    }

    private static resolveMasterConnection(
        source: Endpoint,
        target: Endpoint,
        model: C3Network,
    ): MasterConnectionResolution {
        const existing = model.connectionBetween(
            { unitId: source.node.unit.id, compIndex: source.compIndex }, C3Role.MASTER,
            { unitId: target.node.unit.id, compIndex: target.compIndex }, C3Role.MASTER,
        );
        if (existing) {
            return { parent: source, child: target, validation: this.invalid('Already connected') };
        }

        const forward = this.canConnectMasters(source, target, model);
        if (forward.valid) return { parent: source, child: target, validation: forward };

        if (source.node.unit.id === target.node.unit.id) {
            return { parent: source, child: target, validation: forward };
        }

        const reverse = this.canConnectMasters(target, source, model);
        if (reverse.valid) return { parent: target, child: source, validation: reverse };

        return { parent: source, child: target, validation: forward };
    }

    /** A success reason is an internal marker for an auto-link depth level. */
    private static validateAlternateMasterPin(endpoint: Endpoint, model: C3Network, userMessage: boolean): Validation {
        if (endpoint.node.c3Components.length <= 1 || this.endpointStatus(endpoint, model).connected) return { valid: true };
        for (const component of endpoint.node.c3Components) {
            if (component.role !== C3Role.MASTER || component.index === endpoint.compIndex) continue;
            const alternateEndpoint = { node: endpoint.node, compIndex: component.index };
            const alternate = this.endpointStatus(alternateEndpoint, model);
            if (alternate.network?.members) {
                const validation = this.canConnectMasters(alternateEndpoint, endpoint, model);
                if (!validation.valid) return validation;
                return { valid: true, reason: userMessage
                    ? 'Master has another Master component and we can auto-link internally' : 'auto-link' };
            }
            if (alternate.parent) return this.invalid('Master has another Master component connected');
        }
        return { valid: true };
    }

    private static validateChildPin(child: Endpoint, model: C3Network, sameUnit: boolean): Validation {
        const status = this.endpointStatus(child, model);
        if (sameUnit || !status.connected) return { valid: true };
        return status.parent ? this.invalid('Child pin already has a parent') : { valid: true };
    }

    private static endpointStatus(endpoint: Endpoint, model: C3Network): EndpointStatus {
        const unitId = endpoint.node.unit.id;
        const network = model.masterNetwork(unitId, endpoint.compIndex);
        const parent = model.parentNetworkForEndpoint(unitId, endpoint.compIndex);
        return { network, parent, connected: !!network || !!parent };
    }

    private static networkRootIds(
        unitId: string,
        networks: readonly SerializedC3NetworkGroup[],
    ): ReadonlySet<string> {
        const model = new C3Network(networks);
        const roots = new Set<string>();
        for (const network of networks) {
            const participates = network.masterId === unitId
                || network.peerIds?.includes(unitId)
                || network.members?.some(member => C3Network.parseMember(member).unitId === unitId);
            if (participates) roots.add(network.peerIds ? network.id : model.rootOf(network.id)?.id ?? network.id);
        }
        return roots;
    }

    private static externalParentCount(
        unitId: string,
        networks: readonly SerializedC3NetworkGroup[],
    ): number {
        let count = 0;
        for (const network of networks) {
            if (network.type !== C3NetworkType.C3 || network.masterId === unitId) continue;
            count += network.members?.filter(member => C3Network.parseMember(member).unitId === unitId).length ?? 0;
        }
        return count;
    }

    private static hasConnectedMasterComponent(node: C3Node, model: C3Network): boolean {
        return node.c3Components.some(component => component.role === C3Role.MASTER
            && !!(model.masterNetwork(node.unit.id, component.index)
                || model.parentNetworkForEndpoint(node.unit.id, component.index)));
    }

    private static connectPeers(context: C3NetworkContext, first: C3Node, second: C3Node,
        type: C3NetworkType): NetworkMutationResult {
        let networks = [...context.networks];
        const model = new C3Network(networks);
        const firstNetwork = model.peerNetwork(first.unit.id, type);
        const secondNetwork = model.peerNetwork(second.unit.id, type);
        const limit = C3_NETWORK_LIMITS[type];
        if (firstNetwork && secondNetwork && firstNetwork.id !== secondNetwork.id
            && firstNetwork.peerIds!.length + secondNetwork.peerIds!.length <= limit) {
            const merged = [...new Set([...firstNetwork.peerIds!, ...secondNetwork.peerIds!])];
            networks = networks.filter(network => network.id !== firstNetwork.id)
                .map(network => network.id === secondNetwork.id ? { ...network, peerIds: merged } : network);
            return { networks, success: true, message: 'Networks merged' };
        }
        const destination = secondNetwork && secondNetwork.peerIds!.length < limit ? secondNetwork
            : firstNetwork && firstNetwork.peerIds!.length < limit ? firstNetwork : undefined;
        if (destination) {
            const unitId = destination.id === secondNetwork?.id ? first.unit.id : second.unit.id;
            networks = this.detachPeer(networks, unitId, type).map(network => network.id === destination.id
                ? { ...network, peerIds: [...network.peerIds!, unitId] } : network);
            return { networks, success: true, message: 'Peer connected' };
        }
        networks = this.detachPeer(this.detachPeer(networks, first.unit.id, type), second.unit.id, type);
        networks.push({ id: uuidv7(), type, color: context.getNextColor(), peerIds: [first.unit.id, second.unit.id] });
        return { networks, success: true, message: 'Peer network created' };
    }

    private static addMember(context: C3NetworkContext, master: Endpoint, memberId: string,
        memberCompIndex?: number): NetworkMutationResult {
        let networks = [...context.networks];
        let model = new C3Network(networks);
        let network = model.masterNetwork(master.node.unit.id, master.compIndex);
        if (!network && master.node.c3Components.length > 1 && master.node.unit.id !== memberId) {
            for (const component of master.node.c3Components) {
                if (component.role !== C3Role.MASTER || component.index === master.compIndex) continue;
                const alternate = model.masterNetwork(master.node.unit.id, component.index);
                if (!alternate?.members) continue;
                const linked = this.addMember({ ...context, networks },
                    { node: master.node, compIndex: component.index }, master.node.unit.id, master.compIndex);
                if (linked.success) { networks = linked.networks; model = new C3Network(networks); break; }
            }
        }
        network = model.masterNetwork(master.node.unit.id, master.compIndex);
        if (!network) {
            const component = this.component(master)!;
            network = {
                id: uuidv7(), type: component.networkType,
                color: context.masterPinColors?.get(`${master.node.unit.id}:${master.compIndex}`) ?? context.getNextColor(),
                masterId: master.node.unit.id, masterCompIndex: master.compIndex, members: [],
            };
            networks.push(network);
        }
        const member = memberCompIndex === undefined ? memberId : C3Network.masterMember(memberId, memberCompIndex);
        networks = networks.map(candidate => candidate.members ? {
            ...candidate,
            members: candidate.members.filter(existing => existing !== member),
        } : candidate);
        const index = networks.findIndex(candidate => candidate.id === network!.id);
        const members = networks[index].members ?? [];
        if (!members.includes(member)) networks[index] = { ...networks[index], members: [...members, member] };
        return { networks: networks.filter(candidate => candidate.id === network!.id
            || !!candidate.peerIds?.length || !!(candidate.masterId && candidate.members?.length)), success: true, message: 'Member added' };
    }

    private static removePeer(networks: SerializedC3NetworkGroup[], networkId: string, unitId: string): NetworkMutationResult {
        const index = networks.findIndex(network => network.id === networkId && network.peerIds?.includes(unitId));
        if (index < 0) return this.failure([...networks], 'Unit not in peer network');
        const result = [...networks];
        const peerIds = result[index].peerIds!.filter(id => id !== unitId);
        if (peerIds.length >= 2) result[index] = { ...result[index], peerIds }; else result.splice(index, 1);
        return { networks: result, success: true };
    }

    private static detachPeer(networks: SerializedC3NetworkGroup[], unitId: string,
        type: C3NetworkType): SerializedC3NetworkGroup[] {
        return networks.flatMap(network => {
            if (network.type !== type || !network.peerIds?.includes(unitId)) return [network];
            const peerIds = network.peerIds.filter(id => id !== unitId);
            return peerIds.length >= 2 ? [{ ...network, peerIds }] : [];
        });
    }

    private static validateNetwork(network: SerializedC3NetworkGroup,
        capabilities: ReadonlyMap<string, C3Capabilities>): SerializedC3NetworkGroup | undefined {
        if (!Object.values(C3NetworkType).includes(network.type)) return undefined;
        if (network.peerIds?.length) {
            if (network.type === C3NetworkType.C3 || network.masterId !== undefined) return undefined;
            const peerIds = [...new Set(network.peerIds)].filter(id => capabilities.get(id)?.has(network.type, C3Role.PEER));
            return peerIds.length >= 2 ? { id: network.id, type: network.type, color: network.color,
                peerIds: peerIds.slice(0, C3_NETWORK_LIMITS[network.type]) } : undefined;
        }
        if (network.type !== C3NetworkType.C3 || network.masterId === undefined
            || network.masterCompIndex === undefined) return undefined;
        const master = capabilities.get(network.masterId)?.component(network.masterCompIndex);
        if (master?.role !== C3Role.MASTER || master.networkType !== network.type) return undefined;
        const masters: string[] = [];
        const slaves: string[] = [];
        for (const member of network.members ?? []) {
            const parsed = C3Network.parseMember(member);
            const memberCapabilities = capabilities.get(parsed.unitId);
            const valid = parsed.compIndex === undefined ? memberCapabilities?.has(network.type, C3Role.SLAVE)
                : memberCapabilities?.component(parsed.compIndex)?.role === C3Role.MASTER
                    && memberCapabilities.component(parsed.compIndex)?.networkType === network.type;
            if (valid) (parsed.compIndex === undefined ? slaves : masters).push(member);
        }
        const selected = masters.length && slaves.length
            ? (masters.length >= slaves.length ? masters : slaves) : [...masters, ...slaves];
        const members = [...new Set(selected)].slice(0, C3_NETWORK_LIMITS[network.type]);
        return members.length ? { id: network.id, type: network.type, color: network.color,
            masterId: network.masterId, masterCompIndex: network.masterCompIndex, members } : undefined;
    }

    private static cleanDepth(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        const model = new C3Network(networks);
        const removals = new Map<string, Set<string>>();
        for (const network of networks) {
            if (network.peerIds || model.depthOf(network.id) < C3_MAX_NETWORK_DEPTH) continue;
            const parent = model.parentOf(network.id);
            if (!parent) continue;
            const members = removals.get(parent.id) ?? new Set<string>();
            members.add(C3Network.masterMember(network.masterId!, network.masterCompIndex!));
            removals.set(parent.id, members);
        }
        return this.removeMembers(networks, removals);
    }

    private static cleanTotalUnits(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        let result = [...networks];
        while (true) {
            const model = new C3Network(result);
            const oversized = model.topLevelNetworks.find(network => !network.peerIds
                && model.treeUnitIds(network.id).size > C3_MAX_NETWORK_TOTAL);
            if (!oversized) return result;
            const removal = this.lastMasterMember(oversized, model);
            if (!removal) return result;
            result = this.removeMembers(result, new Map([[removal.networkId, new Set([removal.member])]]));
        }
    }

    private static lastMasterMember(root: SerializedC3NetworkGroup,
        model: C3Network): { networkId: string; member: string } | undefined {
        const stack = [root];
        const visited = new Set<string>();
        while (stack.length) {
            const network = stack.pop()!;
            if (visited.has(network.id)) continue;
            visited.add(network.id);
            const member = [...(network.members ?? [])].reverse()
                .find(candidate => C3Network.parseMember(candidate).compIndex !== undefined);
            if (member) return { networkId: network.id, member };
            stack.push(...model.childrenOf(network.id));
        }
        return undefined;
    }

    private static cleanMixedMembers(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        return networks.map(network => {
            if (!network.members?.length) return network;
            const masters = network.members.filter(member => C3Network.parseMember(member).compIndex !== undefined);
            const slaves = network.members.filter(member => C3Network.parseMember(member).compIndex === undefined);
            if (!masters.length || !slaves.length) return network;
            return { ...network, members: masters.length > slaves.length ? masters : slaves };
        });
    }

    private static cleanNonCanonicalMasterTiers(
        networks: SerializedC3NetworkGroup[],
    ): SerializedC3NetworkGroup[] {
        const model = new C3Network(networks);
        const removals = new Map<string, Set<string>>();
        for (const network of networks) {
            if (network.type !== C3NetworkType.C3 || !model.parentOf(network.id)) continue;
            const members = network.members?.filter(member => model.isMasterBranchMember(member)) ?? [];
            if (members.length) removals.set(network.id, new Set(members));
        }
        return this.removeMembers(networks, removals);
    }

    private static cleanSplitUnitTrees(networks: SerializedC3NetworkGroup[]): SerializedC3NetworkGroup[] {
        let result = [...networks];
        const seenRoots = new Map<string, string>();
        for (const network of networks) {
            const model = new C3Network(result);
            const rootId = model.rootOf(network.id)?.id ?? network.id;
            const endpoints = network.peerIds?.map(unitId => ({ unitId, compIndex: -1 })) ?? [
                ...(network.masterId !== undefined && network.masterCompIndex !== undefined
                    ? [{ unitId: network.masterId, compIndex: network.masterCompIndex }] : []),
                ...(network.members ?? []).map(member => {
                    const parsed = C3Network.parseMember(member);
                    return { unitId: parsed.unitId, compIndex: parsed.compIndex ?? -1 };
                }),
            ];
            for (const endpoint of endpoints) {
                const key = endpoint.unitId;
                const firstRoot = seenRoots.get(key);
                if (!firstRoot) { seenRoots.set(key, rootId); continue; }
                if (firstRoot === rootId) continue;
                if (network.masterId === endpoint.unitId && network.masterCompIndex === endpoint.compIndex) {
                    const removeIds = new Set(model.treeNetworks(network.id).map(candidate => candidate.id));
                    result = result.filter(candidate => !removeIds.has(candidate.id));
                } else if (network.peerIds?.includes(endpoint.unitId)) {
                    result = result.flatMap(candidate => {
                        if (candidate.id !== network.id) return [candidate];
                        const peerIds = candidate.peerIds!.filter(id => id !== endpoint.unitId);
                        return peerIds.length >= 2 ? [{ ...candidate, peerIds }] : [];
                    });
                } else {
                    result = result.map(candidate => candidate.id === network.id
                        ? { ...candidate, members: candidate.members!.filter(member => {
                            const parsed = C3Network.parseMember(member);
                            return parsed.unitId !== endpoint.unitId || parsed.compIndex !== endpoint.compIndex;
                        }) }
                        : candidate);
                }
                result = result.filter(candidate => candidate.peerIds ? candidate.peerIds.length >= 2 : !!candidate.members?.length);
            }
        }
        return result;
    }

    private static removeMembers(networks: SerializedC3NetworkGroup[],
        removals: ReadonlyMap<string, ReadonlySet<string>>): SerializedC3NetworkGroup[] {
        return networks.flatMap(network => {
            const remove = removals.get(network.id);
            if (!remove || !network.members) return [network];
            const members = network.members.filter(member => !remove.has(member));
            return members.length ? [{ ...network, members }] : [];
        });
    }

    private static component(endpoint: Endpoint): C3Component | undefined {
        return endpoint.node.c3Components[endpoint.compIndex];
    }
    private static invalid(reason: string): Validation { return { valid: false, reason }; }
    private static failure(networks: SerializedC3NetworkGroup[], message: string): NetworkMutationResult {
        return { networks, success: false, message };
    }
}
