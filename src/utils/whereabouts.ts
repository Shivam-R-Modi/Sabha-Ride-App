/**
 * Which side of the world is this device on, and therefore which service to offer first.
 *
 * FROM THE DEVICE TIMEZONE, NOT FROM GEOLOCATION, and that is the whole point. The
 * browser's location API would answer the same question, but it costs a PERMISSION
 * PROMPT at sign-up — before the app has been any use, which is how a permission gets
 * refused permanently. And this app already spends that prompt later, where the value is
 * obvious: `RiderHome` asks when a rider says they are ready, and the driver's active
 * ride watches position. A denial at sign-up is sticky (on iOS it needs Settings) and
 * would break both of those, which are worth far more than a card being dimmed.
 *
 * The timezone needs no permission, no network call, no API key and no stored
 * coordinates; it works offline, cannot be denied, and is already this codebase's idiom
 * for "where is this" — see `AIRPORTS` and `zonedTimeToInstant`.
 *
 * NOTHING HERE IS STORED. The verdict picks a default on one screen and is then
 * forgotten. Writing a derived country onto a user document — these documents belong to
 * minors as well as adults — would be a new category of personal data for no benefit.
 *
 * AND IT IS A HINT, NEVER A GATE. A timezone is two taps to change and the server cannot
 * verify it, so treating it as security would be decoration. It also answers a slightly
 * different question than the one being asked: a Boston student filling this in from
 * their family home in Ahmedabad is "outside the USA" and still needs Sabha Seva. So the
 * card it points away from stays clickable.
 *
 * The verdict function is PURE and takes the zone in as an argument, the same shape as
 * `pushAvailability` in ./push — so the whole matrix is testable without a browser.
 */

/**
 * Every IANA zone that means "in the United States", including the territories.
 *
 * AN EXPLICIT LIST, because the obvious shortcut is wrong: `America/` also covers
 * Toronto, Mexico_City, Sao_Paulo and Bogota, so a prefix test would tell somebody in
 * Canada or Brazil that they are in the USA and hide the airport service from exactly
 * the people it exists for.
 *
 * Includes the sub-zone families (Indiana, Kentucky, North_Dakota) because a device in
 * Indianapolis reports `America/Indiana/Indianapolis`, not `America/New_York`. Includes
 * Hawaii, the Alaskan zones, and Puerto Rico / Guam / Samoa / the Virgin Islands, whose
 * residents are in the USA and would otherwise be steered to the wrong service.
 */
const US_ZONES: ReadonlySet<string> = new Set([
    // Contiguous
    'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Menominee',
    'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
    // Sub-zone families
    'America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Indiana/Marengo',
    'America/Indiana/Petersburg', 'America/Indiana/Tell_City', 'America/Indiana/Vevay',
    'America/Indiana/Vincennes', 'America/Indiana/Winamac',
    'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
    'America/North_Dakota/Beulah', 'America/North_Dakota/Center',
    'America/North_Dakota/New_Salem',
    // Alaska and Hawaii
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla',
    'America/Nome', 'America/Yakutat', 'America/Adak', 'Pacific/Honolulu',
    // Territories
    'America/Puerto_Rico', 'America/St_Thomas', 'Pacific/Guam', 'Pacific/Saipan',
    'Pacific/Pago_Pago', 'Pacific/Midway', 'Pacific/Wake',
]);

/**
 * `true` in the USA, `false` outside it, `null` when there is no way to tell.
 *
 * `null` IS A REAL ANSWER and callers must treat it as "ask, do not guess" — it is what
 * an ancient browser, a stripped-down webview or a blank zone produces, and steering
 * somebody on a coin-flip is worse than steering nobody.
 */
export function likelyInUsa(timeZone: string | undefined | null): boolean | null {
    const zone = (timeZone ?? '').trim();
    if (!zone) return null;
    if (US_ZONES.has(zone)) return true;
    // A zone we recognise as somewhere else. Anything unparseable — no slash, so not an
    // IANA identifier at all — is "cannot tell" rather than "abroad", because a
    // malformed value is not evidence of a location.
    if (!zone.includes('/')) return null;
    return false;
}

/**
 * This device's IANA zone, or undefined.
 *
 * Wrapped and defensive for the same reason `readDeviceToken` is: `Intl` is missing in
 * old webviews and `resolvedOptions()` has been seen to throw in locked-down ones. A
 * sign-up screen must not fail to render over a nicety.
 */
export function deviceTimeZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}
