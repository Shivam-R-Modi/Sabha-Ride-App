import React, { useState } from 'react';
import { Briefcase, Home, Plane, Users } from 'lucide-react';
import { Disclosure } from '../shared/Disclosure';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { PhoneNumberInput } from '../auth/PhoneNumberInput';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { requestAirportPickup } from '../../src/utils/cloudFunctions';
import { updateAirportPickup } from '../../src/utils/cloudFunctions';
import type { AirportPickupRequest } from '../../src/utils/cloudFunctions';
import type { AirportPickup } from '../../types';
import {
    AIRPORTS, MAX_BAGS, MAX_NOTES, MAX_PARTY_SIZE, MAX_SHORT_TEXT,
} from '../../src/utils/arrival';
import type { WhatsappOn } from '../../src/utils/arrival';
import type { PlaceDetails } from '../../hooks/useGooglePlaces';
import { parsePhoneNumber, validatePhoneNumber } from '../../src/utils/phoneUtils';

/**
 * Asking to be collected from the airport.
 *
 * SECTIONED, not one long scroll. There are twenty-odd fields, and the person filling
 * them in is often doing it from another country a week before they fly. Four
 * `Disclosure` rows, one open at a time — the same accordion the manager's Setup screen
 * uses, so the behaviour is already familiar and there is no second one to drift.
 *
 * THE SERVER OWNS THE ARRIVAL INSTANT. This form sends the date and time the traveller
 * read off their ticket, as strings, and `requestAirportPickup` turns them into an
 * absolute instant using the AIRPORT'S timezone. Nothing here computes an hour, which
 * is the rule that stopped drop-off rides breaking every Friday.
 *
 * NATIVE date and time inputs, and the pair stacks below `sm`. Both are pinned by
 * tests/quality/native-date-time-inputs.test.ts: WebKit's time widget claims its own
 * width and centres its value, which was reported twice from a phone and is
 * unreproducible on desktop Chromium.
 */

type Section = 'flight' | 'party' | 'destination' | 'you';

const FIELD =
    'w-full px-4 py-3 rounded-xl bg-cream-300 text-coffee placeholder:text-coffee-500/60 '
    + 'border border-hairline/10 focus:outline-none focus:ring-2 focus:ring-saffron min-h-11';

const LABEL = 'block text-xs font-bold uppercase tracking-wide text-coffee-500 mb-1';

interface ArrivalRequestFormProps {
    onSubmitted: () => void;
    /**
     * The live request, when this is an EDIT rather than a new ask.
     *
     * One form for both, not two. The alternative is a second screen with the same
     * twenty fields and the same validation, which would drift the first time either
     * changed — and the server takes the whole request either way, so the payload is
     * already identical.
     */
    existing?: AirportPickup;
    /** Leave the edit without saving. Only rendered when `existing` is set. */
    onCancelEdit?: () => void;
}

