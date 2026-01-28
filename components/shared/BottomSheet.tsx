import React, { useState, useEffect, useRef } from 'react';

interface BottomSheetProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
  snapPoints?: number[]; // [collapsed, partial, expanded] in pixels
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ 
  children, 
  isOpen, 
  snapPoints = [80, 400, window.innerHeight * 0.9] 
}) => {
  const [height, setHeight] = useState(snapPoints[0]);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    startHeight.current = height;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const deltaY = startY.current - currentY;
    const newHeight = Math.max(snapPoints[0], Math.min(snapPoints[2], startHeight.current + deltaY));
    setHeight(newHeight);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    // Snap to closest point
    const closest = snapPoints.reduce((prev, curr) => 
      Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev
    );
    setHeight(closest);
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`fixed inset-x-0 bottom-0 z-[60] bg-white rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] transition-all duration-300 ease-out lg:hidden ${isDragging ? 'transition-none' : ''}`}
      style={{ height: `${height}px` }}
    >
      {/* Drag Handle */}
      <div 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="w-full h-8 flex items-center justify-center cursor-grab active:cursor-grabbing"
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
      </div>

      <div className="h-full overflow-y-auto px-6 pb-20">
        {children}
      </div>
    </div>
  );
};