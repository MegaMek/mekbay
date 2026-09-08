// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { BaseEntity } from '../models/entity/base-entity';
import { EntityMountedEquipment, type EntityMountedEquipmentInit } from '../models/entity/types/equipment';
import { MekEntity } from '../models/entity/entities/mek/mek-entity';
import { BattleArmorEntity } from '../models/entity/entities/infantry/battle-armor-entity';
import { VehicleEntity } from '../models/entity/entities/vehicle/vehicle-entity';
import { AmmoEquipment, Equipment, WeaponEquipment, formatEquipmentRulesRefs } from '../models/equipment.model';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { DataService } from '../services/data.service';
import { NativeEntityService } from '../services/native-entity.service';
import { CustomUnitsService } from '../services/custom-units.service';
import { DialogsService } from '../services/dialogs.service';
import { UnitNameService } from '../services/unit-name.service';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { MAX_UNIT_SOURCE_BYTES } from '../services/unit-catalog/core-unit-manifest';
import { encodeNativeEntity } from '../models/entity/write-entity';
import { ConstructionExtrasComponent } from './components/construction-extras.component';
import { reconcileConstructionEquipmentRelationships } from './domain/construction-relationships';
import {
    CONSTRUCTION_UNIT_TYPES, createConstructionEntity, getConstructionFields,
    getConstructionLocations, getConstructionMass, getConstructionMassCapacity, equipmentPlacementIssues,
    installConstructionEquipment, moveConstructionEquipment, resizeConstructionEquipment, validateConstruction,
    setConstructionArmor, getConstructionArmorOptions, getConstructionStructureOptions,
    setConstructionArmorMaterial, setConstructionStructure, constructionSupportsAmmoQuantity,
    type ConstructionField, type ConstructionUnitKind,
} from './domain';

interface DragEquipment { readonly equipmentId: string; readonly mountId?: string }
interface DropLocation { readonly location: string; readonly slotIndex?: number }
interface SlotRow { index: number; span: number; system?: string; mount?: EntityMountedEquipment }
type WarehouseCategory = 'all' | 'energy' | 'ballistic' | 'missile' | 'artillery' | 'physical' | 'ammo' | 'misc';

