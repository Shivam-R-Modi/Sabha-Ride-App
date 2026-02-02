import React from 'react';
import { Car, User, Phone, MapPin } from 'lucide-react';
import { Card, CardContent, Badge } from '../common';
import type { Ride } from '../../types';

interface AssignedScreenProps {
    ride: Ride;
}

export const AssignedScreen: React.FC<AssignedScreenProps> = ({ ride }) => {
    return (
        <div className="space-y-6">
            {/* Success Header */}
            <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                        className="w-10 h-10 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    Driver Assigned!
                </h2>
                <p className="text-gray-600">
                    Your driver will arrive shortly. Please be ready at your pickup location.
                </p>
            </div>

            {/* Driver Info Card */}
            <Card>
                <CardContent>
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-16 h-16 bg-saffron/10 rounded-full flex items-center justify-center">
                            <User className="w-8 h-8 text-saffron" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">
                                {ride.driverName}
                            </h3>
                            <Badge variant="success">Driver</Badge>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Car className="w-5 h-5 text-gray-400" />
                            <div>
                                <p className="font-medium text-gray-900">
                                    {ride.carColor} {ride.carModel}
                                </p>
                                <p className="text-sm text-gray-500">{ride.carLicensePlate}</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Pickup Location */}
            <Card>
                <CardContent>
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                            <MapPin className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900 mb-1">
                                Pickup Location
                            </h3>
                            <p className="text-gray-600">
                                {ride.students.find((s) => s.id)?.location?.address ||
                                    'Your saved address'}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Ride Details */}
            <Card className="bg-gray-50 border-gray-200">
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-gray-500 mb-1">Ride Type</p>
                            <p className="font-medium text-gray-900">
                                {ride.rideType === 'home-to-sabha'
                                    ? 'Home → Sabha'
                                    : 'Sabha → Home'}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 mb-1">Ride Number</p>
                            <p className="font-medium text-gray-900">
                                #{ride.id.slice(-6).toUpperCase()}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 mb-1">Est. Distance</p>
                            <p className="font-medium text-gray-900">
                                {ride.estimatedDistance.toFixed(1)} km
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 mb-1">Est. Time</p>
                            <p className="font-medium text-gray-900">
                                {ride.estimatedTime} min
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Instructions */}
            <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
                <h4 className="font-semibold text-yellow-900 mb-2">
                    Before the driver arrives:
                </h4>
                <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
                    <li>Be ready at your pickup location</li>
                    <li>Keep your phone nearby</li>
                    <li>Look for a {ride.carColor} {ride.carModel}</li>
                    <li>Verify the license plate: {ride.carLicensePlate}</li>
                </ul>
            </div>
        </div>
    );
};
