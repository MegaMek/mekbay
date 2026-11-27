// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  inject,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OptionsService } from '../../services/options.service';
import { viewerWheel } from '../../utils/viewer-wheel';
import {
  BUILDING_MAP_KEY,
  buildingMapFeatures,
  buildingMapDoors,
  buildingMapFill,
  buildingDoorPoints,
  buildingMapHexLabel,
  buildingMapLocationLabel,
} from '../../utils/building-map-presentation';
import { SessionPersistenceService } from '../../services/session-persistence.service';
import { DialogsService } from '../../services/dialogs.service';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom } from 'rxjs';
import { ConstructionBuildingServicesComponent } from './construction-building-services.component';
import { ConstructionHexSidesComponent } from './construction-hex-sides.component';
import { CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { buildingElevatorRange } from '../../models/entity/utils/building-construction';
import {
  BUILDING_ORIGIN,
  buildingHexKey,
  buildingNeighbors,
  buildingLocationName,
  buildingConnectedComponents,
  buildingBridgeSpan,
  buildingBridgeLevels,
  parseBuildingLocation,
  type BuildingHex,
} from '../../models/entity/types/building';
import {
  setConstructionBuildingTopology,
  buildingTopologyDoorChanges,
  setConstructionBuildingHexHeight,
  transformConstructionBuilding,
} from '../domain/construction-building-topology';
import { moveConstructionEquipment } from '../domain/construction-rules';

const HEX_SIZE = 42;
const PANCAKE_MIN_WIDTH = 250;
const ABSOLUTE_COORDINATES_KEY = 'construction.building.absoluteCoordinates';
const hexCenter = (hex: BuildingHex) => ({
  x: HEX_SIZE * 1.5 * hex.q,
  y: HEX_SIZE * Math.sqrt(3) * (hex.r + hex.q / 2),
});

@Component({
  selector: 'construction-topology',
  imports: [FormsModule, CdkDropList, ConstructionBuildingServicesComponent, ConstructionHexSidesComponent],
  templateUrl: './construction-topology.component.html',
  styleUrl: './construction-topology.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConstructionTopologyComponent {
  readonly optionsService = inject(OptionsService);
  private readonly session = inject(SessionPersistenceService);
  private readonly dialogs = inject(DialogsService);
  readonly absoluteCoordinates = signal(this.session.getItem(ABSOLUTE_COORDINATES_KEY) === 'true');
  readonly entity = input.required<StaticEmplacementEntity>();
  readonly disabled = input(false);
  readonly dropLocation = input<string | null>(null);
  readonly dropIssue = input('');
  readonly equipmentDropped = output<CdkDragDrop<unknown>>();
  readonly editRequested = output<() => void>();
  readonly location = model(buildingLocationName(BUILDING_ORIGIN, 0));
  private readonly position = computed(() => parseBuildingLocation(this.location()));
  readonly viewMode = signal<'top' | 'pancake'>('top');
  readonly hoveredKey = signal<string | null>(null);
  readonly selected = computed(
    () =>
      this.entity()
        .coordinates()
        .find((hex) => hex.q === this.position()?.hex.q && hex.r === this.position()?.hex.r) ??
      this.entity().coordinates()[0],
  );
  readonly floors = computed(() => Array.from({ length: this.entity().height() ?? 1 }, (_, index) => index));
  readonly floor = computed(() => Math.min(this.position()?.floor ?? 0, this.entity().hexHeight(this.selected()) - 1));
  readonly mapKey = BUILDING_MAP_KEY;
  readonly legend = computed(() => [
    ...new Set(this.pancake().layers.flatMap((layer) => layer.cells.flatMap((cell) => cell.features))),
  ]);
  readonly sideLines = Array.from({ length: 6 }, (_, side) => {
    const a = (side + 4) % 6,
      b = (a + 1) % 6;
    return {
      side,
      x1: HEX_SIZE * Math.cos((a * Math.PI) / 3),
      y1: HEX_SIZE * Math.sin((a * Math.PI) / 3),
      x2: HEX_SIZE * Math.cos((b * Math.PI) / 3),
      y2: HEX_SIZE * Math.sin((b * Math.PI) / 3),
    };
  });
  readonly bridgeSpan = computed(() =>
    this.entity().isBridge() ? buildingBridgeSpan(this.entity().coordinates()) : null,
  );
  readonly selectedLocation = computed(() => buildingLocationName(this.selected(), this.floor()));
  readonly zoom = signal(100);
  private readonly mapSvg = viewChild<ElementRef<SVGSVGElement>>('mapSvg');
  private readonly viewportSize = signal({ width: 0, height: 0 });
  readonly moveColumn = linkedSignal(() =>
    this.absoluteCoordinates() ? this.selected().q : this.entity().displayGrid().position(this.selected()).column + 1,
  );
  readonly moveRow = linkedSignal(() =>
    this.absoluteCoordinates() ? this.selected().r : this.entity().displayGrid().position(this.selected()).row + 1,
  );
  readonly assignId = signal('');
  readonly connected = computed(() => buildingConnectedComponents(this.entity().coordinates()).length);
  readonly available = computed(() =>
    this.entity()
      .equipment()
      .filter((mount) => mount.allocation.kind === 'location' && mount.location !== this.selectedLocation()),
  );
  readonly equipmentCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const mount of this.entity().equipment())
      for (const position of this.entity().equipmentPositions(mount)) {
        const location = buildingLocationName(position.hex, position.floor);
        counts.set(location, (counts.get(location) ?? 0) + 1);
      }
    return counts;
  });
  readonly polygon = Array.from({ length: 6 }, (_, side) => {
    const angle = (side * Math.PI) / 3;
    return `${HEX_SIZE * Math.cos(angle)},${HEX_SIZE * Math.sin(angle)}`;
  }).join(' ');
  readonly cells = computed(() => {
    const occupied = new Set(this.entity().coordinates().map(buildingHexKey));
    const cells = new Map(
      this.entity()
        .coordinates()
        .map((hex) => [buildingHexKey(hex), hex]),
    );
    for (const hex of this.entity().coordinates())
      for (const neighbor of buildingNeighbors(hex)) cells.set(buildingHexKey(neighbor), neighbor);
    return [...cells].map(([key, hex]) => ({
      key,
      hex,
      ...hexCenter(hex),
      footprint: occupied.has(key),
      occupied: occupied.has(key) && (!this.entity().isMobile() || this.entity().occupiesMapLevel(hex, this.floor())),
      count: this.equipmentCounts().get(buildingLocationName(hex, this.floor())) ?? 0,
      ...this.decoration(hex, this.floor()),
    }));
  });
  readonly topCells = computed(() => {
    const cells = this.cells();
    const selected = buildingHexKey(this.selected());
    const hovered = this.hoveredKey();
    const dropHex = parseBuildingLocation(this.dropLocation() ?? '')?.hex;
    // SVG paints in DOM order, so highlighted borders must follow neighboring hexes.
    const drawOrder = (cell: (typeof cells)[number]) =>
      dropHex && cell.key === buildingHexKey(dropHex)
        ? 4
        : cell.key === hovered
          ? 3
          : cell.occupied && cell.key === selected
            ? 2
            : cell.occupied
              ? 1
              : 0;
    return [...cells].sort((a, b) => drawOrder(a) - drawOrder(b));
  });
  readonly topBounds = computed(() => {
    const cells = this.cells();
    return {
      left: Math.min(...cells.map((cell) => cell.x)) - HEX_SIZE - 18,
      right: Math.max(...cells.map((cell) => cell.x)) + HEX_SIZE + 18,
      top: Math.min(...cells.map((cell) => cell.y)) - HEX_SIZE - 18,
      bottom: Math.max(...cells.map((cell) => cell.y)) + HEX_SIZE + 18,
    };
  });
  readonly pancake = computed(() => {
    // Project only the occupied footprint. Each layer has its own unobscured hit area.
    const cells = this.cells()
      .filter((cell) => cell.footprint)
      .map((cell) => ({ ...cell, x: cell.x - 0.35 * cell.y, y: 0.38 * cell.y }));
    const contentLeft = Math.min(...cells.map((cell) => cell.x)) - HEX_SIZE * 1.35 - 12;
    const contentRight = Math.max(...cells.map((cell) => cell.x)) + HEX_SIZE * 1.35 + 12;
    const width = Math.max(contentRight - contentLeft, PANCAKE_MIN_WIDTH);
    const center = (contentLeft + contentRight) / 2;
    const left = center - width / 2;
    const right = center + width / 2;
    const top = Math.min(...cells.map((cell) => cell.y)) - HEX_SIZE * 0.38 - 12;
    const bottom = Math.max(...cells.map((cell) => cell.y)) + HEX_SIZE * 0.38 + 12;
    const step = bottom - top + 44;
    const layers = this.entity()
      .mapLevels()
      .map((floor, index) => {
        const hexes = cells
          .filter((cell) => this.entity().occupiesMapLevel(cell.hex, floor))
          .map((cell) => ({
            ...cell,
            count: this.equipmentCounts().get(buildingLocationName(cell.hex, floor)) ?? 0,
            ...this.decoration(cell.hex, floor),
          }));
        return {
          floor,
          y: index * step,
          cells: hexes,
          count: hexes.reduce((count, cell) => count + cell.count, 0),
        };
      });
    const elevatorConnections = this.entity()
      .elevators()
      .flatMap((lift) => {
        const [lowest, highest] = buildingElevatorRange(lift);
        const key = buildingHexKey(lift.hex);
        const positions = layers.flatMap((layer) => {
          if (layer.floor < lowest || layer.floor > highest) return [];
          const cell = layer.cells.find((cell) => cell.key === key);
          return cell ? [{ floor: layer.floor, x: cell.x, y: cell.y + layer.y }] : [];
        });
        // The left/right tips have local y = 0, so the pancake projection keeps their ±radius offsets.
        return positions.slice(1).flatMap((lower, index) =>
          [-HEX_SIZE, HEX_SIZE].map((offset) => ({
            fromFloor: lower.floor,
            x1: positions[index].x + offset,
            y1: positions[index].y,
            x2: lower.x + offset,
            y2: lower.y,
          })),
        );
      });
    return {
      left,
      right,
      top,
      bottom,
      // Paint from ground upward; outgoing shaft edges cover their floor, then the next floor covers them.
      layers: layers
        .map((layer) => ({
          ...layer,
          elevatorConnections: elevatorConnections.filter((connection) => connection.fromFloor === layer.floor),
        }))
        .reverse(),
      bounds: {
        left: left - 20,
        right: right + 20,
        top: top - 38,
        bottom: bottom + (layers.length - 1) * step + 30,
      },
    };
  });
  private readonly mapBounds = computed(() =>
    this.viewMode() === 'pancake' ? this.pancake().bounds : this.topBounds(),
  );
  private readonly viewSize = computed(() => {
    const { left, right, top, bottom } = this.mapBounds();
    let width = Math.max(360, right - left) / (this.zoom() / 100);
    let height = Math.max(300, bottom - top) / (this.zoom() / 100);
    const viewport = this.viewportSize();
    // Include the extra visible space introduced by SVG's default xMidYMid meet scaling.
    if (viewport.width > 0 && viewport.height > 0) {
      const scale = Math.min(viewport.width / width, viewport.height / height);
      width = Math.max(width, viewport.width / scale);
      height = Math.max(height, viewport.height / scale);
    }
    return { width, height };
  });
  private readonly panLimits = computed(() => {
    const { left, right, top, bottom } = this.mapBounds();
    const { width, height } = this.viewSize();
    return { x: Math.max(0, (right - left - width) / 2), y: Math.max(0, (bottom - top - height) / 2) };
  });
  readonly pannable = computed(() => this.panLimits().x > 0 || this.panLimits().y > 0);
  readonly touchAction = computed(() =>
    this.panLimits().y > 0 ? 'pinch-zoom' : this.panLimits().x > 0 ? 'pan-y pinch-zoom' : 'auto',
  );
  readonly pan = linkedSignal<{ x: number; y: number }, { x: number; y: number }>({
    source: this.panLimits,
    computation: (_, previous) => this.clampPan(previous?.value ?? { x: 0, y: 0 }),
  });
  readonly viewBox = computed(() => {
    const { left, right, top, bottom } = this.mapBounds();
    const { width, height } = this.viewSize();
    return `${(left + right - width) / 2 + this.pan().x} ${(top + bottom - height) / 2 + this.pan().y} ${width} ${height}`;
  });

  readonly key = buildingHexKey;
  readonly locationName = buildingLocationName;
  displayHex(hex: BuildingHex): string {
    return buildingMapHexLabel(this.entity(), hex, this.absoluteCoordinates());
  }
  displayLocation(location: string, compact = false): string {
    return buildingMapLocationLabel(this.entity(), location, this.absoluteCoordinates(), compact);
  }
  coordinateWidth(text: string, glyphs: number): number | null {
    return this.absoluteCoordinates() && text.length + glyphs * 2 > 10 ? 64 : null;
  }
  setAbsoluteCoordinates(absolute: boolean): void {
    this.absoluteCoordinates.set(absolute);
    this.session.setItem(ABSOLUTE_COORDINATES_KEY, String(absolute));
  }
  isOrigin(hex: BuildingHex): boolean {
    return hex.q === 0 && hex.r === 0;
  }
  private decoration(hex: BuildingHex, floor: number) {
    const features = buildingMapFeatures(this.entity(), hex, floor);
    const doors = buildingMapDoors(this.entity(), hex, floor).map((door) => {
      const side = this.sideLines[door.facing];
      return {
        ...door,
        line: door.geometry?.line.map(([x, y]) => `${x * HEX_SIZE},${y * HEX_SIZE}`).join(' '),
        points: (door.geometry ? door.geometry.arrow.map(([x, y]) => [x * HEX_SIZE, y * HEX_SIZE])
          : buildingDoorPoints([side.x1, side.y1], [side.x2, side.y2]))
          .map(([x, y]) => `${x},${y}`)
          .join(' '),
      };
    });
    return { features, fill: buildingMapFill(features), glyphs: features.filter((symbol) => this.mapKey[symbol].glyph), doors };
  }
  private drag?: { id: number; x: number; y: number; scale: number; scrollPage: boolean; moved: boolean };
  private suppressClick = false;

  constructor() {
    afterRenderEffect((onCleanup) => {
      const svg = this.mapSvg()?.nativeElement;
      if (!svg) return;
      const updateSize = () => {
        const { width, height } = svg.getBoundingClientRect();
        this.viewportSize.set({ width, height });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(svg);
      onCleanup(() => observer.disconnect());
    });
    // Keep the warehouse target valid when a geometry edit or undo removes the selected location.
    effect(() => {
      if (this.location() !== this.selectedLocation()) this.location.set(this.selectedLocation());
    });
  }

  select(hex: BuildingHex): void {
    this.location.set(buildingLocationName(hex, Math.min(this.floor(), this.entity().hexHeight(hex) - 1)));
    const position = this.entity().displayGrid().position(hex);
    this.moveColumn.set(this.absoluteCoordinates() ? hex.q : position.column + 1);
    this.moveRow.set(this.absoluteCoordinates() ? hex.r : position.row + 1);
  }

  selectFloor(floor: number): void {
    const hex = this.entity().occupiesMapLevel(this.selected(), floor)
      ? this.selected()
      : (this.entity()
          .coordinates()
          .find((hex) => this.entity().occupiesMapLevel(hex, floor)) ?? this.selected());
    this.location.set(buildingLocationName(hex, floor));
  }

  async activate(hex: BuildingHex, occupied: boolean): Promise<void> {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (occupied) this.select(hex);
    else if (!this.disabled()) {
      const changes = buildingTopologyDoorChanges(this.entity(), [...this.entity().coordinates(), hex]);
      const remove = changes.count ? await this.confirmDoorCleanup(changes) : false;
      this.editRequested.emit(() => {
        if (remove) changes.remove();
        if (
          this.entity()
            .coordinates()
            .some((existing) => buildingHexKey(existing) === buildingHexKey(hex))
        )
          setConstructionBuildingHexHeight(this.entity(), hex, this.floor() + 1);
        else setConstructionBuildingTopology(this.entity(), [...this.entity().coordinates(), hex]);
        this.select(hex);
      });
    }
  }

  private async confirmDoorCleanup(changes: ReturnType<typeof buildingTopologyDoorChanges>): Promise<boolean> {
    if (!changes.count) return false;
    const dialog = this.dialogs.createDialog<boolean>(ConfirmDialogComponent, {
      disableClose: true, panelClass: 'warning', data: {
        title: 'Doors affected by footprint edit',
        message: `${changes.description} Remove them with this edit? Keeping them will leave validation errors.`,
        buttons: [{ label: 'REMOVE AFFECTED DOORS', value: true }, { label: 'KEEP INVALID DOORS', value: false }],
      },
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  setHexHeight(value: number | null): void {
    if (value === null || !Number.isInteger(value) || value < 1) return;
    this.editRequested.emit(() => setConstructionBuildingHexHeight(this.entity(), this.selected(), value));
  }

  setFuel(value: number | null): void {
    if (value === null || !Number.isFinite(value) || value < 0) return;
    this.editRequested.emit(() => {
      const entity = this.entity();
      const allocation = new Map(entity.coordinates().map((hex) => [buildingHexKey(hex), entity.fuelInHex(hex)]));
      allocation.set(buildingHexKey(this.selected()), value);
      entity.fuelLocations.set(allocation);
    });
  }

  distributeFuel(): void {
    this.editRequested.emit(() => this.entity().fuelLocations.set(new Map()));
  }

  floorName(level: number): string {
    const displayed = this.entity().baseLevel() + level;
    return displayed === 0 ? 'Ground floor' : `Floor ${displayed}`;
  }

  setSide(side: number, selected: boolean): void {
    this.editRequested.emit(() => {
      const entity = this.entity(),
        hex = this.selected();
      const values = new Map(entity.wallSides());
      values.set(
        buildingHexKey(hex),
        selected ? entity.sideMask(hex) | (1 << side) : entity.sideMask(hex) & ~(1 << side),
      );
      const neighbor = buildingNeighbors(hex)[side];
      if (selected && entity.coordinates().some((other) => buildingHexKey(other) === buildingHexKey(neighbor)))
        values.set(buildingHexKey(neighbor), entity.sideMask(neighbor) & ~(1 << ((side + 3) % 6)));
      entity.wallSides.set(values);
    });
  }

  setBridgeEndpoint(start: boolean, level: number): void {
    const span = this.bridgeSpan();
    if (!span || !Number.isSafeInteger(level) || level < 0) return;
    this.editRequested.emit(() =>
      this.entity().bridgeDecks.set(
        buildingBridgeLevels(
          span,
          start ? level : this.entity().deckLevel(span.start),
          start ? this.entity().deckLevel(span.end) : level,
        ),
      ),
    );
  }

  async removeHex(): Promise<void> {
    const hex = this.selected();
    if (this.entity().coordinates().length < 2) return;
    const changes = buildingTopologyDoorChanges(this.entity(), this.entity().coordinates().filter(item => buildingHexKey(item) !== buildingHexKey(hex)));
    const remove = changes.count ? await this.confirmDoorCleanup(changes) : false;
    this.editRequested.emit(() => {
      if (remove) changes.remove();
      setConstructionBuildingTopology(
        this.entity(),
        this.entity()
          .coordinates()
          .filter((item) => buildingHexKey(item) !== buildingHexKey(hex)),
      );
      this.select(this.entity().coordinates()[0]);
    });
  }

  moveHex(): void {
    const previous = this.selected();
    if (this.isOrigin(previous)) return;
    const moved = this.absoluteCoordinates()
      ? { q: this.moveColumn(), r: this.moveRow() }
      : this.entity()
          .displayGrid()
          .hexAt(this.moveColumn() - 1, this.moveRow() - 1);
    this.editRequested.emit(() => {
      setConstructionBuildingTopology(
        this.entity(),
        this.entity()
          .coordinates()
          .map((hex) => (hex === previous ? moved : hex)),
        this.entity().height() ?? 1,
        new Map([[buildingHexKey(previous), moved]]),
      );
      this.select(moved);
    });
  }

  rotate(): void {
    const transform = (hex: BuildingHex) => ({ q: -hex.r, r: hex.q + hex.r });
    const selected = transform(this.selected());
    this.editRequested.emit(() => {
      transformConstructionBuilding(this.entity(), transform, (facing) => (facing >= 0 ? (facing + 1) % 6 : facing));
      this.select(selected);
    });
  }

  mirror(): void {
    const transform = (hex: BuildingHex) => ({ q: -hex.q, r: hex.q + hex.r });
    const selected = transform(this.selected());
    this.editRequested.emit(() => {
      transformConstructionBuilding(this.entity(), transform, (facing) => (facing >= 0 ? (6 - facing) % 6 : facing));
      this.select(selected);
    });
  }

  makeOrigin(): void {
    const origin = this.selected();
    this.editRequested.emit(() => {
      transformConstructionBuilding(this.entity(), (hex) => ({ q: hex.q - origin.q, r: hex.r - origin.r }));
      this.select({ q: 0, r: 0 });
    });
  }

  assign(): void {
    const mount = this.entity()
      .equipment()
      .find((item) => item.mountId === this.assignId());
    if (mount)
      this.editRequested.emit(() => {
        moveConstructionEquipment(this.entity(), mount, this.selectedLocation());
        this.assignId.set('');
      });
  }

  setViewMode(mode: 'top' | 'pancake'): void {
    this.viewMode.set(mode);
    this.resetView();
  }
  openFloor(floor: number): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.entity().isBridge()) {
      const hex = this.entity()
        .coordinates()
        .find((hex) => this.entity().deckLevel(hex) === floor);
      if (hex) this.select(hex);
    } else this.selectFloor(floor);
    this.setViewMode('top');
  }

  resetView(): void {
    this.zoom.set(100);
    this.pan.set({ x: 0, y: 0 });
  }
  wheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget as SVGSVGElement;
    const delta = viewerWheel(event, this.optionsService.options().mouseWheelAction, {
      width: svg.clientWidth, height: svg.clientHeight,
    });
    if (delta.zoom !== 1) {
      const before = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()?.inverse());
      const oldSize = this.viewSize();
      const oldPan = this.pan();
      this.zoom.set(Math.max(50, Math.min(400, Math.round(this.zoom() * delta.zoom))));
      const ratio = this.viewSize().width / oldSize.width;
      const bounds = this.mapBounds();
      const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
      this.pan.set(this.clampPan({
        x: oldPan.x + (before.x - center.x - oldPan.x) * (1 - ratio),
        y: oldPan.y + (before.y - center.y - oldPan.y) * (1 - ratio),
      }));
      return;
    }
    const scale = svg.getScreenCTM()?.a ?? 1;
    const before = this.pan();
    const next = this.clampPan({ x: before.x + delta.x / scale, y: before.y + delta.y / scale });
    this.pan.set(next);
    this.scrollPage(svg, delta.y - (next.y - before.y) * scale);
  }

  pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.pointerType === 'touch' && !event.isPrimary)) return;
    const svg = event.currentTarget as SVGSVGElement;
    this.suppressClick = false;
    if (!this.pannable()) return;
    const matrix = svg.getScreenCTM();
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scale: matrix?.a ?? 1,
      // touch-action is fixed for this gesture, even if zoom or layout changes during it.
      scrollPage: event.pointerType === 'touch' && this.panLimits().y > 0,
      moved: false,
    };
  }
  pointerMove(event: PointerEvent): void {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x,
      dy = event.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
    this.drag.moved = true;
    const svg = event.currentTarget as SVGSVGElement;
    svg.setPointerCapture(event.pointerId);
    const previous = this.pan();
    const next = this.clampPan({ x: previous.x - dx / this.drag.scale, y: previous.y - dy / this.drag.scale });
    this.pan.set(next);
    if (this.drag.scrollPage) {
      this.scrollPage(svg, -dy - (next.y - previous.y) * this.drag.scale);
    }
    // Consume each movement once so reversing at an edge responds immediately.
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  }
  private scrollPage(svg: SVGSVGElement, deltaY: number): void {
    // The constructor can live in a scrolling dialog or directly in the page.
    for (let parent = svg.parentElement; parent && Math.abs(deltaY) > 0.5; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const scrollable =
        /^(auto|scroll)$/.test(style.overflowY) ||
        (parent === document.scrollingElement && !/^(hidden|clip)$/.test(style.overflowY));
      if (!scrollable) continue;
      const before = parent.scrollTop;
      parent.scrollBy({ top: deltaY, behavior: 'instant' });
      deltaY -= parent.scrollTop - before;
      if (style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') break;
    }
  }
  private clampPan(pan: { x: number; y: number }): { x: number; y: number } {
    const limits = this.panLimits();
    return {
      x: limits.x === 0 ? 0 : Math.max(-limits.x, Math.min(limits.x, pan.x)),
      y: limits.y === 0 ? 0 : Math.max(-limits.y, Math.min(limits.y, pan.y)),
    };
  }
  pointerUp(event: PointerEvent): void {
    if (this.drag && this.drag.id !== event.pointerId) return;
    this.suppressClick = this.drag?.moved ?? false;
    this.drag = undefined;
    const svg = event.currentTarget as SVGSVGElement;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
}
