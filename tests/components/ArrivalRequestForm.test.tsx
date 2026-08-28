/**
 * Asking to be collected from the airport — the form, which had no test.
 *
 * THREE THINGS EARN THIS FILE, all of them changes made on 2026-08-25 at the owner's
 * request, and each one is a rule that used to be the opposite:
 *
 *  - **the destination is optional.** It used to be required AND had to carry
 *    coordinates from the Google Places suggestions. For the person this service
 *    exists for — somebody in Ahmedabad filing a month before they fly — that was
 *    either a dead end or a guess. The test that matters most here is that a request
 *    with no address at all is sent, and sent with the address key ABSENT rather than
 *    as an empty string.
 *
 *  - **every phone number is digit-checked.** All three of them, through the app's own
 *    `PhoneNumberInput` rather than a bare text field, so the count comes from the
 *    country the person picked. Deliberately NOT mocked below: the validation is the
 *    thing under test, and a stubbed input would assert nothing.
 *
 *  - **what is stored is the E.164 form.** Same as `ProfileSetup`, and the same as the
 *    numbers already in production. Sending the display string would store
 *    `+91 98765 43210` for one traveller and `+919876543210` for the next, and
 *    `waLink` would have to guess which.
 *
 * Two fields were removed in the same pass — "Anything we should know" and "Somebody
 * here who knows you" — and there is a test that neither comes back, because a form
 * this long grows fields more easily than it loses them.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestAirportPickup = vi.fn(async (_payload: unknown) => ({
    success: true, pickupId: 'p_new', arrivalAt: '2026-12-02T05:00:00.000Z',
}));
const updateAirportPickup = vi.fn(async (_payload: unknown) => ({
    success: true, status: 'open' as const,
}));
vi.mock('../../src/utils/cloudFunctions', () => ({
    requestAirportPickup: (payload: unknown) => requestAirportPickup(payload),
    updateAirportPickup: (payload: unknown) => updateAirportPickup(payload),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));

/**
 * `profilePhone` is a variable, and that is the point. It was hardcoded to '' — which
 * is why nothing here caught the bug that made this form unsubmittable for anybody
 * whose profile already held a number. See "a profile that already has a number".
 */
let profilePhone = '';
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        currentUser: { uid: 'traveller_1', email: 'cab@example.com' },
        userProfile: { name: 'Cab Exa', phone: profilePhone },
    }),
}));

// Google Places only. PhoneNumberInput is left REAL on purpose — see the header.
vi.mock('../../hooks/useGooglePlaces', () => ({
    useGooglePlaces: () => ({
        predictions: [],
        loading: false,
        getPlacePredictions: vi.fn(),
        getPlaceDetails: vi.fn(),
        clearPredictions: vi.fn(),
    }),
    geocodeAddressInBrowser: vi.fn(),
}));

import { ArrivalRequestForm } from '../../components/airport/ArrivalRequestForm';

const onSubmitted = vi.fn();
const onCancelEdit = vi.fn();

const show = () => render(<ArrivalRequestForm onSubmitted={onSubmitted} />);

/** The same form, seeded from a live request. One component, two jobs. */
const LIVE = {
    id: 'p_live',
    arrivalDate: '2026-12-02', arrivalTime: '00:00', airportCode: 'BOS',
    airline: 'Emirates', flightNumber: 'EK237', terminal: 'E', isInternational: true,
    partySize: 3, largeBags: 5, cabinBags: 2,
    dropoffAddress: '5 Woodbine St, Roxbury, MA',
    hasUsWorkingPhone: false, meetingPointNote: 'Meet at arrivals',
    passenger: {
        name: 'Cab Exa', dateOfBirth: '1998-04-23', phone: '+16175550123',
        whatsappOn: 'primary', email: 'cab@example.com',
        familyContact: { name: 'Sheetal', relationship: 'Mother', phone: '+919876543210', hasWhatsapp: true },
    },
} as never;

const showEditing = () => render(
    <ArrivalRequestForm existing={LIVE} onSubmitted={onSubmitted} onCancelEdit={onCancelEdit} />,
);

/**
 * Open a named accordion section, if it is not open already.
 *
 * Idempotent because the accordion allows ONE open section at a time and starts with
 * "Your flight" open — so a blind click on that one closes it, and the fields the test
 * then looks for are unmounted rather than merely hidden. `probe` is a label only
 * present when the section's panel is mounted.
 */
