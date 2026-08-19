import { storage } from '../../firebase/config';

/** Mirrors the ceiling in storage.rules. Checked here only for a decent message. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Pure, so the rules can be tested without a browser or a bucket. */
export function describeImageProblem(file: { size: number; type: string }): string | null {
    if (!file.type.startsWith('image/')) return 'That file is not an image.';
    if (file.size >= MAX_IMAGE_BYTES) {
        return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please keep it under 3 MB.`;
    }
    return null;
}

/** A folder per upload, so one notice's image can be deleted without touching another. */
export function imagePathFor(fileName: string): string {
    // Runs of dots collapse to one. Storage object names are literal strings, so
    // `..` is not traversal there — but this path is sent to the server and used
    // to DELETE an object later, and a name that reads like traversal is not
    // worth having in that position.
    const safe = fileName
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\.{2,}/g, '.')
        .slice(-60);
    const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    return `notices/${id}/${safe}`;
}

/**
 * Upload a notice image and return both halves of the pair.
 *
 * The PATH matters as much as the URL: `publishNotice` refuses one without the
 * other, because a URL alone cannot be deleted and that is how a bucket fills up
 * with files nobody can account for.
 */
export async function uploadNoticeImage(file: File): Promise<{ imagePath: string; imageUrl: string }> {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const imagePath = imagePathFor(file.name);
    const target = ref(await storage(), imagePath);
    await uploadBytes(target, file, { contentType: file.type });
    return { imagePath, imageUrl: await getDownloadURL(target) };
}
