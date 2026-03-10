
import { signal, type computed } from '@angular/core';
import type { ForceUnit } from './force-unit.model';
import type { SerializedState, C3_POSITION_SCHEMA } from './force-serialization';
import type { Sanitizer } from '../utils/sanitizer.util';

/**
 * Base state class for ForceUnit instances.
 * Contains only common state shared between all game systems (CBT, AS)
 */
export abstract class ForceUnitState {
    public unit: ForceUnit;
    public modified = signal(false);
    public immobile = signal(false);
    public prone = signal(false);
    public skidding = signal(false);
    public destroyed = signal(false);
    public shutdown = signal(false);
    public c3Position = signal<{ x: number; y: number } | null>(null);

    constructor(unit: ForceUnit) {
        this.unit = unit;
    }

    abstract update(data: SerializedState): void;
}
