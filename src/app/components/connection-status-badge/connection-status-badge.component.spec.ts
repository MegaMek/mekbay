import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConnectionStatusBadgeComponent } from './connection-status-badge.component';
import { LayoutService } from '../../services/layout.service';
import { WsService, type ConnectionStatusPhase } from '../../services/ws.service';

describe('ConnectionStatusBadgeComponent', () => {
    const connectionStatusPhase = signal<ConnectionStatusPhase>('hidden');
    const isMenuOpen = signal(false);

    beforeEach(() => {
        TestBed.resetTestingModule();
        connectionStatusPhase.set('hidden');
        isMenuOpen.set(false);

        TestBed.configureTestingModule({
            imports: [ConnectionStatusBadgeComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: WsService,
                    useValue: {
                        connectionStatusPhase,
                    },
                },
                {
                    provide: LayoutService,
                    useValue: {
                        isMenuOpen,
                    },
                },
            ],
        });
    });

    it('renders nothing while the status is hidden', () => {
        const fixture = TestBed.createComponent(ConnectionStatusBadgeComponent);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent.trim()).toBe('');
    });

    it('renders the offline label with the cloud-slash icon', () => {
        connectionStatusPhase.set('offline');
        const fixture = TestBed.createComponent(ConnectionStatusBadgeComponent);
        fixture.componentRef.setInput('placement', 'home');
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const icon = element.querySelector('svg.connection-status-icon');
        const label = element.querySelector('.connection-status-badge');

        expect(label?.textContent?.trim()).toBe('OFFLINE MODE');
        expect(icon?.getAttribute('viewBox')).toBe('0 0 16 16');
        expect(icon?.querySelector('path')).not.toBeNull();
    });

    it('renders the short sidebar label when the sidebar is closed', () => {
        connectionStatusPhase.set('offline');
        isMenuOpen.set(false);
        const fixture = TestBed.createComponent(ConnectionStatusBadgeComponent);
        fixture.componentRef.setInput('placement', 'sidebar');
        fixture.detectChanges();

        const label = fixture.nativeElement.querySelector('.connection-status-badge');

        expect(label?.textContent?.trim()).toBe('OFFLINE');
    });

    it('renders the full sidebar label when the sidebar is open', () => {
        connectionStatusPhase.set('online');
        isMenuOpen.set(true);
        const fixture = TestBed.createComponent(ConnectionStatusBadgeComponent);
        fixture.componentRef.setInput('placement', 'sidebar');
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const icon = element.querySelector('.connection-status-icon');
        const label = element.querySelector('.connection-status-badge');

        expect(label?.textContent?.trim()).toBe('SYSTEM ONLINE');
        expect(icon).toBeNull();
    });
});