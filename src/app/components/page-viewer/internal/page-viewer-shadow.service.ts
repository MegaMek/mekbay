import { Injectable } from '@angular/core';

@Injectable()
export class PageViewerShadowService {
    getShadowKey(unitIndex: number, direction: 'left' | 'right'): string {
        return `${direction}:${unitIndex}`;
    }
}
