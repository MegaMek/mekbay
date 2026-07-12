import { ServiceWorkerUpdateScreen } from './service-worker-update-bootstrap.util';

describe('ServiceWorkerUpdateScreen', () => {
    afterEach(() => {
        document.querySelectorAll('.mekbay-bootstrap-update-screen').forEach((element) => element.remove());
    });

    it('shows the MekBay update screen with the configured logo and progress state', () => {
        const screen = new ServiceWorkerUpdateScreen(document, '/images/logo.png');

        screen.show('Installing update...', 38, true);

        const root = document.querySelector('.mekbay-bootstrap-update-screen');
        const logo = root?.querySelector<HTMLImageElement>('.mekbay-bootstrap-update-logo');
        const label = root?.querySelector('.mekbay-bootstrap-update-label');
        const bar = root?.querySelector<HTMLElement>('.mekbay-bootstrap-update-bar');

        expect(root).not.toBeNull();
        expect(logo?.getAttribute('src')).toBe('/images/logo.png');
        expect(label?.textContent).toBe('Installing update...');
        expect(bar?.style.width).toBe('38%');
        expect(bar?.classList.contains('mekbay-bootstrap-update-bar-indeterminate')).toBeTrue();

        screen.remove();

        expect(document.querySelector('.mekbay-bootstrap-update-screen')).toBeNull();
    });
});