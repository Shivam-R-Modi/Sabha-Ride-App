import React from 'react';
import { Clock, MapPin, Edit2 } from 'lucide-react';
import { Card, CardContent, Button } from '../common';
import type { Student, RideContext } from '../../types';

interface WaitingScreenProps {
    student: Student;
    rideContext: RideContext | null;
    onEditLocation: () => void;
}

export const WaitingScreen: React.FC<WaitingScreenProps> = ({
    student,
    rideContext,
    onEditLocation,
}) => {
    const isWaitingForPickup = student.status === 'waiting_for_pickup';
    const isWaitingForDropoff = student.status === 'waiting_for_dropoff';

    return (
        <div className="space-y-6">
            {/* Status Card */}
            <Card className="text-center py-8">
                <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock className="w-10 h-10 text-saffron animate-pulse" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {isWaitingForPickup && 'Waiting for Pickup'}
                    {isWaitingForDropoff && 'Waiting for Drop-off'}
                </h2>
                <p className="text-gray-600 max-w-sm mx-auto">
                    {isWaitingForPickup &&
                        'You will be automatically assigned to a driver. Please be ready at your pickup location.'}
                    {isWaitingForDropoff &&
                        'A driver will be assigned to take you home. Please wait at the Sabha entrance.'}
                </p>
            </Card>

            {/* Location Card */}
            <Card>
                <CardContent>
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                            <MapPin className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-gray-900 mb-1">Your Location</h3>
                            <p className="text-gray-600 text-sm">
                                {student.location?.address || 'No address set'}
                            </p>
                            {student.location?.lat && student.location?.lng && (
                                <p className="text-gray-400 text-xs mt-1">
                                    {student.location.lat.toFixed(6)},{' '}
                                    {student.location.lng.toFixed(6)}
                                </p>
                            )}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<Edit2 className="w-4 h-4" />}
                            onClick={onEditLocation}
                        >
                            Edit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Ride Context Info */}
            {rideContext && (
                <Card className="bg-gray-50 border-gray-200">
                    <CardContent>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <div>
                                <p className="font-medium text-gray-900">
                                    {rideContext.displayText}
                                </p>
                                <p className="text-sm text-gray-500">{rideContext.timeContext}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Instructions */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <h4 className="font-semibold text-blue-900 mb-2">What to expect:</h4>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>You will receive a notification when a driver is assigned</li>
                    <li>The driver will arrive at your location</li>
                    <li>No need to call or message - just wait patiently</li>
                    <li>Keep your phone nearby for updates</li>
                </ul>
            </div>
        </div>
    );
};
