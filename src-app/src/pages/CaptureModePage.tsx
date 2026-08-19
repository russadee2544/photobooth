import React from 'react';
import { CaptureMode } from '../../types';

export interface CaptureModePageProps {
  gifEnabled: boolean;
  onSelect: (mode: CaptureMode) => void;
  onBack: () => void;
}

export const CaptureModePage: React.FC<CaptureModePageProps> = ({ gifEnabled, onSelect, onBack }) => {
  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex flex-col p-8">
      
      <div className="w-full flex justify-between items-center mb-12">
        <button 
          onClick={onBack}
          className="px-6 py-3 bg-gray-700 rounded-xl text-xl font-bold active:scale-95"
        >
          &larr; กลับ / Back
        </button>
        <div className="text-right">
          <h1 className="text-4xl font-bold">เลือกโหมดการถ่าย</h1>
          <p className="text-xl text-gray-400">Choose Capture Mode</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center gap-12 max-w-6xl mx-auto w-full">
        
        {/* Photo Mode */}
        <div 
          onClick={() => onSelect('photo')}
          className="flex-1 bg-gray-800 rounded-[3rem] p-12 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-gray-750 hover:scale-105 active:scale-95 ring-4 ring-transparent hover:ring-blue-500 shadow-2xl h-[60vh]"
        >
          <div className="text-8xl mb-8">📷</div>
          <h2 className="text-5xl font-bold mb-4 text-center">ภาพนิ่ง</h2>
          <h3 className="text-3xl text-gray-400 mb-8 text-center">Photo</h3>
          <p className="text-center text-gray-500 text-xl leading-relaxed">
            ถ่ายภาพนิ่งคุณภาพสูง<br/>
            High quality still photos
          </p>
        </div>

        {/* GIF Mode */}
        {gifEnabled && (
          <div 
            onClick={() => onSelect('gif')}
            className="flex-1 bg-gray-800 rounded-[3rem] p-12 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-gray-750 hover:scale-105 active:scale-95 ring-4 ring-transparent hover:ring-purple-500 shadow-2xl h-[60vh]"
          >
            <div className="text-8xl mb-8">🎬</div>
            <h2 className="text-5xl font-bold mb-4 text-center">ภาพเคลื่อนไหว</h2>
            <h3 className="text-3xl text-gray-400 mb-8 text-center">GIF</h3>
            <p className="text-center text-gray-500 text-xl leading-relaxed">
              ภาพขยับได้แบบสนุกๆ<br/>
              Animated moving pictures
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
