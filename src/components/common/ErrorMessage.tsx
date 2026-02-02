import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorMessageProps {
    message: string;
    onDismiss?: () => void;
    className?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
    message,
    onDismiss,
    className = '',
}) => {
    return (
        <div
            className={`bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 ${className}`}
            role="alert"
        >
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="text-sm text-red-700">{message}</p>
            </div>
            {onDismiss && (
                <button
                    onClick={onDismiss}
                    className="text-red-400 hover:text-red-600 transition-colors"
                    aria-label="Dismiss error"
                >
                    <X className="w-5 h-5" />
                </button>
            )}
        </div>
    );
};
