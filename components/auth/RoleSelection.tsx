import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../contexts/AuthContext';
import { redeemManagerInvite } from '../../src/utils/cloudFunctions';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../../src/constants/tenancy';
import { UserRole } from '../../types';
import { grantedRoles } from '../../src/roles';
import { deviceTimeZone, likelyInUsa } from '../../src/utils/whereabouts';
import { ArrowLeft, Car, Eye, EyeOff, Plane } from 'lucide-react';

interface RoleSelectionProps {
    onSelectRole: () => void;
}

/**
 * Where they are, asked before what they want to do.
 *
 * `null` means unanswered, which is the first step of this screen.
 */
type Whereabouts = 'arriving' | 'local';

export const RoleSelection: React.FC<RoleSelectionProps> = ({ onSelectRole }) => {
    const { currentUser, refreshClaims } = useAuth();
    /**
     * HELD IN REACT STATE, NEVER WRITTEN ON ITS OWN, and that is load-bearing.
     *
     * The `setDoc` below writes role, registeredRole, roles, activeRole and
     * accountStatus — five of the fields in `touchesPrivilegeFields()`. It is legal
     * only because it is a CREATE: no user document exists yet, so firestore.rules
     * takes the `createsUnprivilegedProfile()` arm, and `changedKeys()` is
     * update-only.
     *
     * So a separate screen that asked this question and wrote the answer first would
     * turn that create into an owner UPDATE touching privilege fields, the rules
     * would deny it, and NOBODY COULD REGISTER — not a student, not a Sarthi.
     * `tests/rules/firestore.rules.test.ts` guards exactly that, commented "if this
     * breaks, no student can register at all".
     *
     * Hence: one screen, two steps, one write.
     */
    const [whereabouts, setWhereabouts] = useState<Whereabouts | null>(null);
    const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
    const [managerCode, setManagerCode] = useState('');
    const [showManagerCode, setShowManagerCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    /**
     * Which service to put forward first, from the DEVICE TIMEZONE — no permission
     * prompt, no network call, nothing stored. See src/utils/whereabouts.ts for why it
     * is not the geolocation API, which this app deliberately spends later, at the
     * moment a rider or driver can see what it buys them.
     *
     * Read once on mount: it cannot change while somebody is on this screen, and
     * re-deriving it would re-run `Intl` on every keystroke in the steps below.
     */
    const [inUsa] = useState(() => likelyInUsa(deviceTimeZone()));

    const places: Array<{ id: Whereabouts; title: string; description: string; icon: React.ReactNode }> = [
        {
            id: 'local',
            title: 'I am already in the USA',
            description: 'Lifts to sabha and home again.',
            icon: <Car className="w-12 h-12" />,
        },
        {
            id: 'arriving',
            title: 'I am arriving soon',
            // No weekday and no clock time: tests/quality/schedule-not-hardcoded.test.ts
            // scans this directory, and a sabha's schedule is a rule rather than a
            // constant.
            description: 'A Sarthi will collect you from the airport.',
            icon: <Plane className="w-12 h-12" />,
        },
    ];

    const roles = [
        {
            id: 'student' as UserRole,
            title: 'Bhulku',
            description: 'Request rides to and from Sabha',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            ),
        },
        {
            id: 'driver' as UserRole,
            title: 'Sarthi',
            description: 'Volunteer to drive students',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
            ),
        },
        {
            id: 'manager' as UserRole,
            title: 'Manager',
            description: 'Coordinate and manage rides',
            icon: (
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
            ),
        },
    ];

    const handleSubmit = async () => {
        // STEP 0. Answering "already here" only advances the screen — it writes nothing,
        // for the reason on `whereabouts` above.
        if (whereabouts === null) {
            setError('Please choose one');
            return;
        }
        if (whereabouts === 'local' && !selectedRole) {
            setError('Please select a role');
            return;
        }

        if (!currentUser) {
            setError('User not authenticated');
            return;
        }

        // An arriving traveller is a Bhulku and nothing else. They are never shown the
        // role cards: they cannot drive on a Friday from another continent, and offering
        // them Sarthi or Manager would be offering something that cannot work.
        const role: UserRole = whereabouts === 'arriving' ? 'student' : selectedRole!;
        const isArriving = whereabouts === 'arriving';

        setLoading(true);
        setError('');

        try {
            let initialStatus: 'approved' | 'pending' = 'pending';

            if (role === 'student') {
                // Students are auto-approved
                initialStatus = 'approved';
            } else if (role === 'manager') {
                const rawInput = managerCode.trim();
                if (!rawInput) {
                    setError('Manager access code is required');
                    setLoading(false);
                    return;
                }

                // The code is checked server-side, and the manager profile is
                // written server-side with the Admin SDK.
                //
                // This screen used to compare the input against
                // ['sabha2026','sabha2024'] hardcoded right here — shipped in
                // the bundle to every visitor, readable with View Source, and
                // impossible to rotate without a redeploy. It then wrote
                // accountStatus:'approved' onto its own user document, so even
                // the check was optional: skip it, write the field, be a
                // manager. Neither the code nor the privilege fields belong in
                // the browser.
                const { redeemed, message } = await redeemManagerInvite(rawInput);

                if (!redeemed) {
                    setError(message || 'That invite code was not recognised. Please check with the Sabha coordinator.');
                    setLoading(false);
                    return;
                }

                // redeemManagerInvite has already created the approved manager
                // profile. Writing it again from here would be denied, and
                // would be the very thing this change removes.
                //
                // It also set a `mgr` claim, which only lands on a token when one
                // is minted — so force a refresh rather than leaving the new
                // manager's first hour running on the slower document check.
                await refreshClaims();

                onSelectRole();
                return;
            } else {
                // Drivers (Riders) require manager approval
                initialStatus = 'pending';
            }

            // Save user profile with final determined accountStatus
            await setDoc(doc(db, 'users', currentUser.uid), {
                role,
                registeredRole: role,
                // THE GRANTED SET, not just the role they picked.
                //
                // This wrote `[selectedRole]` while the invite path
                // (functions/src/http/managerInvites.ts) writes
                // ['manager','driver','student'] with the comment "the granted set,
                // so one query answers 'who can drive?' everywhere". Two writers,
                // two different meanings for one field — and `useUsers` queries
                // `roles array-contains 'driver'` to build the driver picker.
                //
                // So a manager created down THIS path got `roles: ['manager']` and
                // was invisible to the picker, however many nights they drove. That
                // is the same "lists nobody" bug the comment at useUsers.ts:206
                // records fixing once already: it queried `role == 'driver'` and
                // found none, because every driver here is recorded as a manager who
                // also drives.
                //
                // `roles` is the GRANTED set everywhere now.
                // tests/quality/role-table-parity.test.ts holds the table itself in
                // step across all six copies.
                roles: grantedRoles({ role }),
                activeRole: role,
                // Absent for everybody who is already here, which is what makes this a
                // no-op for every account that predates the field. See the note on
                // `isArriving` in types.ts.
                ...(isArriving ? { isArriving: true } : {}),
                email: currentUser.email,
                phone: currentUser.phoneNumber,
                accountStatus: initialStatus,
                // Stamped on BOTH profile writes. A profile is created here and
                // completed in ProfileSetup, with a gap between; stamping only one
                // leaves a window where the document exists unstamped.
                cityId: FOUNDING_CITY_ID,
                locationId: FOUNDING_LOCATION_ID,
                createdAt: new Date().toISOString(),
            }, { merge: true });

            onSelectRole();
        } catch (err: unknown) {
            console.error('Error saving role:', err);
            // redeemManagerInvite throws for rate limiting, and that message is
            // the actionable part. A blanket "Failed to save role" hid it and left
            // the user retyping a correct code. Bad codes do not come through
            // here — they resolve with a reason, handled above.
            const message = err instanceof Error ? err.message : '';
            setError(message || 'Failed to save role. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-saffron/10 via-surface to-gold/10 flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] py-8 text-center">
                {/* THREE headers, not two. The arriving branch has no role to choose, so
                    leaving it on "Choose Your Role" — as this did at first, caught by
                    looking at it in the preview harness — asked a question the screen was
                    no longer showing. */}
                <h1 className="text-3xl md:text-4xl font-header font-bold">
                    {whereabouts === null ? 'Jai Swaminarayan'
                        : whereabouts === 'arriving' ? 'Airport Seva'
                            : 'Choose Your Role'}
                </h1>
                <p className="text-sm md:text-base mt-2 opacity-90">
                    {whereabouts === null ? 'Where are you right now?'
                        : whereabouts === 'arriving' ? 'We will meet you at arrivals'
                            : 'How would you like to serve?'}
                </p>
            </div>

            {/* Role Selection */}
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="max-w-4xl w-full space-y-6 animate-in fade-in zoom-in duration-500">
                    {/* STEP 0 — where are they. Two cards, and answering advances rather
                        than submitting, so a mistap is not a decision about their whole
                        app. Nothing is written until Continue on the final step. */}
                    {whereabouts === null && (
                        <>
                            {/* Only when we actually know. `likelyInUsa` returns null for a
                                browser with no usable timezone, and null must read as "ask,
                                do not guess" — a confident line produced by a coin flip is
                                worse than no line at all. */}
                            {inUsa === false && (
                                <p className="text-center text-sm text-coffee-700" role="status">
                                    It looks like you are outside the USA.
                                </p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {places.map((place) => {
                                    /*
                                     * DE-EMPHASISED, NEVER DISABLED. A timezone is two taps
                                     * to change and the server cannot verify it, so treating
                                     * it as a gate would be decoration — and it answers a
                                     * slightly different question than the one asked: a
                                     * Boston student filling this in from Ahmedabad is
                                     * "outside the USA" and still needs Sabha Seva.
                                     *
                                     * AND NOT WITH AN OPACITY CLASS, which is measured rather
                                     * than preferred: dimming the card dims its TEXT. In the
                                     * rendered page the body line fell to 2.90:1 and "I
                                     * actually live here" to 2.49:1, against 4.5 — and that
                                     * second line is the escape hatch for exactly the person
                                     * this guess gets wrong, so of everything here it is what
                                     * most has to stay readable.
                                     *
                                     * So: the icon's HUE carries the de-emphasis and a ring
                                     * marks the suggestion. Nothing that must be read is
                                     * touched. Pinned by tests/quality/theme-tokens.
                                     */
                                    const dimmed = inUsa === false && place.id === 'local';
                                    const suggested = inUsa === false && place.id === 'arriving';
                                    return (
                                        <button
                                            key={place.id}
                                            onClick={() => { setWhereabouts(place.id); setError(''); }}
                                            className={`clay-card p-6 text-center space-y-4 transition-all
                                                hover:scale-105 hover:shadow-lg
                                                ${suggested ? 'ring-2 ring-inset ring-[rgb(var(--cta))]' : ''}`}
                                            disabled={loading}
                                        >
                                            <div className={`inline-flex p-4 rounded-2xl bg-cream-300
                                                ${dimmed ? 'text-coffee-500' : 'text-saffron'}`}>
                                                {place.icon}
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-header font-bold text-coffee">{place.title}</h3>
                                                <p className="text-sm text-coffee-700 mt-2">{place.description}</p>
                                                {dimmed && (
                                                    <p className="text-xs font-bold text-saffron-800 mt-3">
                                                        I actually live here
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* The arriving branch has no second step — they are a Bhulku by
                        definition. So this confirms the choice and offers the way back,
                        rather than leaving them looking at a lone Continue button with
                        the cards gone and nothing saying what they picked. */}
                    {whereabouts === 'arriving' && (
                        <div className="clay-card p-6 space-y-3 text-center animate-in slide-in-from-top-4">
                            <div className="inline-flex p-4 rounded-2xl bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))]">
                                <Plane className="w-12 h-12" />
                            </div>
                            <h3 className="text-xl font-header font-bold text-coffee">
                                Jai Swaminarayan!
                            </h3>
                            {/* The sentence about not being asked for an address is gone
                                deliberately: it explained the ABSENCE of a field, which
                                nobody arriving here is wondering about, and it was the
                                longest clause on a welcome screen. */}
                            <p className="text-sm text-coffee-700">
                                Tell us about your flight and a Sarthi will be waiting for
                                you at arrivals. Nothing else to arrange — we will take it
                                from there.
                            </p>
                            <button
                                onClick={() => { setWhereabouts(null); setError(''); }}
                                disabled={loading}
                                className="flex items-center gap-2 mx-auto text-sm font-bold text-coffee-500 hover:text-saffron transition-colors min-h-11"
                            >
                                <ArrowLeft size={16} aria-hidden="true" />
                                Actually, I am already here
                            </button>
                        </div>
                    )}

                    {/* STEP 1 — the role cards, and ONLY for somebody already here. An
                        arriving traveller skips this entirely: they submit straight from
                        step 0 as a Bhulku. */}
                    {whereabouts === 'local' && (
                    <>
                    <button
                        onClick={() => { setWhereabouts(null); setSelectedRole(null); setError(''); }}
                        disabled={loading}
                        className="flex items-center gap-2 text-sm font-bold text-coffee-500 hover:text-saffron transition-colors min-h-11"
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        Not in the USA yet?
                    </button>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {roles.map((role) => (
                            <button
                                key={role.id}
                                onClick={() => {
                                    setSelectedRole(role.id);
                                    setError('');
                                }}
                                className={`clay-card p-6 text-center space-y-4 transition-all hover:scale-105 ${selectedRole === role.id
                                    ? 'ring-4 ring-saffron shadow-xl'
                                    : 'hover:shadow-lg'
                                    }`}
                                disabled={loading}
                            >
                                <div className={`inline-flex p-4 rounded-2xl ${selectedRole === role.id
                                    ? 'bg-[rgb(var(--cta))] text-[rgb(var(--text-on-accent))]'
                                    : 'bg-cream-300 text-saffron'
                                    }`}>
                                    {role.icon}
                                </div>
                                <div>
                                    <h3 className="text-xl font-header font-bold text-coffee">{role.title}</h3>
                                    <p className="text-sm text-coffee-700 mt-2">{role.description}</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Manager Secret Code Input */}
                    {selectedRole === 'manager' && (
                        <div className="clay-card p-6 animate-in slide-in-from-top-4">
                            <label className="block text-sm font-bold text-coffee mb-2">
                                Manager Access Code <span className="text-[rgb(var(--danger-text))]">*</span>
                            </label>
                            <p className="text-xs text-coffee-500 mb-3">
                                Enter the access code provided by the Sabha coordinator to register as a manager.
                            </p>
                            <div className="relative">
                                <input
                                    type={showManagerCode ? 'text' : 'password'}
                                    value={managerCode}
                                    onChange={(e) => setManagerCode(e.target.value)}
                                    placeholder="Enter admin code..."
                                    className="w-full px-4 py-3 pr-10 rounded-xl border-2 border-mocha/20 focus:border-saffron focus:outline-none transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowManagerCode(!showManagerCode)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee-500 hover:text-coffee transition-colors"
                                    title={showManagerCode ? 'Hide Code' : 'Show Code'}
                                >
                                    {showManagerCode ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                    )}

                    </>
                    )}

                    {error && (
                        <div className="clay-card bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 p-4">
                            <p className="text-[rgb(var(--danger-text))] text-center">{error}</p>
                        </div>
                    )}

                    {/* NOT RENDERED ON STEP 0.
                        It used to be, permanently disabled, because `whereabouts` is null
                        there — a dimmed button that could never work, on the first screen
                        anybody sees. Two costs: it is this repo's signature defect, a
                        control visible that cannot work; and it MISLEADS, because it
                        implies you pick a card and then press it, when tapping the card is
                        the whole interaction and advances on its own.

                        Step 1 is different and it stays: there, picking a role does not
                        advance, so Continue is the next step and has to be visible. It is
                        disabled until a role is chosen — with the reason said out loud
                        beside it, which is the rule ArrivalRequestForm already follows: a
                        disabled button and no explanation is indistinguishable from a
                        broken one. */}
                    {whereabouts !== null && (
                        <div className="text-center space-y-2">
                            {whereabouts === 'local' && !selectedRole && (
                                <p className="text-sm text-coffee-500" role="status">
                                    Pick how you would like to take part.
                                </p>
                            )}
                            <button
                                onClick={handleSubmit}
                                disabled={loading || (whereabouts === 'local' && !selectedRole)}
                                className="clay-button bg-gradient-to-r from-saffron-800 to-gold-700 text-[rgb(var(--text-on-accent))] px-12 py-4 rounded-xl font-semibold text-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Saving...' : whereabouts === 'arriving' ? 'Set up my pickup' : 'Continue'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
