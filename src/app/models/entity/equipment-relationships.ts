// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { EntityMountedEquipment, EquipmentBayKind, MountId } from './types';
import { EquipmentBay } from './types';

interface EquipmentBayDefinition {
  readonly kind: EquipmentBayKind;
  readonly controllerMountId?: MountId;
  readonly memberMountIds: readonly MountId[];
}

export interface EquipmentBayInput {
  readonly controller?: EntityMountedEquipment;
  readonly mounts: readonly EntityMountedEquipment[];
}

export type EquipmentMountIndex = ReadonlyMap<MountId, EntityMountedEquipment>;

/** Immutable relationship graph for an entity's mounted equipment. */
export class EquipmentRelationships {
  readonly #links: ReadonlyMap<MountId, MountId>;
  readonly #reverseLinks: ReadonlyMap<MountId, MountId>;
  readonly #bays: readonly EquipmentBayDefinition[];

  constructor(
    links: ReadonlyMap<MountId, MountId> = new Map(),
    bays: readonly EquipmentBayDefinition[] = [],
  ) {
    this.#links = new Map(links);
    validateLinks(this.#links);
    const reverseLinks = new Map<MountId, MountId>();
    for (const [sourceId, targetId] of this.#links) {
      if (reverseLinks.has(targetId)) {
        throw new Error(`Equipment mount "${targetId}" is already linked`);
      }
      reverseLinks.set(targetId, sourceId);
    }
    this.#reverseLinks = reverseLinks;
    validateBays(bays);
    this.#bays = bays.map(bay => ({ ...bay, memberMountIds: [...bay.memberMountIds] }));
  }

  linkedMount(
    source: EntityMountedEquipment,
    mountsById: EquipmentMountIndex,
  ): EntityMountedEquipment | undefined {
    const targetId = this.#links.get(source.mountId);
    return targetId ? mountsById.get(targetId) : undefined;
  }

  linkingMount(
    target: EntityMountedEquipment,
    mountsById: EquipmentMountIndex,
  ): EntityMountedEquipment | undefined {
    const sourceId = this.#reverseLinks.get(target.mountId);
    return sourceId ? mountsById.get(sourceId) : undefined;
  }

  withLink(source: EntityMountedEquipment, target: EntityMountedEquipment): EquipmentRelationships {
    if (source.mountId === target.mountId) throw new Error('Equipment cannot link to itself');
    const existingSource = this.#reverseLinks.get(target.mountId);
    if (existingSource === source.mountId) return this;
    if (existingSource) throw new Error(`Equipment mount "${target.mountId}" is already linked`);

    const links = new Map(this.#links).set(source.mountId, target.mountId);
    let nextId: MountId | undefined = target.mountId;
    while (nextId) {
      if (nextId === source.mountId) throw new Error('Equipment links cannot form a cycle');
      nextId = links.get(nextId);
    }
    return new EquipmentRelationships(links, this.#bays);
  }

  withoutLink(source: EntityMountedEquipment): EquipmentRelationships {
    if (!this.#links.has(source.mountId)) return this;
    const links = new Map(this.#links);
    links.delete(source.mountId);
    return new EquipmentRelationships(links, this.#bays);
  }

  withoutLinksFor(mount: EntityMountedEquipment): EquipmentRelationships {
    if (!this.#links.has(mount.mountId) && !this.#reverseLinks.has(mount.mountId)) return this;
    const links = new Map([...this.#links]
      .filter(([sourceId, targetId]) => sourceId !== mount.mountId && targetId !== mount.mountId));
    return new EquipmentRelationships(links, this.#bays);
  }

  withoutMount(mount: EntityMountedEquipment): EquipmentRelationships {
    const links = new Map([...this.#links]
      .filter(([sourceId, targetId]) => sourceId !== mount.mountId && targetId !== mount.mountId));
    const bays = this.#bays
      .filter(bay => bay.controllerMountId !== mount.mountId)
      .map(bay => ({
        ...bay,
        memberMountIds: bay.memberMountIds.filter(memberId => memberId !== mount.mountId),
      }))
      .filter(bay => bay.memberMountIds.length > 0);
    return new EquipmentRelationships(links, bays);
  }

  withMounts(mounts: readonly EntityMountedEquipment[]): EquipmentRelationships {
    const mountIds = new Set(mounts.map(mount => mount.mountId));
    const links = new Map([...this.#links]
      .filter(([sourceId, targetId]) => mountIds.has(sourceId) && mountIds.has(targetId)));
    const bays = this.#bays
      .filter(bay => !bay.controllerMountId || mountIds.has(bay.controllerMountId))
      .map(bay => ({
        ...bay,
        memberMountIds: bay.memberMountIds.filter(memberId => mountIds.has(memberId)),
      }))
      .filter(bay => bay.memberMountIds.length > 0);
    return new EquipmentRelationships(links, bays);
  }

  withBay(
    kind: EquipmentBayKind,
    input: EquipmentBayInput,
  ): EquipmentRelationships {
    const bay = definition(kind, input);
    return new EquipmentRelationships(this.#links, [
      ...this.#bays,
      bay,
    ]);
  }

  withBays(
    kind: EquipmentBayKind,
    inputs: readonly EquipmentBayInput[],
  ): EquipmentRelationships {
    const bays = [
      ...this.#bays.filter(bay => bay.kind !== kind),
      ...inputs.map(input => definition(kind, input)),
    ];
    return new EquipmentRelationships(this.#links, bays);
  }

  resolveBays(mountsById: EquipmentMountIndex): readonly EquipmentBay[] {
    return this.#bays.flatMap(bay => {
      const members = bay.memberMountIds.flatMap(mountId => {
        const mount = mountsById.get(mountId);
        return mount ? [mount] : [];
      });
      if (members.length === 0) return [];
      const controller = bay.controllerMountId ? mountsById.get(bay.controllerMountId) : undefined;
      if (bay.controllerMountId && !controller) return [];
      return [new EquipmentBay(bay.kind, members, controller)];
    });
  }
}

function validateLinks(links: ReadonlyMap<MountId, MountId>): void {
  const validated = new Set<MountId>();
  for (const sourceId of links.keys()) {
    if (links.get(sourceId) === sourceId) throw new Error('Equipment cannot link to itself');

    const path = new Set<MountId>();
    let mountId: MountId | undefined = sourceId;
    while (mountId && !validated.has(mountId)) {
      if (path.has(mountId)) throw new Error('Equipment links cannot form a cycle');
      path.add(mountId);
      mountId = links.get(mountId);
    }
    for (const pathMountId of path) validated.add(pathMountId);
  }
}

function definition(kind: EquipmentBayKind, input: EquipmentBayInput): EquipmentBayDefinition {
  if (input.mounts.length === 0) throw new Error('Equipment bays require at least one member');
  const memberMountIds = input.mounts.map(mount => mount.mountId);
  if (new Set(memberMountIds).size !== memberMountIds.length) {
    throw new Error('Equipment bays cannot contain duplicate members');
  }
  return {
    kind,
    controllerMountId: input.controller?.mountId,
    memberMountIds,
  };
}

function validateBays(bays: readonly EquipmentBayDefinition[]): void {
  for (const kind of new Set(bays.map(bay => bay.kind))) {
    const kindBays = bays.filter(bay => bay.kind === kind);
    const memberIds = kindBays.flatMap(bay => bay.memberMountIds);
    if (new Set(memberIds).size !== memberIds.length) {
      throw new Error(`Equipment mounts cannot belong to multiple ${kind} bays`);
    }
    const controllerIds = kindBays.flatMap(bay => bay.controllerMountId ? [bay.controllerMountId] : []);
    if (new Set(controllerIds).size !== controllerIds.length) {
      throw new Error(`Equipment mounts cannot control multiple ${kind} bays`);
    }
  }
}