/**
 * Deleting notice images, and the bucket they get deleted from.
 *
 * This module was mocked in every other suite, which meant the one decision that
 * governs whether Storage ever actually gets cleaned up — WHICH bucket — had no
 * test at all. It matters here specifically: this project's only bucket is
 * `sabha-ride-app.firebasestorage.app`, and `sabha-ride-app.appspot.com` does not
 * exist. Deleting from a bucket that is not there answers 404, `ignoreNotFound`
 * swallows 404, and the caller is told the image is gone. Silent orphaning, which
 * is the failure this feature was asked for to prevent.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

let bucketArg: string | undefined;
let bucketExistsResult: (() => Promise<[boolean]>) | undefined;
let deletedPaths: string[];

vi.mock('firebase-admin', () => ({
    storage: () => ({
        bucket: (name?: string) => {
            bucketArg = name;
            return {
                name: name ?? '(default)',
                exists: () => (bucketExistsResult ?? (async () => [true] as [boolean]))(),
                file: (path: string) => ({
                    delete: async () => { deletedPaths.push(path); },
                }),
            };
        },
    }),
}));

import { deleteNoticeImage, noticeBucketName, resetBucketCheck } from './noticeStorage';

beforeEach(() => {
    bucketArg = undefined;
    bucketExistsResult = undefined;
    deletedPaths = [];
    resetBucketCheck();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

describe('noticeBucketName', () => {
    it('builds the firebasestorage.app name from the project id', () => {
        // NOT appspot.com. That bucket does not exist on this project, and naming
        // it is the difference between deleting an image and pretending to.
        expect(noticeBucketName({ GCLOUD_PROJECT: 'sabha-ride-app' } as NodeJS.ProcessEnv))
            .toBe('sabha-ride-app.firebasestorage.app');
    });

    it('falls back to the project id inside FIREBASE_CONFIG', () => {
        expect(noticeBucketName({
            FIREBASE_CONFIG: JSON.stringify({ projectId: 'sabha-ride-app' }),
        } as NodeJS.ProcessEnv)).toBe('sabha-ride-app.firebasestorage.app');
    });

    it('ignores the storageBucket in FIREBASE_CONFIG', () => {
        // The runtime can still template that field as the legacy appspot name.
        // Trusting it is the whole bug.
        expect(noticeBucketName({
            GCLOUD_PROJECT: 'sabha-ride-app',
            FIREBASE_CONFIG: JSON.stringify({ storageBucket: 'sabha-ride-app.appspot.com' }),
        } as NodeJS.ProcessEnv)).toBe('sabha-ride-app.firebasestorage.app');
    });

    it('lets an explicit override win, for a future second bucket', () => {
        expect(noticeBucketName({
            NOTICE_IMAGE_BUCKET: 'somewhere-else',
            GCLOUD_PROJECT: 'sabha-ride-app',
        } as NodeJS.ProcessEnv)).toBe('somewhere-else');
    });

    it('throws rather than guess when there is no project id', () => {
        expect(() => noticeBucketName({} as NodeJS.ProcessEnv)).toThrow(/cannot resolve a Storage bucket/);
    });

    it('throws rather than guess when FIREBASE_CONFIG is malformed', () => {
        expect(() => noticeBucketName({ FIREBASE_CONFIG: 'not json' } as NodeJS.ProcessEnv))
            .toThrow(/cannot resolve a Storage bucket/);
    });
});

describe('deleteNoticeImage', () => {
    const env = { GCLOUD_PROJECT: 'sabha-ride-app' };

    beforeEach(() => { Object.assign(process.env, env); });

    it('deletes from the named bucket, never the SDK default', async () => {
        expect(await deleteNoticeImage('notices/abc/flyer.jpg')).toBe(true);
        expect(bucketArg).toBe('sabha-ride-app.firebasestorage.app');
        expect(deletedPaths).toEqual(['notices/abc/flyer.jpg']);
    });

    it('reports failure, and deletes nothing, when the bucket is missing', async () => {
        bucketExistsResult = async () => [false];
        expect(await deleteNoticeImage('notices/abc/flyer.jpg')).toBe(false);
        expect(deletedPaths).toEqual([]);
    });

    it('treats a notice with no image as already clean', async () => {
        expect(await deleteNoticeImage(null)).toBe(true);
        expect(await deleteNoticeImage(undefined)).toBe(true);
        expect(await deleteNoticeImage('')).toBe(true);
        expect(deletedPaths).toEqual([]);
    });

    it('reports failure instead of throwing when Storage errors', async () => {
        bucketExistsResult = async () => { throw new Error('network'); };
        expect(await deleteNoticeImage('notices/abc/flyer.jpg')).toBe(false);
    });

    it('retries after a failed check rather than caching the failure', async () => {
        // One blip must not refuse every deletion for the life of the instance.
        let calls = 0;
        bucketExistsResult = async () => {
            calls += 1;
            if (calls === 1) throw new Error('network');
            return [true];
        };
        expect(await deleteNoticeImage('notices/abc/one.jpg')).toBe(false);
        expect(await deleteNoticeImage('notices/abc/two.jpg')).toBe(true);
        expect(deletedPaths).toEqual(['notices/abc/two.jpg']);
    });

    it('checks the bucket once per instance, not once per image', async () => {
        let calls = 0;
        bucketExistsResult = async () => { calls += 1; return [true]; };
        await deleteNoticeImage('notices/a/1.jpg');
        await deleteNoticeImage('notices/b/2.jpg');
        expect(calls).toBe(1);
    });
});
