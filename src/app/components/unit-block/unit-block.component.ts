import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { Unit } from '../../models/units.model';
import { FormatNumberPipe } from '../../pipes/format-number.pipe';
import { FormatTonsPipe } from '../../pipes/format-tons.pipe';
import { PilotStatsPipe } from '../../pipes/pilot-stats.pipe';

@Component({
    selector: 'unit-block',
    standalone: true,
    imports: [CommonModule, FormatNumberPipe, FormatTonsPipe, PilotStatsPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './unit-block.component.html',
    styleUrls: ['./unit-block.component.scss'],
})
export class UnitBlockComponent {
    forceUnit = input<ForceUnit>();
    compactMode = input<boolean>(false);
    onInfo = output<MouseEvent>();
    onRemoveUnit = output<MouseEvent>();
    onToggleC3 = output<MouseEvent>();

    unit = computed<Unit | undefined>(() => {
        return this.forceUnit()?.getUnit();
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

    clickRemove(event: MouseEvent) {
        event.stopPropagation();
        this.onRemoveUnit.emit(event);
    }

    toggleC3Link(event: MouseEvent): void {
        event.stopPropagation();
        this.onToggleC3.emit(event);
    }
}