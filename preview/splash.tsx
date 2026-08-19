// The splash screen. Added because it reported a strip of uncovered screen along
// the bottom on a phone, and that is not something to fix by reasoning about
// viewport units — it needs measuring at a phone's aspect ratio.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { SplashScreen } from '../components/auth/SplashScreen';

document.documentElement.setAttribute('data-theme', 'dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
    <SplashScreen onComplete={() => console.log('splash dismissed')} />
);
