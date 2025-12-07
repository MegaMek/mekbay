
import { Component, ChangeDetectionStrategy, computed, input, output, inject } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { Unit } from '../../models/units.model';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';
import { CdkMenuModule } from '@angular/cdk/menu';
import { UnitIconComponent } from '../unit-icon/unit-icon.component';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { ECMMode } from '../../models/common.model';
import { ASForceUnit } from '../../models/as-force-unit.model';

@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CdkMenuModule, FormatNumberPipe, FormatTonsPipe, UnitIconComponent],
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
    onToggleC3 = output<MouseEvent>();
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

    cleanedModel = computed(() => {
        const unit = this.unit();
        if (!unit || !unit.model) return '';
        return unit.model.replace(/\s*\(.*?\)\s*/g, '').trim();
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

    toggleC3Link(event: MouseEvent): void {
        event.stopPropagation();
        this.onToggleC3.emit(event);
    }

    editPilot(event: MouseEvent): void {
        event.stopPropagation();
        this.onEditPilot.emit(event);
    }
}