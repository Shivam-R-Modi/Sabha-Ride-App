import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Root-level Error Boundary to catch React render errors
 * and display a user-friendly fallback instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #FFFBEB 0%, #FFF7ED 100%)',
                    padding: '24px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                }}>
                    <div style={{
                        background: 'white',
                        borderRadius: '24px',
                        padding: '48px',
                        textAlign: 'center',
                        maxWidth: '420px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.1)',
                    }}>
                        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🙏</div>
                        <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#44403C', marginBottom: '8px' }}>
                            Something went wrong
                        </h2>
                        <p style={{ color: '#A8A29E', marginBottom: '24px', lineHeight: '1.6' }}>
                            The app encountered an unexpected error. Please try refreshing the page.
                        </p>
                        {this.state.error && (
                            <details style={{
                                textAlign: 'left',
                                marginBottom: '24px',
                                padding: '12px',
                                background: '#FEF2F2',
                                borderRadius: '12px',
                                fontSize: '12px',
                                color: '#991B1B',
                            }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Error details</summary>
                                <pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {this.state.error.message}
                                </pre>
                            </details>
                        )}
                        <button
                            onClick={this.handleReload}
                            style={{
                                width: '100%',
                                padding: '14px',
                                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '16px',
                                fontWeight: 'bold',
                                fontSize: '16px',
                                cursor: 'pointer',
                                boxShadow: '0 10px 15px -3px rgba(245, 158, 11, 0.3)',
                            }}
                        >
                            Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
