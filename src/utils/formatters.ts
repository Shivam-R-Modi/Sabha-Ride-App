/**
 * Formatting Utilities for Sabha Ride Seva
 */

import { format, formatDistanceToNow, parseISO } from 'date-fns';

/**
 * Format a date to display format
 * @param date Date string or Date object
 * @returns Formatted date string
 */
export function formatDate(date: string | Date): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return format(d, 'MMM d, yyyy');
}

/**
 * Format a time to display format
 * @param date Date string or Date object
 * @returns Formatted time string
 */
export function formatTime(date: string | Date): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return format(d, 'h:mm a');
}

/**
 * Format date and time together
 * @param date Date string or Date object
 * @returns Formatted date and time string
 */
export function formatDateTime(date: string | Date): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return format(d, 'MMM d, yyyy h:mm a');
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param date Date string or Date object
 * @returns Relative time string
 */
export function formatRelativeTime(date: string | Date): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format distance in kilometers
 * @param km Distance in kilometers
 * @returns Formatted distance string
 */
export function formatDistance(km: number): string {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
}

/**
 * Format duration in minutes
 * @param minutes Duration in minutes
 * @returns Formatted duration string
 */
export function formatDuration(minutes: number): string {
    if (minutes < 60) {
        return `${Math.round(minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format a phone number
 * @param phone Phone number string
 * @returns Formatted phone number
 */
export function formatPhone(phone: string): string {
    if (!phone) return '';

    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');

    // Format based on length
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }

    return phone;
}

/**
 * Format a name to title case
 * @param name Name string
 * @returns Title-cased name
 */
export function formatName(name: string): string {
    if (!name) return '';

    return name
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Truncate text with ellipsis
 * @param text Text to truncate
 * @param maxLength Maximum length
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

/**
 * Format a number with commas
 * @param num Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number): string {
    return num.toLocaleString();
}

/**
 * Get day of week name
 * @param date Date string or Date object
 * @returns Day name
 */
export function getDayName(date: string | Date): string {
    const d = typeof date === 'string' ? parseISO(date) : date;
    return format(d, 'EEEE');
}

/**
 * Check if date is today
 * @param date Date string or Date object
 * @returns Boolean
 */
export function isToday(date: string | Date): boolean {
    const d = typeof date === 'string' ? parseISO(date) : date;
    const today = new Date();
    return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
    );
}

/**
 * Format ride status for display
 * @param status Ride status
 * @returns Formatted status string
 */
export function formatRideStatus(status: string): string {
    const statusMap: Record<string, string> = {
        assigned: 'Assigned',
        in_progress: 'In Progress',
        completed: 'Completed',
        cancelled: 'Cancelled',
        waiting_for_pickup: 'Waiting for Pickup',
        waiting_for_dropoff: 'Waiting for Drop-off',
        in_ride: 'In Ride',
        at_sabha: 'At Sabha',
        home_safe: 'Home Safe',
    };

    return statusMap[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Format role for display
 * @param role User role
 * @returns Formatted role string
 */
export function formatRole(role: string): string {
    const roleMap: Record<string, string> = {
        student: 'Student',
        driver: 'Driver',
        manager: 'Manager',
    };

    return roleMap[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Get initials from name
 * @param name Full name
 * @returns Initials (up to 2 characters)
 */
export function getInitials(name: string): string {
    if (!name) return '';

    const parts = name.split(' ');
    if (parts.length === 1) {
        return parts[0].charAt(0).toUpperCase();
    }

    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Format file size
 * @param bytes Size in bytes
 * @returns Formatted size string
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
