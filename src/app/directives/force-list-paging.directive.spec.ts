// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ForceListPagingDirective } from './force-list-paging.directive';

@Component({
    imports: [ForceListPagingDirective, ScrollingModule],
    template: `@if (virtual()) {
        <cdk-virtual-scroll-viewport style="width: 300px" [style.height.px]="height()" [itemSize]="50"
            [forceListPaging]="visible() && !pending() && !complete() && !error()" (forceListLoadMore)="loadMore()">
            <div *cdkVirtualFor="let id of available()" style="height: 50px">Force {{ id }}</div>
        </cdk-virtual-scroll-viewport>
    } @else {
    <div style="overflow: auto; width: 300px" [style.height.px]="height()"
        [forceListPaging]="visible() && !pending() && !complete() && !error()" (forceListLoadMore)="loadMore()">
        @for (id of available(); track id) { <div style="height: 50px">Force {{ id }}</div> }
    </div> }`,
})
class PagingHost {
    readonly height = signal(500);
    readonly virtual = signal(false);
    readonly visible = signal(true);
    readonly pending = signal(false);
    readonly complete = signal(false);
    readonly error = signal(false);
    readonly loaded = signal<number[]>([]);
    readonly deployed = signal(new Set<number>());
    readonly available = computed(() => this.loaded().filter(id => !this.deployed().has(id)));
    total = 100;
    requests = 0;
    failNext = false;
    async loadMore(): Promise<void> {
        if (this.pending()) throw new Error('Overlapping page request');
        this.pending.set(true);
        this.requests++;
        await Promise.resolve();
        if (this.failNext) {
            this.error.set(true);
        } else {
            const start = this.loaded().length;
            this.loaded.update(ids => [...ids, ...Array.from({ length: Math.min(20, this.total - start) }, (_, i) => start + i)]);
            this.complete.set(this.loaded().length === this.total);
        }
        this.pending.set(false);
    }
}

describe('ForceListPagingDirective', () => {
    beforeEach(() => TestBed.configureTestingModule({
        imports: [PagingHost], providers: [provideZonelessChangeDetection()],
    }));

    it('fills a tall viewport through sequential pages without a scroll event', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        fixture.componentInstance.height.set(2200);
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(3);
        expect(fixture.componentInstance.loaded().length).toBe(60);
    });

    it('loads beyond a first page with 19 of its 20 forces already deployed', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        fixture.componentInstance.deployed.set(new Set(Array.from({ length: 19 }, (_, i) => i)));
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(2);
        expect(fixture.componentInstance.available().length).toBe(21);
    });

    it('fills a real CDK virtual viewport when a page is shorter than the visible area', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        fixture.componentInstance.virtual.set(true);
        fixture.componentInstance.height.set(2200);
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(3);
        expect(fixture.componentInstance.loaded().length).toBe(60);
    });

    it('responds to an external viewport resize and releases its observer on destruction', async () => {
        const disconnect = spyOn(ResizeObserver.prototype, 'disconnect').and.callThrough();
        const fixture = TestBed.createComponent(PagingHost);
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(1);
        const viewport = fixture.nativeElement.firstElementChild as HTMLElement;
        viewport.style.height = '2200px';
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(3);
        fixture.destroy();
        expect(disconnect).toHaveBeenCalled();
    });

    it('continues through wholly excluded pages, then stops when all cloud entries are exhausted', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        fixture.componentInstance.total = 45;
        fixture.componentInstance.deployed.set(new Set(Array.from({ length: 45 }, (_, i) => i)));
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(3);
        expect(fixture.componentInstance.available()).toEqual([]);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(3);
    });

    it('fills again after deploying visible entries and after increasing viewport height', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(1);
        fixture.componentInstance.deployed.set(new Set(Array.from({ length: 19 }, (_, i) => i)));
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(2);
        fixture.componentInstance.height.set(2200);
        await fixture.whenStable();
        expect(fixture.componentInstance.requests).toBe(4);
    });

    it('loads near the scroll end and pauses when hidden or after a failure until retry', async () => {
        const fixture = TestBed.createComponent(PagingHost);
        const host = fixture.componentInstance;
        host.visible.set(false);
        await fixture.whenStable();
        expect(host.requests).toBe(0);
        host.visible.set(true);
        await fixture.whenStable();
        const viewport = fixture.nativeElement.firstElementChild as HTMLElement;
        host.failNext = true;
        viewport.scrollTop = 500;
        viewport.dispatchEvent(new Event('scroll'));
        await fixture.whenStable();
        expect(host.requests).toBe(2);
        fixture.detectChanges();
        viewport.dispatchEvent(new Event('scroll'));
        await fixture.whenStable();
        expect(host.requests).toBe(2);
        host.failNext = false;
        host.error.set(false);
        await fixture.whenStable();
        expect(host.requests).toBe(3);
    });
});
