// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { LoadForceEntry } from './load-force-entry.model';
import { ForceListSession, type ForceListPage } from './force-list-session';

function entry(id: string, time: number, local = false): LoadForceEntry {
    return new LoadForceEntry({ instanceId: id, timestamp: new Date(time).toISOString(),
        local, cloud: !local, tags: [id], groups: [] });
}

describe('ForceListSession', () => {
    it('exposes a correctly ordered complete prefix and defers older local copies until their cloud page', async () => {
        const localNew = entry('local-new', 400, true);
        const localOld = entry('shared', 50, true);
        const localTail = entry('tail', 10, true);
        const cloudNew = entry('cloud', 300);
        const cloudShared = entry('shared', 200);
        const fetch = jasmine.createSpy().and.returnValues(
            Promise.resolve({ entries: [cloudNew], next: { timestamp: 300, instanceId: 'cloud' } }),
            Promise.resolve({ entries: [cloudShared] }),
        );
        const accept = jasmine.createSpy();
        const session = new ForceListSession([localNew, localOld, localTail], fetch, accept);
        await session.loadNext();
        expect(session.getEntries()).toEqual([localNew, cloudNew]);
        expect(session.complete).toBeFalse();
        expect(accept).toHaveBeenCalledWith([cloudNew], false);
        await session.loadNext();
        expect(session.getEntries()).toEqual([localNew, cloudNew, cloudShared, localTail]);
        expect(cloudShared.local).toBeTrue();
        expect(cloudShared.cloud).toBeTrue();
        expect(session.complete).toBeTrue();
        expect(fetch.calls.allArgs()).toEqual([[undefined, 100], [{ timestamp: 300, instanceId: 'cloud' }, 100]]);
    });

    it('uses a deterministic id boundary for equal timestamps and retains the newer local winner', async () => {
        const newest = entry('newest', 400, true);
        const sameTimeBefore = entry('z', 300, true);
        const sameTimeAfter = entry('a', 300, true);
        const session = new ForceListSession([newest, sameTimeBefore, sameTimeAfter], async () => ({
            entries: [entry('newest', 200), entry('m', 300)],
            next: { timestamp: 300, instanceId: 'm' },
        }), () => {});
        await session.loadNext();
        expect(session.getEntries().map(force => force.instanceId)).toEqual(['newest', 'z', 'm']);
        expect(session.getEntries()[0]).toBe(newest);
        expect(newest.cloud).toBeFalse();
    });

    it('shares a pending scroll page with whole-account completion instead of downloading twice', async () => {
        let resolve!: (page: ForceListPage) => void;
        const fetch = jasmine.createSpy().and.returnValues(new Promise<ForceListPage>(done => { resolve = done; }),
            Promise.resolve({ entries: [entry('b', 100)] }));
        const session = new ForceListSession([], fetch, () => {});
        const scroll = session.loadNext();
        const completion = session.loadAll();
        expect(fetch).toHaveBeenCalledTimes(1);
        resolve({ entries: [entry('a', 200)], next: { timestamp: 200, instanceId: 'a' } });
        await Promise.all([scroll, completion]);
        expect(fetch.calls.allArgs()).toEqual([[undefined, 100], [{ timestamp: 200, instanceId: 'a' }, 100]]);
        expect(session.getEntries().map(force => force.instanceId)).toEqual(['a', 'b']);
    });

    it('retries failed pages without losing the cursor or accepting partial cache state', async () => {
        const fetch = jasmine.createSpy().and.returnValues(Promise.reject(new Error('offline')),
            Promise.resolve({ entries: [entry('a', 200)] }));
        const accept = jasmine.createSpy();
        const session = new ForceListSession([], fetch, accept);
        await expectAsync(session.loadNext()).toBeRejectedWithError('offline');
        expect(accept).not.toHaveBeenCalled();
        expect(session.complete).toBeFalse();
        await session.loadNext();
        expect(fetch.calls.allArgs()).toEqual([[undefined, 100], [undefined, 100]]);
        expect(session.getEntries().length).toBe(1);
    });

    it('keeps local saves visible after a first cloud failure without claiming completeness or pruning the cache', async () => {
        const local = entry('local', 100, true);
        const accept = jasmine.createSpy();
        const session = new ForceListSession([local], async () => { throw new Error('offline'); }, accept);
        await expectAsync(session.loadNext()).toBeRejectedWithError('offline');
        expect(session.getEntries()).toEqual([local]);
        expect(session.complete).toBeFalse();
        expect(accept).not.toHaveBeenCalled();
    });

    for (const next of [{ timestamp: 301, instanceId: 'a' }, { timestamp: 300, instanceId: 'm' },
        { timestamp: 300, instanceId: 'z' }]) {
        it(`rejects a non-descending cursor ${JSON.stringify(next)} without accepting its rows`, async () => {
            const cloud = entry('m', 300);
            const fetch = jasmine.createSpy().and.returnValues(
                Promise.resolve({ entries: [cloud], next: { timestamp: 300, instanceId: 'm' } }),
                Promise.resolve({ entries: [entry('bad', 200)], next }),
            );
            const session = new ForceListSession([], fetch, () => {});
            await session.loadNext();
            await expectAsync(session.loadAll()).toBeRejectedWithError('Cloud force list did not advance.');
            expect(session.getEntries()).toEqual([cloud]);
            expect(session.complete).toBeFalse();
        });
    }

    it('discards late responses and stops subsequent pages after dialog disposal', async () => {
        let resolve!: (page: ForceListPage) => void;
        const fetch = jasmine.createSpy().and.returnValue(new Promise<ForceListPage>(done => { resolve = done; }));
        const accept = jasmine.createSpy();
        const session = new ForceListSession([entry('local', 100, true)], fetch, accept);
        const completion = session.loadAll();
        session.dispose();
        resolve({ entries: [entry('cloud', 200)], next: { timestamp: 200, instanceId: 'cloud' } });
        await completion;
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(accept).not.toHaveBeenCalled();
        expect(session.getEntries()).toEqual([]);
    });

    it('stops completing a superseded query after the current page and preserves intentional deletions', async () => {
        let continueLoading = true;
        const session = new ForceListSession([], async () => {
            continueLoading = false;
            return { entries: [entry('deleted', 300), entry('kept', 200)], next: { timestamp: 200, instanceId: 'kept' } };
        }, () => {});
        session.remove('deleted');
        await session.loadAll(() => continueLoading);
        expect(session.complete).toBeFalse();
        expect(session.getEntries().map(force => force.instanceId)).toEqual(['kept']);
    });
});
