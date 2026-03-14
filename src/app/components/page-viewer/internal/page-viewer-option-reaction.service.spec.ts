import { TestBed } from '@angular/core/testing';

import { PageViewerOptionReactionService } from './page-viewer-option-reaction.service';

describe('PageViewerOptionReactionService', () => {
    let service: PageViewerOptionReactionService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerOptionReactionService]
        });

        service = TestBed.inject(PageViewerOptionReactionService);
    });

    it('requests redisplay only after allow-multiple changes post-initialization', () => {
        expect(service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: false,
            viewInitialized: true,
            isSwiping: false
        })).toBeFalse();

        expect(service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: true,
            viewInitialized: true,
            isSwiping: false
        })).toBeTrue();

        expect(service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: true,
            viewInitialized: true,
            isSwiping: false
        })).toBeFalse();
    });

    it('suppresses allow-multiple redisplay while swiping or before init', () => {
        service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: false,
            viewInitialized: true,
            isSwiping: false
        });

        expect(service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: true,
            viewInitialized: false,
            isSwiping: false
        })).toBeFalse();

        expect(service.shouldRedisplayForAllowMultipleChange({
            allowMultiple: false,
            viewInitialized: true,
            isSwiping: true
        })).toBeFalse();
    });

    it('requests redisplay only when transitioning from read-only to editable', () => {
        expect(service.shouldRedisplayForReadOnlyChange({
            isReadOnly: true,
            viewInitialized: true,
            isSwiping: false
        })).toBeFalse();

        expect(service.shouldRedisplayForReadOnlyChange({
            isReadOnly: false,
            viewInitialized: true,
            isSwiping: false
        })).toBeTrue();

        expect(service.shouldRedisplayForReadOnlyChange({
            isReadOnly: false,
            viewInitialized: true,
            isSwiping: false
        })).toBeFalse();
    });

    it('suppresses read-only redisplay while swiping or before init', () => {
        service.shouldRedisplayForReadOnlyChange({
            isReadOnly: true,
            viewInitialized: true,
            isSwiping: false
        });

        expect(service.shouldRedisplayForReadOnlyChange({
            isReadOnly: false,
            viewInitialized: false,
            isSwiping: false
        })).toBeFalse();

        service.shouldRedisplayForReadOnlyChange({
            isReadOnly: true,
            viewInitialized: true,
            isSwiping: false
        });

        expect(service.shouldRedisplayForReadOnlyChange({
            isReadOnly: false,
            viewInitialized: true,
            isSwiping: true
        })).toBeFalse();
    });
});