export const ArrivalRequestForm: React.FC<ArrivalRequestFormProps> = ({
    onSubmitted, existing, onCancelEdit,
}) => {
    const { userProfile, currentUser } = useAuth();
    const toast = useToast();
    const editing = Boolean(existing);

    const [open, setOpen] = useState<Section | null>('flight');
    const [saving, setSaving] = useState(false);

    /**
     * THE THREE NUMBERS, SEEDED ONCE, READ TWICE.
     *
     * `form` needs them to display, `phones` needs them to judge validity — and those
     * were two separate expressions, which is precisely how this broke. `form` fell
     * back to the profile's number; `phones` did not. So a traveller whose profile
     * already held a phone number saw it in the field, saw a green tick under it, and
     * was told "check your phone number — it does not have the right number of digits"
     * on every single attempt. The form could not be submitted at all without deleting
     * a correct number and retyping it, which nobody would think to try.
     *
     * Reported from a phone on 2026-08-25. Named and shared so the two cannot disagree
     * again — the fix is the single source, not the extra fallback.
     */
    const seedNumbers = {
        phone: existing?.passenger.phone ?? userProfile?.phone ?? '',
        altPhone: existing?.passenger.altPhone ?? '',
        familyPhone: existing?.passenger.familyContact?.phone ?? '',
    };

    // Seeded from the profile they already filled in at signup. Not read-only —
    // the phone that matters here is the one they will have on landing, which is
    // often not the one on their profile.
    const [form, setForm] = useState(() => ({
        arrivalDate: existing?.arrivalDate ?? '',
        arrivalTime: existing?.arrivalTime ?? '',
        airportCode: existing?.airportCode ?? 'BOS',
        airline: existing?.airline ?? '',
        flightNumber: existing?.flightNumber ?? '',
        terminal: existing?.terminal ?? '',
        isInternational: existing?.isInternational ?? true,

        partySize: existing?.partySize ?? 1,
        largeBags: existing?.largeBags ?? 2,
        cabinBags: existing?.cabinBags ?? 1,

        // Optional, all three. Somebody filing a month out often has no address yet.
        dropoffAddress: existing?.dropoffAddress ?? '',
        dropoffLat: existing?.dropoffLat ?? 0,
        dropoffLng: existing?.dropoffLng ?? 0,

        fullName: existing?.passenger.name ?? userProfile?.name ?? '',
        // NOT seeded, and hidden below when editing. These two live on
        // `airportProfiles`, which no client may read — so showing them would mean
        // showing a blank box beside a value the traveller knows they typed. Sending
        // them empty is harmless: the payload omits blanks, and the profile write
        // merges, so nothing already stored is wiped.
        preferredName: '',
        dateOfBirth: existing?.passenger.dateOfBirth ?? '',
        email: existing?.passenger.email ?? currentUser?.email ?? userProfile?.email ?? '',
        phone: seedNumbers.phone,
        altPhone: seedNumbers.altPhone,
        whatsappOn: (existing?.passenger.whatsappOn ?? 'primary') as WhatsappOn,
        hasUsWorkingPhone: existing?.hasUsWorkingPhone ?? false,
        meetingPointNote: existing?.meetingPointNote ?? '',
        university: '',
        needsStopOnTheWay: existing?.needsStopOnTheWay ?? '',
        notes: existing?.notes ?? '',

        familyName: existing?.passenger.familyContact?.name ?? '',
        familyRelationship: existing?.passenger.familyContact?.relationship ?? '',
        familyPhone: seedNumbers.familyPhone,
        familyHasWhatsapp: existing?.passenger.familyContact?.hasWhatsapp ?? true,
        familyLanguage: existing?.passenger.familyContact?.preferredLanguage ?? '',
    }));

    /**
     * The three phone numbers, kept apart from `form`.
     *
     * `PhoneNumberInput` hands back three things per keystroke — a formatted display
     * string, an E.164 normalisation and a validity flag — and it is the E.164 value
     * that gets STORED, matching `ProfileSetup` and the numbers already in production.
     * Keeping them here rather than in `form` is what stops the display string being
     * the thing that gets sent.
     *
     * Validity comes from `phoneUtils`, which knows the country the person picked and
     * therefore the exact digit count: 10 for the US and India, 9 for Australia. The
     * server re-checks the digit count within the E.164 envelope, because a client is
     * a trust boundary even when it belongs to the person whose number it is.
     */
    /**
     * SEEDED FROM `seedNumbers`, NOT BLANK — see the note there for what blank cost.
     *
     * Re-validated rather than trusted: the stored value is run back through the same
     * `phoneUtils` check the field itself uses, so a number that was stored before a
     * rule tightened is caught here rather than at the server.
     */
    const [phones, setPhones] = useState(() => {
        const seed = (stored: string) => {
            if (!stored) return { e164: '', valid: false };
            const { country, localDigits } = parsePhoneNumber(stored);
            const check = validatePhoneNumber(localDigits, country);
            return { e164: check.e164 ?? '', valid: check.isValid };
        };
        return {
            phone: seed(seedNumbers.phone),
            altPhone: seed(seedNumbers.altPhone),
            familyPhone: seed(seedNumbers.familyPhone),
        };
    });

    type PhoneKey = keyof typeof phones;

    const setPhone = (key: PhoneKey) =>
        (display: string, e164: string, valid: boolean) => {
            setForm(prev => ({ ...prev, [key]: display }));
            setPhones(prev => ({ ...prev, [key]: { e164, valid } }));
        };

    const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
        setForm(prev => ({ ...prev, [key]: value }));

    /**
     * What is missing, in words, or null.
     *
     * Shown BESIDE an always-enabled submit button rather than disabling it. A greyed
     * button with no explanation is the dead control this codebase keeps removing —
     * you cannot tell whether you have missed a field or the app is broken. The
     * server re-validates all of it regardless; a client is a trust boundary even
     * when it belongs to the person whose data it is.
     */
    const missing = (): string | null => {
        if (!form.arrivalDate || !form.arrivalTime) return 'Add the date and time you land.';
        if (!/^[A-Za-z]{3}$/.test(form.airportCode)) return 'Add the airport, as a three-letter code.';
        if (!form.fullName.trim()) return 'Add your full name.';
        if (!form.dateOfBirth) return 'Add your date of birth.';
        if (!form.email.trim()) return 'Add your email address.';
        if (!form.phone.trim()) return 'Add a phone number.';
        // Digit count, from the country selected on the field itself.
        if (!phones.phone.valid) {
            return 'Check your phone number — it does not have the right number of digits.';
        }
        if (form.whatsappOn === 'alt' && !form.altPhone.trim()) {
            return 'You chose your other number for WhatsApp — add it, or change the choice.';
        }
        if (form.altPhone.trim() && !phones.altPhone.valid) {
            return 'Check your other phone number — it does not have the right number of digits.';
        }
        // THE ADDRESS IS NOT CHECKED HERE ANY MORE, on purpose. It used to be required
        // and picked from the suggestions, which is impossible for somebody who does not
        // yet know where they are staying. See the destination section below.
        if (Boolean(form.familyName.trim()) !== Boolean(form.familyPhone.trim())) {
            return 'A family contact needs both a name and a phone number.';
        }
        if (form.familyPhone.trim() && !phones.familyPhone.valid) {
            return 'Check your family contact’s number — it does not have the right number of digits.';
        }
        return null;
    };

    const problem = missing();

    const submit = async () => {
        if (problem) {
            toast.error(problem);
            return;
        }
        setSaving(true);
        try {
            const payload: AirportPickupRequest = {
                arrivalDate: form.arrivalDate,
                arrivalTime: form.arrivalTime,
                airportCode: form.airportCode.toUpperCase(),
                airline: form.airline || undefined,
                flightNumber: form.flightNumber || undefined,
                terminal: form.terminal || undefined,
                isInternational: form.isInternational,

                partySize: form.partySize,
                largeBags: form.largeBags,
                cabinBags: form.cabinBags,
                // Omitted entirely when blank, rather than sent as ''. The server
                // treats an absent address as "not known yet"; an empty string would
                // be a destination whose text happens to be nothing.
                dropoffAddress: form.dropoffAddress.trim() || undefined,
                dropoffLat: form.dropoffLat || undefined,
                dropoffLng: form.dropoffLng || undefined,
                hasUsWorkingPhone: form.hasUsWorkingPhone,
                meetingPointNote: form.meetingPointNote || undefined,
                needsStopOnTheWay: form.needsStopOnTheWay || undefined,
                notes: form.notes || undefined,

                fullName: form.fullName,
                preferredName: form.preferredName || undefined,
                dateOfBirth: form.dateOfBirth,
                email: form.email,
                // The E.164 form, so what is stored is dialable from anywhere — the
                // same choice ProfileSetup makes. Falls back to what they typed only
                // if normalisation somehow produced nothing.
                phone: phones.phone.e164 || form.phone,
                altPhone: phones.altPhone.e164 || form.altPhone || undefined,
                whatsappOn: form.whatsappOn,
                university: form.university || undefined,
                familyContact: form.familyName.trim()
                    ? {
                        name: form.familyName,
                        relationship: form.familyRelationship,
                        phone: phones.familyPhone.e164 || form.familyPhone,
                        hasWhatsapp: form.familyHasWhatsapp,
                        preferredLanguage: form.familyLanguage || undefined,
                    }
                    : undefined,
            };

            if (existing) {
                // The WHOLE request, not a patch — the server runs the same three
                // parsers the create path runs, and anything less would be a second,
                // laxer way into a collection no client may write directly.
                await updateAirportPickup({
                    ...payload, pickupId: existing.id, action: 'editRequest',
                });
                toast.success('Your pickup has been updated.');
            } else {
                await requestAirportPickup(payload);
                toast.success('Your request is on the board. A Sarthi will take it.');
            }
            onSubmitted();
        } catch (err) {
            // The server's own message. "You already have an airport pickup request
            // open" is actionable; "please try again" is not.
            toast.error(err instanceof Error ? err.message : 'That could not be sent');
        } finally {
            setSaving(false);
        }
    };

    const toggle = (section: Section) => setOpen(open === section ? null : section);

    return (
        <div className="p-4 lg:p-6 space-y-3 max-w-2xl mx-auto">
            <header>
                <h1 className="text-xl font-header font-bold text-coffee">Airport pickup</h1>
                <p className="text-sm text-coffee-500">
                    Tell us when you land and a Sarthi will be there to meet you.
                </p>
            </header>

            <Disclosure
                icon={<Plane size={20} aria-hidden="true" />}
                title="Your flight"
                summary={form.arrivalDate ? `${form.arrivalDate} · ${form.airportCode}` : 'When and where you land'}
                open={open === 'flight'}
                onToggle={() => toggle('flight')}
            >
                <div className="space-y-3">
                    {/* grid-cols-1 sm:grid-cols-2, never a bare grid-cols-2 — see the
                        file header and tests/quality/native-date-time-inputs.test.ts. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label className={LABEL} htmlFor="arrival-date">Date you land</label>
                            <input
                                id="arrival-date" type="date" className={FIELD}
                                value={form.arrivalDate}
                                onChange={e => set('arrivalDate', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className={LABEL} htmlFor="arrival-time">Time you land</label>
                            <input
                                id="arrival-time" type="time" className={FIELD}
                                value={form.arrivalTime}
                                onChange={e => set('arrivalTime', e.target.value)}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-coffee-500">
                        The local time at the airport, as printed on your ticket.
                    </p>

                    <div>
                        <label className={LABEL} htmlFor="airport">Airport</label>
                        <select
                            id="airport" className={FIELD}
                            value={form.airportCode}
                            onChange={e => set('airportCode', e.target.value)}
                        >
                            {AIRPORTS.map(a => (
                                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label className={LABEL} htmlFor="airline">Airline (optional)</label>
                            <input
                                id="airline" className={FIELD} value={form.airline}
                                onChange={e => set('airline', e.target.value)} placeholder="Emirates"
                            />
                        </div>
                        <div>
                            <label className={LABEL} htmlFor="flight-number">Flight number (optional)</label>
                            <input
                                id="flight-number" className={FIELD} value={form.flightNumber}
                                onChange={e => set('flightNumber', e.target.value)} placeholder="EK237"
                            />
                        </div>
                    </div>

                    <div>
                        <label className={LABEL} htmlFor="terminal">Terminal, if you know it</label>
                        <input
                            id="terminal" className={FIELD} value={form.terminal}
                            onChange={e => set('terminal', e.target.value)} placeholder="E"
                        />
                    </div>

                    <Check
                        id="international"
                        checked={form.isInternational}
                        onChange={v => set('isInternational', v)}
                        label="This is an international arrival"
                    />
                </div>
            </Disclosure>

            <Disclosure
                icon={<Users size={20} aria-hidden="true" />}
                title="Who is travelling"
                summary={`${form.partySize} ${form.partySize === 1 ? 'person' : 'people'} · ${form.largeBags + form.cabinBags} bags`}
                open={open === 'party'}
                onToggle={() => toggle('party')}
            >
                <div className="space-y-3">
                    <Counter
                        label="People travelling together" value={form.partySize}
                        min={1} max={MAX_PARTY_SIZE} onChange={v => set('partySize', v)}
                    />
                    <Counter
                        label="Large suitcases" value={form.largeBags}
                        min={0} max={MAX_BAGS} onChange={v => set('largeBags', v)}
                    />
                    <Counter
                        label="Cabin bags" value={form.cabinBags}
                        min={0} max={MAX_BAGS} onChange={v => set('cabinBags', v)}
                    />
                    {/* Kept, shortened. Everything else on this screen lost its helper
                        line; this one stays because it is the only hint that prevents a
                        real failure — the wrong car turning up for the luggage. */}
                    <p className="flex items-start gap-2 text-xs text-coffee-500">
                        <Briefcase size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                        Bags decide which car can come.
                    </p>
                </div>
            </Disclosure>

            <Disclosure
                icon={<Home size={20} aria-hidden="true" />}
                title="Where you are going"
                summary={form.dropoffAddress || 'Optional — if you know it yet'}
                open={open === 'destination'}
                onToggle={() => toggle('destination')}
            >
                <div className="space-y-3">
                    <div>
                        <label className={LABEL}>Address (optional)</label>
                        <AddressAutocomplete
                            value={form.dropoffAddress}
                            onChange={v => setForm(prev => ({
                                // Coordinates cleared whenever the text is edited by
                                // hand. Keeping the old pair would send a Sarthi to the
                                // previously-picked address under a new one's name.
                                ...prev, dropoffAddress: v, dropoffLat: 0, dropoffLng: 0,
                            }))}
                            onSelect={(place: PlaceDetails) => setForm(prev => ({
                                ...prev,
                                dropoffAddress: place.formattedAddress,
                                dropoffLat: place.latitude,
                                dropoffLng: place.longitude,
                            }))}
                            placeholder="Dorm, apartment or host's address"
                        />
                        {/* Leaving this blank does not block the request — plenty of
                            people file before they know where they will live. Three
                            sentences to say "optional" was the longest hint on the
                            screen. */}
                        <p className="text-xs text-coffee-500 mt-1">
                            Leave it blank if you do not know yet.
                        </p>
                    </div>

                    <Field
                        id="stop" label="Somewhere you need to stop on the way (optional)"
                        value={form.needsStopOnTheWay} max={MAX_SHORT_TEXT}
                        onChange={v => set('needsStopOnTheWay', v)}
                        placeholder="A shop for a SIM card, groceries"
                    />
                </div>
            </Disclosure>

            <Disclosure
                icon={<Users size={20} aria-hidden="true" />}
                title="You, and your family back home"
                summary={form.fullName || 'How we reach you, and who we reassure'}
                open={open === 'you'}
                onToggle={() => toggle('you')}
            >
                <div className="space-y-3">
                    <Field
                        id="full-name" label="Full name, as on your passport"
                        value={form.fullName} onChange={v => set('fullName', v)}
                    />
                    {!editing && <Field
                        id="preferred-name" label="What you like to be called (optional)"
                        value={form.preferredName} onChange={v => set('preferredName', v)}
                    />}
                    <div>
                        <label className={LABEL} htmlFor="dob">Date of birth</label>
                        <input
                            id="dob" type="date" className={FIELD} value={form.dateOfBirth}
                            onChange={e => set('dateOfBirth', e.target.value)}
                        />
                    </div>
                    <Field
                        id="email" label="Email" value={form.email}
                        onChange={v => set('email', v)} type="email"
                    />
                    {/*
                      * The app's phone control, not a bare text field: it carries the
                      * country selector and the per-country digit count from
                      * phoneUtils, and normalises to E.164 the way ProfileSetup does.
                      *
                      * ITS OWN LABEL IS SUPPRESSED and this form's `LABEL` used instead.
                      * PhoneNumberInput labels in sentence case with a red asterisk,
                      * which is right on the signup screen it was built for and wrong
                      * here — every other label on this form is small, bold and
                      * uppercase, and nothing else on it marks a required field with an
                      * asterisk. Seen in preview/airport.html; it read as though a
                      * different form had been pasted in.
                      *
                      * The privacy line shows once for the group rather than on each of
                      * the three numbers this form asks for.
                      */}
                    <div>
                        <label className={LABEL}>Phone number</label>
                        <PhoneNumberInput
                            label=""
                            value={form.phone}
                            onChange={setPhone('phone')}
                            required
                        />
                    </div>
                    <div>
                        <label className={LABEL}>Another number (optional)</label>
                        <PhoneNumberInput
                            label=""
                            value={form.altPhone}
                            onChange={setPhone('altPhone')}
                            required={false}
                            showPrivacyNote={false}
                        />
                    </div>

                    <div>
                        <label className={LABEL} htmlFor="whatsapp-on">Which number has WhatsApp?</label>
                        <select
                            id="whatsapp-on" className={FIELD} value={form.whatsappOn}
                            onChange={e => set('whatsappOn', e.target.value as WhatsappOn)}
                        >
                            <option value="primary">The first one</option>
                            <option value="alt">The other one</option>
                            <option value="none">Neither</option>
                        </select>
                    </div>

                    <Check
                        id="working-phone"
                        checked={form.hasUsWorkingPhone}
                        onChange={v => set('hasUsWorkingPhone', v)}
                        label="I will have a working phone when I land"
                        hint="Most people land on a dead SIM."
                    />
                    {!form.hasUsWorkingPhone && (
                        <Field
                            id="meeting-point" label="Where should your Sarthi wait for you?"
                            value={form.meetingPointNote} max={MAX_SHORT_TEXT}
                            onChange={v => set('meetingPointNote', v)}
                            placeholder="Meet at arrivals"
                        />
                    )}

                    {!editing && <Field
                        id="university" label="University or employer (optional)"
                        value={form.university} onChange={v => set('university', v)}
                    />}

                    <hr className="border-0 border-t border-hairline/10" />

                    <p className="text-sm text-coffee-500">
                        We can message your family once you are met.
                    </p>
                    <Field
                        id="family-name" label="Family contact name" value={form.familyName}
                        onChange={v => set('familyName', v)}
                    />
                    <Field
                        id="family-relationship" label="Relationship" value={form.familyRelationship}
                        onChange={v => set('familyRelationship', v)} placeholder="Mother"
                    />
                    <div>
                        <label className={LABEL}>Their phone number</label>
                        <PhoneNumberInput
                            label=""
                            value={form.familyPhone}
                            onChange={setPhone('familyPhone')}
                            required={false}
                            showPrivacyNote={false}
                        />
                    </div>
                    <Check
                        id="family-whatsapp" checked={form.familyHasWhatsapp}
                        onChange={v => set('familyHasWhatsapp', v)}
                        label="They use WhatsApp on that number"
                    />
                    <Field
                        id="family-language" label="Language they prefer (optional)"
                        value={form.familyLanguage} onChange={v => set('familyLanguage', v)}
                        placeholder="Gujarati"
                    />

                    <Field
                        id="notes" label="Anything else (optional)" value={form.notes}
                        max={MAX_NOTES} onChange={v => set('notes', v)} multiline
                    />
                </div>
            </Disclosure>

            {/* Always enabled, with the reason beside it. A disabled button and no
                explanation is indistinguishable from a broken one. */}
            {problem && (
                <p className="text-sm text-coffee-500" role="status">{problem}</p>
            )}
            <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="clay-button w-full py-4 rounded-xl font-bold text-[rgb(var(--text-on-accent))] bg-gradient-to-r from-[rgb(var(--cta))] to-[rgb(var(--cta-dark))] disabled:opacity-60"
            >
                {saving
                    ? (editing ? 'Saving…' : 'Sending…')
                    : (editing ? 'Save changes' : 'Ask for a pickup')}
            </button>
            {/* Only in edit mode. On a new request there is nothing to go back to. */}
            {editing && onCancelEdit && (
                <button
                    type="button"
                    onClick={onCancelEdit}
                    disabled={saving}
                    className="clay-button w-full py-3 rounded-xl font-bold text-coffee bg-cream-300 disabled:opacity-60"
                >
                    Leave it as it was
                </button>
            )}
        </div>
    );
};

