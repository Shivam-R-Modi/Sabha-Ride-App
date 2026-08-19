import * as admin from 'firebase-admin';

/** Just enough of a Storage bucket to check and delete, so tests need no bucket. */
type BucketLike = {
    name: string;
    exists(): Promise<[boolean]>;
    file(path: string): { delete(options?: { ignoreNotFound?: boolean }): Promise<unknown> };
};

/**
 * Which bucket notice images live in, resolved explicitly rather than left to
 * the SDK default.
 *
 * `admin.storage().bucket()` with no name reads `storageBucket` out of
 * FIREBASE_CONFIG, and on a project of this vintage that value can still be the
 * legacy `<id>.appspot.com`. This project's only bucket is
 * `<id>.firebasestorage.app`; appspot.com genuinely does not exist here. Since
 * deleting from a bucket that is not there answers 404 — which `ignoreNotFound`
 * swallows — default resolution would report every deletion a success and orphan
 * the file. That is the exact thing the notice board exists to avoid.
 *
 * Pure, so the resolution rules can be tested without a bucket.
 */
export function noticeBucketName(env: NodeJS.ProcessEnv): string {
    const explicit = (env.NOTICE_IMAGE_BUCKET ?? '').trim();
    if (explicit) return explicit;

    let projectId = (env.GCLOUD_PROJECT ?? '').trim();
    if (!projectId) {
        try {
            projectId = String(JSON.parse(env.FIREBASE_CONFIG ?? '{}').projectId ?? '').trim();
        } catch {
            // Malformed FIREBASE_CONFIG. Fall through to the throw below rather
            // than deleting from a bucket whose name we guessed.
        }
    }
    if (!projectId) {
        throw new Error('[notices] cannot resolve a Storage bucket: no project id in the environment');
    }
    return `${projectId}.firebasestorage.app`;
}

let bucketCheck: Promise<boolean> | undefined;

/** Exported for tests, which need each case to start from a cold instance. */
export function resetBucketCheck(): void {
    bucketCheck = undefined;
}

async function bucketExists(bucket: BucketLike): Promise<boolean> {
    if (!bucketCheck) {
        bucketCheck = bucket.exists().then(([exists]) => exists);
        // A rejected check must not stay cached, or one network blip would refuse
        // every deletion for the rest of the instance's life.
        bucketCheck.catch(() => { bucketCheck = undefined; });
    }
    return bucketCheck;
}

/**
 * Delete a notice's image, if it has one.
 *
 * NEVER THROWS. A Storage outage must not leave an expired notice stuck on every
 * dashboard because its image could not be removed.
 *
 * Returns whether the file is gone, so a caller can log the difference between
 * "deleted" and "left behind" instead of guessing. Both callers do.
 */
export async function deleteNoticeImage(imagePath: string | undefined | null): Promise<boolean> {
    if (!imagePath) return true;
    try {
        const bucket = admin.storage().bucket(noticeBucketName(process.env)) as unknown as BucketLike;
        if (!await bucketExists(bucket)) {
            console.error(`[notices] bucket ${bucket.name} does not exist; image kept`, imagePath);
            return false;
        }
        await bucket.file(imagePath).delete({ ignoreNotFound: true });
        return true;
    } catch (error) {
        // Worth a loud log: an orphaned image is invisible and costs money.
        console.error('[notices] could not delete image', imagePath, error);
        return false;
    }
}
