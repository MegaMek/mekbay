import { withServiceWorkerBypass } from './service-worker-bypass.util';

describe('withServiceWorkerBypass', () => {
    it('adds the Angular service-worker bypass to an absolute remote URL', () => {
        expect(withServiceWorkerBypass('https://db.mekbay.com/eras.json'))
            .toBe('https://db.mekbay.com/eras.json?ngsw-bypass=true');
    });

    it('appends the bypass after existing query parameters', () => {
        expect(withServiceWorkerBypass('https://db.mekbay.com/eras.json?version=2'))
            .toBe('https://db.mekbay.com/eras.json?version=2&ngsw-bypass=true');
    });

    it('leaves same-origin relative assets unchanged', () => {
        expect(withServiceWorkerBypass('assets/sourcebooks.json'))
            .toBe('assets/sourcebooks.json');
        expect(withServiceWorkerBypass('/assets/sourcebooks.json'))
            .toBe('/assets/sourcebooks.json');
    });
});
