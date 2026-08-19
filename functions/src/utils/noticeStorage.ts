import * as admin from 'firebase-admin';

/**
 * Delete a notice's image, if it has one.
 *
 * NEVER THROWS. Two reasons, and they pull the same way:
 *
 *  - Cloud Storage is not provisioned on this project yet, so every call fails
 *    until someone enables it in the console. A notice must still be deletable.
 *  - Even once it is provisioned, a Storage outage must not leave an expired
 *    notice stuck on every dashboard because its image could not be removed.
 *
 * Returns whether the file is gone, so a caller can log the difference between
 * "deleted" and "left behind" instead of guessing.
 */
export async function deleteNoticeImage(imagePath: string | undefined | null): Promise<boolean> {
    if (!imagePath) return true;
    try {
        await admin.storage().bucket().file(imagePath).delete({ ignoreNotFound: true });
        return true;
    } catch (error) {
        // Worth a loud log: an orphaned image is invisible and costs money.
        console.error('[notices] could not delete image', imagePath, error);
        return false;
    }
}
