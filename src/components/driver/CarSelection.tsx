import React from 'react';
import { Car, Check, Users } from 'lucide-react';
import { Card, CardContent, Button } from '../common';
import type { Car } from '../../types';

interface CarSelectionProps {
    cars: Car[];
    selectedCarId: string | null;
    onSelectCar: (carId: string) => void;
    isLoading?: boolean;
}

export const CarSelection: React.FC<CarSelectionProps> = ({
    cars,
    selectedCarId,
    onSelectCar,
    isLoading = false,
}) => {
    if (cars.length === 0) {
        return (
            <Card className="bg-gray-50 border-gray-200">
                <CardContent className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Car className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                        No Cars Available
                    </h3>
                    <p className="text-gray-500">
                        All cars are currently in use. Please wait or contact the manager.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
                Select Your Car
            </h3>
            <p className="text-sm text-gray-500">
                Choose a car for this session. You must select a car every time.
            </p>

            <div className="space-y-3">
                {cars.map((car) => (
                    <Card
                        key={car.id}
                        className={`cursor-pointer transition-all ${selectedCarId === car.id
                                ? 'ring-2 ring-saffron border-saffron'
                                : 'hover:border-gray-300'
                            }`}
                        onClick={() => onSelectCar(car.id)}
                    >
                        <CardContent>
                            <div className="flex items-center gap-4">
                                <div
                                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${selectedCarId === car.id
                                            ? 'bg-saffron text-white'
                                            : 'bg-gray-100 text-gray-600'
                                        }`}
                                >
                                    {selectedCarId === car.id ? (
                                        <Check className="w-6 h-6" />
                                    ) : (
                                        <Car className="w-6 h-6" />
                                    )}
                                </div>

                                <div className="flex-1">
                                    <h4 className="font-semibold text-gray-900">{car.model}</h4>
                                    <div className="flex items-center gap-3 text-sm text-gray-500">
                                        <span>{car.color}</span>
                                        <span>•</span>
                                        <span className="font-mono">{car.licensePlate}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 text-sm text-gray-600">
                                    <Users className="w-4 h-4" />
                                    <span>{car.capacity} seats</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {selectedCarId && (
                <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                    <p className="text-sm text-green-800">
                        <strong>Car selected!</strong> Click "Assign Me" to get students.
                    </p>
                </div>
            )}
        </div>
    );
};
