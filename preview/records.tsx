// The Raw records page. Added so the console's banner and filter row can be seen
// without Firestore or a sign-in.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { ManagerRecords } from '../components/manager/ManagerRecords';
import { ToastProvider } from '../contexts/ToastContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <ToastProvider><ManagerRecords /></ToastProvider>
);
