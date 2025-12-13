
import { Component, ChangeDetectionStrategy, computed, input, output, inject } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { Unit } from '../../models/units.model';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';
import { CdkMenuModule } from '@angular/cdk/menu';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { TooltipDirective } from '../../directives/tooltip.directive';
import { TooltipLine } from '../tooltip/tooltip.component';
import { ECMMode } from '../../models/common.model';
import { ASForceUnit } from '../../models/as-force-unit.model';
import { C3NetworkUtil } from '../../utils/c3-network.util';
import { C3Component, C3Role } from '../../models/c3-network.model';

@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CdkMenuModule, FormatNumberPipe, FormatTonsPipe, UnitIconComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-block.component.html',
    styleUrls: ['./unit-block.component.scss'],
})
export class UnitBlockComponent {
    optionsService = inject(OptionsService);
    forceUnit = input<ForceUnit>();
    compactMode = input<boolean>(false);
    onInfo = output<MouseEvent>();
    onRemoveUnit = output<MouseEvent>();
    onOpenC3Network = output<MouseEvent>();
    onRepairUnit = output<MouseEvent>();
    onEditPilot = output<MouseEvent>();

    unit = computed<Unit | undefined>(() => {
        return this.forceUnit()?.getUnit();
    });

    dirty = computed<boolean>(() => {
        if (!this.optionsService.options().useAutomations) {
            return false;
        }
        const unit = this.forceUnit();
        if (!unit) return false;
        if (unit instanceof ASForceUnit) {
            return false;
        } else
        if (unit instanceof CBTForceUnit) {
            return unit.turnState().dirty();
        }
        return false;
    });

    unitPhase = computed<string>(() => {
        const unit = this.forceUnit();
        if (!unit) return '';
        if (unit instanceof ASForceUnit) {
            return '';
        } else
        if (unit instanceof CBTForceUnit) {
            const phase = unit.turnState().currentPhase();
            return phase || '';
        }
        return '';
    });

    hasPendingEffects = computed<boolean>(() => {
        if (!this.optionsService.options().useAutomations) {
            return false;
        }
        const unit = this.forceUnit();
        if (!unit) return false;
        if (unit instanceof ASForceUnit) {
            return false;
        } else
        if (unit instanceof CBTForceUnit) {
            return unit.turnState().dirtyPhase();
        }
        return false;
    });

    getECMStatus = computed(() => {
        const unit = this.forceUnit();
        if (!unit) return true;
        return false;
    });

    hasECM = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        const hasECM = unit.comp.some(eq => eq.eq?.flags.has('F_ECM'));
        return hasECM;
    });

    getECMMode = computed<ECMMode | undefined>(() => {
        const forceUnit = this.forceUnit();
        if (!forceUnit) return undefined;
        if (forceUnit instanceof ASForceUnit) {
            return ECMMode.ECM;
        } else 
        if (forceUnit instanceof CBTForceUnit) {
            const mountedECM = forceUnit.getInventory().find(eq => eq.equipment?.flags.has('F_ECM'));
            return mountedECM ? mountedECM.states?.get('ecm_mode') as ECMMode || undefined : undefined;
        }
        return undefined;
    });

    /** Check if unit has any C3 equipment using the new flag-based detection */
    hasC3 = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return C3NetworkUtil.hasC3(unit);
    });

    /** Get the C3 components for this unit */
    c3Components = computed<C3Component[]>(() => {
        const unit = this.unit();
        if (!unit) return [];
        return C3NetworkUtil.getC3Components(unit);
    });

    /** Get a display label for the C3 equipment */
    c3Label = computed<string>(() => {
        const components = this.c3Components();
        if (components.length === 0) return '';
        
        // Get unique network types
        const types = [...new Set(components.map(c => C3NetworkUtil.getNetworkTypeName(c.networkType)))];
        return types.join(', ');
    });

    cleanedModel = computed(() => {
        const unit = this.unit();
        if (!unit || !unit.model) return '';
        return unit.model.replace(/\s*\(.*?\)\s*/g, '').trim();
    });

    bvTooltip = computed<TooltipLine[] | null>(() => {
        const forceUnit = this.forceUnit();
        const unit = this.unit();
        if (!forceUnit || !unit) return null;
        if (!(forceUnit instanceof CBTForceUnit)) return null;

        const baseBv = unit.bv;
        const totalBv = forceUnit.getBv();
        if (baseBv === totalBv) return null; // No adjustments
        const pilotAdjustedBv = forceUnit.baseBvPilotAdjusted();
        const pilotDiff = pilotAdjustedBv - baseBv;
        const c3Tax = forceUnit.c3Tax();

        const lines: TooltipLine[] = [];
        if (baseBv > 0) {
            lines.push({ label: 'Base:', value: `${baseBv}` });
        }
        if (pilotDiff !== 0) {
            const sign = pilotDiff > 0 ? '+' : '';
            lines.push({ label: 'Pilot:', value: `${sign}${pilotDiff}` });
        }
        if (c3Tax > 0) {
            lines.push({ label: 'C3:', value: `+${c3Tax}` });
        }
        if (c3Tax > 0) {
            lines.push({ label: 'Total:', value: `=${totalBv}` });
        }

        return lines.length > 0 ? lines : null;
    });

    clickInfo(event: MouseEvent): void {
        event.stopPropagation();
        this.onInfo.emit(event);
    }

    repairUnit(event: MouseEvent): void {
        event.stopPropagation();
        this.onRepairUnit.emit(event);
    }

    clickRemove(event: MouseEvent): void {
        event.stopPropagation();
        this.onRemoveUnit.emit(event);
    }

    openC3Network(event: MouseEvent): void {
        event.stopPropagation();
        this.onOpenC3Network.emit(event);
    }

    editPilot(event: MouseEvent): void {
        event.stopPropagation();
        this.onEditPilot.emit(event);
    }
}