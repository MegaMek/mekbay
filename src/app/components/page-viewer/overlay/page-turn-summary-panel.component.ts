import { ChangeDetectionStrategy, Component, computed, inject, Injector, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Overlay } from '@angular/cdk/overlay';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PageInteractionOverlayComponent } from './page-interaction-overlay.component';
import { canChangeAirborneGround, type MotiveModeOption, type MotiveModes } from '../../../models/motiveModes.model';
import { HexSliderComponent } from '../../hex-slider/hex-slider.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import type { TooltipLine } from '../../tooltip/tooltip.component';
import { calculateModifierTotal, type UnitModifierBreakdownEntry, type UnitModifierTotal } from '../../../models/rules/unit-type-rules';
import { EquipmentInteractionRegistryService, type HandlerChoice, type HandlerContext } from '../../../services/equipment-interaction-registry.service';
import { ToastService } from '../../../services/toast.service';
import { DialogsService } from '../../../services/dialogs.service';
import { DataService } from '../../../services/data.service';
import type { MountedEquipment } from '../../../models/mounted-equipment.model';
import { MascHandler } from '../../../equipment-handlers/masc.handler';
import { togglePsrWarningOverlay } from './page-psr-warning-panel.component';
import { composeTurnSummaryHeatRows, displayPsrModifiers } from './page-turn-summary.util';
import { orderedModifierTooltipLines } from '../../../utils/hit-target-tooltip.util';

interface EquipmentTrackControlRow {
    entry: MountedEquipment;
    label: string;
    damaged: boolean;
    sequenceChoices: HandlerChoice[];
    statusChoice?: HandlerChoice;
}

