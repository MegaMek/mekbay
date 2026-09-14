import { ConstructionTopologyComponent } from './components/construction-topology.component';
import { ConstructionBuildingStructureComponent } from './components/construction-building-structure.component';
import { StaticEmplacementEntity } from '../models/entity/entities/misc/static-emplacement-entity';
import { parseBuildingLocation } from '../models/entity/types/building';
import { SourcebookPickerComponent } from '../components/sourcebook-picker/sourcebook-picker.component';
import type { SourcebookReference } from '../models/sourcebook.model';
// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  HostListener,
  inject,
  Injector,
  linkedSignal,
  resource,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule, type NgModel } from '@angular/forms';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { UnitIconComponent } from '../components/unit-icon/unit-icon.component';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
  CdkDropListGroup,
  type CdkDragDrop,
  type CdkDragMove,
} from '@angular/cdk/drag-drop';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { BaseEntity } from '../models/entity/base-entity';
import { asComponentId, type ComponentId } from '../models/entity/entity-identifiers';
import { EntityMountedEquipment, type EntityMountedEquipmentInit } from '../models/entity/types/equipment';
import { MekEntity, type MekStructureDonor } from '../models/entity/entities/mek/mek-entity';
import { isMekLocation, type EntityValidationMessage } from '../models/entity/types';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { VehicleEntity } from '../models/entity/entities/vehicle/vehicle-entity';
import {
  AmmoEquipment,
  ArmorEquipment,
  Equipment,
  StructureEquipment,
  WeaponEquipment,
  formatEquipmentName,
  formatEquipmentRulesRefs,
  resolveWeaponDamage,
} from '../models/equipment.model';
import { isArmorConstructionEquipment } from '../models/construction-equipment.model';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { QuirksCatalogService } from '../services/catalogs/quirks-catalog.service';
import { DataService } from '../services/data.service';
import { NativeEntityService } from '../services/native-entity.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { UnitArtworkService } from '../services/unit-artwork.service';
import { UnitFluffImageService } from '../services/catalogs/unit-fluff-image.service';
import type { UnitArtwork } from '../models/unit-artwork.model';
import { extractNativeUnitArtwork, MAX_NATIVE_IMPORT_BYTES } from '../models/entity/native-unit-artwork';
import { decodeUnitArtwork, encodeUnitImage, normalizeUnitImage } from '../utils/unit-artwork.util';
import { CustomUnitSyncService } from '../services/custom-unit-sync.service';
import { ForceCustomDesignsService } from '../services/force-custom-designs.service';
import { uuidv7 } from '../utils/uuid.util';
import { DialogsService } from '../services/dialogs.service';
import { UnitNameService } from '../services/unit-name.service';
import { LayoutService } from '../services/layout.service';
import { OptionsService } from '../services/options.service';
import { TechBaseBadgeComponent } from '../components/tech-base-badge/tech-base-badge.component';
import {
  equipmentHeat,
  equipmentTechnologyGroups,
  equipmentToHitModifier,
  equipmentTypeLabel,
} from '../components/floating-comp-info/equipment-info';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../models/rules/game-rules';
import { formatWeaponDamage } from '../utils/weapon-damage.util';
import {
  constructionEngineTechnology,
  constructionTechnologyEligibility,
} from './domain/construction-technology-rules';
import { ToastService } from '../services/toast.service';
import { shareUrlWithClipboardFallback } from '../utils/clipboard.util';
import { StatBarSpecsPipe } from '../pipes/stat-bar-specs.pipe';
import { TooltipDirective } from '../directives/tooltip.directive';
import { InspectorHoverDirective } from '../directives/inspector-hover.directive';
import { InspectorInteraction } from '../components/floating-comp-info/inspector-interaction';
import { UnitSummaryBuilder } from '../utils/unit-summary-builder';
import { asUnitUuid, CUSTOM_UNIT_PROVIDER_ID } from '../services/unit-catalog/unit-catalog.types';
import { constructionLocationLayout } from './domain/construction-location-layout';
import { caseEquipmentKind } from '../models/case-equipment.model';
import { constructionArmorTechRating, constructionMaterialMessages } from './domain/construction-material-rules';
import {
  constructionOmniBaseSource,
  constructionPodField,
  constructionReconfigurationIssues,
  establishConstructionOmniBase,
  supportsConstructionReconfiguration,
} from './domain/construction-design-mode';
import type { ConstructionLocation } from './domain/construction-rules';
import {
  planConstructionEquipmentInsertion,
  planConstructionCaseInstallation,
  allocationPlacements,
  constructionBlockMovePlacements,
  constructionEquipmentCandidate,
  moveConstructionEquipmentBlock,
  removeConstructionEquipment,
  reorderConstructionEquipment,
  splitConstructionEquipment,
} from './domain/construction-rules';
import {
  ensureConstructionMaterialEquipment,
  isRequiredConstructionEquipment,
  uninstallConstructionEquipment,
} from './domain/construction-rules';
import {
  applyConstructionSpreadPlacements,
  constructionSpreadAllocation,
  constructionSpreadAutoPlacements,
  constructionSpreadMovePlacements,
  setConstructionSpreadSlots,
} from './domain/construction-rules';
import { areMekSplitLocationsAdjacent, type MekSystemType } from '../models/entity/types/mek';
import { mekSystemLabel } from '../utils/mek-critical-display.util';
import { getWeaponTypeCSSClass } from '../utils/equipment.util';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';
import { encodeNativeEntity, nativeEntityFormat } from '../models/entity/write-entity';
import { ConstructionExtrasComponent } from './components/construction-extras.component';
import { ConstructionFluffComponent } from './components/construction-fluff.component';
import { ConstructionQuirksComponent } from './components/construction-quirks.component';
import { ConstructionSummaryComponent } from './components/construction-summary.component';
import { constructionQuirkApplies } from './domain/construction-quirk-rules';
import { WEAPON_QUIRKS } from '../models/entity/utils/weapon-quirks';
import {
  canAssignWeaponQuirks,
  captureConstructionWeaponQuirks,
  constructionWeaponQuirkApplies,
  reconcileConstructionWeaponQuirks,
} from './domain/construction-weapon-quirks';
import { ConstructionArmorControlComponent } from './components/construction-armor-control.component';
import { ConstructionPreviewComponent } from './components/construction-preview.component';
import { ConstructionBreakdownComponent } from './components/construction-breakdown.component';
import { constructionBreakdown } from './domain/construction-breakdowns';
import {
  constructionArmorRepairCommands,
  constructionComponentHasRepairDamage,
  constructionComponentRepairCommands,
  constructionHasRepairDamage,
  constructionInternalRepairCommands,
  constructionPendingRepairQuote,
  constructionReconfigurationSPCost,
  constructionRepairQuote,
  type ConstructionRepairQuote,
} from './domain/construction-repairs';
import { fillConstructionArmor } from './domain/construction-armor-allocation';
import { constructionComponentArmorIssue } from './domain/construction-component-armor';
import { ConstructionForceService, type ConstructionMountOrigins } from './construction-force.service';
import type { CBTForceMember } from '../models/force-member.model';
import type { ConstructionRuntimeCommand, ConstructionRuntimePreview } from '../models/runtime/construction-runtime';
import { ammoLoadoutDisplay } from '../models/runtime/mek-ammo';
import {
  mountedAmmoDialogData,
  SetAmmoDialogComponent,
  type SetAmmoDialogResult,
} from '../components/set-ammo-dialog/set-ammo.dialog.component';
import { reconcileConstructionEquipmentRelationships } from './domain/construction-relationships';
import { constructionSystemSlotKeys, reconcileConstructionSystemSlots } from './domain/construction-system-rules';
import {
  CONSTRUCTION_UNIT_TYPES,
  createConstructionEntity,
  getConstructionFields,
  getConstructionLocations,
  getConstructionMass,
  getConstructionMassCapacity,
  constructionEquipmentEligibilityIssues,
  equipmentLocationIssues,
  equipmentPlacementIssues,
  installConstructionEquipment,
  moveConstructionEquipment,
  resizeConstructionEquipment,
  validateConstruction,
  setConstructionArmor,
  getConstructionArmorOptions,
  getConstructionStructureOptions,
  setConstructionArmorMaterial,
  setConstructionStructure,
  constructionSupportsAmmoQuantity,
  constructionSupportsPatchwork,
  setConstructionPatchwork,
  setConstructionHybridStructure,
  maximizeConstructionArmor,
  type ConstructionField,
  type ConstructionUnitKind,
} from './domain';

interface DragEquipment {
  readonly equipmentId: string;
  readonly mountId?: string;
  readonly sourceLocation?: string;
  readonly sourceSlotIndex?: number;
  readonly slotCount?: number;
}
type PlacementSelection = { kind: 'equipment'; equipment: Equipment } | { kind: 'mount'; mountId: string };
interface DropLocation {
  readonly location: string;
  readonly slotIndex?: number;
}
type SlotRow = ConstructionLocation['slots'][number] & {
  span: number;
  integralEquipment?: readonly { mount: EntityMountedEquipment; quantity: number }[];
};
interface ConstructionHistoryEntry {
  readonly source: string;
  readonly unallocated: readonly EntityMountedEquipment[];
  readonly origins: ConstructionMountOrigins;
  readonly runtime: ConstructionRuntimePreview | null;
  readonly artwork: UnitArtwork | null;
}
type WarehouseCategory = 'all' | 'energy' | 'ballistic' | 'missile' | 'artillery' | 'physical' | 'ammo' | 'misc';
type EquipmentSortColumn = 'name' | 'slots' | 'tons' | 'damage' | 'range' | 'bv';

