import React, { useState, useEffect } from 'react';
import { X, MapPin, Navigation } from 'lucide-react';
import { Card, CardHeader, Button } from '../common';
import { useLocation } from '../../hooks/useLocation';

interface LocationEditModalProps {
    currentAddress: string;
    onSave: (location: { lat: number; lng: number; address: string }) => void;
    onClose: () => void;
    isLoading?: boolean;
}

export const LocationEditModal: React.FC<LocationEditModalProps> = ({
    currentAddress,
    onSave,
    onClose,
    isLoading = false,
}) => {
    const [address, setAddress] = useState(currentAddress);
    const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
    const { location, isLoading: isLocating, error, getLocation } = useLocation();

    useEffect(() => {
        if (location) {
            setCoordinates({ lat: location.lat, lng: location.lng });
        }
    }, [location]);

    const handleUseCurrentLocation = async () => {
        const loc = await getLocation();
        if (loc) {
            setCoordinates({ lat: loc.lat, lng: loc.lng });
            // In a real app, you would reverse geocode here
            setAddress('Current Location');
        }
    };

    const handleSave = () => {
        if (coordinates) {
            onSave({
                lat: coordinates.lat,
                lng: coordinates.lng,
                address,
            });
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
                <CardHeader
                    title="Edit Location"
                    action={
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    }
                />

                <div className="p-6 space-y-6">
                    {/* Address Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Address
                        </label>
                        <textarea
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            rows={3}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-saffron focus:ring-2 focus:ring-saffron/20 outline-none resize-none"
                            placeholder="Enter your full address"
                        />
                    </div>

                    {/* Current Location Button */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Or use current location
                        </label>
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleUseCurrentLocation}
                            isLoading={isLocating}
                            leftIcon={<Navigation className="w-4 h-4" />}
                        >
                            Get Current Location
                        </Button>
                        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
                    </div>

                    {/* Coordinates Display */}
                    {coordinates && (
                        <div className="bg-gray-50 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <MapPin className="w-4 h-4 text-saffron" />
                                <span className="text-sm font-medium text-gray-700">
                                    Coordinates
                                </span>
                            </div>
                            <p className="text-sm text-gray-600 font-mono">
                                {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
                            </p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <Button variant="outline" className="flex-1" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            className="flex-1"
                            onClick={handleSave}
                            isLoading={isLoading}
                            disabled={!address.trim()}
                        >
                            Save Location
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};