@Component({
    selector: 'page-turn-summary-panel',
    imports: [CommonModule, HexSliderComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-turn-summary-panel.component.html',
    styleUrl: './page-turn-summary-panel.component.scss'
})
export class PageTurnSummaryPanelComponent {
    private readonly overlayManager = inject(OverlayManagerService);
    private readonly injector = inject(Injector);
    private readonly overlay = inject(Overlay);
    private readonly parent = inject(PageInteractionOverlayComponent);
    private readonly equipmentRegistry = inject(EquipmentInteractionRegistryService).getRegistry();
    private readonly toastService = inject(ToastService);
    private readonly dialogsService = inject(DialogsService);
    private readonly dataService = inject(DataService);
    readonly unit = this.parent.unit;
    readonly force = this.parent.force;
    readonly endTurnForAllButtonVisible = input<boolean>(false);
    readonly endTurnForAllClicked = output<void>();

    private handlerContext(): HandlerContext {
        return {
            toastService: this.toastService,
            dialogsService: this.dialogsService,
            dataService: this.dataService,
            choiceSurface: 'turn-summary',
        };
    }

    endTurnForAll(event: MouseEvent): void {
        event.stopPropagation();
        this.endTurnForAllClicked.emit();
    }

    readonly dirty = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().dirty();
    });

    readonly damageReceived = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().dmgReceived();
    });

    readonly hasPSRChecks = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().PSRRollsCount() > 0;
    });

    readonly falling = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().autoFall();
    });

    readonly PSRChecksCount = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().PSRRollsCount();
    });

    readonly controlRollShortLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'PSR';
        return unit.rules.controlRollShortLabel;
    });

    readonly controlRollFullLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return 'Piloting Skill Rolls';
        return unit.rules.controlRollFullLabel;
    });

    readonly currentMoveMode = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        return unit.turnState().moveMode();
    });

    moveModeModifierLabel(mode: MotiveModes): string | null {
        const unit = this.unit();
        const modifier = unit?.rules.getAttackMovementModifier(mode, unit.turnState().airborne() ?? false) ?? 0;
        if (modifier === 0) return null;
        return modifier > 0 ? `+${modifier}` : `${modifier}`;
    }

    readonly getTotalTargetModifierAsDefender = computed(() => {
        const unit = this.unit();
        return this.formatModifierTotal(unit
            ? unit.turnState().getTotalTargetModifierAsDefender()
            : { modifier: 0 });
    });

    readonly defenseTargetModifierTooltip = computed<TooltipLine[] | null>(() => {
        const unit = this.unit();
        if (!unit) return null;
        return this.buildModifierTooltip('Defense Target Modifier', unit.turnState().getDefenseModifierBreakdown());
    });

    readonly spotting = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().spotting();
    });

    readonly spottingModifierLabel = computed(() => {
        const unit = this.unit();
        if (!unit) return null;
        return this.formatModifier(unit.rules.getSpottingModifier());
    });

    readonly tracksHeat = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.getUnit().heat >= 0;
    });

    readonly heatRows = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return composeTurnSummaryHeatRows(unit.turnState().heatSources(), unit.selectedInventoryWeaponHeat());
    });

    readonly psrModifiers = computed(() => {
        const unit = this.unit();
        if (!unit) return [];
        return displayPsrModifiers(unit.PSRModifiers().modifiers);
    });

    readonly equipmentTrackControlRows = computed<EquipmentTrackControlRow[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.getInventory()
            .filter(entry => entry.equipment?.flags?.has('F_MASC'))
            .map(entry => {
                const active = entry.equipment?.flags?.has('F_MASC') ? MascHandler.isActive(entry) : true;
                const damaged = entry.resolvedDestroyed();
                const choices = this.equipmentRegistry.getChoices(entry, this.handlerContext());
                return {
                    entry,
                    label: entry.equipment?.name || entry.name,
                    damaged,
                    active,
                    sequenceChoices: choices.filter(choice => typeof choice.value === 'number'),
                    statusChoice: choices.find(choice => typeof choice.value !== 'number'),
                };
            })
            .filter(row => !row.damaged || row.active)
            .filter(row => row.sequenceChoices.length > 0);
    });

    close(): void {
        const unitId = this.unit()?.id;
        this.overlayManager.closeManagedOverlay(`turnSummary-${unitId}`);
    }

    endTurn(): void {
        this.unit()?.endTurn();
    }

    openPsrWarning(event: MouseEvent): void {
        event.stopPropagation();
        togglePsrWarningOverlay(this.parent, this.overlayManager, this.injector, this.overlay);
    }

    readonly airborne = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().airborne();
    });

    readonly canSwitchAirborneMode = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return canChangeAirborneGround(unit.getUnit());
    });

    setAirborne(airborne: boolean): void {
        const unit = this.unit();
        if (!unit) return;
        const turnState = unit.turnState();
        const currentAirborne = turnState.airborne();
        turnState.airborne.set(currentAirborne === airborne ? null : airborne);
        turnState.moveMode.set(null);
        turnState.moveDistance.set(null);
        turnState.applyMovePSR.set(true);
    }

    readonly moveModes = computed<MotiveModeOption[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        return unit.getAvailableMotiveModes(unit.turnState().airborne() ?? false);
    });

    selectMove(mode: MotiveModes): void {
        const unit = this.unit();
        if (!unit) return;
        const turnState = unit.turnState();
        const current = turnState.moveMode();
        if (current === mode) {
            turnState.moveMode.set(null);
            turnState.moveDistance.set(null);
        } else {
            turnState.moveMode.set(mode);
            turnState.moveDistance.set(mode === 'stationary' ? null : turnState.minDistanceCurrentMoveMode());
        }
        turnState.applyMovePSR.set(true);
    }

    toggleSpotting(): void {
        const unit = this.unit();
        if (!unit) return;
        const turnState = unit.turnState();
        turnState.spotting.set(!turnState.spotting());
    }

    async handleEquipmentTrackChoice(row: EquipmentTrackControlRow, choice: HandlerChoice): Promise<void> {
        if (choice.disabled) return;
        await this.equipmentRegistry.handleSelection(row.entry, choice, this.handlerContext());
        this.unit()?.inventoryControl.markInventoryViewChanged();
    }

    readonly overDistance = computed<boolean>(() => {
        const unit = this.unit();
        if (!unit) return false;
        const turnState = unit.turnState();
        turnState.airborne();
        turnState.moveMode();
        const moveDistance = this.moveDistance();
        const minDistance = turnState.minDistanceCurrentMoveMode();
        const maxDistance = turnState.maxDistanceCurrentMoveMode();
        if (moveDistance === null) return false;
        return moveDistance < minDistance || moveDistance > maxDistance;
    });

    readonly moveDistance = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        return unit.turnState().moveDistance() || 0;
    });

    readonly moveMax = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        const baseUnit = unit.getUnit();
        if (!baseUnit) return 0;
        const mode = unit.turnState().moveMode();
        if (!mode) return 0;
        return unit.turnState().maxDistanceCurrentMoveMode();
    });

    readonly moveMin = computed(() => {
        const unit = this.unit();
        if (!unit) return 0;
        const mode = unit.turnState().moveMode();
        if (!mode) return 0;
        return Math.min(unit.turnState().minDistanceCurrentMoveMode(), this.moveMax());
    });

    readonly moveDistanceTicks = computed(() => {
        const max = this.moveMax();
        const length = Math.max(0, max + 1);
        return Array.from({ length }, (_value, index) => index);
    });

    readonly hasMoveDistance = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.turnState().moveDistance() !== null;
    });

    setMoveDistance(value: number, markModified = true): void {
        const unit = this.unit();
        if (!unit) return;
        const min = this.moveMin();
        const max = this.moveMax();
        unit.turnState().setMoveDistance(Math.max(min, Math.min(max, value)), { markModified });
    }

    commitMoveDistance(value: number): void {
        const unit = this.unit();
        if (!unit) return;
        this.setMoveDistance(value, false);
        unit.turnState().markModified();
    }

    private buildModifierTooltip(title: string, entries: UnitModifierBreakdownEntry[]): TooltipLine[] {
        const total = calculateModifierTotal(entries);
        const modifierLines = orderedModifierTooltipLines(entries, entry => this.formatModifierTotal(entry));
        return [
            { value: title, isHeader: true },
            ...(entries.length > 0
                ? modifierLines
                : [{ label: 'No active modifiers', value: '+0' }]),
            { isBreak: true },
            { label: 'Total', value: this.formatModifierTotal(total) },
        ];
    }

    private formatModifierTotal(total: UnitModifierTotal): string {
        const value = this.formatModifier(total.modifier);
        const alternateModifierLabel = total.alternateModifierLabel ? ` ${total.alternateModifierLabel}` : '';
        return total.alternateModifier !== undefined && total.alternateModifier !== total.modifier
            ? `${value} (${this.formatModifier(total.alternateModifier)}${alternateModifierLabel})`
            : value;
    }

    private formatModifier(value: number): string {
        return value >= 0 ? `+${value}` : `${value}`;
    }
}
