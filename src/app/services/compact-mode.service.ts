import { Injectable, WritableSignal, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CompactModeService {
    compactMode: WritableSignal<boolean> = signal(false);

    toggle() {
        this.compactMode.set(!this.compactMode());
    }
}