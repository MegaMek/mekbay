// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConstructionHexSidesComponent } from './construction-hex-sides.component';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { BUILDING_SIDE_LABELS, buildingHexKey, buildingLocationName, buildingNeighbors, parseBuildingLocation,
  type BuildingBayDoor, type BuildingDoor, type BuildingElevator, type BuildingEquipmentPlacement, type BuildingHex, type BuildingSpace } from '../../models/entity/types/building';
import { buildingDoorVertices, buildingDoorsTouch, linkBuildingDoors, unlinkBuildingDoor, normalizeBuildingDoorLinks } from '../../models/entity/utils/building-doors';
import { buildingCanAutomate, buildingCanSpread, buildingElevatorRange, buildingElevatorWeight } from '../../models/entity/utils/building-construction';
import { getBayConstructionWeight, getBayRecordSheetName } from '../../models/entity/bays/bay-definitions';
import type { EntityTransportBay } from '../../models/entity/types';
import { buildingMapHexLabel, buildingMapLocationLabel } from '../../utils/building-map-presentation';

@Component({
  selector: 'construction-building-services', imports: [FormsModule, ConstructionHexSidesComponent],
  templateUrl: './construction-building-services.component.html',
  styleUrl: './construction-building-services.component.scss', changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionBuildingServicesComponent {
  readonly entity = input.required<StaticEmplacementEntity>();
  readonly location = input.required<string>();
  readonly disabled = input(false);
  readonly absoluteCoordinates = input(false);
  readonly editRequested = output<() => void>();
  displayHex(hex: BuildingHex): string { return buildingMapHexLabel(this.entity(), hex, this.absoluteCoordinates()); }
  displayLocation(location: string): string { return buildingMapLocationLabel(this.entity(), location, this.absoluteCoordinates(), true); }
  readonly position = computed(() => parseBuildingLocation(this.location())!);
  readonly sides = BUILDING_SIDE_LABELS;
  readonly levels = computed(() => Array.from({ length: this.entity().hexHeight(this.position().hex) + 1 }, (_, floor) => floor));
  readonly localDoors = computed(() => this.entity().doors().map((door, index) => ({ door, index }))
    .filter(({ door }) => buildingHexKey(door.position.hex) === buildingHexKey(this.position().hex)
      && door.position.floor === this.position().floor));
  readonly doorMask = computed(() => this.localDoors().reduce((mask, { door }) => mask | (1 << door.facing), 0));
  readonly doorLinks = computed(() => {
    const doors = this.entity().doors(), local = new Set(this.localDoors().map(entry => entry.door));
    return doors.flatMap((a, index) => doors.slice(index + 1).flatMap(b => {
      if ((!local.has(a) && !local.has(b)) || !buildingDoorsTouch(a, b)
        || this.internal(a.position.hex, a.facing) || this.internal(b.position.hex, b.facing)) return [];
      const source = local.has(a) ? a : b, other = source === a ? b : a;
      const sameHex = buildingHexKey(source.position.hex) === buildingHexKey(other.position.hex);
      const vertex = buildingDoorVertices(a).find(p => buildingDoorVertices(b).some(q => p[0] === q[0] && p[1] === q[1]))!;
      const hex = this.position().hex, x = (vertex[0] - 3 * hex.q) / 2, y = (vertex[1] - 2 * hex.r - hex.q) * Math.sqrt(3) / 2;
      const length = Math.hypot(x, y);
      return [{ source, other, linked: !!a.linkGroup && a.linkGroup === b.linkGroup,
        left: 50 + 45 * x / length, top: 50 + 45 * y / length,
        target: `${sameHex ? '' : this.displayHex(other.position.hex) + ' / '}${this.sides[other.facing]}`,
        sameHex }];
    }));
  });
  readonly blockedDoorSides = computed(() => this.entity().doors()
    .filter(door => buildingHexKey(door.position.hex) === buildingHexKey(this.position().hex)
      && door.position.floor !== this.position().floor)
    .reduce((mask, door) => mask | (1 << door.facing), this.internalSides(this.position().hex)));
  readonly maxDoorHeight = computed(() => this.entity().hexHeight(this.position().hex) - this.position().floor);
  readonly doorsDisabled = computed(() => this.disabled() || this.entity().hasNoInterior()
    || this.entity().buildingClass() === 3 || this.maxDoorHeight() < 1);
  readonly localLifts = computed(() => this.entity().elevators().map((lift, index) => ({ lift, index }))
    .filter(({ lift }) => buildingHexKey(lift.hex) === buildingHexKey(this.position().hex)));
  readonly mountId = linkedSignal(() => this.entity().equipment().find(mount => mount.location === this.location())?.mountId ?? this.entity().equipment()[0]?.mountId ?? '');
  readonly mount = computed(() => this.entity().equipment().find(mount => mount.mountId === this.mountId()));
  readonly mountDesign = computed<BuildingEquipmentPlacement>(() => this.entity().equipmentDesign().get(this.mountId())
    ?? { positions: [], automated: false, pcmtSource: 0 });
  readonly canSpread = computed(() => buildingCanSpread(this.mount()?.equipment));
  readonly canAutomate = computed(() => buildingCanAutomate(this.mount()?.equipment));
  readonly bays = computed(() => this.entity().transporters().filter((bay): bay is EntityTransportBay => bay.kind === 'bay'));
  readonly bayId = linkedSignal(() => this.bays()[0]?.id ?? '');
  readonly bay = computed(() => this.bays().find(bay => bay.id === this.bayId()));
  readonly spaces = computed(() => this.bay() ? this.entity().baySpaces(this.bay()!) : []);
  readonly bayDoors = computed(() => this.entity().bayDoors().map((door, index) => ({ door, index }))
    .filter(({ door }) => door.bayId === this.bayId()));
  readonly liftWeight = buildingElevatorWeight;
  readonly liftRange = buildingElevatorRange;
  readonly bayWeight = getBayConstructionWeight;
  readonly bayName = getBayRecordSheetName;
  readonly doorsOpen = linkedSignal(() => { this.location(); return this.localDoors().length > 0; });
  readonly elevatorsOpen = linkedSignal(() => { this.location(); return this.localLifts().length > 0; });
  readonly equipmentOpen = linkedSignal(() => {
    const location = this.location();
    return this.entity().equipment().some(mount =>
      this.entity().equipmentPositions(mount).some(position => buildingLocationName(position.hex, position.floor) === location));
  });
  readonly transportOpen = linkedSignal(() => {
    const location = this.location();
    return this.bays().some(bay => this.entity().baySpaces(bay).some(space =>
      space.tons > 0 && buildingLocationName(space.position.hex, space.position.floor) === location))
      || this.entity().bayDoors().some(door => buildingLocationName(door.position.hex, door.position.floor) === location);
  });

  sectionOpen(event: Event): boolean { return (event.target as HTMLDetailsElement).open; }

  levelName(level: number, compact = false): string { return this.entity().roofLevelLabel(level, compact, this.position().hex); }
  internalLevels(hex: BuildingHex): readonly number[] { return Array.from({ length: this.entity().hexHeight(hex) }, (_, floor) => floor); }
  internal(hex: BuildingHex, side: number, floor = 0): boolean {
    const neighbor = buildingNeighbors(hex)[side];
    return this.entity().coordinates().some(hex => buildingHexKey(hex) === buildingHexKey(neighbor)
      && floor <= this.entity().hexHeight(hex));
  }
  internalSides(hex: BuildingHex, floor = 0): number {
    return this.sides.reduce((mask, _, side) => mask | (this.internal(hex, side, floor) ? 1 << side : 0), 0);
  }
  toggleDoor(facing: number): void {
    if (this.doorsDisabled()) return;
    const position = this.position();
    const entry = this.localDoors().find(({ door }) => door.facing === facing);
    if (!entry && (this.blockedDoorSides() & (1 << facing))) return;
    this.editRequested.emit(() => this.entity().doors.update(doors => entry
      ? normalizeBuildingDoorLinks(doors.filter((_, index) => index !== entry.index))
      : [...doors, { position, facing, height: 1 }]));
  }
  changeDoorHeight(index: number, height: number): void {
    if (this.doorsDisabled() || !Number.isInteger(height) || height < 1) return;
    const selected = this.entity().doors()[index];
    const related = (door: BuildingDoor) => door === selected || (!!selected.linkGroup && door.linkGroup === selected.linkGroup);
    if (this.entity().doors().some(door => related(door) && height > this.entity().hexHeight(door.position.hex) - door.position.floor)) return;
    this.editRequested.emit(() => this.entity().doors.update(doors => doors.map(door => related(door) ? { ...door, height } : door)));
  }
  toggleDoorLink(source: BuildingDoor, other: BuildingDoor): void {
    if (this.disabled()) return;
    this.editRequested.emit(() => this.entity().doors.update(doors => source.linkGroup && source.linkGroup === other.linkGroup
      ? unlinkBuildingDoor(doors, source) : linkBuildingDoors(doors, source, other)));
  }
  addLift(): void {
    const { hex } = this.position();
    const floor = Math.min(this.position().floor, this.entity().hexHeight(hex) - 1);
    this.editRequested.emit(() => this.entity().elevators.update(lifts => [...lifts,
      { hex, capacity: Math.min(20, (this.entity().constructionFactor() ?? 20) * this.entity().cfScale()),
        exits: new Map([[floor, this.internalSides(hex, floor)], [floor + 1, this.internalSides(hex, floor + 1)]]) }]));
  }
  changeLift(index: number, patch: Partial<BuildingElevator>): void {
    if (patch.capacity !== undefined && (!Number.isFinite(patch.capacity) || patch.capacity <= 0)) return;
    this.editRequested.emit(() => this.entity().elevators.update(lifts => lifts.map((lift, i) => i === index ? { ...lift, ...patch } : lift)));
  }
  setLiftRange(index: number, start: number, end: number): void {
    const lift = this.entity().elevators()[index];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > this.entity().hexHeight(lift.hex)) return;
    this.changeLift(index, { exits: new Map(Array.from({ length: end - start + 1 }, (_, offset) =>
      [start + offset, lift.exits.get(start + offset) ?? this.internalSides(lift.hex, start + offset)])) });
  }
  setLiftSide(index: number, level: number, side: number, checked: boolean): void {
    const exits = new Map(this.entity().elevators()[index].exits), mask = exits.get(level) ?? 0;
    exits.set(level, checked ? mask | (1 << side) : mask & ~(1 << side));
    this.changeLift(index, { exits });
  }
  liftStops(lift: BuildingElevator): readonly number[] { return [...lift.exits.keys()].sort((a, b) => a - b); }
  liftSide(lift: BuildingElevator, level: number, side: number): boolean { return !!((lift.exits.get(level) ?? 0) & (1 << side)); }
  removeLift(index: number): void {
    this.editRequested.emit(() => this.entity().elevators.update(lifts => lifts.filter((_, i) => i !== index)));
  }
  changeMount(patch: Partial<BuildingEquipmentPlacement>): void {
    if (patch.pcmtSource !== undefined && (!Number.isFinite(patch.pcmtSource) || patch.pcmtSource < 0)) return;
    const id = this.mountId(), next = { ...this.mountDesign(), ...patch };
    this.editRequested.emit(() => this.entity().equipmentDesign.update(designs => new Map(designs).set(id, next)));
  }
  allocated(hex: BuildingHex): number | undefined {
    const mount = this.mount();
    return mount && this.entity().equipmentPositions(mount).find(position => buildingHexKey(position.hex) === buildingHexKey(hex))?.floor;
  }
  anchor(hex: BuildingHex): boolean {
    const position = parseBuildingLocation(this.mount()?.location ?? '');
    return !!position && buildingHexKey(position.hex) === buildingHexKey(hex);
  }
  allocateHex(hex: BuildingHex, floor: number | undefined): void {
    const mount = this.mount();
    if (!mount) return;
    const positions = this.entity().equipmentPositions(mount).filter(position => buildingHexKey(position.hex) !== buildingHexKey(hex));
    this.changeMount({ positions: floor === undefined ? positions : [...positions, { hex, floor: Math.min(floor, this.entity().hexHeight(hex) - 1) }] });
  }
  changeSpaces(spaces: readonly BuildingSpace[]): void {
    const bay = this.bay();
    if (bay) this.editRequested.emit(() => this.entity().baySpace.update(values => new Map(values).set(bay.id, spaces)));
  }
  automaticBay(): void {
    const bay = this.bay();
    if (bay) this.editRequested.emit(() => this.entity().baySpace.update(values => { const next = new Map(values); next.delete(bay.id); return next; }));
  }
  assignBayHere(): void { if (this.bay()) this.changeSpaces([{ position: this.position(), tons: getBayConstructionWeight(this.bay()!) }]); }
  addSpace(): void { this.changeSpaces([...this.spaces(), { position: this.position(), tons: 0 }]); }
  changeSpace(index: number, location: string, tons: number): void {
    if (!Number.isFinite(tons) || tons < 0) return;
    const position = parseBuildingLocation(location);
    if (position) this.changeSpaces(this.spaces().map((space, i) => i === index ? { position, tons } : space));
  }
  removeSpace(index: number): void { this.changeSpaces(this.spaces().filter((_, i) => i !== index)); }
  addBayDoor(): void {
    const bay = this.bay(), position = this.position();
    if (!bay || this.bayDoors().length >= bay.doors || position.floor >= this.entity().hexHeight(position.hex)) return;
    const facing = this.sides.findIndex((_, side) => !this.internal(position.hex, side)
      && this.entity().bayDoors().filter(door => buildingHexKey(door.position.hex) === buildingHexKey(position.hex)
        && door.facing === side).length < (this.entity().buildingClass() === 1 ? 2 : 1));
    if (facing < 0) return;
    this.editRequested.emit(() => this.entity().bayDoors.update(doors => [...doors, { bayId: bay.id, position, facing }]));
  }
  changeBayDoor(index: number, patch: Partial<BuildingBayDoor>): void {
    this.editRequested.emit(() => this.entity().bayDoors.update(doors => doors.map((door, i) => i === index ? { ...door, ...patch } : door)));
  }
  moveBayDoor(index: number, location: string): void {
    const position = parseBuildingLocation(location);
    if (position) this.changeBayDoor(index, { position });
  }
  removeBayDoor(index: number): void {
    this.editRequested.emit(() => this.entity().bayDoors.update(doors => doors.filter((_, i) => i !== index)));
  }
  bayDoorLocation(door: BuildingBayDoor): string { return buildingLocationName(door.position.hex, door.position.floor); }
  spaceLocation(space: BuildingSpace): string { return buildingLocationName(space.position.hex, space.position.floor); }
}