const openSection = async (name: RegExp, probe: RegExp) => {
    if (screen.queryByLabelText(probe) || screen.queryByPlaceholderText(probe)) return;
    await userEvent.click(screen.getByRole('button', { name }));
};

const FLIGHT: [RegExp, RegExp] = [/your flight/i, /date you land/i];
const DESTINATION: [RegExp, RegExp] = [/where you are going/i, /dorm, apartment/i];
const YOU: [RegExp, RegExp] = [/you, and your family back home/i, /full name/i];

const submit = () =>
    userEvent.click(screen.getByRole('button', { name: /ask for a pickup/i }));

/** The payload the callable was handed, or undefined. */
const sent = () => requestAirportPickup.mock.calls[0]?.[0] as unknown as Record<string, unknown>;

/** The reason shown beside the always-enabled submit button. */
const reason = () => screen.queryByRole('status')?.textContent ?? '';

/**
 * Type a number into one of the three phone controls, in document order: their
 * number, their other number, their family's.
 *
 * Found by selector rather than by role, because a `type="tel"` input is not a
 * `textbox` to testing-library. `PhoneNumberInput` strips non-digits itself, so only
 * the digits need typing.
 */
const typePhone = async (index: number, digits: string) => {
    const inputs = document.querySelectorAll('input[type="tel"]');
    await userEvent.type(inputs[index] as HTMLElement, digits);
};

/** Everything the form insists on, with no address and no family contact. */
const fillMinimum = async () => {
    await openSection(...FLIGHT);
    await userEvent.type(screen.getByLabelText(/date you land/i), '2026-12-02');
    await userEvent.type(screen.getByLabelText(/time you land/i), '01:00');

    await openSection(...YOU);
    await userEvent.type(screen.getByLabelText(/full name/i), 'Cab Exa');
    await userEvent.type(screen.getByLabelText(/date of birth/i), '1998-04-23');
    await userEvent.clear(screen.getByLabelText(/^email$/i));
    await userEvent.type(screen.getByLabelText(/^email$/i), 'cab@example.com');
    await typePhone(0, '6175550123');
};

beforeEach(() => {
    vi.clearAllMocks();
    profilePhone = '';
});

describe('the destination, which is now optional', () => {
    it('does not demand an address before it will send', async () => {
        show();
        await fillMinimum();
        await submit();

        expect(requestAirportPickup).toHaveBeenCalledTimes(1);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('sends NO address key at all, rather than an empty string', async () => {
        // `''` would be a destination whose text happens to be nothing, and the card
        // would render an empty "Going to" row instead of the loud prompt.
        show();
        await fillMinimum();
        await submit();

        expect(sent().dropoffAddress).toBeUndefined();
        expect(sent().dropoffLat).toBeUndefined();
        expect(sent().dropoffLng).toBeUndefined();
    });

    it('says the address is optional, in the label', async () => {
        show();
        await openSection(...DESTINATION);
        expect(screen.getByText(/address \(optional\)/i)).toBeInTheDocument();
    });

    it('tells them what leaving it blank means', async () => {
        show();
        await openSection(...DESTINATION);
        expect(screen.getByText(/leave it blank if you do not know yet/i)).toBeInTheDocument();
    });

    it('no longer tells them to pick from the suggestions as a condition', async () => {
        // The old copy read "Pick it from the suggestions so your Sarthi can navigate
        // to it" full stop, which reads as a requirement.
        show();
        await openSection(...DESTINATION);
        expect(reason()).not.toMatch(/address suggestions/i);
    });

    it('sends free text typed by hand, with no coordinates', async () => {
        show();
        await openSection(...DESTINATION);
        await userEvent.type(
            screen.getByPlaceholderText(/dorm, apartment/i),
            'Northeastern International Village',
        );
        await fillMinimum();
        await submit();

        expect(sent().dropoffAddress).toBe('Northeastern International Village');
        expect(sent().dropoffLat).toBeUndefined();
    });
});

describe('the phone numbers', () => {
    it('refuses to send a primary number with too few digits', async () => {
        show();
        await openSection(...FLIGHT);
        await userEvent.type(screen.getByLabelText(/date you land/i), '2026-12-02');
        await userEvent.type(screen.getByLabelText(/time you land/i), '01:00');
        await openSection(...YOU);
        await userEvent.type(screen.getByLabelText(/full name/i), 'Cab Exa');
        await userEvent.type(screen.getByLabelText(/date of birth/i), '1998-04-23');
        await typePhone(0, '617555');

        await submit();

        expect(requestAirportPickup).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(
            expect.stringMatching(/right number of digits/i));
    });

    it('names WHICH number is wrong, not just "check your details"', async () => {
        show();
        await fillMinimum();
        await typePhone(1, '99');
        await submit();

        expect(toast.error).toHaveBeenCalledWith(
            expect.stringMatching(/other phone number/i));
    });

    it('stores the E.164 form rather than the formatted display string', async () => {
        show();
        await fillMinimum();
        await submit();

        // The default country is US/CA, so ten digits become +1…
        expect(sent().phone).toBe('+16175550123');
    });

    it('accepts a complete number and sends it', async () => {
        show();
        await fillMinimum();
        await submit();
        expect(requestAirportPickup).toHaveBeenCalledTimes(1);
    });

    it('leaves the optional second number out when it is blank', async () => {
        show();
        await fillMinimum();
        await submit();
        expect(sent().altPhone).toBeUndefined();
    });

    it('checks the family number too, when a family contact is given', async () => {
        show();
        await fillMinimum();
        await userEvent.type(screen.getByLabelText(/family contact name/i), 'Rajesh');
        await typePhone(2, '99');
        await submit();

        expect(requestAirportPickup).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/digits/i));
    });

    it('shows the privacy line ONCE, not once per number', async () => {
        // Three copies of the same sentence reads as a rendering fault.
        show();
        await openSection(...YOU);
        expect(screen.getAllByText(/kept private, used only/i)).toHaveLength(1);
    });

    it('offers a country selector on each number, so a +91 number is valid', async () => {
        show();
        await openSection(...YOU);
        // Three numbers asked for: theirs, their other one, their family's.
        expect(document.querySelectorAll('input[type="tel"]')).toHaveLength(3);
    });
});

