import React, { useState } from 'react';
import { Briefcase, Home, Plane, Users } from 'lucide-react';
import { Disclosure } from '../shared/Disclosure';
import { AddressAutocomplete } from '../auth/AddressAutocomplete';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { requestAirportPickup } from '../../src/utils/cloudFunctions';
import type { AirportPickupRequest } from '../../src/utils/cloudFunctions';
import {
    AIRPORTS, MAX_BAGS, MAX_NOTES, MAX_PARTY_SIZE, MAX_SHORT_TEXT,
} from '../../src/utils/arrival';
import type { WhatsappOn } from '../../src/utils/arrival';
import type { PlaceDetails } from '../../hooks/useGooglePlaces';

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
}

export const ArrivalRequestForm: React.FC<ArrivalRequestFormProps> = ({ onSubmitted }) => {
    const { userProfile, currentUser } = useAuth();
    const toast = useToast();

    const [open, setOpen] = useState<Section | null>('flight');
    const [saving, setSaving] = useState(false);

    // Seeded from the profile they already filled in at signup. Not read-only —
    // the phone that matters here is the one they will have on landing, which is
    // often not the one on their profile.
    const [form, setForm] = useState({
        arrivalDate: '',
        arrivalTime: '',
        airportCode: 'BOS',
        airline: '',
        flightNumber: '',
        terminal: '',
        isInternational: true,

        partySize: 1,
        largeBags: 2,
        cabinBags: 1,

        dropoffAddress: '',
        dropoffLat: 0,
        dropoffLng: 0,

        fullName: userProfile?.name ?? '',
        preferredName: '',
        dateOfBirth: '',
        email: currentUser?.email ?? userProfile?.email ?? '',
        phone: userProfile?.phone ?? '',
        altPhone: '',
        whatsappOn: 'primary' as WhatsappOn,
        hasUsWorkingPhone: false,
        meetingPointNote: '',
        university: '',
        referredByName: '',
        needsStopOnTheWay: '',
        specialNeeds: '',
        notes: '',

        familyName: '',
        familyRelationship: '',
        familyPhone: '',
        familyHasWhatsapp: true,
        familyLanguage: '',
    });

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
        if (form.whatsappOn === 'alt' && !form.altPhone.trim()) {
            return 'You chose your other number for WhatsApp — add it, or change the choice.';
        }
        if (!form.dropoffAddress.trim() || (form.dropoffLat === 0 && form.dropoffLng === 0)) {
            return 'Pick where you are going from the address suggestions, so it has a location.';
        }
        if (Boolean(form.familyName.trim()) !== Boolean(form.familyPhone.trim())) {
            return 'A family contact needs both a name and a phone number.';
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
                dropoffAddress: form.dropoffAddress,
                dropoffLat: form.dropoffLat,
                dropoffLng: form.dropoffLng,
                hasUsWorkingPhone: form.hasUsWorkingPhone,
                meetingPointNote: form.meetingPointNote || undefined,
                needsStopOnTheWay: form.needsStopOnTheWay || undefined,
                specialNeeds: form.specialNeeds || undefined,
                notes: form.notes || undefined,

                fullName: form.fullName,
                preferredName: form.preferredName || undefined,
                dateOfBirth: form.dateOfBirth,
                email: form.email,
                phone: form.phone,
                altPhone: form.altPhone || undefined,
                whatsappOn: form.whatsappOn,
                university: form.university || undefined,
                referredByName: form.referredByName || undefined,
                familyContact: form.familyName.trim()
                    ? {
                        name: form.familyName,
                        relationship: form.familyRelationship,
                        phone: form.familyPhone,
                        hasWhatsapp: form.familyHasWhatsapp,
                        preferredLanguage: form.familyLanguage || undefined,
                    }
                    : undefined,
            };

            await requestAirportPickup(payload);
            toast.success('Your request is on the board. A Sarthi will take it.');
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
                        hint="So your Sarthi allows time for immigration and baggage."
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
                    <p className="flex items-start gap-2 text-xs text-coffee-500">
                        <Briefcase size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                        Be honest about the suitcases — it decides which car can come.
                        Two people with four large cases do not fit in a saloon.
                    </p>
                </div>
            </Disclosure>

            <Disclosure
                icon={<Home size={20} aria-hidden="true" />}
                title="Where you are going"
                summary={form.dropoffAddress || 'Your address in the USA'}
                open={open === 'destination'}
                onToggle={() => toggle('destination')}
            >
                <div className="space-y-3">
                    <div>
                        <label className={LABEL}>Address</label>
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
                        <p className="text-xs text-coffee-500 mt-1">
                            Pick it from the suggestions so your Sarthi can navigate to it.
                        </p>
                    </div>

                    <Field
                        id="stop" label="Somewhere you need to stop on the way (optional)"
                        value={form.needsStopOnTheWay} max={MAX_SHORT_TEXT}
                        onChange={v => set('needsStopOnTheWay', v)}
                        placeholder="A shop for a SIM card, groceries"
                    />
                    <Field
                        id="needs" label="Anything we should know (optional)"
                        value={form.specialNeeds} max={MAX_SHORT_TEXT}
                        onChange={v => set('specialNeeds', v)}
                        placeholder="Travelling with an infant, wheelchair, medical"
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
                    <Field
                        id="preferred-name" label="What you like to be called (optional)"
                        value={form.preferredName} onChange={v => set('preferredName', v)}
                    />
                    <div>
                        <label className={LABEL} htmlFor="dob">Date of birth</label>
                        <input
                            id="dob" type="date" className={FIELD} value={form.dateOfBirth}
                            onChange={e => set('dateOfBirth', e.target.value)}
                        />
                        <p className="text-xs text-coffee-500 mt-1">
                            So your Sarthi can be sure they have met the right person.
                        </p>
                    </div>
                    <Field
                        id="email" label="Email" value={form.email}
                        onChange={v => set('email', v)} type="email"
                    />
                    <Field
                        id="phone" label="Phone number" value={form.phone}
                        onChange={v => set('phone', v)} type="tel"
                        placeholder="+91 98765 43210"
                    />
                    <Field
                        id="alt-phone" label="Another number (optional)" value={form.altPhone}
                        onChange={v => set('altPhone', v)} type="tel"
                    />

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
                        hint="Most people arrive on a dead SIM. If you will not, agree a meeting point below."
                    />
                    {!form.hasUsWorkingPhone && (
                        <Field
                            id="meeting-point" label="Where should your Sarthi wait for you?"
                            value={form.meetingPointNote} max={MAX_SHORT_TEXT}
                            onChange={v => set('meetingPointNote', v)}
                            placeholder="By the exit doors at arrivals, holding a sign with my name"
                        />
                    )}

                    <Field
                        id="university" label="University or employer (optional)"
                        value={form.university} onChange={v => set('university', v)}
                    />
                    <Field
                        id="referred-by" label="Somebody here who knows you (optional)"
                        value={form.referredByName} onChange={v => set('referredByName', v)}
                    />

                    <hr className="border-0 border-t border-hairline/10" />

                    <p className="text-sm text-coffee-500">
                        Your Sarthi can message your family to say you have been met and
                        you are safe. Give a number and it takes them one tap.
                    </p>
                    <Field
                        id="family-name" label="Family contact name" value={form.familyName}
                        onChange={v => set('familyName', v)}
                    />
                    <Field
                        id="family-relationship" label="Relationship" value={form.familyRelationship}
                        onChange={v => set('familyRelationship', v)} placeholder="Mother"
                    />
                    <Field
                        id="family-phone" label="Their phone number, with country code"
                        value={form.familyPhone} onChange={v => set('familyPhone', v)}
                        type="tel" placeholder="+91 98765 43210"
                    />
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
                className="clay-button w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-saffron to-saffron-dark disabled:opacity-60"
            >
                {saving ? 'Sending…' : 'Ask for a pickup'}
            </button>
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
