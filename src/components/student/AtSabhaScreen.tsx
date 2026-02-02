import React from 'react';
import { CheckCircle, Home, Clock } from 'lucide-react';
import { Card, CardContent, Button } from '../common';
import type { RideContext } from '../../types';

interface AtSabhaScreenProps {
    rideContext: RideContext | null;
    onReadyToLeave: () => void;
    isLoading?: boolean;
}

export const AtSabhaScreen: React.FC<AtSabhaScreenProps> = ({
    rideContext,
    onReadyToLeave,
    isLoading = false,
}) => {
    // Check if it's after 10 PM (drop-off time)
    const isDropOffTime = rideContext?.rideType === 'sabha-to-home';

    return (
        <div className="space-y-6">
            {/* Success Header */}
            <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    Arrived at Sabha!
                </h2>
                <p className="text-gray-600">
                    Enjoy the Sabha. When you're ready to leave, click the button below.
                </p>
            </div>

            {/* Status Card */}
            <Card className="bg-green-50 border-green-200">
                <CardContent>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-green-900">
                                Pickup Ride Completed
                            </h3>
                            <p className="text-sm text-green-700">
                                You have successfully arrived at Sabha
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Ready to Leave Section */}
            <Card>
                <CardContent className="text-center py-6">
                    <div className="w-16 h-16 bg-saffron/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Home className="w-8 h-8 text-saffron" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                        Ready to Leave?
                    </h3>
                    <p className="text-gray-600 mb-6">
                        {isDropOffTime
                            ? 'Click the button below to request your ride home'
                            : 'Drop-off rides will be available after 10 PM'}
                    </p>

                    {!isDropOffTime ? (
                        <div className="bg-gray-100 rounded-xl p-4">
                            <div className="flex items-center justify-center gap-2 text-gray-500">
                                <Clock className="w-5 h-5" />
                                <span>Available after 10:00 PM</span>
                            </div>
                        </div>
                    ) : (
                        <Button
                            size="lg"
                            className="w-full"
                            onClick={onReadyToLeave}
                            isLoading={isLoading}
                            leftIcon={<Home className="w-5 h-5" />}
                        >
                            I'm Ready to Leave
                        </Button>
                    )}
                </CardContent>
            </Card>

            {/* Instructions */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <h4 className="font-semibold text-blue-900 mb-2">
                    For your return journey:
                </h4>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Click "I'm Ready to Leave" when you're done</li>
                    <li>A driver will be assigned to take you home</li>
                    <li>Wait at the Sabha entrance for your ride</li>
                    <li>You'll receive a notification when the driver arrives</li>
                </ul>
            </div>
        </div>
    );
};
