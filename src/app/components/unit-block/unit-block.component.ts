import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, computed, input, output, inject } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { Unit } from '../../models/units.model';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { OptionsService } from '../../services/options.service';

@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CommonModule, FormatNumberPipe, FormatTonsPipe],
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
    onToggleECM = output<MouseEvent>();
    onRepairUnit = output<MouseEvent>();

    unit = computed<Unit | undefined>(() => {
        return this.forceUnit()?.getUnit();
    });

    getECMStatus = computed(() => {
        const unit = this.forceUnit();
        if (!unit) return true;
        return false;
    });

    hasECM = computed(() => {
        const unit = this.unit();
        if (!unit) return false;
        return unit.comp.some(eq => eq.eq?.flags.has('F_ECM'));
    });

    imgSrc = computed(() => {
        const unit = this.unit();
        if (!unit || !unit.icon) {
            return '/images/unknown.png';
        }
        return `https://db.mekbay.com/images/units/${unit.icon}`;
    });

    cleanedModel = computed(() => {
        const unit = this.unit();
        if (!unit || !unit.model) return '';
        return unit.model.replace(/\s*\(.*?\)\s*/g, '').trim();
    });

    clickInfo(event: MouseEvent) {
        this.onInfo.emit(event);
    }

    repairUnit(event: MouseEvent) {
        this.onRepairUnit.emit(event);
    }

    clickRemove(event: MouseEvent) {
        event.stopPropagation();
        this.onRemoveUnit.emit(event);
    }

    toggleC3Link(event: MouseEvent): void {
        event.stopPropagation();
        this.onToggleC3.emit(event);
    }

    toggleECMMode(event: MouseEvent): void {
        event.stopPropagation();
        this.onToggleECM.emit(event);
    }
}