/**
 * Notifications Hook
 * Manages push notifications and browser notifications
 */

import { useState, useEffect, useCallback } from 'react';
import {
    requestNotificationPermission,
    setupMessageHandler,
    showBrowserNotification,
    getNotificationContent,
    checkNotificationStatus,
} from '../utils/notifications';
import type { NotificationType } from '../utils/notifications';

interface UseNotificationsReturn {
    permission: NotificationPermission;
    isSupported: boolean;
    token: string | null;
    requestPermission: () => Promise<string | null>;
    showNotification: (title: string, body: string) => void;
    sendLocalNotification: (type: NotificationType, data?: Record<string, string>) => void;
}

export function useNotifications(): UseNotificationsReturn {
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [isSupported, setIsSupported] = useState(false);
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        const status = checkNotificationStatus();
        setIsSupported(status.supported);
        setPermission(status.permission);
    }, []);

    useEffect(() => {
        if (!isSupported) return;

        // Setup foreground message handler
        setupMessageHandler((payload) => {
            showBrowserNotification(payload.title, payload.body);
        });
    }, [isSupported]);

    const requestPermission = useCallback(async (): Promise<string | null> => {
        const fcmToken = await requestNotificationPermission();
        if (fcmToken) {
            setToken(fcmToken);
            setPermission('granted');
        }
        return fcmToken;
    }, []);

    const showNotification = useCallback((title: string, body: string) => {
        showBrowserNotification(title, body);
    }, []);

    const sendLocalNotification = useCallback(
        (type: NotificationType, data?: Record<string, string>) => {
            const { title, body } = getNotificationContent(type, data);
            showBrowserNotification(title, body);
        },
        []
    );

    return {
        permission,
        isSupported,
        token,
        requestPermission,
        showNotification,
        sendLocalNotification,
    };
}

// Hook for in-app notification banners
interface NotificationBanner {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
}

interface UseNotificationBannersReturn {
    banners: NotificationBanner[];
    showBanner: (title: string, message: string, type?: NotificationBanner['type']) => void;
    dismissBanner: (id: string) => void;
    clearAll: () => void;
}

export function useNotificationBanners(): UseNotificationBannersReturn {
    const [banners, setBanners] = useState<NotificationBanner[]>([]);

    const showBanner = useCallback(
        (title: string, message: string, type: NotificationBanner['type'] = 'info') => {
            const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const banner: NotificationBanner = { id, title, message, type };
            setBanners((prev) => [...prev, banner]);

            // Auto-dismiss after 5 seconds
            setTimeout(() => {
                dismissBanner(id);
            }, 5000);
        },
        []
    );

    const dismissBanner = useCallback((id: string) => {
        setBanners((prev) => prev.filter((b) => b.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setBanners([]);
    }, []);

    return {
        banners,
        showBanner,
        dismissBanner,
        clearAll,
    };
}
