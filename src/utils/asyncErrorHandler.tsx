/**
 * Async Error Handler
 * Wraps async functions to catch errors and handle them gracefully
 */

import React, { createContext, useContext, ReactNode } from 'react';

interface ErrorContextType {
  showError: (message: string, error?: Error) => void;
}

const ErrorContext = createContext<ErrorContextType | null>(null);

export const useErrorHandler = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrorHandler must be used within ErrorProvider');
  }
  return context;
};

interface ErrorProviderProps {
  children: ReactNode;
  onError?: (message: string, error?: Error) => void;
}

export const ErrorProvider: React.FC<ErrorProviderProps> = ({ children, onError }) => {
  const showError = (message: string, error?: Error) => {
    console.error(`[AsyncError] ${message}`, error);

    if (onError) {
      onError(message, error);
    } else {
      // Default: Show user-friendly alert
      alert(`Error: ${message}\n\nPlease try again or contact support if the problem persists.`);
    }
  };

  return (
    <ErrorContext.Provider value={{ showError }}>
      {children}
    </ErrorContext.Provider>
  );
};

/**
 * Wrapper for async functions to handle errors gracefully
 */
export function withAsyncErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorMessage?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = errorMessage || 'An unexpected error occurred';
      console.error(`[AsyncError] ${message}`, error);

      const errorText = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}: ${errorText}`);
    }
  }) as T;
}

/**
 * React Hook for async error handling in components
 */
export function useAsyncErrorHandler() {
  const { showError } = useErrorHandler();

  const handleAsync = async <T,>(
    fn: () => Promise<T>,
    errorMessage?: string
  ): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      const message = errorMessage || 'Operation failed';
      showError(message, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  };

  return { handleAsync, showError };
}
