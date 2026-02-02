import React from 'react';
import { Clock, ArrowRight, Info } from 'lucide-react';
import { Card, CardContent, Badge } from '../common';
import type { RideContext } from '../../types';

interface RideTypeDisplayProps {
    rideContext: RideContext | null;
}

export const RideTypeDisplay: React.FC<RideTypeDisplayProps> = ({
    rideContext,
}) => {
    if (!rideContext || !rideContext.rideType) {
        return (
            <Card className="bg-gray-100 border-gray-200">
                <CardContent>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                            <Clock className="w-5 h-5 text-gray-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-700">
                                No Rides Available
                            </h3>
                            <p className="text-sm text-gray-500">
                                {rideContext?.timeContext || 'Rides are only available on Fridays'}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const isPickup = rideContext.rideType === 'home-to-sabha';

    return (
        <Card className={isPickup ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'}>
            <CardContent>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center ${isPickup ? 'bg-blue-100' : 'bg-purple-100'
                                }`}
                        >
                            <ArrowRight
                                className={`w-6 h-6 ${isPickup ? 'text-blue-600' : 'text-purple-600'
                                    }`}
                            />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900">
                                {rideContext.displayText}
                            </h3>
                            <p className="text-sm text-gray-600">{rideContext.timeContext}</p>
                        </div>
                    </div>
                    <Badge variant={isPickup ? 'info' : 'default'}>
                        {isPickup ? 'Pickup' : 'Drop-off'}
                    </Badge>
                </div>

                <div className="mt-4 flex items-start gap-2 text-sm text-gray-600">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                        {isPickup
                            ? 'Select a car and click "Assign Me" to get students for pickup.'
                            : 'Select a car and click "Assign Me" to get students for drop-off.'}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};
