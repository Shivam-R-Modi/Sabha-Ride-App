import React from 'react';
import { Car, Users, Navigation } from 'lucide-react';
import { Card, CardContent, Badge } from '../common';
import type { Ride } from '../../types';

interface InRideScreenProps {
    ride: Ride;
}

export const InRideScreen: React.FC<InRideScreenProps> = ({ ride }) => {
    const destination =
        ride.rideType === 'home-to-sabha' ? 'Sabha' : 'Home';

    return (
        <div className="space-y-6">
            {/* Status Header */}
            <div className="text-center">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <Car className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    Riding to {destination}
                </h2>
                <Badge variant="info" size="md">
                    In Progress
                </Badge>
            </div>

            {/* Driver Info */}
            <Card>
                <CardContent>
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-saffron/10 rounded-full flex items-center justify-center">
                            <Car className="w-7 h-7 text-saffron" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900">{ride.driverName}</h3>
                            <p className="text-gray-600">
                                {ride.carColor} {ride.carModel}
                            </p>
                            <p className="text-sm text-gray-500 font-mono">
                                {ride.carLicensePlate}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Passengers */}
            <Card>
                <CardContent>
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="w-5 h-5 text-gray-400" />
                        <h3 className="font-semibold text-gray-900">
                            Riding with ({ride.students.length})
                        </h3>
                    </div>
                    <div className="space-y-2">
                        {ride.students.map((student, index) => (
                            <div
                                key={student.id}
                                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                            >
                                <div className="w-8 h-8 bg-saffron/20 rounded-full flex items-center justify-center text-saffron font-bold text-sm">
                                    {index + 1}
                                </div>
                                <span className="font-medium text-gray-900">
                                    {student.name}
                                </span>
                                {student.picked && (
                                    <Badge variant="success" size="sm">
                                        Picked
                                    </Badge>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Route Info */}
            <Card className="bg-gray-50 border-gray-200">
                <CardContent>
                    <div className="flex items-center gap-3 mb-4">
                        <Navigation className="w-5 h-5 text-saffron" />
                        <h3 className="font-semibold text-gray-900">Route Information</h3>
                    </div>
                    <div className="space-y-3">
                        {ride.route.map((waypoint, index) => (
                            <div
                                key={index}
                                className={`flex items-center gap-3 ${waypoint.visited ? 'opacity-50' : ''
                                    }`}
                            >
                                <div
                                    className={`w-3 h-3 rounded-full ${waypoint.visited
                                            ? 'bg-green-500'
                                            : waypoint.type === 'start'
                                                ? 'bg-blue-500'
                                                : waypoint.type === 'end'
                                                    ? 'bg-red-500'
                                                    : 'bg-saffron'
                                        }`}
                                />
                                <span
                                    className={`text-sm ${waypoint.visited
                                            ? 'line-through text-gray-400'
                                            : 'text-gray-700'
                                        }`}
                                >
                                    {waypoint.name}
                                </span>
                                {waypoint.visited && (
                                    <span className="text-xs text-green-600">Visited</span>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Info Message */}
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <p className="text-sm text-blue-800">
                    Sit back and relax. The driver will drop you off at your destination.
                    No action needed from you.
                </p>
            </div>
        </div>
    );
};