@Component({
  selector: 'unit-construction',
  imports: [
    UnitIconComponent,
    ConstructionTopologyComponent,
    ConstructionBuildingStructureComponent,
    DecimalPipe,
    NgTemplateOutlet,
    FormsModule,
    ScrollingModule,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    CdkDragPreview,
    CdkDropList,
    CdkDropListGroup,
    CdkTrapFocus,
    TooltipDirective,
    InspectorHoverDirective,
    TechBaseBadgeComponent,
    SourcebookPickerComponent,
    ConstructionExtrasComponent,
    ConstructionFluffComponent,
    ConstructionQuirksComponent,
    ConstructionSummaryComponent,
    ConstructionArmorControlComponent,
    ConstructionPreviewComponent,
    ConstructionBreakdownComponent,
  ],
  providers: [StatBarSpecsPipe],
  templateUrl: './unit-construction.component.html',
  styleUrls: [
    './unit-construction.component.scss',
    './construction-loadout.scss',
    './construction-panels.scss',
    './construction-installed-inspector.scss',
    '../components/floating-comp-info/equipment-info.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fullscreen-dialog-host nopadding fullheight' },
})
export class UnitConstructionComponent {
  readonly unitBV = computed(() => {
    try {
      return this.entity().battleValue();
    } catch {
      return null;
    }
  });
  readonly effectiveBV = computed(() => {
    const source = this.repairSnapshot();
    if (source && this.designChanged()) return this.refitBV.hasValue() ? this.refitBV.value().effective : null;
    try {
      return source ? source.query.currentBaseBattleValue() : this.unitBV();
    } catch {
      return null;
    }
  });
  readonly repairBVDelta = computed(() => {
    if (!this.pendingRepairQuote()) return null;
    try {
      const before = this.designChanged()
        ? this.refitBV.hasValue()
          ? this.refitBV.value().beforeRepairs
          : null
        : this.repairSourceSnapshot()?.query.currentBaseBattleValue();
      const after = this.effectiveBV();
      return before == null || after === null ? null : after - before;
    } catch {
      return null;
    }
  });
  readonly unitCost = computed(() => {
    try {
      return this.entity().cost();
    } catch {
      return null;
    }
  });
  showBreakdown(kind: 'bv' | 'weight' | 'cost', event?: Event): void {
    this.toggleDetails(kind, event);
  }
  fillArmor(): void {
    this.change(() => fillConstructionArmor(this.entity()));
  }
  private readonly constructionShell = viewChild<ElementRef<HTMLElement>>('constructionShell');
  private readonly constructionFooter = viewChild<ElementRef<HTMLElement>>('constructionFooter');
  private dragBounds = new Map<string, { id: string; midpoint: number }[]>();
  private dragSequence = 0;
  private dragScrollFrame: number | null = null;
  private dragPointer: { x: number; y: number } | null = null;
  readonly rejectWarehouseDrop = () => false;
  readonly acceptWarehouseDrop = (drag: CdkDrag<DragEquipment>) => {
    const mount = this.entity().equipment().find((item) => item.mountId === drag.data?.mountId);
    return !!mount && this.canRemoveMount(mount);
  };
  rowTicks(count: number): readonly undefined[] {
    return Array.from({ length: count });
  }
  private readonly dialogRef = inject(DialogRef);
  private readonly cdkDialog = inject(Dialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(DialogsService);
  private readonly data = inject(DataService);
  private readonly native = inject(NativeEntityService);
  readonly customUnits = inject(CustomUnitsService);
  private readonly artwork = inject(UnitArtworkService);
  private readonly fluffImages = inject(UnitFluffImageService);
  readonly unitNames = inject(UnitNameService);
  private readonly layout = inject(LayoutService);
  private readonly optionsService = inject(OptionsService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly equipmentToggle = viewChild<ElementRef<HTMLButtonElement>>('equipmentToggle');
  private readonly equipmentViewport = viewChild(CdkVirtualScrollViewport);
  private readonly statBarSpecs = inject(StatBarSpecsPipe);
  private readonly summaryBuilder = new UnitSummaryBuilder();
  private readonly registry = inject(EquipmentCatalogService).getEquipmentRegistry();
  private readonly quirksCatalog = inject(QuirksCatalogService);
  private readonly forceConstruction = inject(ConstructionForceService);

  readonly unitTypes = CONSTRUCTION_UNIT_TYPES;
  readonly entity = signal<BaseEntity>(createConstructionEntity('Biped', this.registry));
  readonly savedUuid = signal<UnitUuid | undefined>(undefined);
  readonly foreignDesign = signal(false);
  private draftUuid?: UnitUuid;
  private readonly customPolicy = inject(ForceCustomDesignsService);
  // An unmodified core design has no native refit parent yet; retain its source identity for the first save.
  private readonly coreSourceUuid = signal<UnitUuid | undefined>(undefined);
  readonly originalUuid = computed(() => this.entity().refitFromUUID() ?? this.coreSourceUuid());
  readonly refitReference = computed(() => {
    this.data.searchCorpusVersion();
    const uuid = this.entity().refitFromUUID();
    if (!uuid || uuid === this.entity().uuid()) return null;
    const source = this.data.getUnitByUuid(uuid);
    return { uuid, name: source ? this.unitNames.name(source) : uuid };
  });
  private readonly baselineSource = signal(encodeNativeEntity(this.entity()));
  private readonly artworkBaseUuid = signal<UnitUuid | undefined>(undefined);
  private readonly artworkDraft = signal<UnitArtwork | null | undefined>(undefined);
  private readonly artworkDraftUrl = signal<string | null>(null);
  readonly effectiveArtwork = computed(() =>
    this.artworkDraft() === undefined
      ? this.artwork.get(this.artworkBaseUuid() ?? this.entity().uuid())
      : (this.artworkDraft() ?? null),
  );
  readonly artworkChanged = computed(() => this.artworkDraft() !== undefined);
  readonly fluffImageUrl = computed(() => {
    const draft = this.artworkDraft();
    const local =
      draft === undefined ? this.artwork.url(this.artworkBaseUuid() ?? this.entity().uuid()) : this.artworkDraftUrl();
    return local ?? this.fluffImages.resolveEntityCatalogUrl(this.entity());
  });
  private readonly newDesign = signal(true);
  readonly routeUuid = computed(() => this.savedUuid() ?? (this.newDesign() ? undefined : this.entity().uuid()));
  private readonly unsavedImport = signal(false);
  private readonly savePending = signal(false);
  private readonly runtimePreview = signal<ConstructionRuntimePreview | null>(null);
  readonly designChanged = computed(() => encodeNativeEntity(this.entity()) !== this.baselineSource());
  readonly runtimeChanged = computed(() => this.runtimePreview()?.changed ?? false);
  readonly dirty = computed(
    () =>
      this.designChanged() ||
      this.runtimeChanged() ||
      this.artworkChanged() ||
      this.unsavedImport() ||
      this.savePending(),
  );
  readonly canShare = computed(() => !this.busy() && !this.newDesign() && !this.dirty());
  readonly canSave = computed(
    () =>
      !this.busy() &&
      (this.dirty() || this.newDesign()) &&
      (this.designEditing() ||
        !this.pendingOmniReconfiguration() ||
        (!constructionHasRepairDamage(this.repairSnapshot()!) &&
          !constructionReconfigurationIssues(this.entity()).length)),
  );
  readonly saveLabel = computed(() => {
    if (this.designChanged() || this.newDesign() || this.unsavedImport() || this.savePending()) {
      return this.savedUuid() ? 'UPDATE REFIT' : this.forceMember() ? 'SAVE NEW REFIT' : 'SAVE REFIT';
    }
    if (this.runtimeChanged() || this.artworkChanged()) return 'SAVE';
    return this.forceMember() || this.savedUuid() ? 'CONFIRM' : 'SAVE REFIT';
  });
  readonly busy = signal(false);
  readonly unitPickerOpen = signal(false);
  readonly status = signal('');
  readonly building = computed(() => {
    const entity = this.entity();
    return entity instanceof StaticEmplacementEntity ? entity : null;
  });
  readonly showQuirks = computed(() => {
    const entity = this.entity();
    return (
      entity.quirks().length > 0 ||
      entity.weaponQuirks().length > 0 ||
      [...this.quirksCatalog.getQuirksByKey().keys()].some((key) => constructionQuirkApplies(entity, key)) ||
      entity
        .equipment()
        .some(
          (mount) =>
            canAssignWeaponQuirks(entity, mount) &&
            WEAPON_QUIRKS.some((quirk) => constructionWeaponQuirkApplies(entity, mount, quirk.key)),
        )
    );
  });
  readonly panel = signal<'loadout' | 'systems' | 'topology' | 'fluff' | 'quirks' | 'preview'>('loadout');
  private readonly systemPanels = viewChildren<ElementRef<HTMLElement>>('systemPanel');
  readonly picker = signal<'new' | null>(null);
  readonly newType = signal<ConstructionUnitKind>('Biped');
  readonly query = signal('');
  readonly category = signal<WarehouseCategory>('all');
  readonly filterByLocation = signal(false);
  readonly equipmentFiltersOpen = signal(false);
  readonly showIncompatibleEquipment = signal(false);
  readonly equipmentRowHeight = 44;
  readonly trackEquipment = (_index: number, equipment: Equipment) => equipment.id;
  readonly equipmentSort = signal<{ column: EquipmentSortColumn; direction: 'asc' | 'desc' }>({
    column: 'name',
    direction: 'asc',
  });
  readonly equipmentColumns: readonly { id: EquipmentSortColumn; label: string }[] = [
    { id: 'name', label: 'Name' },
    { id: 'slots', label: 'Slots' },
    { id: 'tons', label: 'Tons' },
    { id: 'damage', label: 'Damage' },
    { id: 'range', label: 'Range' },
    { id: 'bv', label: 'BV' },
  ];
  readonly selectedLocation = signal('RT');
  readonly selectedEquipment = signal<Equipment | null>(null);
  readonly selectedMountId = signal<string | null>(null);
  // Inspecting by hover must not replace equipment explicitly chosen for placement.
  private readonly placementSelection = signal<PlacementSelection | null>(null);
  private readonly placementMount = computed(() => {
    const selection = this.placementSelection();
    return selection?.kind === 'mount'
      ? this.entity().equipment().find((mount) => mount.mountId === selection.mountId) ?? null
      : null;
  });
  readonly placementEquipment = computed(() => {
    const selection = this.placementSelection();
    return selection?.kind === 'equipment' ? selection.equipment : this.placementMount()?.equipment ?? null;
  });
  readonly selectedMountLocation = signal('');
  readonly hoveredMountId = signal<string | null>(null);
  readonly hoveredSystemId = signal<string | null>(null);
  readonly dragging = signal<DragEquipment | null>(null);
  readonly dragPreviewOffset = signal('0% 0%');
  readonly dragTarget = signal<{ location: string; beforeMountId?: string } | null>(null);
  readonly selectedSystem = signal<{ location: string; system: MekSystemType; componentId: string } | null>(null);
  readonly inspector = new InspectorInteraction();
  readonly inspectorOpen = this.inspector.isOpen;
  readonly inspectorPosition = signal({ x: 0, y: 0 });
  private readonly inspectorPanel = viewChild<ElementRef<HTMLElement>>('installedInspector');
  readonly splitLocation = signal('');
  readonly splitSecondLocation = signal('');
  readonly splitCount = signal(1);
  readonly splitTotal = computed(() => this.selectedMount()?.placements?.length ?? 0);
  readonly splitChoices = computed(() =>
    this.locations().filter((location) => {
      const entity = this.entity();
      return (
        entity instanceof MekEntity &&
        !entity.locationIsLeg(location.id) &&
        this.locations().some((other) => areMekSplitLocationsAdjacent(location.id, other.id))
      );
    }),
  );
  readonly splitSecondChoices = computed(() =>
    this.splitChoices().filter((location) => areMekSplitLocationsAdjacent(this.splitLocation(), location.id)),
  );
  readonly dropPlans = computed(() => {
    const drag = this.dragging();
    const mount = this.entity()
      .equipment()
      .find((mount) => mount.mountId === drag?.mountId);
    const eq = mount?.equipment ?? (drag ? this.registry.findEquipment(drag.equipmentId) : null);
    return new Map(
      this.locations().map((location) => {
        const editable = mount
          ? this.canEditMount(mount) ||
            ((drag?.sourceLocation ?? mount.location) === location.id && this.canReorderMount(mount))
          : !eq || this.canInstall(eq);
        let issue = editable
          ? ''
          : this.omniReconfiguration() && !this.reconfiguring() && !this.designEditing()
            ? 'Repair the unit fully before reconfiguring it, or enable Edit design.'
            : 'Fixed design. Enable Edit design to change this equipment.';
        let placements: ReturnType<typeof allocationPlacements>;
        let insertion: ReturnType<typeof planConstructionEquipmentInsertion> | undefined;
        if (eq && !issue) {
          try {
            const entity = this.entity();
            const splitBlock =
              mount &&
              drag?.sourceLocation &&
              entity instanceof MekEntity &&
              mount.equipment?.canSplit() &&
              !mount.equipment.isSpreadable &&
              new Set(mount.placements?.map((p) => p.location)).size > 1;
            if (mount && entity instanceof MekEntity && this.spreadAllocation(mount)) {
              placements = constructionSpreadMovePlacements(
                entity,
                mount,
                drag?.sourceLocation,
                location.id,
                drag?.slotCount,
                drag?.sourceSlotIndex,
              );
            } else if (splitBlock && drag.sourceLocation !== location.id) {
              placements = constructionBlockMovePlacements(entity, mount, drag.sourceLocation!, location.id);
            } else {
              issue = equipmentPlacementIssues(this.entity(), eq, location.id, mount).join(' ');
              if (!issue) placements = allocationPlacements(this.entity(), eq, location.id, undefined, mount);
              // Reordering retains this mount's existing split allocation.
              if (
                mount &&
                (mount.placements?.some((p) => p.location === location.id) ||
                  (!(this.entity() instanceof MekEntity) && mount.location === location.id))
              ) {
                issue = '';
                placements = mount.placements;
              }
            }
            if (!issue && placements && entity instanceof MekEntity && this.dragTarget()?.location === location.id) {
              insertion = planConstructionEquipmentInsertion(
                entity,
                eq,
                location.id,
                placements,
                mount,
                this.dragTarget()?.beforeMountId,
              );
            }
          } catch (error) {
            issue = error instanceof Error ? error.message : String(error);
          }
        }
        return [location.id, { issue, placements, insertion }] as const;
      }),
    );
  });
  readonly acceptEquipmentDrop = (drag: CdkDrag<DragEquipment>, drop: CdkDropList<DropLocation>) => {
    if (!this.dragging()) this.dragging.set(drag.data);
    return !this.dropPlans().get(drop.data.location)?.issue;
  };
  readonly dropArrangement = computed(() => {
    const target = this.dragTarget();
    return target ? (this.dropPlans().get(target.location)?.insertion?.arrangement ?? null) : null;
  });
  previewRowIndex(location: string, row: SlotRow): number {
    if (!row.mount || location !== this.dragTarget()?.location) return row.index;
    const placements = this.dropArrangement()
      ?.get(row.mount.mountId)
      ?.filter((p) => p.location === location);
    return placements?.length ? Math.min(...placements.map((p) => p.slotIndex)) : row.index;
  }
  previewOccupied(location: string, index: number): boolean {
    const plan = this.dropArrangement();
    return (
      !!plan &&
      [...plan.values()].some((placements) => placements.some((p) => p.location === location && p.slotIndex === index))
    );
  }
  readonly dropPreview = computed(() => {
    const target = this.dragTarget(),
      drag = this.dragging();
    if (!target || !drag || this.dropPlans().get(target.location)?.issue) return [];
    const plan = this.dropPlans().get(target.location);
    const placements =
      (plan?.insertion && plan.insertion.arrangement.get(plan.insertion.mountId)) || plan?.placements || [];
    const mount = this.entity()
      .equipment()
      .find((mount) => mount.mountId === drag.mountId);
    const movingSplitBlock =
      drag.sourceLocation &&
      mount?.equipment?.canSplit() &&
      !mount.equipment.isSpreadable &&
      new Set(mount.placements?.map((p) => p.location)).size > 1;
    const visiblePlacements =
      movingSplitBlock || mount?.equipment?.isSpreadable
        ? placements.filter((p) => p.location === target.location)
        : placements;
    const rows: { location: string; index: number; span: number }[] = [];
    for (const placement of [...visiblePlacements].sort(
      (a, b) => a.location.localeCompare(b.location) || a.slotIndex - b.slotIndex,
    )) {
      const last = rows.at(-1);
      if (last?.location === placement.location && last.index + last.span === placement.slotIndex) last.span++;
      else rows.push({ location: placement.location, index: placement.slotIndex, span: 1 });
    }
    return rows;
  });
  readonly detailsView = signal<'issues' | 'bv' | 'weight' | 'cost' | null>(null);
  readonly showValidation = computed(() => this.detailsView() === 'issues');
  readonly dockedDetailsOpen = computed(() => this.detailsView() !== null && this.layout.windowWidth() > 1850);
  readonly detailsOverlayOpen = computed(() => this.detailsView() !== null && !this.dockedDetailsOpen());
  readonly breakdown = computed(() => {
    const kind = this.detailsView();
    if (kind === null || kind === 'issues') return null;
    try {
      const data = constructionBreakdown(this.entity(), kind);
      return Number.isFinite(data.total) ? data : null;
    } catch {
      return null;
    }
  });
  private detailsTrigger: HTMLElement | null = null;
  toggleDetails(view: 'issues' | 'bv' | 'weight' | 'cost', event?: Event): void {
    if (this.detailsView() === view) {
      this.closeDetails();
      return;
    }
    this.detailsTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.detailsView.set(view);
  }
  closeDetails(): void {
    this.detailsView.set(null);
    const trigger = this.detailsTrigger;
    this.detailsTrigger = null;
    // Wait until the overlay's background is no longer inert before restoring focus.
    afterNextRender(() => trigger?.focus({ preventScroll: true }), { injector: this.injector });
  }
  navigateToIssue(message: EntityValidationMessage): void {
    // Navigation owns the next focus target, instead of restoring the issues toggle.
    this.detailsTrigger = null;
    this.detailsView.set(null);
    this.equipmentDrawerOpen.set(false);
    this.inspector.close();
    this.placementSelection.set(null);

    const mount = message.mountId
      ? this.entity().equipment().find((item) => item.mountId === message.mountId)
      : undefined;
    const location = [message.location, mount?.location, ...(mount?.getOccupiedLocations() ?? [])]
      .find((id) => id && this.locations().some((item) => item.id === id));
    const fieldByCode: Readonly<Record<string, string>> = {
      CHASSIS_REQUIRED: 'chassis',
      OEM_YEAR_AFTER_INTRODUCTION: 'originalBuildYear',
      MEK_CHASSIS_WEIGHT: 'tonnage',
      OMNI_CHASSIS: 'omni',
      PROTO_GLIDER_SPEED: 'walkMP',
      PROTO_QUAD_SPEED: 'walkMP',
    };
    const field = fieldByCode[message.code];
    let selector: string;
    let fallback = '.construction-workspace';
    if (mount) {
      this.panel.set('loadout');
      if (location) this.selectedLocation.set(location);
      const unallocated = this.isMountUnallocated(mount);
      if (unallocated) this.unallocatedOpen.set(true);
      const scope = unallocated ? '.unallocated-panel ' : location ? `.location-card[data-location="${CSS.escape(location)}"] ` : '';
      selector = `${scope}[data-mount-id="${CSS.escape(mount.mountId)}"]`;
    } else if (field) {
      this.panel.set('systems');
      if (field === 'originalBuildYear') this.oemYearExpanded.set(true);
      selector = `[data-field-id="${field}"]`;
    } else if (message.code.includes('QUIRK')) {
      this.panel.set('quirks');
      selector = 'construction-quirks';
    } else if (message.code.startsWith('MATERIAL_') && message.category !== 'crit') {
      this.panel.set('systems');
      selector = '[data-system-group="Materials"]';
    } else if (location) {
      this.panel.set('loadout');
      this.selectedLocation.set(location);
      fallback = `.location-card[data-location="${CSS.escape(location)}"]`;
      selector = message.category === 'armor'
        ? `${fallback} .location-defense`
        : fallback;
    } else if (message.code === 'OVERWEIGHT') {
      this.detailsView.set('weight');
      selector = 'construction-breakdown';
      fallback = '#construction-details';
    } else if (['equipment', 'crit', 'armor'].includes(message.category) || message.code === 'MASS_UNRESOLVED') {
      this.panel.set('loadout');
      if ((message.category === 'crit' || message.code === 'MASS_UNRESOLVED') && this.unallocated().length) {
        this.unallocatedOpen.set(true);
        selector = '.unallocated-panel';
      } else selector = '.location-grid';
    } else {
      this.panel.set('systems');
      const group: Partial<Record<EntityValidationMessage['category'], string>> = {
        general: 'Chassis', tech: 'Chassis', weight: 'Chassis', movement: 'Movement',
      };
      selector = message.category === 'heat' ? '[data-field-id="heatSinks"]'
        : `[data-system-group="${group[message.category] ?? 'Systems'}"]`;
    }
    afterNextRender(() => {
      const shell = this.constructionShell()?.nativeElement;
      const target = shell?.querySelector<HTMLElement>(selector) ?? shell?.querySelector<HTMLElement>(fallback);
      if (!target) return;
      // Prefer the invalid armor facing, then an editable control or equipment name.
      const focus = target.querySelector<HTMLElement>('input:out-of-range:not(:disabled), [aria-invalid="true"]:not(:disabled)')
        ?? target.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled), summary')
        ?? target;
      if (focus === target && !target.matches('button, input, select, summary, [tabindex]')) target.tabIndex = -1;
      focus.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, { injector: this.injector });
  }
  readonly equipmentDrawerOpen = signal(false);
  readonly mobileEquipment = computed(() => this.layout.windowWidth() <= 900);
  readonly equipmentDrawerActive = computed(() => this.mobileEquipment() && this.equipmentDrawerOpen() && !this.dragging());
  readonly forceMember = signal<CBTForceMember | null>(null);
  readonly editDesign = signal(false);
  readonly designEditing = computed(() => !this.foreignDesign() && (!this.forceMember() || this.editDesign()));
  readonly omniReconfiguration = computed(
    () => !!this.forceMember() && supportsConstructionReconfiguration(this.entity()),
  );
  readonly reconfiguring = computed(
    () =>
      !this.foreignDesign() &&
      this.omniReconfiguration() &&
      !this.designEditing() &&
      !constructionHasRepairDamage(this.repairSnapshot()!),
  );
  private readonly baselineOmniSource = computed(() => {
    if (!this.omniReconfiguration()) return null;
    const source = this.baselineSource(),
      format = nativeEntityFormat(this.entity());
    const entity = untracked(() => this.customUnits.parseDraft(source, format));
    return constructionOmniBaseSource(entity);
  });
  readonly pendingOmniReconfiguration = computed(
    () =>
      this.omniReconfiguration() &&
      this.designChanged() &&
      this.baselineOmniSource() === constructionOmniBaseSource(this.entity()),
  );
  canInstall(eq: Equipment): boolean {
    return this.designEditing() || (this.reconfiguring() && !eq.omniFixedOnly);
  }
  canEditMount(mount: EntityMountedEquipment): boolean {
    return (
      this.designEditing() ||
      (this.reconfiguring() && mount.omniPodMounted && !!mount.equipment && !mount.equipment.omniFixedOnly)
    );
  }
  requiredMount(mount: EntityMountedEquipment): boolean {
    return isRequiredConstructionEquipment(this.entity(), mount);
  }
  isMountUnallocated(mount: EntityMountedEquipment): boolean {
    if (mount.allocation.kind === 'engine') return false;
    if (this.locationCase().get(mount.location)?.slotlessMounts.includes(mount)) return false;
    return !this.locations().some((location) => location.slots.some((slot) => slot.mount?.mountId === mount.mountId));
  }
  canUninstallMount(mount: EntityMountedEquipment): boolean {
    return mount.allocation.kind !== 'engine' && !this.isMountUnallocated(mount) && this.canEditMount(mount);
  }
  canRemoveMount(mount: EntityMountedEquipment): boolean {
    return mount.allocation.kind !== 'engine' && !this.requiredMount(mount) && this.canEditMount(mount);
  }
  readonly canPlaceSelectedEquipment = computed(() => {
    const selection = this.placementSelection();
    if (!selection) return false;
    const mount = this.placementMount();
    return selection.kind === 'mount'
      ? !!mount && this.canPlaceMount(mount)
      : this.canInstall(selection.equipment);
  });
  private canPlaceMount(mount: EntityMountedEquipment): boolean {
    return !!mount.equipment &&
      (this.isMountUnallocated(mount) || !!this.spreadAllocation(mount)?.remaining) && this.canEditMount(mount);
  }
  placementSourceSelected(equipmentId: string, mountId?: string): boolean {
    const drag = this.dragging();
    if (!drag && !this.canPlaceSelectedEquipment()) return false;
    const sourceMountId = drag ? drag.mountId : this.placementMount()?.mountId;
    return mountId !== undefined
      ? sourceMountId === mountId
      : sourceMountId === undefined && (drag?.equipmentId ?? this.placementEquipment()?.id) === equipmentId;
  }
  cancelPlacement(): void {
    this.placementSelection.set(null);
    this.selectedEquipment.set(null);
    this.selectedMountId.set(null);
    this.selectedSystem.set(null);
    this.closeInstalledInspector();
  }
  canReorderMount(mount: EntityMountedEquipment): boolean {
    return mount.allocation.kind !== 'engine' && (this.designEditing() || this.reconfiguring());
  }
  canEditField(field: ConstructionField): boolean {
    return (
      !field.disabled &&
      (this.designEditing() || (this.reconfiguring() && constructionPodField(this.entity(), field.id)))
    );
  }
  setDesignEditing(enabled: boolean): void {
    if (this.busy() || this.forceMember()?.force.readOnly()) return;
    this.editDesign.set(enabled);
    this.endDrag();
  }
  private readonly mountOrigins = signal<ConstructionMountOrigins>(new Map());
  readonly sourceDamage = computed(() => {
    const member = this.forceMember();
    return member ? this.forceConstruction.damage(member, this.entity(), this.mountOrigins()) : null;
  });
  readonly repairSourceSnapshot = computed(() => {
    this.sourceDamage();
    const member = this.forceMember();
    return member?.force.getUnitSnapshot(member.id) ?? null;
  });
  readonly runtimeDamage = computed(() => {
    const member = this.forceMember();
    const preview = this.runtimePreview();
    return member && preview
      ? this.forceConstruction.damage(member, this.entity(), this.mountOrigins(), preview.snapshot)
      : this.sourceDamage();
  });
  readonly repairSnapshot = computed(() => {
    return this.runtimePreview()?.snapshot ?? this.repairSourceSnapshot();
  });
  readonly pendingRepairQuote = computed(() => {
    const source = this.repairSourceSnapshot(),
      preview = this.runtimePreview();
    return source && preview?.changed
      ? constructionPendingRepairQuote(source, preview.snapshot, preview.changes.commands)
      : null;
  });
  readonly pendingSupportPoints = computed(() => {
    const quote = this.pendingRepairQuote(),
      reconfiguration = this.pendingOmniReconfiguration();
    if (!quote && !reconfiguration) return null;
    return {
      cost:
        quote?.spCost === null
          ? null
          : (quote?.spCost ?? 0) + (reconfiguration ? constructionReconfigurationSPCost(this.entity()) : 0),
      basis: [quote?.spBasis, reconfiguration ? 'Omni reconfiguration: tonnage / 2 SP' : '']
        .filter(Boolean)
        .join(' · '),
    };
  });
  private readonly refitBV = resource({
    params: () => {
      const member = this.forceMember();
      if (!member || !this.designChanged()) return undefined;
      this.repairSourceSnapshot();
      const entity = this.entity();
      const source = encodeNativeEntity(entity),
        origins = this.mountOrigins(),
        changes = this.runtimePreview()?.changes;
      return untracked(() => {
        const draft = this.customUnits.parseDraft(source, nativeEntityFormat(entity));
        return { member, draft, origins: this.forceConstruction.remapOrigins(entity, draft, origins), changes };
      });
    },
    loader: ({ params }) =>
      params.member.force.previewConstructionBattleValue(params.member, params.draft, params.origins, params.changes),
  });
  readonly selectedRepairComponent = computed(() => {
    const source = this.repairSnapshot();
    const mount = this.selectedMount();
    const origin = mount && this.mountOrigins().get(mount.mountId);
    const system = this.selectedSystem();
    return source && origin
      ? ([...source.index.components.values()].find((component) => component.mount?.mountId === origin) ?? null)
      : source && system
        ? (source.index.components.get(system.componentId as ComponentId) ?? null)
        : null;
  });
  readonly selectedRepairQuote = computed(() => {
    const source = this.repairSnapshot(),
      component = this.selectedRepairComponent();
    if (!source || !component || !constructionComponentHasRepairDamage(source, component.id)) return null;
    try {
      return constructionRepairQuote(source, component.id);
    } catch {
      return {
        cost: null,
        spCost: null,
        spBasis: 'Repair SP unavailable.',
        basis: 'Resolve the original unit cost to calculate repair pricing.',
      };
    }
  });
  readonly selectedRuntimeAmmo = computed(() => {
    const source = this.repairSnapshot(),
      component = this.selectedRepairComponent();
    if (!source || !(component?.mount?.equipment instanceof AmmoEquipment)) return null;
    const data = mountedAmmoDialogData(source, component.id);
    return data ? { componentId: component.id, data } : null;
  });
  async setRuntimeAmmo(): Promise<void> {
    const ammo = this.selectedRuntimeAmmo();
    if (this.busy() || !ammo) return;
    this.busy.set(true);
    try {
      const ref = this.dialogs.createDialog<SetAmmoDialogResult | null>(SetAmmoDialogComponent, {
        data: ammo.data,
      });
      const selection = await firstValueFrom(ref.closed);
      if (!selection) return;
      await this.stageRuntime([
        {
          type: 'configure-ammo-source',
          componentId: ammo.componentId,
          munitionKey: selection.name,
          remaining: selection.quantity,
          hotLoaded: selection.hotLoaded,
        },
      ]);
      this.status.set('Ammo loadout ready to save.');
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  private async stageRuntime(commands: readonly ConstructionRuntimeCommand[]): Promise<void> {
    const member = this.forceMember(),
      source = this.repairSnapshot();
    if (!member || member.force.readOnly() || !source || !commands.length) return;
    const previous = this.captureHistory();
    const changes = this.runtimePreview()?.changes;
    const preview = await member.force.previewConstructionRuntime(member, {
      context: changes?.context ?? source.editContext,
      commands: [...(changes?.commands ?? []), ...commands],
    });
    this.runtimePreview.set(preview);
    this.recordChange(previous);
  }
  repairPrice(quote: ConstructionRepairQuote): string {
    return quote.cost === null ? 'C-Bill cost unavailable' : `${quote.cost.toLocaleString('en-US')} C-Bills`;
  }
  repairSPPrice(quote: ConstructionRepairQuote): string {
    return quote.spCost === null ? 'SP cost unavailable' : `${quote.spCost.toLocaleString('en-US')} SP`;
  }
  async repairDefense(locationCode: string, face: 'front' | 'rear' | 'internal'): Promise<void> {
    const member = this.forceMember(),
      source = this.repairSnapshot();
    if (!member || member.force.readOnly() || !source || this.busy()) return;
    const location = [...source.index.locations.values()].find((location) => location.code === locationCode);
    if (!location) return;
    const armor = location.armorFaceIds
      .map((id) => source.index.armorFaces.get(id))
      .find((armor) => armor?.face === face);
    const commands =
      face === 'internal'
        ? constructionInternalRepairCommands(source, location.id)
        : armor
          ? constructionArmorRepairCommands(source, armor.id)
          : [];
    if (!commands.length) return;
    this.busy.set(true);
    try {
      await this.stageRuntime(commands);
      this.status.set(`${locationCode} ${face === 'internal' ? 'structure' : face + ' armor'} repair ready to save.`);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async repairSelected(): Promise<void> {
    const member = this.forceMember(),
      source = this.repairSnapshot(),
      component = this.selectedRepairComponent();
    if (!member || member.force.readOnly() || !source || !component || this.busy()) return;
    this.busy.set(true);
    try {
      await this.stageRuntime(constructionComponentRepairCommands(source, component.id));
      this.status.set('Component repair ready to save. Damage to its location can still prevent operation.');
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async repairAll(): Promise<void> {
    const member = this.forceMember(),
      source = this.repairSnapshot();
    if (!member || member.force.readOnly() || !source || this.busy()) return;
    this.busy.set(true);
    try {
      const quote = constructionRepairQuote(source);
      const confirmed = await this.dialogs.requestConfirmation(
        `Restore this force unit to pristine condition, including armor, internal structure, components, ammunition and crew?\n\nRepair estimate: ${this.repairPrice(quote)} · ${this.repairSPPrice(quote)}\n${quote.basis}\n${quote.spBasis}\n\nRepairs will apply when you save.`,
        'Repair all',
        'warning',
      );
      if (!confirmed) return;
      await this.stageRuntime([{ type: 'repair-all' }]);
      this.status.set('Repairs ready to save.');
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  private undoStack: ConstructionHistoryEntry[] = [];
  private redoStack: ConstructionHistoryEntry[] = [];
  readonly historyVersion = signal(0);
  readonly canUndo = computed(() => {
    this.historyVersion();
    return this.canRestoreHistory(this.undoStack.at(-1));
  });
  readonly canRedo = computed(() => {
    this.historyVersion();
    return this.canRestoreHistory(this.redoStack.at(-1));
  });

  readonly categories: readonly { id: WarehouseCategory; label: string; icon?: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'energy', label: 'Energy', icon: 'energy' },
    { id: 'ballistic', label: 'Ballistic', icon: 'ballistic' },
    { id: 'missile', label: 'Missile', icon: 'missile' },
    { id: 'artillery', label: 'Artillery', icon: 'artillery' },
    { id: 'physical', label: 'Physical', icon: 'physical' },
    { id: 'ammo', label: 'Ammo', icon: 'ballistic' },
    { id: 'misc', label: 'Equipment', icon: 'crate' },
  ];
  private readonly equipment = [
    ...new Map(
      Object.values(this.registry.equipment)
        .filter((eq) => !eq.isInternalRepresentation && eq.type !== 'armor' && eq.type !== 'structure')
        .map((eq) => [eq.id, eq]),
    ).values(),
  ];

  readonly locations = computed(() => {
    const locations = getConstructionLocations(this.entity()).map((location) => ({
      ...location,
      rows: this.slotRows(location.slots),
    }));
    const engine =
      locations.find((location) => location.id === 'CT')?.rows.find((row) => row.system === 'Engine') ??
      locations.flatMap((location) => location.rows).find((row) => row.system === 'Engine');
    if (engine) {
      const groups = new Map<string, { mount: EntityMountedEquipment; quantity: number }>();
      for (const mount of this.entity().equipment()) {
        if (mount.allocation.kind !== 'engine') continue;
        const group = groups.get(mount.equipmentId);
        if (group) group.quantity++;
        else groups.set(mount.equipmentId, { mount, quantity: 1 });
      }
      engine.integralEquipment = [...groups.values()];
    }
    return locations;
  });
  readonly selectedConstructionLocation = computed(() =>
    this.locations().find((location) => location.id === this.selectedLocation()),
  );
  readonly isMek = computed(() => this.entity() instanceof MekEntity);
  readonly locationLayout = computed(() => constructionLocationLayout(this.entity()));
  readonly locationCase = computed(() => {
    const entity = this.entity();
    const candidates = this.equipment.filter((equipment) => caseEquipmentKind(equipment));
    const hasAvailableCase = candidates.some(
      (equipment) =>
        caseEquipmentKind(equipment) !== 'prototype' &&
        constructionEquipmentEligibilityIssues(entity, equipment).length === 0,
    );
    const warnings = new Map(
      this.warnings()
        .filter((message) => message.code === 'CASE_WITHOUT_EXPLOSIVES')
        .map((message) => [message.location, message.message]),
    );
    const automatic = entity.automaticClanCaseLocations(),
      optedOut = entity.clanCaseOptOutLocations();
    return new Map(
      this.locations().map((location) => {
        const mounts = entity
          .equipment()
          .filter((mount) => mount.location === location.id || mount.getOccupiedLocations().includes(location.id));
        const protection = mounts.filter((mount) => caseEquipmentKind(mount.equipment));
        const installed = protection.map((mount) => caseEquipmentKind(mount.equipment));
        const kind = installed.includes('case-ii')
          ? 'CASE II'
          : installed.includes('case')
            ? 'CASE'
            : installed.includes('prototype')
              ? 'CASE-P'
              : null;
        const generated = automatic.has(location.id);
        const supportsAutomatic = entity.supportsAutomaticClanCaseAt(location.id);
        const hasExplosives = mounts.some((mount) => entity.isMountedEquipmentExplosive(mount));
        const options =
          entity instanceof MekEntity &&
          (hasExplosives || protection.length > 0) &&
          (supportsAutomatic || hasAvailableCase || protection.length > 0)
            ? (
                [
                  ['none', supportsAutomatic ? 'Opt-Out CASE' : 'Not installed'],
                  ['case', 'CASE'],
                  ['case-ii', 'CASE II'],
                ] as const
              ).map(([value, label]) => {
                const needsEquipment = value !== 'none' && !(value === 'case' && supportsAutomatic);
                const eligible = needsEquipment
                  ? candidates
                      .filter((equipment) => caseEquipmentKind(equipment) === value)
                      .map((equipment) => ({
                        equipment,
                        relocations: planConstructionCaseInstallation(entity, equipment, location.id, protection[0]),
                      }))
                      .filter((candidate) => candidate.relocations !== null)
                  : [];
                const candidate =
                  eligible.find(({ equipment }) => equipment.techBase === entity.techBase()) ?? eligible[0];
                return { value, label, ...candidate, disabled: needsEquipment && !candidate };
              })
            : [];
        return [
          location.id,
          {
            label: kind ?? (generated ? 'CASE' : null),
            automatic: !kind && generated,
            configurable: supportsAutomatic || optedOut.has(location.id),
            optedOut: optedOut.has(location.id),
            supportsAutomatic,
            hasExplosives,
            warning: warnings.get(location.id),
            slotlessMounts: protection.filter((mount) => mount.getNumCriticalSlots(entity) === 0),
            selection: installed.includes('case-ii')
              ? 'case-ii'
              : installed.includes('case')
                ? 'case'
                : installed.includes('prototype')
                  ? 'prototype'
                  : generated
                    ? 'case'
                    : 'none',
            options,
            description: kind
              ? `Installed ${kind} in ${location.label}.`
              : generated
                ? `Automatic Clan CASE in ${location.label}; no critical slots.`
                : optedOut.has(location.id)
                  ? `Automatic Clan CASE disabled in ${location.label}.`
                  : 'Automatic Clan CASE activates when explosive equipment is installed; no critical slots.',
          },
        ] as const;
      }),
    );
  });
  readonly locationColumns = computed(() => {
    const locations = this.locations();
    const layout = this.locationLayout();
    const columns = this.layout.windowWidth() <= 1180 ? layout.compactColumns : layout.desktopColumns;
    return columns.map((ids) => ids.flatMap((id) => locations.filter((location) => location.id === id)));
  });
  readonly locationGroups = computed(() => {
    const building = this.building();
    if (!building) return [{ id: 'all', label: null, columns: this.locationColumns() }];
    const floors = new Map<number, ReturnType<typeof this.locations>>();
    for (const location of this.locations()) {
      const floor = parseBuildingLocation(location.id)!.floor;
      const locations = floors.get(floor);
      if (locations) locations.push(location);
      else floors.set(floor, [location]);
    }
    return [...floors]
      .sort(([a], [b]) => a - b)
      .map(([floor, locations]) => ({
        id: String(floor),
        label: building.isBridge() ? 'Bridge deck' : floor === 0 ? 'Ground floor' : `Floor ${floor}`,
        columns: [locations],
      }));
  });
  readonly isBattleArmor = computed(() => this.entity() instanceof BattleArmorEntity);
  readonly isVehicle = computed(() => this.entity() instanceof VehicleEntity);
  readonly supportsAmmoQuantity = computed(() => constructionSupportsAmmoQuantity(this.entity()));
  readonly fields = computed(() => getConstructionFields(this.entity(), this.showIncompatibleEquipment()));
  readonly locationActuators = computed(
    () =>
      new Map(
        ['LA', 'RA'].map((location) => [
          location,
          ['Lower Arm Actuator', 'Hand Actuator'].flatMap((label) => {
            const field = this.fields().find((field) => field.id === this.actuatorFieldId(location, label));
            return field ? [{ field, label }] : [];
          }),
        ]),
      ),
  );
  readonly oemYearField = computed(() => this.fields().find((field) => field.id === 'originalBuildYear')!);
  readonly oemYearExpanded = signal<boolean | null>(null);
  readonly oemYearVisible = computed(() => this.oemYearExpanded() ?? this.entity().originalBuildYear() > 0);
  readonly fieldGroups = computed(() =>
    [...new Set(this.fields().map((field) => field.group))].map((name) => ({
      name,
      fields: this.fields().filter(
        (field) =>
          field.group === name &&
          field.id !== 'originalBuildYear' &&
          !(this.building() && field.id === 'height') &&
          ![...this.locationActuators().values()].some((actuators) =>
            actuators.some((actuator) => actuator.field === field),
          ),
      ),
    })),
  );
  private readonly armorCandidates = computed(() => getConstructionArmorOptions(this.entity(), true));
  private readonly structureCandidates = computed(() => getConstructionStructureOptions(this.entity(), true));
  private readonly materialErrors = computed(
    () =>
      new Map(
        [...this.armorCandidates(), ...this.structureCandidates()].map((material) => [
          material.id,
          constructionMaterialMessages(this.entity(), material).map((issue) => issue.message),
        ]),
      ),
  );
  armorOptions(location?: string): readonly ArmorEquipment[] {
    const selected = location ? this.entity().armorByLocation().get(location) : this.entity().uniformArmor();
    return this.armorCandidates().filter(
      (material) =>
        this.showIncompatibleEquipment() ||
        !this.materialInvalid(material, location) ||
        material.id === selected?.armor.id,
    );
  }
  structureOptions(location?: string): readonly StructureEquipment[] {
    const selected = location
      ? this.entity().structureByLocation().get(location)
      : this.entity().uniformStructureMaterial();
    return this.structureCandidates().filter(
      (material) =>
        this.showIncompatibleEquipment() || !this.materialInvalid(material) || material.id === selected?.structure.id,
    );
  }
  materialInvalid(material: Equipment | undefined, location?: string): boolean {
    const entity = this.entity();
    if (material instanceof ArmorEquipment && entity.isSupportVehicle()) {
      return !!constructionMaterialMessages(entity, material, constructionArmorTechRating(entity, location)).length;
    }
    return !!material && !!this.materialErrors().get(material.id)?.length;
  }
  readonly supportsPatchwork = computed(() => constructionSupportsPatchwork(this.entity()));
  readonly hybridStructure = computed(() => {
    const entity = this.entity();
    return entity instanceof MekEntity && entity.hasHybridStructure();
  });
  readonly mass = computed(() => getConstructionMass(this.entity()));
  readonly massCapacity = computed(() => getConstructionMassCapacity(this.entity()));
  readonly massRatio = computed(() => Math.min(100, ((this.mass() ?? 0) / (this.massCapacity() || 1)) * 100));
  readonly designSummary = computed(() => {
    const entity = this.entity();
    const summary = this.summaryBuilder.build(entity, {
      entryKey: {
        origin: 'user',
        design: { provider: CUSTOM_UNIT_PROVIDER_ID, uuid: entity.uuid() },
        sourceRevision: '',
      },
      format: nativeEntityFormat(entity),
    });
    return { ...summary, mul1id: -1, isCustom: true, canon: false };
  });
  /** The source codec captures every native field, including edits with unchanged summary totals. */
  readonly previewEntity = computed(() => {
    if (this.panel() !== 'preview') return null;
    const entity = this.entity();
    const source = encodeNativeEntity(entity);
    const uuid = entity.uuid();
    // Parsing initializes new signals; only the source design belongs to this computation.
    return untracked(() => {
      const snapshot = this.customUnits.parseDraft(source, nativeEntityFormat(entity));
      snapshot.uuid.set(uuid);
      return snapshot;
    });
  });
  readonly summaryStats = computed(() => {
    this.data.searchCorpusVersion();
    const source = this.sourceDamage(),
      preview = this.runtimeDamage();
    const locations = source ? this.entity().damageLocations() : [];
    return this.statBarSpecs
      .transform(this.designSummary())
      .filter((spec) =>
        ['Armor', 'Structure', 'Squad size', 'Top Speed', 'Jump', 'VTOL', 'Heat', 'Dissipation'].includes(spec.label),
      )
      .map((spec) => {
        const unchanged = { ...spec, pendingRepair: 0, repairStart: 0, repairPercent: 0 };
        if (!source || !preview || !['Armor', 'Structure'].includes(spec.label) || spec.value <= 0) return unchanged;
        let beforeDamage = 0,
          afterDamage = 0;
        for (const location of locations) {
          if (spec.label === 'Armor') {
            for (const face of ['front', 'rear'] as const) {
              beforeDamage += Math.min(location.armor[face], source.armorDamage(location.code, face));
              afterDamage += Math.min(location.armor[face], preview.armorDamage(location.code, face));
            }
          } else {
            beforeDamage += Math.min(location.internalPoints, source.internalDamage(location.code));
            afterDamage += Math.min(location.internalPoints, preview.internalDamage(location.code));
          }
        }
        if (!beforeDamage && !afterDamage) return unchanged;
        const remaining = Math.max(0, spec.value - afterDamage);
        const pendingRepair = Math.max(0, beforeDamage - afterDamage);
        const scale = spec.percent / spec.value;
        return {
          ...spec,
          value: remaining,
          valueText: `${remaining} / ${spec.value}`,
          percent: remaining * scale,
          pendingRepair,
          repairStart: (remaining - pendingRepair) * scale,
          repairPercent: pendingRepair * scale,
        };
      });
  });
  readonly validation = computed(() => validateConstruction(this.entity(), this.optionsService.options().CBTOptionalRules?.quirks !== false));
  readonly errors = computed(() => this.validation().messages.filter((message) => message.severity === 'error'));
  readonly warnings = computed(() => this.validation().messages.filter((message) => message.severity === 'warning'));
  readonly notices = computed(() => this.validation().messages.filter((message) => message.severity === 'info'));
  readonly validationSeverity = computed(() => this.errors().length ? 'error' : this.warnings().length ? 'warning' : this.notices().length ? 'info' : 'clear');
  readonly validationLabel = computed(() => {
    const [count, label] = this.errors().length ? [this.errors().length, 'issue'] as const
      : this.warnings().length ? [this.warnings().length, 'warning'] as const : [this.notices().length, 'notice'] as const;
    return count ? `${count} ${label}${count === 1 ? '' : 's'}` : 'Checks passed';
  });
  private readonly mountIssueMessages = computed(() => {
    const messages = new Map<string, string[]>();
    for (const message of this.validation().messages) {
      if (!message.mountId || message.severity === 'info') continue;
      const issues = messages.get(message.mountId) ?? [];
      issues.push(message.message);
      messages.set(message.mountId, issues);
    }
    return messages;
  });
  readonly showTechBases = computed(
    () =>
      this.entity().mixedTech() ||
      this.showIncompatibleEquipment() ||
      this.validation().messages.some((message) =>
        ['TECH_BASE_MISMATCH', 'MEK_SYSTEM_TECH_BASE', 'SYSTEM_TECH_BASE', 'MATERIAL_TECH_BASE'].includes(message.code),
      ),
  );
  techBaseMismatch(base: Equipment['techBase']): boolean {
    return !this.entity().mixedTech() && base !== 'All' && base !== this.entity().techBase();
  }
  equipmentTechMismatch(equipment: Equipment | null | undefined): boolean {
    return (
      !!equipment &&
      this.entity().mountedEquipmentContributesStaticTech(equipment) &&
      this.techBaseMismatch(equipment.techBase)
    );
  }
  techBaseMismatchReason(base: Equipment['techBase']): string {
    return `${base === 'Clan' ? 'Clan' : 'Inner Sphere'} technology requires mixed technology on this ${this.entity().techBase() === 'Clan' ? 'Clan' : 'Inner Sphere'} chassis.`;
  }
  readonly filteredEquipment = computed(() => {
    const query = this.query().trim().toLowerCase();
    const category = this.category();
    const entity = this.entity();
    const location = this.selectedLocation();
    const filterByLocation = this.filterByLocation();
    const showIncompatible = this.showIncompatibleEquipment();
    const filtered = this.equipment.filter(
      (eq) =>
        (category === 'all' || this.equipmentCategory(eq) === category) &&
        (!query || `${eq.name} ${eq.id} ${eq.aliases.join(' ')}`.toLowerCase().includes(query)) &&
        (showIncompatible || constructionEquipmentEligibilityIssues(entity, eq).length === 0) &&
        (!filterByLocation || equipmentLocationIssues(entity, eq, location).length === 0),
    );
    const { column, direction } = this.equipmentSort();
    const order = direction === 'asc' ? 1 : -1;
    if (column === 'name') return filtered.sort((a, b) => order * a.sortingName.localeCompare(b.sortingName));
    // Resolve each value once, including catalog-backed weapon damage, before comparing rows.
    return filtered
      .map((equipment) => ({ equipment, value: this.equipmentSortValue(equipment, column) }))
      .sort((a, b) => {
        if (a.value === null && b.value !== null) return 1;
        if (a.value !== null && b.value === null) return -1;
        return (
          order * ((a.value ?? 0) - (b.value ?? 0)) || a.equipment.sortingName.localeCompare(b.equipment.sortingName)
        );
      })
      .map((row) => row.equipment);
  });
  readonly selectedMount = computed(
    () =>
      this.entity()
        .equipment()
        .find((mount) => mount.mountId === this.selectedMountId()) ?? null,
  );
  private readonly spreadAllocations = computed(
    () =>
      new Map(
        this.entity()
          .equipment()
          .filter((mount) => mount.equipment?.isSpreadable)
          .map((mount) => [mount.mountId, constructionSpreadAllocation(this.entity(), mount)]),
      ),
  );
  spreadAllocation(mount: EntityMountedEquipment) {
    return this.spreadAllocations().get(mount.mountId) ?? null;
  }
  readonly selectedSpread = computed(() => {
    const mount = this.selectedMount();
    return mount ? this.spreadAllocation(mount) : null;
  });
  readonly spreadAutoIssue = computed(() => {
    const entity = this.entity(),
      mount = this.selectedMount();
    if (!(entity instanceof MekEntity) || !mount || !this.selectedSpread()?.remaining) return '';
    try {
      constructionSpreadAutoPlacements(entity, mount);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  readonly inspectorEquipment = computed(() =>
    this.selectedSystem() ? null : (this.selectedMount()?.equipment ?? this.selectedEquipment()),
  );
  readonly inspectorTypeLabel = computed(() => {
    const eq = this.inspectorEquipment();
    return eq ? equipmentTypeLabel(this.equipmentClass(eq), eq) : 'Structural';
  });
  readonly inspectorToHitModifier = computed(() =>
    equipmentToHitModifier(
      this.inspectorEquipment(),
      this.optionsService.options().CBTRules === 'total-warfare' ? TW_GAME_RULES : CORE_2026_GAME_RULES,
    ),
  );
  readonly inspectorHeat = computed(() => equipmentHeat(this.inspectorEquipment()));
  readonly inspectorTechnology = computed(() => {
    const eq = this.inspectorEquipment(),
      entity = this.entity();
    return eq ? equipmentTechnologyGroups(eq, entity.techBase(), entity.mixedTech()) : [];
  });
  readonly selectedMountLocations = computed(() => {
    const mount = this.selectedMount();
    return mount ? [...new Set([mount.location, ...mount.getOccupiedLocations()])] : [];
  });
  readonly selectedIssues = computed(() => {
    const eq = this.selectedEquipment();
    return eq ? equipmentPlacementIssues(this.entity(), eq, this.selectedLocation()) : [];
  });
  readonly unallocated = computed(() => {
    const locations = this.locations();
    const hasEngine = locations.some((location) => location.rows.some((row) => row.system === 'Engine'));
    return this.entity()
      .equipment()
      .filter((mount) => {
        if (mount.allocation.kind === 'engine') return !hasEngine;
        if (this.spreadAllocation(mount)?.remaining) return true;
        return this.isMountUnallocated(mount);
      });
  });
  readonly unallocatedOpen = linkedSignal<boolean, boolean>({
    source: () => this.unallocated().length > 0,
    computation: (hasEquipment, previous) =>
      hasEquipment && !previous?.source ? true : (previous?.value ?? false),
  });
  readonly removableUnallocated = computed(() =>
    this.unallocated().filter((mount) => this.isMountUnallocated(mount) && this.canRemoveMount(mount)),
  );
  equipmentWarning(mount: EntityMountedEquipment, location = mount.location): string {
    const caseWarning = mount.allocation.kind === 'location' && caseEquipmentKind(mount.equipment)
      ? this.locationCase().get(location)?.warning
      : undefined;
    return [...new Set([
      ...(this.mountIssueMessages().get(mount.mountId) ?? []),
      ...(caseWarning ? [caseWarning] : []),
    ])].join('\n');
  }
  readonly selectedMountInstallIssues = computed(() => {
    const mount = this.selectedMount();
    if (this.selectedSpread()) return this.spreadAutoIssue() ? [this.spreadAutoIssue()] : [];
    return mount?.equipment && this.isMountUnallocated(mount)
      ? equipmentPlacementIssues(this.entity(), mount.equipment, this.selectedLocation(), mount)
      : [];
  });
  readonly acceptUnallocatedDrop = (drag: CdkDrag<DragEquipment>) => {
    if (!drag.data?.mountId) {
      const equipment = this.registry.findEquipment(drag.data?.equipmentId);
      return !!equipment && this.canInstall(equipment)
        && constructionEquipmentEligibilityIssues(this.entity(), equipment).length === 0;
    }
    const mount = this.entity()
      .equipment()
      .find((item) => item.mountId === drag.data?.mountId);
    return !!mount && this.canUninstallMount(mount) && (!this.spreadAllocation(mount) || !!drag.data.sourceLocation);
  };

  constructor() {
    // Clear the previous choice before click handlers can select or install equipment.
    document.addEventListener('click', this.cancelPlacementOnOutsideClick, true);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('click', this.cancelPlacementOnOutsideClick, true);
      this.inspector.close();
      this.endDrag();
    });
    effect(() => {
      if (this.panel() === 'quirks' && !this.showQuirks()) this.panel.set('loadout');
    });
    effect((onCleanup) => {
      const blob = this.artworkDraft()?.fluff;
      const url = blob ? URL.createObjectURL(blob) : null;
      this.artworkDraftUrl.set(url);
      if (url) onCleanup(() => URL.revokeObjectURL(url));
    });
    afterRenderEffect((onCleanup) => {
      const footer = this.constructionFooter()?.nativeElement,
        shell = this.constructionShell()?.nativeElement;
      if (!footer || !shell) return;
      // On phones, both the footer and unallocated tray stick inside the scrolling shell.
      const update = () => shell.style.setProperty('--construction-footer-height', `${footer.offsetHeight}px`);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(footer);
      onCleanup(() => observer.disconnect());
    });
    afterRenderEffect((onCleanup) => {
      const panels = this.systemPanels();
      if (!panels.length) return;
      // Set initial placement before paint, reading every panel before changing the grid.
      const initialSpans = panels.map(({ nativeElement: panel }) => ({
        panel,
        span: Math.ceil(panel.getBoundingClientRect().height + parseFloat(getComputedStyle(panel).marginBottom)),
      }));
      for (const { panel, span } of initialSpans) panel.style.gridRowEnd = `span ${span}`;
      const pendingSpans = new Map<HTMLElement, string>();
      let frame: number | null = null;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const panel = entry.target as HTMLElement;
          const gap = parseFloat(getComputedStyle(panel).marginBottom);
          // Each implicit grid row is one pixel; include the spacing below the panel.
          const span = `span ${Math.ceil(entry.borderBoxSize[0].blockSize + gap)}`;
          if (panel.style.gridRowEnd !== span) pendingSpans.set(panel, span);
          else pendingSpans.delete(panel);
        }
        // Changing grid placement during observer delivery can resize these same panels.
        if (frame !== null || !pendingSpans.size) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          for (const [panel, span] of pendingSpans) {
            if (panel.style.gridRowEnd !== span) panel.style.gridRowEnd = span;
          }
          pendingSpans.clear();
        });
      });
      for (const panel of panels) observer.observe(panel.nativeElement, { box: 'border-box' });
      onCleanup(() => {
        observer.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
      });
    });
    effect((onCleanup) => {
      const viewport = this.equipmentViewport();
      if (!viewport) return;
      // Sidebar layout changes can resize the viewport without resizing the window.
      const observer = new ResizeObserver(() => viewport.checkViewportSize());
      observer.observe(viewport.elementRef.nativeElement);
      onCleanup(() => observer.disconnect());
    });
    afterRenderEffect(() => {
      this.filteredEquipment();
      const viewport = this.equipmentViewport();
      untracked(() => viewport?.scrollToIndex(0));
    });
  }

  sortEquipment(column: EquipmentSortColumn): void {
    this.equipmentSort.update((sort) => ({
      column,
      direction: sort.column === column && sort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  private equipmentSortValue(eq: Equipment, column: Exclude<EquipmentSortColumn, 'name'>): number | null {
    switch (column) {
      case 'slots':
        return eq.getNumCriticalSlots(this.entity()) ?? null;
      case 'tons': {
        const mass = this.equipmentMass(eq);
        return typeof mass === 'number' ? mass : null;
      }
      case 'bv':
        return eq.hasFixedBV() ? eq.bv : null;
      case 'damage':
        return eq instanceof WeaponEquipment
          ? Math.max(0, ...resolveWeaponDamage(eq, this.registry).values) || null
          : null;
      case 'range':
        return eq instanceof WeaponEquipment
          ? eq.ranges[this.optionsService.options().CBTOptionalRules.extremeRange ? 3 : 2] || null
          : null;
    }
  }

  equipmentCategory(eq: Equipment): WarehouseCategory {
    if (eq instanceof AmmoEquipment) return 'ammo';
    if (eq.hasAnyFlag(['F_CLUB', 'F_HAND_WEAPON', 'F_SHIELD'])) return 'physical';
    if (eq instanceof WeaponEquipment) {
      if (eq.hasFlag('F_ARTILLERY')) return 'artillery';
      if (eq.hasFlag('F_MISSILE')) return 'missile';
      if (eq.hasFlag('F_BALLISTIC')) return 'ballistic';
      if (eq.hasFlag('F_ENERGY')) return 'energy';
    }
    return 'misc';
  }

  equipmentClass(eq?: Equipment): string {
    return eq instanceof AmmoEquipment ? getWeaponTypeCSSClass('X', eq) : eq ? this.equipmentCategory(eq) : 'misc';
  }
  equipmentSlots(eq: Equipment): string | number {
    return eq.getNumCriticalSlots(this.entity()) ?? '—';
  }
  equipmentMass(eq: Equipment): string | number {
    const entity = this.entity();
    const mass = constructionEquipmentCandidate(entity, eq, this.selectedLocation()).getTonnage(entity);
    return mass === undefined ? 'Var.' : eq.hasFixedTonnage() ? mass : Number(mass.toFixed(3));
  }
  equipmentDamage(eq: Equipment): string {
    return eq instanceof WeaponEquipment ? formatWeaponDamage(resolveWeaponDamage(eq, this.registry)) || '—' : '—';
  }
  equipmentRange(eq: Equipment): string {
    if (!(eq instanceof WeaponEquipment)) return '—';
    const ranges = eq.ranges.slice(0, this.optionsService.options().CBTOptionalRules.extremeRange ? 4 : 3).join('/');
    return `${eq.minimumRange > 0 ? `(${eq.minimumRange}) ` : ''}${ranges}`;
  }
  mountedMass(mount: EntityMountedEquipment): string {
    if (isArmorConstructionEquipment(mount.equipment)) return '';
    try {
      const mass = mount.getTonnage(this.entity());
      return mass !== undefined && Number.isFinite(mass) ? `${Number(mass.toFixed(3))} t` : 'Variable mass';
    } catch {
      return 'Variable mass';
    }
  }
  equipmentLabel(eq: Equipment): string {
    return formatEquipmentName(eq, this.ammo(eq)?.shots);
  }
  mountedDisplay(mount: EntityMountedEquipment): { name: string; custom: boolean } {
    const source = this.repairSnapshot(),
      origin = this.mountOrigins().get(mount.mountId);
    if (source && origin && mount.equipment instanceof AmmoEquipment) {
      const componentId = asComponentId(origin);
      const ammo = source.query.ammoEquipment(componentId);
      if (ammo) return ammoLoadoutDisplay(mount.equipment.internalName, ammo, source.query.remainingAmmo(componentId));
    }
    return { name: mount.displayName(true), custom: false };
  }
  equipmentRefs(eq: Equipment): string {
    return formatEquipmentRulesRefs(eq.rulesRefs);
  }
  materialLabel(eq: Equipment, location?: string): string {
    return `${eq.name}${eq.techBase === 'All' ? '' : eq.techBase === 'Clan' ? ' · Clan' : ' · IS'}${this.materialInvalid(eq, location) ? ' (incompatible)' : ''}`;
  }
  weapon(eq: Equipment): WeaponEquipment | null {
    return eq instanceof WeaponEquipment ? eq : null;
  }
  ammo(eq: Equipment): AmmoEquipment | null {
    return eq instanceof AmmoEquipment ? eq : null;
  }
  locationLabel(id: string): string {
    return this.locations().find((location) => location.id === id)?.label ?? id;
  }
  structureAt(id: string): string {
    return this.entity().structureByLocation().get(id)?.structure.id ?? '';
  }
  armorAt(id: string): string {
    return this.entity().armorByLocation().get(id)?.armor.id ?? '';
  }
  donorTonnage(id: string): number {
    return this.entity().structureByLocation().get(id)?.tonnage ?? this.entity().tonnage();
  }
  donorAt(id: string): MekStructureDonor | null {
    const entity = this.entity();
    return entity instanceof MekEntity && isMekLocation(id) ? entity.structureDonorAt(id) : null;
  }
  armorDamage(id: string, face: 'front' | 'rear' = 'front'): number {
    return this.runtimeDamage()?.armorDamage(id, face) ?? 0;
  }
  armorRepair(id: string, face: 'front' | 'rear' = 'front'): number {
    return Math.max(0, (this.sourceDamage()?.armorDamage(id, face) ?? 0) - this.armorDamage(id, face));
  }
  internalRepair(id: string, maximum: number): number {
    return Math.max(
      0,
      this.internalRemaining(id, maximum) - Math.max(0, maximum - (this.sourceDamage()?.internalDamage(id) ?? 0)),
    );
  }
  defensePercent(value: number, maximum: number): number {
    return maximum > 0 ? Math.max(0, Math.min(100, (value / maximum) * 100)) : 0;
  }
  internalRemaining(id: string, maximum: number): number {
    return Math.max(0, maximum - (this.runtimeDamage()?.internalDamage(id) ?? 0));
  }
  mountCondition(id: string): string {
    const damage = this.runtimeDamage();
    if (!damage) return '';
    const status = damage.mountStatus(id);
    return status === 'destroyed'
      ? 'Destroyed'
      : status === 'disabled'
        ? 'Disabled'
        : damage.mountHits(id) > 0 || damage.mountHasCombatDamage(id)
          ? 'Damaged'
          : '';
  }

  private slotRows(slots: ConstructionLocation['slots']): SlotRow[] {
    const result: SlotRow[] = [];
    for (const slot of slots) {
      const last = result[result.length - 1];
      const sameComponent =
        last &&
        (slot.componentId
          ? slot.componentId === last.componentId
          : slot.mount && slot.mount.mountId === last.mount?.mountId);
      if (sameComponent && slot.index === last.index + last.span) last.span++;
      else result.push({ ...slot, span: 1 });
    }
    return result;
  }

  change(action: () => void, podChange = false): void {
    if (
      this.busy() ||
      this.foreignDesign() ||
      this.forceMember()?.force.readOnly() ||
      (!this.designEditing() && !podChange)
    )
      return;
    const entity = this.entity();
    let previous: ConstructionHistoryEntry | undefined;
    try {
      previous = this.captureHistory();
      const omniBase = this.designEditing() ? null : constructionOmniBaseSource(entity);
      const weaponQuirks = captureConstructionWeaponQuirks(entity);
      const systemSlots = constructionSystemSlotKeys(entity);
      action();
      reconcileConstructionSystemSlots(entity, systemSlots);
      ensureConstructionMaterialEquipment(entity);
      reconcileConstructionEquipmentRelationships(entity);
      reconcileConstructionWeaponQuirks(entity, weaponQuirks);
      const unallocated = entity.equipment().filter((mount) => mount.allocation.kind === 'unallocated');
      if (
        encodeNativeEntity(entity) === previous.source &&
        unallocated.length === previous.unallocated.length &&
        unallocated.every((mount, index) => mount === previous!.unallocated[index])
      )
        return;
      if (omniBase !== null && omniBase !== constructionOmniBaseSource(entity)) {
        throw new Error(
          'Reconfiguration cannot change the fixed Omni chassis or equipment. Enable Edit design to customize it.',
        );
      }
      if (omniBase !== null) {
        const issues = constructionReconfigurationIssues(entity);
        if (issues.length) throw new Error(issues.join(' '));
      }
      const survivingIds = new Set(entity.equipment().map((mount) => mount.mountId));
      this.mountOrigins.update((origins) => new Map([...origins].filter(([id]) => survivingIds.has(id))));
      this.recordChange(previous);
      this.status.set('');
    } catch (error) {
      if (previous !== undefined) {
        const restored = this.parseHistoryEntity(previous.source, previous.unallocated);
        restored.uuid.set(entity.uuid());
        this.entity.set(restored);
        this.mountOrigins.set(previous.origins);
        this.selectedMountId.set(null);
      }
      this.reportError(error);
    }
  }

  setField(field: ConstructionField, value: string | number | boolean | null, control?: NgModel): void {
    if (
      field.id !== 'mulId' &&
      field.id !== 'manualBV' &&
      field.kind === 'number' &&
      (value == null || value === '' || !Number.isFinite(Number(value)))
    )
      return;
    if (field.id === 'year' && this.oemYearVisible()) this.oemYearExpanded.set(true);
    this.change(() => field.set(field.kind === 'number' ? Number(value) : value), this.canEditField(field));
    if (field.id === 'manualBV' && field.get() === null) {
      control?.control.setValue(null, { emitEvent: false, emitViewToModelChange: false });
    }
  }
  setOemYear(value: number | null): void {
    this.oemYearExpanded.set(true);
    this.change(() => this.oemYearField().set(value ?? ''));
  }

  async selectIcon(event: Event): Promise<void> {
    if (!this.designEditing() || this.busy()) return;
    const trigger = event.currentTarget as HTMLButtonElement;
    const entity = this.entity();
    const { UnitIconPickerDialogComponent } =
      await import('../components/unit-icon-picker-dialog/unit-icon-picker-dialog.component');
    if (this.destroyRef.destroyed || this.entity() !== entity) return;
    const result = await firstValueFrom(this.dialogs.createDialog<string | null>(UnitIconPickerDialogComponent, {
      data: { unit: entity }, autoFocus: 'input[type="search"]',
    }).closed);
    if (this.destroyRef.destroyed) return;
    if (result !== undefined && this.entity() === entity) this.change(() => entity.iconPath.set(result ?? ''));
    trigger.focus();
  }
  async unlinkRefitSource(): Promise<void> {
    const entity = this.entity();
    const reference = this.refitReference();
    if (!reference || this.busy() || !this.designEditing()) return;
    const confirmed = await this.dialogs.requestConfirmation(
      `Unlink ${reference.name} from this design? The source reference will be removed when you save. There is no option to link it again.`,
      'Unlink source unit',
      'danger',
    );
    if (
      !confirmed ||
      this.busy() ||
      !this.designEditing() ||
      this.entity() !== entity ||
      entity.refitFromUUID() !== reference.uuid
    )
      return;
    this.change(() => entity.refitFromUUID.set(undefined));
    this.coreSourceUuid.set(undefined);
  }
  setSources(field: 'source' | 'published', value: SourcebookReference[]): void {
    this.change(() => this.entity()[field].set(value));
  }
  setArmor(id: string, face: 'front' | 'rear', value: number | null): void {
    if (value === null || !Number.isFinite(value)) return;
    const entity = this.entity();
    this.change(() =>
      setConstructionArmor(
        entity,
        id,
        face === 'front' ? value : entity.getArmorValue(id),
        face === 'rear' ? value : entity.getArmorValue(id, 'rear'),
      ),
    );
  }
  setArmorMaterial(id: string, location?: string): void {
    if (id === 'patchwork' && !location) {
      this.change(() => setConstructionPatchwork(this.entity(), true));
      return;
    }
    const armor = this.armorOptions(location).find((eq) => eq.id === id);
    if (armor) this.change(() => setConstructionArmorMaterial(this.entity(), armor, location));
  }
  setClanCaseOptOut(location: string, optedOut: boolean): void {
    const entity = this.entity();
    if (!entity.supportsAutomaticClanCaseAt(location) && !entity.clanCaseOptOutLocations().has(location)) return;
    this.change(() =>
      entity.setLocationMetadata(location, {
        ...entity.locationMetadata().get(location),
        clanCaseOptOut: optedOut || undefined,
      }),
    );
  }
  setLocationCase(location: string, value: string): void {
    const entity = this.entity();
    const state = this.locationCase().get(location);
    const option = state?.options.find((option) => option.value === value);
    if (!(entity instanceof MekEntity) || !state || !option || option.disabled || state.selection === value) return;
    this.change(() => {
      for (const { mount, placements } of option.relocations ?? []) {
        applyConstructionSpreadPlacements(entity, mount, placements);
      }
      for (const mount of entity.getEquipmentAtLocation(location)) {
        if (caseEquipmentKind(mount.equipment)) removeConstructionEquipment(entity, mount);
      }
      entity.setLocationMetadata(location, {
        ...entity.locationMetadata().get(location),
        clanCaseOptOut: (state.supportsAutomatic && value === 'none') || undefined,
      });
      if (option.equipment) installConstructionEquipment(entity, option.equipment, location);
    });
  }
  setStructure(id: string, location?: string, tonnage?: number): void {
    if (id === 'hybrid' && !location) {
      this.change(() => setConstructionHybridStructure(this.entity(), true));
      return;
    }
    const structure = this.structureOptions(location).find((eq) => eq.id === id);
    if (structure) this.change(() => setConstructionStructure(this.entity(), structure, location, tonnage));
  }
  setDonor(id: string, field: 'name' | 'unitType', value: string): void {
    const entity = this.entity();
    if (!(entity instanceof MekEntity) || !isMekLocation(id)) return;
    this.change(() => {
      const donor = { name: '', unitType: null, ...entity.structureDonorAt(id), [field]: value.trim() };
      entity.setStructureDonor(id, donor.name || donor.unitType ? donor : null);
    });
  }
  closeEquipmentDrawer(): void {
    this.equipmentDrawerOpen.set(false);
    // A removed mount cannot receive CDK's restored focus; use the stable drawer trigger.
    afterNextRender(() => this.equipmentToggle()?.nativeElement.focus(), { injector: this.injector });
  }
  stripArmor(): void {
    this.change(() => this.entity().armorLocations.forEach((id) => setConstructionArmor(this.entity(), id, 0, 0)));
  }
  maxArmor(): void {
    this.change(() => maximizeConstructionArmor(this.entity()));
  }
  stripEquipment(): void {
    this.change(() =>
      this.entity()
        .equipment()
        .filter((mount) => mount.allocation.kind !== 'engine')
        .forEach((mount) => {
          if (this.requiredMount(mount)) uninstallConstructionEquipment(this.entity(), mount);
          else removeConstructionEquipment(this.entity(), mount);
        }),
    );
  }
  selectEquipment(eq: Equipment, anchor?: HTMLElement): void {
    this.inspectEquipment(eq, anchor);
    this.placementSelection.set(this.canInstall(eq) ? { kind: 'equipment', equipment: eq } : null);
  }
  inspectEquipment(eq: Equipment, anchor?: HTMLElement, byHover = false): void {
    if (anchor && !this.inspector.open(anchor, byHover)) return;
    this.selectedEquipment.set(eq);
    this.selectedMountId.set(null);
    this.selectedSystem.set(null);
    if (!anchor) this.inspector.close();
    if (anchor) this.positionInstalledInspector(anchor);
  }
  selectMount(mount: EntityMountedEquipment, anchor?: HTMLElement, location?: string): void {
    this.inspectMount(mount, anchor, location);
    this.placementSelection.set(this.canPlaceMount(mount) ? { kind: 'mount', mountId: mount.mountId } : null);
  }
  private finishEquipmentEdit(mount: EntityMountedEquipment): void {
    this.placementSelection.set(null);
    this.inspectMount(mount);
  }
  inspectMount(mount: EntityMountedEquipment, anchor?: HTMLElement, location?: string, byHover = false): void {
    if (anchor && !this.inspector.open(anchor, byHover)) return;
    const locations = mount.getOccupiedLocations();
    const currentLocation = this.selectedMountLocation();
    const keepLocation = !anchor && this.selectedMountId() === mount.mountId && locations.includes(currentLocation);
    this.selectedMountLocation.set(location ?? (keepLocation ? currentLocation : mount.location));
    this.selectedMountId.set(mount.mountId);
    this.selectedSystem.set(null);
    this.splitLocation.set(locations[0] ?? mount.location);
    this.splitSecondLocation.set(locations[1] ?? this.splitSecondChoices()[0]?.id ?? '');
    this.splitCount.set(
      mount.placements?.filter((p) => p.location === locations[0]).length === mount.placements?.length
        ? Math.max(1, (mount.placements?.length ?? 2) - 1)
        : (mount.placements?.filter((p) => p.location === locations[0]).length ?? 1),
    );
    if (anchor) this.positionInstalledInspector(anchor);
  }
  private positionInstalledInspector(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const width = 340;
    const height = this.selectedSpread() ? 800 : 480;
    const x = rect.right + width + 20 <= window.innerWidth ? rect.right + 8 : rect.left - width - 8;
    this.inspectorPosition.set({
      x: Math.max(12, Math.min(window.innerWidth - width - 12, x)),
      y: Math.max(12, Math.min(window.innerHeight - height, rect.top)),
    });
    this.equipmentDrawerOpen.set(false);
  }
  closeInstalledInspector(): void {
    const restoreFocus = this.inspector.isPinned();
    const anchor = this.inspector.trigger;
    this.inspector.close();
    if (!restoreFocus) return;
    afterNextRender(
      () => {
        if (anchor?.isConnected) anchor.focus();
        else this.equipmentToggle()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
  inspectSystem(location: string, row: SlotRow, anchor: HTMLElement, byHover = false): void {
    if (!row.system || !row.componentId) return;
    if (!this.inspector.open(anchor, byHover)) return;
    if (!byHover) this.placementSelection.set(null);
    this.selectedMountId.set(null);
    this.selectedSystem.set({ location, system: row.system, componentId: row.componentId });
    this.positionInstalledInspector(anchor);
  }
  systemLabel(system: MekSystemType): string {
    const entity = this.entity();
    return entity instanceof MekEntity ? mekSystemLabel(system, entity) : system;
  }
  systemTechBase(system: MekSystemType): Equipment['techBase'] {
    const entity = this.entity();
    if (!(entity instanceof MekEntity)) return 'All';
    switch (system) {
      case 'Engine': {
        const engine = entity.mountedEngine();
        return constructionEngineTechnology(entity, engine.type(), engine.techBase).techBase;
      }
      case 'Gyro':
        return entity.mountedGyro().tech.techBase;
      case 'Cockpit':
      case 'Sensors':
      case 'Life Support':
        return entity.mountedCockpit().tech.techBase;
      default:
        return 'All';
    }
  }
  systemDescription(system: MekSystemType): string {
    switch (system) {
      case 'Engine':
        return 'Provides propulsion and integral heat-sink capacity. Engine type determines its fixed critical-slot layout.';
      case 'Gyro':
        return 'Stabilizes the Mek. Gyro type determines its fixed slots around the center-torso engine sections.';
      case 'Cockpit':
        return 'Houses the crew and controls. Cockpit type determines the placement of cockpit, sensor and life-support slots.';
      case 'Sensors':
        return 'Provides targeting and sensor functions. Its fixed slots follow the cockpit configuration.';
      case 'Life Support':
        return 'Protects the crew. Its fixed slots follow the cockpit configuration.';
      case 'Lower Arm Actuator':
        return 'Controls lower-arm articulation. Uninstalling disables this actuator and frees its critical slot.';
      case 'Hand Actuator':
        return 'Provides hand articulation. Uninstalling disables this actuator and frees its critical slot.';
      default:
        return 'A fixed chassis system. Its location is determined by the chassis configuration.';
    }
  }
  readonly systemFields = computed(() => {
    const selected = this.selectedSystem();
    if (!selected) return [];
    const ids =
      selected.system === 'Engine'
        ? ['engineType', 'engineRating', 'engineTechBase', 'heatSinkType', 'heatSinkCount']
        : selected.system === 'Gyro'
          ? ['gyro']
          : selected.system === 'Cockpit'
            ? ['cockpit', 'fullHeadEjection']
            : [];
    return this.fields().filter((field) => ids.includes(field.id));
  });
  readonly selectedSystemSlots = computed(() => {
    const selected = this.selectedSystem();
    return selected
      ? this.locations().flatMap((location) =>
          location.slots
            .filter((slot) => slot.componentId === selected.componentId)
            .map((slot) => ({
              location: location.id,
              index: slot.index,
              armored: this.systemArmored(location.id, slot.index),
            })),
        )
      : [];
  });
  componentArmorIssue(component: EntityMountedEquipment | MekSystemType): string | null {
    return constructionComponentArmorIssue(this.entity(), component)?.message ?? null;
  }
  systemArmored(location: string, index: number): boolean {
    const entity = this.entity();
    return entity instanceof MekEntity && entity.armoredSystemSlots().has(`${location}:${index}`);
  }
  armoredSystemCount(location: string, row: SlotRow): number {
    return Array.from({ length: row.span }, (_, index) => this.systemArmored(location, row.index + index)).filter(
      Boolean,
    ).length;
  }
  setSystemArmored(location: string, index: number, armored: boolean): void {
    const entity = this.entity();
    if (!(entity instanceof MekEntity) || !isMekLocation(location)) return;
    const slot = entity.criticalSlotGrid().get(location)?.[index];
    if (armored && (slot?.type !== 'system' || this.componentArmorIssue(slot.systemType))) return;
    this.change(() =>
      entity.armoredSystemSlots.update((previous) => {
        const next = new Set(previous);
        if (armored) next.add(`${location}:${index}`);
        else next.delete(`${location}:${index}`);
        return next;
      }),
    );
  }
  private actuatorFieldId(location: string, system: string): string {
    const side = location === 'LA' ? 'left' : location === 'RA' ? 'right' : '';
    return side ? side + (system === 'Lower Arm Actuator' ? 'LowerArm' : system === 'Hand Actuator' ? 'Hand' : '') : '';
  }
  removableSystem(location: string, system: string): boolean {
    const id = this.actuatorFieldId(location, system);
    return this.fields().some((field) => field.id === id && this.canEditField(field));
  }
  removeSystem(location: string, system: string, event?: Event): void {
    event?.stopPropagation();
    const field = this.fields().find((field) => field.id === this.actuatorFieldId(location, system));
    if (!field || !this.canEditField(field)) return;
    this.change(() => {
      field.set(false);
      const entity = this.entity();
      if (entity instanceof MekEntity) {
        entity.armoredSystemSlots.update(
          (slots) =>
            new Set(
              [...slots].filter((key) => {
                const [loc, index] = key.split(':');
                return entity.getSystemSlotsForLocation(loc)[Number(index)]?.type === 'system';
              }),
            ),
        );
        entity.arrangeEquipment(location);
      }
    }, this.canEditField(field));
    this.inspector.close();
  }
  applySplit(): void {
    const mount = this.selectedMount();
    if (mount)
      this.change(
        () =>
          this.finishEquipmentEdit(
            splitConstructionEquipment(
              this.entity(),
              mount,
              this.splitLocation(),
              this.splitCount(),
              this.splitSecondLocation(),
            ),
          ),
        this.canEditMount(mount),
      );
  }
  setSplitLocation(location: string): void {
    this.splitLocation.set(location);
    this.splitSecondLocation.set(this.splitSecondChoices().at(0)?.id ?? '');
  }
  locationMounts(location: string): string[] {
    return [
      ...new Set(
        this.locations()
          .find((item) => item.id === location)
          ?.slots.flatMap((slot) => (slot.mount ? [slot.mount.mountId] : [])) ?? [],
      ),
    ];
  }
  reorderMount(mount: EntityMountedEquipment, location: string, direction: -1 | 1): void {
    const order = this.locationMounts(location);
    const index = order.indexOf(mount.mountId);
    if (index < 0 || index + direction < 0 || index + direction >= order.length) return;
    this.change(
      () =>
        reorderConstructionEquipment(
          this.entity(),
          location,
          mount.mountId,
          order[index + (direction === -1 ? -1 : 2)],
        ),
      this.canReorderMount(mount),
    );
  }
  startDrag(data: DragEquipment): void {
    this.dragSequence++;
    this.inspector.close();
    this.placementSelection.set(null);
    this.dragging.set(data);
    this.dragTarget.set(null);
    this.dragBounds.clear();
    const root = this.constructionShell()?.nativeElement;
    if (!root) return;
    for (const location of this.locations()) {
      const grid = root.querySelector<HTMLElement>('.critical-grid[data-location="' + location.id + '"]');
      if (!grid) continue;
      const top = grid.getBoundingClientRect().top;
      this.dragBounds.set(
        location.id,
        location.rows.flatMap((row) => {
          if (!row.mount) return [];
          const block = grid.querySelector<HTMLElement>('[data-slot-index="' + row.index + '"]');
          if (!block) return [];
          const rect = block.getBoundingClientRect();
          return [{ id: row.mount.mountId, midpoint: rect.top - top + rect.height / 2 }];
        }),
      );
    }
  }
  endDrag(): void {
    if (this.dragging() && this.mobileEquipment()) this.equipmentDrawerOpen.set(false);
    if (this.dragScrollFrame !== null) cancelAnimationFrame(this.dragScrollFrame);
    this.dragScrollFrame = null;
    this.dragPointer = null;
    this.dragging.set(null);
    this.dragTarget.set(null);
  }
  dragEnded(): void {
    // CDK emits drag-ended before the destination's dropped event.
    const sequence = this.dragSequence;
    queueMicrotask(() => {
      if (sequence === this.dragSequence) this.endDrag();
    });
  }
  dragMoved(event: Pick<CdkDragMove<DragEquipment>, 'pointerPosition'>): void {
    this.dragPointer = event.pointerPosition;
    this.updateDragTarget(event.pointerPosition);
    if (this.dragging() && this.dragScrollFrame === null)
      this.dragScrollFrame = requestAnimationFrame(this.scrollDuringDrag);
  }
  private readonly scrollDuringDrag = (): void => {
    this.dragScrollFrame = null;
    const pointer = this.dragPointer;
    const shell = this.constructionShell()?.nativeElement;
    const scroll = this.mobileEquipment() ? shell : shell?.querySelector<HTMLElement>('.construction-workspace');
    if (!pointer || !shell || !scroll || !this.dragging()) return;
    const bounds = scroll.getBoundingClientRect();
    const top = Math.max(bounds.top, shell.querySelector('.workshop-header')!.getBoundingClientRect().bottom);
    const bottom = Math.min(bounds.bottom, this.constructionFooter()!.nativeElement.getBoundingClientRect().top);
    if (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top || pointer.y > bounds.bottom) return;
    // Use the visible loadout edges, excluding the sticky header and footer.
    const step = pointer.y < top + 48 ? -10 : pointer.y > bottom - 48 ? 10 : 0;
    const previous = scroll.scrollTop;
    scroll.scrollTop += step;
    if (scroll.scrollTop !== previous) {
      this.updateDragTarget(pointer);
      this.dragScrollFrame = requestAnimationFrame(this.scrollDuringDrag);
    }
  };
  private updateDragTarget(pointer: { x: number; y: number }): void {
    // CDK reports viewport coordinates, matching elementFromPoint and DOM bounds.
    const element = document.elementFromPoint(pointer.x, pointer.y);
    const location = element?.closest('[data-location]')?.getAttribute('data-location');
    const grid = element?.closest<HTMLElement>('.critical-grid');
    const y = pointer.y - (grid?.getBoundingClientRect().top ?? 0);
    // Hit-test the original block positions so moving the preview cannot change its own target.
    const beforeMountId =
      location && grid
        ? this.dragBounds.get(location)?.find((block) => block.id !== this.dragging()?.mountId && y < block.midpoint)
            ?.id
        : undefined;
    if (location !== this.dragTarget()?.location || beforeMountId !== this.dragTarget()?.beforeMountId)
      this.dragTarget.set(location ? { location, beforeMountId } : null);
  }
  dragLabel(): string {
    return this.registry.findEquipment(this.dragging()?.equipmentId ?? '')?.name ?? '';
  }
  dragPreviewSlots(equipment?: Equipment): number {
    return Math.max(1, equipment?.getNumCriticalSlots(this.entity()) ?? 1);
  }
  hasEditableSize(equipment: Equipment): boolean {
    return (
      equipment.tonnage === 'variable' &&
      (!equipment.isSpreadable || (!!this.building() && equipment.hasFlag('F_POWER_GENERATOR'))) &&
      !(equipment instanceof ArmorEquipment || equipment instanceof StructureEquipment)
    );
  }
  dragPreviewWidth(): number {
    return (
      this.constructionShell()
        ?.nativeElement.querySelector<HTMLElement>('.critical-grid .slot-target')
        ?.getBoundingClientRect().width || 200
    );
  }
  captureDragPreviewOrigin(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Custom-size CDK previews start at the pointer; retain the same relative grab point.
    this.dragPreviewOffset.set(
      `${(-100 * (event.clientX - rect.left)) / rect.width}% ${(-100 * (event.clientY - rect.top)) / rect.height}%`,
    );
  }
  install(eq: Equipment, location = this.selectedLocation(), slotIndex?: number): void {
    this.change(
      () => this.finishEquipmentEdit(installConstructionEquipment(this.entity(), eq, location, slotIndex)),
      this.canInstall(eq),
    );
  }
  installSelected(): void {
    const version = this.historyVersion();
    this.clickSlot(this.selectedLocation());
    if (this.historyVersion() !== version) this.closeInstalledInspector();
  }
  clickSlot(location: string, slotIndex?: number): void {
    if (this.dragging() || !this.canPlaceSelectedEquipment()) return;
    this.selectedLocation.set(location);
    const selection = this.placementSelection()!;
    const mount = this.placementMount();
    if (mount) this.inspectMount(mount);
    const spread = mount && this.spreadAllocation(mount);
    if (mount && spread?.remaining) {
      this.setSpreadSlots(location, (spread.locations.find((item) => item.id === location)?.count ?? 0) + 1, slotIndex);
      return;
    }
    if (mount && this.isMountUnallocated(mount)) {
      this.moveSelected(location, slotIndex);
      return;
    }
    if (selection.kind === 'equipment') this.install(selection.equipment, location, slotIndex);
  }
  onTopologyDrop(event: CdkDragDrop<unknown, unknown, DragEquipment>): void {
    if (!event.isPointerOverContainer) return;
    // The map is one CDK container; resolve the actual hex and floor at release.
    this.dragMoved({ pointerPosition: event.dropPoint });
    const destination = this.dragTarget();
    if (destination && this.dropPlans().get(destination.location)?.issue === '') {
      this.onDrop({ ...event, container: { data: destination } });
    }
  }
  onDrop(event: {
    item: { data: DragEquipment };
    container: { data: DropLocation };
    isPointerOverContainer?: boolean;
  }): void {
    const data = event.item.data;
    const destination = event.container.data;
    if (!data || !destination || event.isPointerOverContainer === false) return;
    if (
      this.dragging() &&
      (this.dragTarget()?.location !== destination.location || this.dropPlans().get(destination.location)?.issue)
    )
      return;
    const mount = data.mountId
      ? this.entity()
          .equipment()
          .find((item) => item.mountId === data.mountId)
      : null;
    if (data.mountId && !mount) return;
    const equipment = mount?.equipment ?? this.registry.findEquipment(data.equipmentId);
    if (!equipment) return;
    this.selectedLocation.set(destination.location);
    if (
      mount
        ? !(
            this.canEditMount(mount) ||
            ((data.sourceLocation ?? mount.location) === destination.location && this.canReorderMount(mount))
          )
        : !this.canInstall(equipment)
    )
      return;
    const entity = this.entity();
    this.change(() => {
      let placed: EntityMountedEquipment;
      if (mount && entity instanceof MekEntity && this.spreadAllocation(mount)) {
        placed = applyConstructionSpreadPlacements(
          entity,
          mount,
          constructionSpreadMovePlacements(
            entity,
            mount,
            data.sourceLocation,
            destination.location,
            data.slotCount,
            data.sourceSlotIndex,
          ),
        );
      } else if (
        mount &&
        data.sourceLocation &&
        data.sourceLocation !== destination.location &&
        entity instanceof MekEntity &&
        mount.equipment?.canSplit() &&
        !mount.equipment.isSpreadable &&
        new Set(mount.placements?.map((p) => p.location)).size > 1
      ) {
        placed = moveConstructionEquipmentBlock(entity, mount, data.sourceLocation, destination.location);
      } else if (
        mount &&
        (mount.placements?.some((p) => p.location === destination.location) ||
          (!(entity instanceof MekEntity) && mount.location === destination.location))
      ) {
        placed = mount;
      } else if (mount) placed = moveConstructionEquipment(entity, mount, destination.location);
      else placed = installConstructionEquipment(entity, equipment, destination.location, destination.slotIndex);
      reorderConstructionEquipment(entity, destination.location, placed.mountId, this.dragTarget()?.beforeMountId);
      this.finishEquipmentEdit(entity.equipment().find((item) => item.mountId === placed.mountId)!);
    }, this.reconfiguring());
  }
  onUnallocatedDrop(event: { item: { data: DragEquipment }; isPointerOverContainer?: boolean }): void {
    if (event.isPointerOverContainer === false) return;
    const data = event.item.data;
    if (!data?.mountId) {
      const equipment = this.registry.findEquipment(data?.equipmentId);
      if (equipment) this.change(
        () => this.finishEquipmentEdit(installConstructionEquipment(this.entity(), equipment)),
        this.canInstall(equipment),
      );
    } else {
      const mount = this.entity()
        .equipment()
        .find((item) => item.mountId === data.mountId);
      if (!mount) return;
      if (this.spreadAllocation(mount)) {
        if (data.sourceLocation) this.uninstallBlock(mount, data.sourceLocation, data.slotCount, data.sourceSlotIndex);
      } else this.uninstall(mount);
    }
  }
  onWarehouseDrop(event: { item: { data: DragEquipment }; isPointerOverContainer?: boolean }): void {
    if (event.isPointerOverContainer === false) return;
    const mount = this.entity().equipment().find((item) => item.mountId === event.item.data?.mountId);
    if (mount) this.remove(mount);
  }
  uninstallBlock(
    mount: EntityMountedEquipment,
    location?: string,
    count?: number,
    slotIndex?: number,
    event?: Event,
  ): void {
    event?.stopPropagation();
    const entity = this.entity();
    if (!this.canUninstallMount(mount)) return;
    if (!(entity instanceof MekEntity) || !this.spreadAllocation(mount) || !location) {
      this.uninstall(mount);
      return;
    }
    this.change(
      () =>
        this.finishEquipmentEdit(
          applyConstructionSpreadPlacements(
            entity,
            mount,
            constructionSpreadMovePlacements(entity, mount, location, undefined, count, slotIndex),
          ),
        ),
      this.canEditMount(mount),
    );
  }
  editSpreadSlots(location: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const target = this.selectedSpread()?.locations.find((item) => item.id === location);
    if (!target) return;
    const count = input.valueAsNumber;
    if (Number.isInteger(count)) this.setSpreadSlots(location, Math.max(0, Math.min(target.maximum, count)));
    input.value = String(this.selectedSpread()?.locations.find((item) => item.id === location)?.count ?? target.count);
  }
  setSpreadSlots(location: string, count: number, slotIndex?: number): void {
    const entity = this.entity(),
      mount = this.selectedMount();
    if (!(entity instanceof MekEntity) || !mount || !this.canEditMount(mount)) return;
    const previousCount = this.selectedSpread()?.locations.find((item) => item.id === location)?.count ?? 0;
    if (previousCount === count) return;
    this.change(
      () => this.finishEquipmentEdit(setConstructionSpreadSlots(entity, mount, location, count, slotIndex)),
      this.canEditMount(mount),
    );
  }
  autoAllocateSpread(): void {
    const entity = this.entity(),
      mount = this.selectedMount();
    if (!(entity instanceof MekEntity) || !mount || !this.selectedSpread()?.remaining || !this.canEditMount(mount))
      return;
    this.change(
      () =>
        this.finishEquipmentEdit(
          applyConstructionSpreadPlacements(entity, mount, constructionSpreadAutoPlacements(entity, mount)),
        ),
      this.canEditMount(mount),
    );
  }
  uninstall(mount: EntityMountedEquipment, event?: Event): void {
    event?.stopPropagation();
    if (!this.canUninstallMount(mount)) return;
    this.change(() => this.finishEquipmentEdit(uninstallConstructionEquipment(this.entity(), mount)), this.canEditMount(mount));
    this.closeInstalledInspector();
  }
  remove(mount: EntityMountedEquipment, event?: Event): void {
    event?.stopPropagation();
    if (!this.canRemoveMount(mount)) return;
    this.change(() => removeConstructionEquipment(this.entity(), mount), this.canEditMount(mount));
    this.selectedMountId.set(null);
    this.inspector.close();
  }
  removeAllUnallocated(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const mounts = this.removableUnallocated();
    if (!mounts.length) return;
    this.change(() => mounts.forEach((mount) => removeConstructionEquipment(this.entity(), mount)), true);
    if (mounts.some((mount) => mount.mountId === this.selectedMountId()) && !this.selectedMount()) {
      this.selectedMountId.set(null);
      this.inspector.close();
    }
  }
  updateMount(mount: EntityMountedEquipment, values: Partial<EntityMountedEquipmentInit>): void {
    if (!this.canEditMount(mount) || (!this.designEditing() && ('omniPodMounted' in values || 'armored' in values)))
      return;
    if (values.armored && this.componentArmorIssue(mount)) return;
    if (values.size !== undefined) {
      if (!Number.isFinite(values.size) || values.size <= 0) return;
      this.change(
        () => this.finishEquipmentEdit(resizeConstructionEquipment(this.entity(), mount, values.size!)),
        this.canEditMount(mount),
      );
      return;
    }
    if ('shotsCount' in values && (!Number.isInteger(values.shotsCount) || values.shotsCount! < 0)) return;
    if (
      this.building() &&
      values.shotsCount !== undefined &&
      mount.equipment instanceof AmmoEquipment &&
      values.shotsCount > mount.equipment.shots
    )
      return;
    this.change(
      () =>
        this.entity().updateEquipment((mounts) =>
          mounts.map((item) => (item.mountId === mount.mountId ? item.clone(values) : item)),
        ),
      this.canEditMount(mount),
    );
  }
  moveSelected(location: string, slotIndex?: number): void {
    const mount = this.selectedMount();
    if (mount)
      this.change(
        () => this.finishEquipmentEdit(moveConstructionEquipment(this.entity(), mount, location, slotIndex)),
        this.canEditMount(mount),
      );
  }
  undo(): void {
    this.restoreHistory(this.undoStack, this.redoStack);
  }
  redo(): void {
    this.restoreHistory(this.redoStack, this.undoStack);
  }
  private recordChange(previous: ConstructionHistoryEntry): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
    this.historyVersion.update((value) => value + 1);
  }
  private captureHistory(): ConstructionHistoryEntry {
    const entity = this.entity();
    const source = encodeNativeEntity(entity);
    const runtime = this.runtimePreview();
    const artwork = this.effectiveArtwork();
    const unallocated = entity.equipment().filter((mount) => mount.allocation.kind === 'unallocated');
    if (!this.forceMember()) return { source, unallocated, origins: new Map(), runtime, artwork };
    const detached = this.parseHistoryEntity(source, unallocated);
    return {
      source,
      unallocated,
      origins: this.forceConstruction.remapOrigins(entity, detached, this.mountOrigins()),
      runtime,
      artwork,
    };
  }
  private parseHistoryEntity(source: string, unallocated: readonly EntityMountedEquipment[]): BaseEntity {
    const entity = this.customUnits.parseDraft(source, nativeEntityFormat(this.entity()));
    const heatSinkCount = entity instanceof MekEntity ? entity.heatSinkCount() : 0;
    // Optional inventory belongs to this editing session; native saves retain only installed equipment.
    entity.updateEquipment((mounts) => mounts.filter((mount) => mount.allocation.kind !== 'unallocated'));
    entity.addEquipmentBatch(unallocated);
    if (entity instanceof MekEntity) entity.initializeParsedHeatSinkMounts(heatSinkCount);
    ensureConstructionMaterialEquipment(entity);
    return entity;
  }
  private restoreHistory(source: ConstructionHistoryEntry[], destination: ConstructionHistoryEntry[]): void {
    if (this.busy() || !this.canRestoreHistory(source.at(-1))) return;
    const previous = source.pop();
    if (previous === undefined) return;
    destination.push(this.captureHistory());
    const entity = this.parseHistoryEntity(previous.source, previous.unallocated);
    entity.uuid.set(this.entity().uuid());
    this.entity.set(entity);
    this.mountOrigins.set(previous.origins);
    this.runtimePreview.set(previous.runtime);
    this.setArtworkDraft(previous.artwork);
    this.selectedMountId.set(null);
    this.placementSelection.set(null);
    this.historyVersion.update((value) => value + 1);
  }
  private canRestoreHistory(entry: ConstructionHistoryEntry | undefined): boolean {
    if (!entry || this.forceMember()?.force.readOnly()) return false;
    if (this.designEditing() || entry.source === encodeNativeEntity(this.entity())) return true;
    if (!this.reconfiguring()) return false;
    const previous = untracked(() => this.parseHistoryEntity(entry.source, entry.unallocated));
    return (
      constructionOmniBaseSource(previous) === constructionOmniBaseSource(this.entity()) &&
      !constructionReconfigurationIssues(previous).length
    );
  }
  changeArtwork(fluff: Blob | null): void {
    if (this.busy()) return;
    const previous = this.captureHistory();
    const icon = this.effectiveArtwork()?.icon;
    this.setArtworkDraft(fluff || icon ? { ...(fluff ? { fluff } : {}), ...(icon ? { icon } : {}) } : null);
    this.recordChange(previous);
  }
  private setArtworkDraft(artwork: UnitArtwork | null): void {
    const saved = this.artwork.get(this.artworkBaseUuid() ?? this.entity().uuid());
    this.artworkDraft.set(artwork?.fluff === saved?.fluff && artwork?.icon === saved?.icon ? undefined : artwork);
  }
  private markClean(): void {
    this.baselineSource.set(encodeNativeEntity(this.entity()));
    this.runtimePreview.set(null);
    this.unsavedImport.set(false);
    this.savePending.set(false);
    this.artworkDraft.set(undefined);
  }
  private replaceDesign(entity: BaseEntity): void {
    ensureConstructionMaterialEquipment(entity);
    this.coreSourceUuid.set(undefined);
    this.draftUuid = undefined;
    this.foreignDesign.set(false);
    this.forceMember.set(null);
    this.editDesign.set(false);
    this.oemYearExpanded.set(null);
    this.mountOrigins.set(new Map());
    this.entity.set(entity);
    this.artworkBaseUuid.set(entity.uuid());
    this.selectedLocation.set(entity.validLocations.has('RT') ? 'RT' : [...entity.validLocations][0]);
    this.selectedEquipment.set(null);
    this.selectedMountId.set(null);
    this.placementSelection.set(null);
    this.undoStack = [];
    this.redoStack = [];
    this.historyVersion.update((value) => value + 1);
    this.markClean();
    this.newDesign.set(false);
    this.picker.set(null);
    this.status.set('');
  }
  async createNew(): Promise<void> {
    if (this.busy() || !(await this.allowReplace()) || this.busy()) return;
    try {
      this.replaceDesign(createConstructionEntity(this.newType(), this.registry));
      this.savedUuid.set(undefined);
      this.newDesign.set(true);
    } catch (error) {
      this.reportError(error);
    }
  }
  async openUnit(unit: UnitSummary, copy = false): Promise<void> {
    if (this.busy() || !(await this.allowReplace()) || this.busy()) return;
    this.busy.set(true);
    try {
      await this.artwork.initialize();
      const custom = unit.origin === 'user';
      if (custom && !(await this.customUnits.get(unit.uuid)))
        await this.injector.get(CustomUnitSyncService).openShared(unit.uuid);
      const entity = custom
        ? await this.customUnits.load(unit.uuid)
        : this.customUnits.detach((await this.native.load(unit.uuid)).entity);
      this.replaceDesign(entity);
      this.foreignDesign.set(custom && !copy && !this.customUnits.isOwned(unit.uuid));
      this.savedUuid.set(custom && !copy && !this.foreignDesign() ? unit.uuid : undefined);
      const originalUuid = entity.refitFromUUID() ?? (!custom || copy ? unit.uuid : undefined);
      this.coreSourceUuid.set(!custom && !copy ? unit.uuid : undefined);
      if (copy) {
        entity.refitFromUUID.set(originalUuid);
        entity.model.set(`${entity.model()} Custom`.trim());
        entity.mulId.set(null);
        this.newDesign.set(true);
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async openForceMember(member: CBTForceMember): Promise<void> {
    if (this.busy() || !(await this.allowReplace()) || this.busy()) return;
    this.busy.set(true);
    try {
      await this.artwork.initialize();
      if (member.force.readOnly()) throw new Error('This force is read-only.');
      const record = await this.customUnits.get(member.entity.uuid());
      const entity = this.customUnits.detach(member.entity);
      establishConstructionOmniBase(entity);
      this.replaceDesign(entity);
      this.forceMember.set(member);
      this.mountOrigins.set(this.forceConstruction.captureOrigins(member, entity));
      this.foreignDesign.set(
        record?.owned === false ||
          (!record && member.force.getUnitSnapshot(member.id)?.nativeSource?.isCustom === true),
      );
      this.savedUuid.set(this.foreignDesign() ? undefined : record?.uuid);
      this.coreSourceUuid.set(record || this.foreignDesign() ? undefined : member.entity.uuid());
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async chooseUnit(): Promise<void> {
    if (this.busy() || this.unitPickerOpen()) return;
    this.unitPickerOpen.set(true);
    let unregister: (() => void) | undefined;
    try {
      const { UnitSearchPickerDialogComponent } =
        await import('../components/unit-search-picker-dialog/unit-search-picker-dialog.component');
      if (this.destroyRef.destroyed) return;
      const ref = this.dialogs.createDialog<UnitSummary>(UnitSearchPickerDialogComponent, { disableClose: false });
      unregister = this.destroyRef.onDestroy(() => ref.close());
      const selected = await firstValueFrom(ref.closed);
      if (selected && !this.destroyRef.destroyed) await this.openUnit(selected);
    } catch (error) {
      this.reportError(error);
    } finally {
      unregister?.();
      this.unitPickerOpen.set(false);
    }
  }
  async deleteSaved(): Promise<void> {
    const uuid = this.savedUuid();
    if (!uuid || this.busy()) return;
    this.busy.set(true);
    try {
      if (!(await this.customUnits.get(uuid))) throw new Error('The custom unit no longer exists.');
      if (
        !(await this.dialogs.requestConfirmation(
          `Delete ${this.entity().displayName()} from your custom unit library on all devices? Anyone subscribed will lose access. Copies included in saved forces are kept.`,
          'Delete custom unit',
          'danger',
        ))
      )
        return;
      await this.customUnits.delete(uuid);
      this.savedUuid.set(undefined);
      this.newDesign.set(true);
      this.unsavedImport.set(true);
      this.savePending.set(false);
      this.draftUuid = undefined;
      await this.data.refreshCustomUnits();
      this.status.set('Custom unit deleted. Other devices will update when connected.');
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  cloneToOwn(): void {
    if (this.busy() || !this.foreignDesign()) return;
    this.entity().refitFromUUID.set(this.entity().uuid());
    this.draftUuid = asUnitUuid(uuidv7());
    this.entity().uuid.set(this.draftUuid);
    this.entity().mulId.set(null);
    this.savedUuid.set(undefined);
    this.foreignDesign.set(false);
    this.newDesign.set(true);
    this.status.set('Your own copy is ready. Save Refit to keep it.');
  }

  async save(copy = false): Promise<void> {
    if (!this.canSave() || (copy && !this.designChanged())) return;
    if (!this.entity().chassis().trim()) {
      this.reportError(new Error('Give the design a chassis name before saving.'));
      return;
    }
    this.busy.set(true);
    const savedVersion = this.historyVersion();
    let persisted = false;
    try {
      await this.artwork.initialize();
      const images = this.effectiveArtwork();
      const saveArtwork = this.artworkChanged();
      const baseUuid = this.artworkBaseUuid() ?? this.entity().uuid();
      const member = this.forceMember();
      if (member?.force.readOnly()) throw new Error('This force is read-only.');
      const runtime = this.runtimeChanged() ? this.runtimePreview()!.changes : undefined;
      const saveDesign = this.designChanged() || this.newDesign() || this.unsavedImport() || this.savePending();
      if (saveDesign && this.foreignDesign()) throw new Error('Clone this design to edit it.');
      let updated = member;
      if (saveDesign) {
        const updateUuid = copy && !this.savePending() ? undefined : this.savedUuid();
        const newUuid = updateUuid ? undefined : (this.draftUuid ?? (member ? asUnitUuid(uuidv7()) : undefined));
        if (member) {
          const proposed = this.customUnits.detach(this.entity());
          proposed.uuid.set(updateUuid ?? newUuid!);
          if (
            !(await this.customPolicy.check(
              member.force,
              {
                uuid: proposed.uuid(),
                source: { format: nativeEntityFormat(proposed), source: encodeNativeEntity(proposed) },
              },
              member.id,
            ))
          )
            return;
        }
        const record = await this.customUnits.save(this.entity(), {
          uuid: updateUuid,
          ...(newUuid ? { newUuid } : {}),
          originalUnitUuid: this.originalUuid() ?? (copy ? this.savedUuid() : undefined),
        });
        persisted = true;
        this.savePending.set(true);
        this.savedUuid.set(record.uuid);
        this.entity().uuid.set(record.uuid);
        this.entity().refitFromUUID.set(record.originalUnitUuid);
        this.coreSourceUuid.set(undefined);
        await this.data.refreshCustomUnits();
        if (member)
          updated = await this.forceConstruction.applySavedConstruction(
            member,
            record,
            this.entity(),
            this.mountOrigins(),
            runtime,
          );
      } else if (member && runtime) {
        updated = await member.force.applyConstruction(member, undefined, runtime);
      }
      if (saveArtwork || (saveDesign && baseUuid !== this.entity().uuid() && images)) {
        await this.artwork.set(this.entity().uuid(), images);
        this.artworkBaseUuid.set(this.entity().uuid());
      }
      if (updated) {
        this.forceMember.set(updated);
        this.mountOrigins.set(this.forceConstruction.captureOrigins(updated, this.entity()));
        // Earlier history holds the previous runtime edit context and mount identities.
        this.undoStack = [];
        this.redoStack = [];
        this.historyVersion.update((value) => value + 1);
        this.markClean();
      } else if (savedVersion === this.historyVersion()) this.markClean();
      this.newDesign.set(false);
      this.status.set(
        !saveDesign && !runtime && saveArtwork
          ? 'Fluff image saved on this device.'
          : member
            ? saveDesign
              ? 'Refit saved and applied to this force unit.'
              : 'Runtime changes saved to this force unit.'
            : this.errors().length
              ? 'Draft saved. Resolve the construction issues before fielding this unit.'
              : 'Custom unit saved and added to search.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportError(
        persisted
          ? new Error(
              `Design saved locally. ${this.forceMember() ? 'Force refit' : 'Search update'} failed: ${message}`,
            )
          : error,
      );
    } finally {
      this.busy.set(false);
    }
  }
  async onShare(): Promise<void> {
    if (!this.canShare()) return;
    const entity = this.entity();
    try {
      const result = await shareUrlWithClipboardFallback({
        title: entity.displayName(),
        url: `${window.location.origin}/meklab/${entity.uuid()}`,
      });
      if (result === 'copied') this.toast.showToast('Unit link copied to clipboard.', 'success');
    } catch (error) {
      this.reportError(error);
    }
  }
  async exportDesign(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.artwork.initialize();
      // Only the downloaded copy owns embedded images; the working design stays image-free.
      const entity = this.customUnits.detach(this.entity());
      const artwork = this.effectiveArtwork();
      let fluff = artwork?.fluff;
      const catalogUrl = fluff ? null : await this.fluffImages.loadEntityCatalogUrl(entity);
      if (!fluff && catalogUrl) {
        const response = await fetch(catalogUrl);
        if (!response.ok) throw new Error('Could not load the fluff image for export.');
        fluff = await normalizeUnitImage(await response.blob());
      }
      entity.fluffImageEncoded.set(fluff ? await encodeUnitImage(fluff) : '');
      entity.iconEncoded.set(artwork?.icon ? await encodeUnitImage(artwork.icon) : '');
      const blob = new Blob([encodeNativeEntity(entity)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${entity.displayName().replace(/[<>:"/\\|?*]/g, '_')}.${nativeEntityFormat(entity)}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (this.busy() || !file || !(await this.allowReplace()) || this.busy()) return;
    this.busy.set(true);
    try {
      if (file.size > MAX_NATIVE_IMPORT_BYTES)
        throw new Error(`Choose a native unit file no larger than ${MAX_NATIVE_IMPORT_BYTES / 1024 / 1024} MB.`);
      const format = file.name.toLowerCase().endsWith('.mtf')
        ? 'mtf'
        : file.name.toLowerCase().endsWith('.blk')
          ? 'blk'
          : null;
      if (!format) throw new Error('Choose an MTF or BLK unit file.');
      const extracted = extractNativeUnitArtwork(await file.text(), format);
      if (new TextEncoder().encode(extracted.source).byteLength > MAX_UNIT_SOURCE_BYTES) {
        throw new Error(`The unit source without images must be no larger than ${MAX_UNIT_SOURCE_BYTES / 1024} KB.`);
      }
      const entity = this.customUnits.parseDraft(extracted.source, format);
      const { artwork, warnings } = await decodeUnitArtwork(extracted.images);
      encodeNativeEntity(entity);
      this.replaceDesign(entity);
      this.savedUuid.set(undefined);
      this.unsavedImport.set(true);
      this.newDesign.set(true);
      this.artworkDraft.set(artwork);
      if (warnings.length) {
        this.reportError(warnings.join(' '));
      }
      if (entity.loadIssues().length) {
        this.reportError(
          `Imported with ${entity.loadIssues().length} source diagnostics. Review validation before saving.`,
        );
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async canLeave(): Promise<boolean> {
    if (this.busy()) return false;
    if (!(await this.allowReplace())) return false;
    this.markClean();
    return true;
  }
  async close(): Promise<void> {
    if (await this.canLeave()) this.dialogRef.close();
  }
  private async allowReplace(): Promise<boolean> {
    return (
      !this.dirty() ||
      (await this.dialogs.requestConfirmation(
        'This design has unsaved changes. Discard them?',
        'Unsaved construction',
        'warning',
      ))
    );
  }
  private reportError(error: unknown): void {
    this.status.set('');
    this.toast.showToast(error instanceof Error ? error.message : String(error), 'error');
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  @HostListener('document:pointerdown', ['$event']) inspectorPointerDown(event: PointerEvent): void {
    const panel = this.inspectorPanel()?.nativeElement;
    if (panel && !this.mobileEquipment()) this.inspector.closeOutside(event.target, panel);
  }
  private readonly cancelPlacementOnOutsideClick = (event: MouseEvent): void => {
    if (!this.placementSelection()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.inspector-close, .inspector-place, .installed-inspector-backdrop, .empty-slot.placement-ready')) return;
    // Keep the inspector's edit context available to the control being clicked.
    this.placementSelection.set(null);
  };
  @HostListener('document:contextmenu', ['$event']) cancelPlacementOnRightClick(event: MouseEvent): void {
    if (!this.canPlaceSelectedEquipment()) return;
    event.preventDefault();
    this.cancelPlacement();
  }
  @HostListener('document:keydown', ['$event']) keydown(event: KeyboardEvent): void {
    if (this.cdkDialog.openDialogs.at(-1) !== this.dialogRef) return;
    if (this.inspectorOpen() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelPlacement();
      return;
    }
    if (this.equipmentDrawerActive() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeEquipmentDrawer();
      return;
    }
    if (this.picker()) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.picker.set(null);
      }
      return;
    }
    if (this.detailsView() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeDetails();
      return;
    }
    if (this.canPlaceSelectedEquipment() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelPlacement();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
    }
  }
}
