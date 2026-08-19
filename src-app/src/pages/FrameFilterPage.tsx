import React, { useState } from 'react';
import { LayoutPreset, Frame, FilterPreset } from '../../types';

export interface FrameFilterPageProps {
  frames: Frame[];
  filters: FilterPreset[];
  photos: string[];
  layout: LayoutPreset;
  onConfirm: (frameId: string, filterId: string) => void;
  onBack: () => void;
}

export const FrameFilterPage: React.FC<FrameFilterPageProps> = ({
  frames,
  filters,
  photos,
  layout,
  onConfirm,
  onBack
}) => {
  const [selectedFrame, setSelectedFrame] = useState<string>(frames[0]?.id || '');
  const [selectedFilter, setSelectedFilter] = useState<string>(filters[0]?.id || '');
  
  const [activeTab, setActiveTab] = useState<'frames' | 'filters'>('frames');

  // Simple CSS filter mapping for preview
  const getFilterStyle = (filterId: string) => {
    switch(filterId) {
      case 'bw': return { filter: 'grayscale(100%)' };
      case 'sepia': return { filter: 'sepia(80%)' };
      case 'vintage': return { filter: 'contrast(1.2) saturate(0.8) sepia(0.3)' };
      default: return {};
    }
  };

  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex p-6 gap-6">
      
      {/* Left Area: Controls */}
      <div className="w-1/3 bg-gray-800 rounded-3xl p-6 flex flex-col">
        <button 
          onClick={onBack}
          className="self-start px-6 py-3 bg-gray-700 rounded-xl text-lg font-bold active:scale-95 mb-6"
        >
          &larr; กลับ / Back
        </button>

        <h1 className="text-3xl font-bold mb-6">ตกแต่งภาพ / Decorate</h1>

        {/* Tabs */}
        <div className="flex bg-gray-700 rounded-xl p-2 mb-6">
          <button 
            className={`flex-1 py-3 rounded-lg text-xl font-bold transition ${activeTab === 'frames' ? 'bg-white text-black shadow-md' : 'text-gray-300'}`}
            onClick={() => setActiveTab('frames')}
          >
            กรอบ / Frame
          </button>
          <button 
            className={`flex-1 py-3 rounded-lg text-xl font-bold transition ${activeTab === 'filters' ? 'bg-white text-black shadow-md' : 'text-gray-300'}`}
            onClick={() => setActiveTab('filters')}
          >
            ฟิลเตอร์ / Filter
          </button>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-4">
          {activeTab === 'frames' && frames.map(frame => (
            <div 
              key={frame.id}
              onClick={() => setSelectedFrame(frame.id)}
              className={`p-4 bg-gray-700 rounded-2xl cursor-pointer transition flex flex-col items-center ${selectedFrame === frame.id ? 'ring-4 ring-blue-500 bg-gray-600' : ''}`}
            >
              <div className="w-full h-32 bg-gray-800 rounded-xl mb-3 flex items-center justify-center">
                 {/* Thumbnail preview of frame could go here */}
                 <span className="text-gray-400">Frame: {frame.name}</span>
              </div>
              <span className="font-bold text-lg">{frame.name}</span>
            </div>
          ))}

          {activeTab === 'filters' && filters.map(filter => (
            <div 
              key={filter.id}
              onClick={() => setSelectedFilter(filter.id)}
              className={`p-4 bg-gray-700 rounded-2xl cursor-pointer transition flex items-center gap-4 ${selectedFilter === filter.id ? 'ring-4 ring-blue-500 bg-gray-600' : ''}`}
            >
              <div 
                className="w-16 h-16 rounded-full bg-cover bg-center" 
                style={{ ...getFilterStyle(filter.id), backgroundImage: `url(${photos[0] || ''})` }}
              />
              <span className="font-bold text-xl">{filter.name}</span>
            </div>
          ))}
        </div>

        <button 
          onClick={() => onConfirm(selectedFrame, selectedFilter)}
          className="w-full py-6 mt-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-2xl font-bold shadow-xl active:scale-95 transition"
        >
          ยืนยันและพิมพ์ / Confirm & Print
        </button>
      </div>

      {/* Right Area: Large Preview */}
      <div className="w-2/3 bg-gray-800 rounded-3xl p-8 flex flex-col items-center justify-center relative">
        {/* Placeholder for the actual canvas composition */}
        <div className="relative w-full max-w-2xl aspect-[9/16] bg-white shadow-2xl">
          {/* Photos Layer */}
          <div className="absolute inset-0 grid grid-rows-3 gap-2 p-8" style={getFilterStyle(selectedFilter)}>
            {photos.map((photo, i) => (
              <div key={i} className="bg-gray-200 w-full h-full rounded-md overflow-hidden flex items-center justify-center">
                 <img src={photo} className="w-full h-full object-cover transform -scale-x-100" />
              </div>
            ))}
          </div>
          
          {/* Frame Layer Overlay */}
          <div className="absolute inset-0 border-[16px] border-blue-900 pointer-events-none opacity-50 flex items-end justify-center pb-4">
             <span className="text-blue-900 font-bold text-2xl bg-white/80 px-4 py-1 rounded">
               {frames.find(f => f.id === selectedFrame)?.name || 'Frame'} Layer
             </span>
          </div>
        </div>
      </div>
      
    </div>
  );
};
