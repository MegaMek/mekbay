import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
    selector: 'mode-switch',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './mode-switch.component.html',
    styleUrls: ['./mode-switch.component.scss'],
    host: {
        '[class.mode-switch-active-right]': 'selectedRight()',
        '[class.mode-switch-game-system]': 'variant() === "game-system"',
        '[class.mode-switch-disabled]': 'disabled()',
        '[class.mode-switch-no-labels]': '!showLabels()',
    },
})
export class ModeSwitchComponent {
    readonly leftLabel = input<string>('');
    readonly rightLabel = input<string>('');
    readonly selectedRight = input<boolean>(false);
    readonly disabled = input<boolean>(false);
    readonly showLabels = input<boolean>(true);
    readonly ariaLabel = input<string>('Toggle mode');
    readonly variant = input<'component-view' | 'game-system'>('component-view');
    readonly switchAriaLabel = input<string>('Toggle mode');
    readonly selectedRightChange = output<boolean>();

    selectRight(selectedRight: boolean): void {
        if (this.disabled() || this.selectedRight() === selectedRight) {
            return;
        }

        this.selectedRightChange.emit(selectedRight);
    }

    toggle(): void {
        this.selectRight(!this.selectedRight());
    }
}