describe('the two fields that were removed', () => {
    it('no longer asks "anything we should know"', async () => {
        show();
        await openSection(...DESTINATION);
        expect(screen.queryByLabelText(/anything we should know/i)).not.toBeInTheDocument();
    });

    it('no longer asks for somebody here who knows you', async () => {
        show();
        await openSection(...YOU);
        expect(screen.queryByLabelText(/somebody here who knows you/i)).not.toBeInTheDocument();
    });

    it('never sends either field', async () => {
        show();
        await fillMinimum();
        await submit();
        expect(sent()).not.toHaveProperty('specialNeeds');
        expect(sent()).not.toHaveProperty('referredByName');
    });

    it('keeps the two that were NOT removed', async () => {
        // `needsStopOnTheWay` and the free-text `notes` both survive — `notes` is what
        // now carries an infant or a wheelchair.
        show();
        await openSection(...DESTINATION);
        expect(screen.getByLabelText(/stop on the way/i)).toBeInTheDocument();
        await openSection(...YOU);
        expect(screen.getByLabelText(/anything else/i)).toBeInTheDocument();
    });
});

/**
 * THE SAME FORM, EDITING. Added 2026-08-25: a traveller could file a request and then
 * only cancel it, so a moved flight meant cancelling and starting again — which loses
 * the Sarthi who had already taken it.
 *
 * One component rather than two. A separate edit screen would be these twenty fields
 * and this validation a second time, drifting the first time either changed.
 */
