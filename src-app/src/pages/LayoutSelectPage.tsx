import React, { useState } from 'react';
import { LayoutPreset } from '../../types';

export interface LayoutSelectPageProps {
  enabledLayouts: LayoutPreset[];
  onSelect: (layoutId: string) => void;
  onBack: () => void;
}

export const LayoutSelectPage: React.FC<LayoutSelectPageProps> = ({ enabledLayouts, onSelect, onBack }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleNext = () => {
    if (selectedId) {
      onSelect(selectedId);
    }
  };

  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex flex-col p-8">
      
      <div className="w-full flex justify-between items-center mb-8">
        <button 
          onClick={onBack}
          className="px-6 py-3 bg-gray-700 rounded-xl text-xl font-bold active:scale-95"
        >
          &larr; กลับ / Back
        </button>
        <div className="text-right">
          <h1 className="text-4xl font-bold">เลือกเลย์เอาต์</h1>
          <p className="text-xl text-gray-400">Choose Layout</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-8 p-4">
          {enabledLayouts.map((layout) => (
            <div
              key={layout.id}
              onClick={() => setSelectedId(layout.id)}
              className={`relative flex flex-col items-center bg-gray-800 rounded-3xl p-6 cursor-pointer transition-all ${
                selectedId === layout.id 
                  ? 'ring-8 ring-blue-500 shadow-2xl shadow-blue-900/50 transform scale-105' 
                  : 'hover:bg-gray-750 opacity-80 hover:opacity-100'
              }`}
            >
              {/* Layout Preview Placeholder */}
              <div className="w-48 h-64 bg-gray-700 rounded-xl border-4 border-gray-600 flex items-center justify-center mb-4">
                <span className="text-gray-500 text-lg">{layout.slots} Slots Preview</span>
              </div>
              
              <h3 className="text-2xl font-bold text-center">
                {layout.nameTh || layout.name}
              </h3>
              <p className="text-gray-400 text-center">{layout.name}</p>
              
              {selectedId === layout.id && (
                <div className="absolute top-4 right-4 bg-blue-500 text-white p-2 rounded-full">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="w-full flex justify-center mt-8">
        <button
          onClick={handleNext}
          disabled={!selectedId}
          className={`px-16 py-6 rounded-full text-3xl font-bold transition-all shadow-xl ${
            selectedId 
              ? 'bg-blue-600 text-white active:scale-95 hover:bg-blue-500' 
              : 'bg-gray-800 text-gray-500 opacity-50 cursor-not-allowed'
          }`}
        >
          ถัดไป / Next &rarr;
        </button>
      </div>
    </div>
  );
};