const Field: React.FC<{
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
    max?: number;
    multiline?: boolean;
}> = ({ id, label, value, onChange, type = 'text', placeholder, max, multiline }) => (
    <div>
        <label className={LABEL} htmlFor={id}>{label}</label>
        {multiline ? (
            <textarea
                id={id} className={FIELD} rows={3} value={value} maxLength={max}
                placeholder={placeholder} onChange={e => onChange(e.target.value)}
            />
        ) : (
            <input
                id={id} type={type} className={FIELD} value={value} maxLength={max}
                placeholder={placeholder} onChange={e => onChange(e.target.value)}
            />
        )}
    </div>
);

/**
 * A stepper rather than a number input.
 *
 * Same choice `PickupForm` made for seats: a mobile number keypad lets somebody type
 * 44 large suitcases, and the bounds are what decide whether a car can come.
 */
const Counter: React.FC<{
    label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}> = ({ label, value, min, max, onChange }) => (
    <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-coffee">{label}</span>
        <span className="flex items-center gap-3 shrink-0">
            <button
                type="button" aria-label={`One fewer: ${label}`}
                disabled={value <= min} onClick={() => onChange(value - 1)}
                className="w-11 h-11 rounded-xl bg-cream-300 text-coffee font-bold disabled:opacity-40"
            >−</button>
            <span className="w-6 text-center font-bold text-coffee" aria-live="polite">{value}</span>
            <button
                type="button" aria-label={`One more: ${label}`}
                disabled={value >= max} onClick={() => onChange(value + 1)}
                className="w-11 h-11 rounded-xl bg-cream-300 text-coffee font-bold disabled:opacity-40"
            >+</button>
        </span>
    </div>
);

const Check: React.FC<{
    id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}> = ({ id, checked, onChange, label, hint }) => (
    <div>
        <label htmlFor={id} className="flex items-start gap-3 cursor-pointer min-h-11">
            <input
                id={id} type="checkbox" checked={checked}
                onChange={e => onChange(e.target.checked)}
                className="mt-1 w-5 h-5 rounded accent-saffron shrink-0"
            />
            <span className="text-sm text-coffee">{label}</span>
        </label>
        {hint && <p className="text-xs text-coffee-500 ml-8">{hint}</p>}
    </div>
);
