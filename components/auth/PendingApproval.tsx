import React from 'react';
import { Clock, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import { LotusIcon } from '../../constants';
import { UserRole } from '../../types';

interface PendingApprovalProps {
    role: UserRole;
    onBack: () => void;
}

export const PendingApproval: React.FC<PendingApprovalProps> = ({ role, onBack }) => {
    // Dynamic Content based on Role
    let title = "Pending Approval";
    let description = "Your account is currently under review.";
    let steps = [
        { title: "Profile Submitted", desc: "We have your details.", completed: true },
        { title: "Verification", desc: "Checking your information.", completed: false },
        { title: "Access Granted", desc: "You'll be notified soon.", completed: false },
    ];

    if (role === 'manager') {
        title = "Access Restricted";
        description = "Backend needs to grant you access for the manager role.";
        steps = [
            { title: "Role Selected", desc: "Manager role requested.", completed: true },
            { title: "Security Check", desc: "Waiting for admin authorization.", completed: false },
            { title: "Dashboard Access", desc: "Access to logistics enabled.", completed: false },
        ];
    } else if (role === 'driver') {
        title = "Rider Status Pending";
        description = "Need to wait for the manager to confirm your rider status.";
        steps = [
            { title: "Registration", desc: "Car and contact details sent.", completed: true },
            { title: "Safety Review", desc: "Manager reviews your profile.", completed: false },
            { title: "Ready to Drive", desc: "You can start accepting rides.", completed: false },
        ];
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
            <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-8 animate-pulse clay-card ${role === 'manager' ? 'text-purple-600' : 'text-saffron'}`}>
                {role === 'manager' ? <Lock className="w-10 h-10" /> : <Clock className="w-10 h-10" />}
            </div>

            <h2 className="font-header font-bold text-2xl text-coffee mb-3">{title}</h2>
            <p className="text-gray-500 mb-8 max-w-xs mx-auto">
                {description}
            </p>

            <div className="clay-card w-full max-w-sm text-left space-y-4 mb-8">
                {steps.map((step, idx) => (
                    <div key={idx} className={`flex items-start gap-3 ${step.completed ? '' : 'opacity-50'}`}>
                        {step.completed ? (
                            <CheckCircle2 className="text-green-500 shrink-0 mt-0.5" size={20} />
                        ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0 mt-0.5"></div>
                        )}
                        <div>
                            <h4 className="font-bold text-sm text-coffee">{step.title}</h4>
                            <p className="text-xs text-gray-400">{step.desc}</p>
                        </div>
                    </div>
                ))}
            </div>

            <button
                onClick={onBack}
                className="clay-button-secondary w-full max-w-[200px]"
            >
                Logout & Return
            </button>

            <div className="mt-12 opacity-50">
                <LotusIcon className="w-8 h-8 text-coffee mx-auto" />
            </div>
        </div>
    );
};