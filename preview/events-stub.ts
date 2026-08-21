// Stand-ins for the events + settings hooks in the visual harness.
//
// Both open onSnapshot listeners against the stubbed `db`, which is `{}` — the
// real hooks throw "Expected first argument to doc() to be a
// CollectionReference" the moment they mount.
//
// `formatTime` is deliberately re-exported from the REAL module rather than
// reimplemented. It is a pure display helper, and a second copy here would let
// the preview show times the app would not.
export { formatTime } from '../hooks/useSettings';

export interface SabhaEvent {
    id: string; date: string; startTime: string; endTime: string;
    venue: { lat: number; lng: number; address: string } | null;
    agenda: string; status: 'scheduled' | 'cancelled';
    source: 'rule' | 'override' | 'one-off'; autoCreated: boolean;
}

const week = (date: string, over: Partial<SabhaEvent> = {}): SabhaEvent => ({
    id: date, date, startTime: '20:30', endTime: '22:00',
    venue: null, agenda: '', status: 'scheduled', source: 'rule', autoCreated: true, ...over,
});

/** Twelve weeks — the count that made the old list unreadable. */
export const useUpcomingEvents = () => ({
    events: [
        week('2026-08-28'),
        week('2026-09-04'),
        week('2026-09-11', {
            source: 'override', startTime: '19:00', endTime: '21:00',
            agenda: 'Guest sant from Ahmedabad. Bhojan after.',
            venue: { lat: 42.35, lng: -71.1, address: '120 Beacon St, Boston MA' },
        }),
        week('2026-09-18'),
        week('2026-09-25'),
        week('2026-10-02'),
        week('2026-10-09'),
        week('2026-10-16', { source: 'one-off' }),
        week('2026-10-23'),
        week('2026-10-30'),
        week('2026-11-06'),
        week('2026-11-13'),
    ],
    loading: false,
    error: null,
    rule: {
        enabled: true, daysOfWeek: [5], startTime: '20:30', endTime: '22:00',
        venue: null, agenda: '',
    },
});

export const editOccurrence = async () => undefined;
export const createOneOff = async () => undefined;

export const useSettings = () => ({
    sabhaLocation: { lat: 42.339362, lng: -71.0878001, address: '346 Huntington Ave, Boston, MA 02115' },
    sabhaStartTime: '20:30',
    sabhaEndTime: '22:00',
    loading: false,
});
