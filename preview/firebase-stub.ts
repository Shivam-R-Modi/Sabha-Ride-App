// Stand-in for firebase/config in the visual harness. The real one calls
// initializeApp() at import time and throws without credentials.
export const auth = {} as never;
export const db = {} as never;
export const googleProvider = {} as never;
export const app = {} as never;
export const initializeMessaging = async () => null;
export const functions = {} as never;
