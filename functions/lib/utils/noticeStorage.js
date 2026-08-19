"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.noticeBucketName = noticeBucketName;
exports.resetBucketCheck = resetBucketCheck;
exports.deleteNoticeImage = deleteNoticeImage;
const admin = __importStar(require("firebase-admin"));
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
function noticeBucketName(env) {
    var _a, _b, _c, _d;
    const explicit = ((_a = env.NOTICE_IMAGE_BUCKET) !== null && _a !== void 0 ? _a : '').trim();
    if (explicit)
        return explicit;
    let projectId = ((_b = env.GCLOUD_PROJECT) !== null && _b !== void 0 ? _b : '').trim();
    if (!projectId) {
        try {
            projectId = String((_d = JSON.parse((_c = env.FIREBASE_CONFIG) !== null && _c !== void 0 ? _c : '{}').projectId) !== null && _d !== void 0 ? _d : '').trim();
        }
        catch (_e) {
            // Malformed FIREBASE_CONFIG. Fall through to the throw below rather
            // than deleting from a bucket whose name we guessed.
        }
    }
    if (!projectId) {
        throw new Error('[notices] cannot resolve a Storage bucket: no project id in the environment');
    }
    return `${projectId}.firebasestorage.app`;
}
let bucketCheck;
/** Exported for tests, which need each case to start from a cold instance. */
function resetBucketCheck() {
    bucketCheck = undefined;
}
async function bucketExists(bucket) {
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
async function deleteNoticeImage(imagePath) {
    if (!imagePath)
        return true;
    try {
        const bucket = admin.storage().bucket(noticeBucketName(process.env));
        if (!await bucketExists(bucket)) {
            console.error(`[notices] bucket ${bucket.name} does not exist; image kept`, imagePath);
            return false;
        }
        await bucket.file(imagePath).delete({ ignoreNotFound: true });
        return true;
    }
    catch (error) {
        // Worth a loud log: an orphaned image is invisible and costs money.
        console.error('[notices] could not delete image', imagePath, error);
        return false;
    }
}
//# sourceMappingURL=noticeStorage.js.map