describe('editing a request that already exists', () => {
    it('opens pre-filled, rather than making them type it all again', () => {
        showEditing();
        expect(screen.getByDisplayValue('EK237')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Emirates')).toBeInTheDocument();
        expect(screen.getByDisplayValue('E')).toBeInTheDocument();
    });

    it('says save rather than ask, because the request already exists', () => {
        showEditing();
        expect(screen.getByRole('button', { name: /Save changes/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Ask for a pickup/i })).not.toBeInTheDocument();
    });

    it('offers a way out that changes nothing', async () => {
        showEditing();
        await userEvent.click(screen.getByRole('button', { name: /Leave it as it was/i }));
        expect(onCancelEdit).toHaveBeenCalled();
        expect(updateAirportPickup).not.toHaveBeenCalled();
    });

    it('sends the WHOLE request with the id, not a patch', async () => {
        // The server runs the same three parsers the create path runs, so a partial
        // payload would be refused — and a laxer edit path would be a side door into a
        // collection no client may write directly.
        showEditing();
        await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));

        expect(updateAirportPickup).toHaveBeenCalledWith(expect.objectContaining({
            pickupId: 'p_live', action: 'editRequest',
            flightNumber: 'EK237', partySize: 3, largeBags: 5,
            fullName: 'Cab Exa', phone: '+16175550123',
        }));
        expect(requestAirportPickup).not.toHaveBeenCalled();
    });

    it('hides the two fields that live on the profile, not on the trip', () => {
        // A university and a preferred name are stored on airportProfiles, which no
        // client may read — so showing them would mean showing a blank box beside a
        // value the traveller knows they typed.
        showEditing();
        expect(screen.queryByLabelText(/University or employer/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/What you like to be called/i)).not.toBeInTheDocument();
    });

    it('still shows both of them on a NEW request', async () => {
        show();
        await openSection(...YOU);
        expect(screen.getByLabelText(/University or employer/i)).toBeInTheDocument();
    });

    it('accepts the stored phone numbers without making them be retyped', async () => {
        // `missing()` refuses to submit while the primary number is unvalidated. With
        // these left blank, a traveller changing only their terminal was told to check
        // a number they had never touched, and Save could not be made to work.
        showEditing();
        await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
        expect(toast.error).not.toHaveBeenCalled();
        expect(updateAirportPickup).toHaveBeenCalled();
    });
});

/**
 * A PROFILE THAT ALREADY HAS A NUMBER, which is every returning member.
 *
 * Reported from a phone on 2026-08-28: "Ask for a pickup" refused with "Check your
 * phone number — it does not have the right number of digits", pointing at a field that
 * showed a correct number and a green tick.
 *
 * The form pre-filled `form.phone` from the profile but seeded `phones.phone.valid`
 * from `existing` only — two expressions for the same three numbers, one with a
 * fallback and one without. So the request could not be sent at all unless the person
 * deleted a correct number and retyped it, which nobody would think to try.
 *
 * Nothing caught it because the auth mock hardcoded `phone: ''`, so every test typed
 * its own number and fired the field's onChange.
 */
describe('a profile that already has a number', () => {
    it('can be submitted without retyping it', async () => {
        profilePhone = '+18572302738';
        show();

        // Everything EXCEPT the phone, which is already there from the profile.
        await openSection(...FLIGHT);
        await userEvent.type(screen.getByLabelText(/date you land/i), '2026-12-02');
        await userEvent.type(screen.getByLabelText(/time you land/i), '01:00');
        await openSection(...YOU);
        await userEvent.type(screen.getByLabelText(/full name/i), 'Cab Exa');
        await userEvent.type(screen.getByLabelText(/date of birth/i), '1998-04-23');

        expect(reason()).toBe('');
        await submit();
        expect(requestAirportPickup).toHaveBeenCalled();
    });

    it('sends the stored number in E.164, not the display string', async () => {
        profilePhone = '+18572302738';
        show();
        await openSection(...FLIGHT);
        await userEvent.type(screen.getByLabelText(/date you land/i), '2026-12-02');
        await userEvent.type(screen.getByLabelText(/time you land/i), '01:00');
        await openSection(...YOU);
        await userEvent.type(screen.getByLabelText(/full name/i), 'Cab Exa');
        await userEvent.type(screen.getByLabelText(/date of birth/i), '1998-04-23');
        await submit();

        expect(sent().phone).toBe('+18572302738');
    });

    it('still refuses a stored number that is genuinely too short', async () => {
        // The seed is RE-VALIDATED, not trusted — a number stored before a rule
        // tightened must fail here rather than at the server.
        profilePhone = '+1857230';
        show();
        await openSection(...FLIGHT);
        await userEvent.type(screen.getByLabelText(/date you land/i), '2026-12-02');
        await userEvent.type(screen.getByLabelText(/time you land/i), '01:00');
        await openSection(...YOU);
        await userEvent.type(screen.getByLabelText(/full name/i), 'Cab Exa');
        await userEvent.type(screen.getByLabelText(/date of birth/i), '1998-04-23');

        expect(reason()).toMatch(/right number of digits/i);
    });
});
