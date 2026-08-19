/**
 * Image checks in the composer.
 *
 * These exist for the MESSAGE, not the safety — `storage.rules` enforces the same
 * size and type, because a client is a trust boundary even when it belongs to a
 * manager. What this buys is "that image is 4.2 MB, keep it under 3" instead of a
 * raw permission error after a slow upload on a phone.
 */

import { describe, it, expect } from 'vitest';
import { describeImageProblem, imagePathFor, MAX_IMAGE_BYTES } from '../../src/utils/noticeImage';

describe('describeImageProblem', () => {
    it('accepts a normal photo', () => {
        expect(describeImageProblem({ size: 900_000, type: 'image/jpeg' })).toBeNull();
    });

    it('refuses something that is not an image', () => {
        expect(describeImageProblem({ size: 100, type: 'application/pdf' })).toMatch(/not an image/i);
    });

    it('refuses one that is too big, and says how big', () => {
        // A number the person can act on beats "upload failed".
        const problem = describeImageProblem({ size: 4.2 * 1024 * 1024, type: 'image/png' });
        expect(problem).toMatch(/4\.2 MB/);
        expect(problem).toMatch(/under 3 MB/);
    });

    it('agrees with the ceiling in storage.rules', () => {
        expect(MAX_IMAGE_BYTES).toBe(3 * 1024 * 1024);
        expect(describeImageProblem({ size: MAX_IMAGE_BYTES - 1, type: 'image/jpeg' })).toBeNull();
        expect(describeImageProblem({ size: MAX_IMAGE_BYTES, type: 'image/jpeg' })).not.toBeNull();
    });
});

describe('imagePathFor', () => {
    it('always lands inside notices/, which publishNotice requires', () => {
        expect(imagePathFor('flyer.jpg').startsWith('notices/')).toBe(true);
    });

    it('strips characters that would break a Storage path', () => {
        const path = imagePathFor('my photo (1)/../secret.png');
        expect(path).not.toMatch(/\.\./);
        expect(path.split('/')).toHaveLength(3);
    });

    it('gives each upload its own folder, so deleting one cannot hit another', () => {
        expect(imagePathFor('a.jpg')).not.toBe(imagePathFor('a.jpg'));
    });
});
