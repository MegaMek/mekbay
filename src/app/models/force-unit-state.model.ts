
import { signal } from '@angular/core';
import { ForceUnit } from './force-unit.model';
import { SerializedState } from './force-serialization';

/**
 * Base state class for ForceUnit instances.
 * Contains only common state shared between all game systems (CBT, AS)
 */
export class ForceUnitState {
    public unit: ForceUnit;
    public modified = signal(false);
    public immobile = signal(false);
    public prone = signal(false);
    public skidding = signal(false);
    public destroyed = signal(false);
    public shutdown = signal(false);
    public c3Linked = signal(false);

    constructor(unit: ForceUnit) {
        this.unit = unit;
    }

    update(data: SerializedState) {
        this.modified.set(data.modified);
        this.destroyed.set(data.destroyed);
        this.shutdown.set(data.shutdown);
        this.c3Linked.set(data.c3Linked);
    }
}