@Component({
    selector: 'unit-construction',
    imports: [DecimalPipe, FormsModule, CdkDrag, CdkDropList, CdkDropListGroup, CdkTrapFocus, ConstructionExtrasComponent],
    templateUrl: './unit-construction.component.html',
    styleUrls: ['./unit-construction.component.scss', './construction-loadout.scss', './construction-panels.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'fullscreen-dialog-host nopadding fullheight' },
})
export class UnitConstructionComponent {
    readonly rejectWarehouseDrop = () => false;
    rowTicks(count: number): readonly undefined[] { return Array.from({ length: count }); }
    private readonly dialogRef = inject(DialogRef);
    private readonly cdkDialog = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialogs = inject(DialogsService);
    private readonly data = inject(DataService);
    private readonly native = inject(NativeEntityService);
    readonly customUnits = inject(CustomUnitsService);
    readonly unitNames = inject(UnitNameService);
    private readonly registry = inject(EquipmentCatalogService).getEquipmentRegistry();

    readonly unitTypes = CONSTRUCTION_UNIT_TYPES;
    readonly entity = signal<BaseEntity>(createConstructionEntity('Biped', this.registry));
    readonly savedUuid = signal<UnitUuid | undefined>(undefined);
    readonly originalUuid = signal<UnitUuid | undefined>(undefined);
    readonly originalName = signal('New design');
    readonly dirty = signal(false);
    readonly busy = signal(false);
    readonly unitPickerOpen = signal(false);
    readonly status = signal('');
    readonly statusError = signal(false);
    readonly panel = signal<'loadout' | 'systems'>('loadout');
    readonly picker = signal<'new' | null>(null);
    readonly newType = signal<ConstructionUnitKind>('Biped');
    readonly query = signal('');
    readonly category = signal<WarehouseCategory>('all');
    readonly compatibleOnly = signal(true);
    readonly equipmentLimit = signal(80);
    readonly selectedLocation = signal('RT');
    readonly selectedEquipment = signal<Equipment | null>(null);
    readonly selectedMountId = signal<string | null>(null);
    readonly showValidation = signal(false);
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    readonly historyVersion = signal(0);
    readonly canUndo = computed(() => { this.historyVersion(); return this.undoStack.length > 0; });
    readonly canRedo = computed(() => { this.historyVersion(); return this.redoStack.length > 0; });

    readonly categories: readonly { id: WarehouseCategory; label: string; icon?: string }[] = [
        { id: 'all', label: 'All' }, { id: 'energy', label: 'Energy', icon: 'energy' },
        { id: 'ballistic', label: 'Ballistic', icon: 'ballistic' },
        { id: 'missile', label: 'Missile', icon: 'missile' },
        { id: 'artillery', label: 'Artillery', icon: 'artillery' },
        { id: 'physical', label: 'Physical', icon: 'physical' },
        { id: 'ammo', label: 'Ammo', icon: 'ballistic' }, { id: 'misc', label: 'Equipment', icon: 'crate' },
    ];
    private readonly equipment = [...new Map(Object.values(this.registry.equipment)
        .filter(eq => !eq.isInternalRepresentation && eq.type !== 'armor' && eq.type !== 'structure')
        .map(eq => [eq.id, eq])).values()].sort((a, b) => a.sortingName.localeCompare(b.sortingName));

    readonly locations = computed(() => getConstructionLocations(this.entity()).map(location => ({
        ...location, rows: this.slotRows(location.slots),
    })));
    readonly isMek = computed(() => this.entity() instanceof MekEntity);
    readonly isBattleArmor = computed(() => this.entity() instanceof BattleArmorEntity);
    readonly isVehicle = computed(() => this.entity() instanceof VehicleEntity);
    readonly supportsAmmoQuantity = computed(() => constructionSupportsAmmoQuantity(this.entity()));
    readonly fields = computed(() => getConstructionFields(this.entity()));
    readonly fieldGroups = computed(() => [...new Set(this.fields().map(field => field.group))]
        .map(name => ({ name, fields: this.fields().filter(field => field.group === name) })));
    readonly armorOptions = computed(() => getConstructionArmorOptions(this.entity()));
    readonly structureOptions = computed(() => getConstructionStructureOptions(this.entity()));
    readonly mass = computed(() => getConstructionMass(this.entity()));
    readonly massCapacity = computed(() => getConstructionMassCapacity(this.entity()));
    readonly massRatio = computed(() => Math.min(100, (this.mass() ?? 0) / (this.massCapacity() || 1) * 100));
    readonly validation = computed(() => validateConstruction(this.entity()));
    readonly errors = computed(() => this.validation().messages.filter(message => message.severity === 'error'));
    readonly warnings = computed(() => this.validation().messages.filter(message => message.severity === 'warning'));
    readonly filteredEquipment = computed(() => {
        const query = this.query().trim().toLowerCase();
        const category = this.category();
        const entity = this.entity();
        const location = this.selectedLocation();
        const compatibleOnly = this.compatibleOnly();
        return this.equipment.filter(eq => (category === 'all' || this.equipmentCategory(eq) === category)
            && (!query || `${eq.name} ${eq.id} ${eq.aliases.join(' ')}`.toLowerCase().includes(query))
            && (!compatibleOnly || equipmentPlacementIssues(entity, eq, location).length === 0));
    });
    readonly visibleEquipment = computed(() => this.filteredEquipment().slice(0, this.equipmentLimit()));
    readonly selectedMount = computed(() => this.entity().equipment().find(mount => mount.mountId === this.selectedMountId()) ?? null);
    readonly selectedIssues = computed(() => {
        const eq = this.selectedEquipment();
        return eq ? equipmentPlacementIssues(this.entity(), eq, this.selectedLocation(), this.selectedMount() ?? undefined) : [];
    });
    readonly unallocated = computed(() => this.entity().equipment().filter(mount =>
        mount.allocation.kind !== 'location' || !this.locations().some(location =>
            location.slots.some(slot => slot.mount?.mountId === mount.mountId))));

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

    equipmentClass(eq?: Equipment): string { return eq instanceof AmmoEquipment ? 'ammo ammo-chemical' : eq ? this.equipmentCategory(eq) : 'misc'; }
    equipmentSlots(eq: Equipment): string | number { return eq.getNumCriticalSlots(this.entity()) ?? '—'; }
    equipmentMass(eq: Equipment): string | number { return eq.tonnage === 'variable' ? 'Var.' : eq.tonnage; }
    mountedMass(mount: EntityMountedEquipment): string {
        try {
            const mass = mount.getTonnage(this.entity());
            return mass !== undefined && Number.isFinite(mass) ? `${Number(mass.toFixed(3))} t` : 'Variable mass';
        } catch { return 'Variable mass'; }
    }
    equipmentRefs(eq: Equipment): string { return formatEquipmentRulesRefs(eq.rulesRefs); }
    materialLabel(eq: Equipment): string { return `${eq.name}${eq.techBase === 'All' ? '' : eq.techBase === 'Clan' ? ' · Clan' : ' · IS'}`; }
    weapon(eq: Equipment): WeaponEquipment | null { return eq instanceof WeaponEquipment ? eq : null; }
    ammo(eq: Equipment): AmmoEquipment | null { return eq instanceof AmmoEquipment ? eq : null; }
    locationLabel(id: string): string { return this.locations().find(location => location.id === id)?.label ?? id; }
    structureAt(id: string): string { return this.entity().structureByLocation().get(id)?.structure.id ?? ''; }
    armorAt(id: string): string { return this.entity().armorByLocation().get(id)?.armor.id ?? ''; }
    donorTonnage(id: string): number { return this.entity().structureByLocation().get(id)?.tonnage ?? this.entity().tonnage(); }

    private slotRows(slots: readonly { index: number; system?: string; mount?: EntityMountedEquipment }[]): SlotRow[] {
        const result: SlotRow[] = [];
        for (const slot of slots) {
            const last = result[result.length - 1];
            if (last?.mount && slot.mount?.mountId === last.mount.mountId && slot.index === last.index + last.span) last.span++;
            else result.push({ ...slot, span: 1 });
        }
        return result;
    }

    change(action: () => void): void {
        if (this.busy()) return;
        const entity = this.entity();
        let previous: string | undefined;
        try {
            previous = encodeNativeEntity(entity);
            action();
            reconcileConstructionEquipmentRelationships(entity);
            // Every accepted edit must remain representable by the native design codec.
            encodeNativeEntity(entity);
            this.undoStack.push(previous);
            if (this.undoStack.length > 40) this.undoStack.shift();
            this.redoStack = [];
            this.historyVersion.update(value => value + 1);
            this.dirty.set(true);
            this.status.set('');
        } catch (error) {
            if (previous !== undefined) {
                const restored = this.customUnits.parseDraft(previous, entity instanceof MekEntity ? 'mtf' : 'blk');
                restored.uuid.set(entity.uuid());
                this.entity.set(restored);
                this.selectedMountId.set(null);
            }
            this.reportError(error);
        }
    }

    setField(field: ConstructionField, value: string | number | boolean): void {
        if (field.kind === 'number' && (value == null || value === '' || !Number.isFinite(Number(value)))) return;
        this.change(() => field.set(field.kind === 'number' ? Number(value) : value));
    }
    setIdentity(field: 'chassis' | 'model', value: string): void { this.change(() => this.entity()[field].set(value)); }
    setArmor(id: string, face: 'front' | 'rear', value: number | null): void {
        if (value === null || !Number.isFinite(value)) return;
        const entity = this.entity();
        this.change(() => setConstructionArmor(entity, id,
            face === 'front' ? value : entity.getArmorValue(id), face === 'rear' ? value : entity.getArmorValue(id, 'rear')));
    }
    setArmorMaterial(id: string, location?: string): void {
        const armor = this.armorOptions().find(eq => eq.id === id);
        if (armor) this.change(() => setConstructionArmorMaterial(this.entity(), armor, location));
    }
    setStructure(id: string, location?: string, tonnage?: number): void {
        const structure = this.structureOptions().find(eq => eq.id === id);
        if (structure) this.change(() => setConstructionStructure(this.entity(), structure, location, tonnage));
    }
    stripArmor(): void {
        this.change(() => this.entity().armorLocations.forEach(id => setConstructionArmor(this.entity(), id, 0, 0)));
    }
    maxArmor(): void {
        this.change(() => {
            const entity = this.entity();
            if (entity instanceof BattleArmorEntity) {
                setConstructionArmor(entity, 'Squad', entity.maximumArmorPoints() / entity.trooperCount());
                return;
            }
            let available = Math.max(0, entity.maximumArmorPoints());
            for (const location of this.locations().filter(loc => entity.armorLocations.includes(loc.id))) {
                const total = Math.min(location.maxArmor, available);
                const rear = entity.hasRearArmor(location.id) ? Math.min(entity.getArmorValue(location.id, 'rear'), total) : 0;
                setConstructionArmor(entity, location.id, total - rear, rear);
                available -= total;
            }
        });
    }
    stripEquipment(): void { this.change(() => this.entity().equipment().filter(mount => mount.allocation.kind !== 'engine').forEach(mount => this.entity().removeEquipment(mount))); }
    selectEquipment(eq: Equipment): void { this.selectedEquipment.set(eq); this.selectedMountId.set(null); }
    selectMount(mount: EntityMountedEquipment): void { this.selectedMountId.set(mount.mountId); this.selectedEquipment.set(mount.equipment ?? null); }
    install(eq: Equipment, location = this.selectedLocation(), slotIndex?: number): void {
        this.change(() => this.selectMount(installConstructionEquipment(this.entity(), eq, location, slotIndex)));
    }
    clickSlot(location: string, slotIndex?: number): void {
        this.selectedLocation.set(location);
        const selected = this.selectedEquipment();
        if (selected && !this.selectedMount()) this.install(selected, location, slotIndex);
    }
    onDrop(event: { item: { data: DragEquipment }; container: { data: DropLocation } }): void {
        const data = event.item.data;
        const destination = event.container.data;
        if (!data || !destination) return;
        const equipment = this.registry.findEquipment(data.equipmentId);
        if (!equipment) return;
        this.selectedLocation.set(destination.location);
        const mount = data.mountId ? this.entity().equipment().find(item => item.mountId === data.mountId) : null;
        if (data.mountId && !mount) return;
        if (mount) this.change(() => this.selectMount(moveConstructionEquipment(this.entity(), mount, destination.location, destination.slotIndex)));
        else this.install(equipment, destination.location, destination.slotIndex);
    }
    remove(mount: EntityMountedEquipment, event?: Event): void {
        event?.stopPropagation();
        this.change(() => this.entity().removeEquipment(mount));
        this.selectedMountId.set(null);
    }
    updateMount(mount: EntityMountedEquipment, values: Partial<EntityMountedEquipmentInit>): void {
        if (values.size !== undefined) {
            if (!Number.isFinite(values.size) || values.size <= 0) return;
            this.change(() => this.selectMount(resizeConstructionEquipment(this.entity(), mount, values.size!)));
            return;
        }
        if ('shotsCount' in values && (!Number.isInteger(values.shotsCount) || values.shotsCount! < 0)) return;
        this.change(() => this.entity().updateEquipment(mounts => mounts.map(item => item.mountId === mount.mountId ? item.clone(values) : item)));
    }
    moveSelected(location: string): void {
        const mount = this.selectedMount();
        if (mount) this.change(() => this.selectMount(moveConstructionEquipment(this.entity(), mount, location)));
    }
    undo(): void { this.restoreHistory(this.undoStack, this.redoStack); }
    redo(): void { this.restoreHistory(this.redoStack, this.undoStack); }
    private restoreHistory(source: string[], destination: string[]): void {
        if (this.busy()) return;
        const previous = source.pop();
        if (previous === undefined) return;
        destination.push(encodeNativeEntity(this.entity()));
        const entity = this.customUnits.parseDraft(previous, this.entity() instanceof MekEntity ? 'mtf' : 'blk');
        entity.uuid.set(this.entity().uuid());
        this.entity.set(entity);
        this.selectedMountId.set(null);
        this.dirty.set(true);
        this.historyVersion.update(value => value + 1);
    }
    private replaceDesign(entity: BaseEntity): void {
        this.entity.set(entity);
        this.selectedLocation.set(entity.validLocations.has('RT') ? 'RT' : [...entity.validLocations][0]);
        this.selectedEquipment.set(null);
        this.selectedMountId.set(null);
        this.undoStack = []; this.redoStack = []; this.historyVersion.update(value => value + 1);
        this.dirty.set(false); this.picker.set(null); this.status.set('');
    }
    async createNew(): Promise<void> {
        if (this.busy() || !await this.allowReplace() || this.busy()) return;
        try {
            this.replaceDesign(createConstructionEntity(this.newType(), this.registry));
            this.savedUuid.set(undefined); this.originalUuid.set(undefined); this.originalName.set('New design');
        } catch (error) { this.reportError(error); }
    }
    async openUnit(unit: UnitSummary, copy = false): Promise<void> {
        if (this.busy() || !await this.allowReplace() || this.busy()) return;
        this.busy.set(true);
        try {
            const custom = unit.origin === 'user';
            const entity = custom ? await this.customUnits.load(unit.uuid) : this.customUnits.detach((await this.native.load(unit.uuid)).entity);
            this.replaceDesign(entity);
            this.savedUuid.set(custom && !copy ? unit.uuid : undefined);
            const originalUuid = unit.originalUnitUuid ?? (!custom || copy ? unit.uuid : undefined);
            this.originalUuid.set(originalUuid);
            const original = originalUuid ? this.data.getUnitByUuid(originalUuid) : undefined;
            this.originalName.set(original ? this.unitNames.name(original) : custom ? 'Custom design' : this.unitNames.name(unit));
            if (!custom || copy) { entity.model.set(`${entity.model()} Custom`.trim()); entity.mulId.set(-1); this.dirty.set(true); }
        } catch (error) { this.reportError(error); }
        finally { this.busy.set(false); }
    }
    async chooseUnit(): Promise<void> {
        if (this.busy() || this.unitPickerOpen()) return;
        this.unitPickerOpen.set(true);
        let unregister: (() => void) | undefined;
        try {
            const { UnitSearchPickerDialogComponent } = await import('../components/unit-search-picker-dialog/unit-search-picker-dialog.component');
            if (this.destroyRef.destroyed) return;
            const ref = this.dialogs.createDialog<UnitSummary>(UnitSearchPickerDialogComponent, { disableClose: true });
            unregister = this.destroyRef.onDestroy(() => ref.close());
            const selected = await firstValueFrom(ref.closed);
            if (selected && !this.destroyRef.destroyed) await this.openUnit(selected);
        } catch (error) { this.reportError(error); }
        finally { unregister?.(); this.unitPickerOpen.set(false); }
    }
    async deleteSaved(): Promise<void> {
        const uuid = this.savedUuid();
        const unit = uuid ? this.data.getUnitByUuid(uuid) : undefined;
        if (unit) await this.deleteCustom(unit);
    }
    async deleteCustom(unit: UnitSummary): Promise<void> {
        if (unit.origin !== 'user' || this.busy()) return;
        if (!await this.dialogs.requestConfirmation(`Delete ${this.unitNames.name(unit)} from this device? Export the design first if you want to keep a backup.`, 'Delete custom unit', 'danger')) return;
        this.busy.set(true);
        try {
            await this.customUnits.delete(unit.uuid);
            if (this.savedUuid() === unit.uuid) { this.savedUuid.set(undefined); this.dirty.set(true); }
            await this.data.refreshCustomUnits();
            this.statusError.set(false); this.status.set('Custom unit removed from this device and search.');
        } catch (error) { this.reportError(error); }
        finally { this.busy.set(false); }
    }
    async save(copy = false): Promise<void> {
        if (this.busy()) return;
        if (!this.entity().chassis().trim()) { this.reportError(new Error('Give the design a chassis name before saving.')); return; }
        this.busy.set(true);
        const savedVersion = this.historyVersion();
        try {
            const record = await this.customUnits.save(this.entity(), {
                uuid: copy ? undefined : this.savedUuid(), originalUnitUuid: this.originalUuid() ?? (copy ? this.savedUuid() : undefined),
            });
            this.savedUuid.set(record.uuid); this.entity().uuid.set(record.uuid);
            this.originalUuid.set(record.originalUnitUuid);
            if (savedVersion === this.historyVersion()) this.dirty.set(false);
            await this.data.refreshCustomUnits();
            this.statusError.set(false); this.status.set(this.errors().length ? 'Draft saved. Resolve the construction issues before fielding this unit.' : 'Custom unit saved and added to search.');
        } catch (error) { this.reportError(error); }
        finally { this.busy.set(false); }
    }
    exportDesign(): void {
        const entity = this.entity();
        const blob = new Blob([encodeNativeEntity(entity)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `${entity.displayName().replace(/[<>:"/\\|?*]/g, '_')}.${entity instanceof MekEntity ? 'mtf' : 'blk'}`;
        anchor.click(); URL.revokeObjectURL(url);
    }
    async importFile(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (this.busy() || !file || !await this.allowReplace() || this.busy()) return;
        this.busy.set(true);
        try {
            if (file.size > MAX_UNIT_SOURCE_BYTES) throw new Error(`Choose a native unit file no larger than ${MAX_UNIT_SOURCE_BYTES / 1024} KB.`);
            const format = file.name.toLowerCase().endsWith('.mtf') ? 'mtf' : file.name.toLowerCase().endsWith('.blk') ? 'blk' : null;
            if (!format) throw new Error('Choose an MTF or BLK unit file.');
            const entity = this.customUnits.parseDraft(await file.text(), format);
            encodeNativeEntity(entity);
            this.replaceDesign(entity);
            this.savedUuid.set(undefined); this.originalUuid.set(undefined); this.originalName.set(file.name); this.dirty.set(true);
            if (entity.loadIssues().length) { this.statusError.set(true); this.status.set(`Imported with ${entity.loadIssues().length} source diagnostics. Review validation before saving.`); }
        } catch (error) { this.reportError(error); }
        finally { this.busy.set(false); }
    }
    async canLeave(): Promise<boolean> {
        if (this.busy()) return false;
        if (!await this.allowReplace()) return false;
        this.dirty.set(false);
        return true;
    }
    async close(): Promise<void> { if (await this.canLeave()) this.dialogRef.close(); }
    private async allowReplace(): Promise<boolean> {
        return !this.dirty() || await this.dialogs.requestConfirmation('This design has unsaved changes. Discard them?', 'Unsaved construction', 'warning');
    }
    private reportError(error: unknown): void {
        this.statusError.set(true); this.status.set(error instanceof Error ? error.message : String(error));
    }
    @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
        if (this.dirty()) { event.preventDefault(); event.returnValue = ''; }
    }
    @HostListener('document:keydown', ['$event']) keydown(event: KeyboardEvent): void {
        if (this.cdkDialog.openDialogs.at(-1) !== this.dialogRef) return;
        if (this.picker()) {
            if (event.key === 'Escape') { event.stopPropagation(); this.picker.set(null); }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.save(); }
    }
}
