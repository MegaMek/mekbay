import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
    selector: 'simple-slider',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './simple-slider.component.html',
    styleUrl: './simple-slider.component.css'
})
export class SimpleSliderComponent {
    min = input(0);
    max = input(100);
    step = input(1);
    value = input(0);
    disabled = input(false);
    ariaLabel = input('Slider');

    valueChange = output<number>();

    percent = computed(() => {
        const min = this.min();
        const max = this.max();
        if (max === min) return 0;
        return this.clamp(((this.value() - min) / (max - min)) * 100, 0, 100);
    });

    onInput(event: Event): void {
        const inputElement = event.target as HTMLInputElement;
        this.valueChange.emit(Number(inputElement.value));
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
