import React, { useState } from 'react';
import { LayoutPreset, LayoutPresetId } from '@/types';

interface LayoutConfigPanelProps {
  enabledLayouts: LayoutPresetId[];
  availableLayouts: LayoutPreset[];
  onSave: (enabledIds: LayoutPresetId[]) => void;
}

export const LayoutConfigPanel: React.FC<LayoutConfigPanelProps> = ({
  enabledLayouts: initialEnabled,
  availableLayouts,
  onSave,
}) => {
  const [enabledIds, setEnabledIds] = useState<Set<LayoutPresetId>>(new Set(initialEnabled));
  const [error, setError] = useState<string | null>(null);

  const toggleLayout = (id: LayoutPresetId) => {
    const newSet = new Set(enabledIds);
    if (newSet.has(id)) {
      if (newSet.size === 1) {
        setError("At least 1 layout must be enabled / ต้องเปิดใช้งานอย่างน้อย 1 รูปแบบ");
        return;
      }
      newSet.delete(id);
    } else {
      newSet.add(id);
      setError(null);
    }
    setEnabledIds(newSet);
  };

  const handleSave = () => {
    if (enabledIds.size === 0) {
      setError("At least 1 layout must be enabled / ต้องเปิดใช้งานอย่างน้อย 1 รูปแบบ");
      return;
    }
    onSave(Array.from(enabledIds));
  };

  // Render a simple preview based on slots
  const renderLayoutPreview = (layout: LayoutPreset) => {
    return (
      <div 
        className="relative bg-gray-200 border border-gray-300 rounded shadow-sm mx-auto"
        style={{ 
          width: '100px', 
          height: `${(layout.canvas.height / layout.canvas.width) * 100}px` 
        }}
      >
        {layout.slots.map((slot) => {
          const x = (slot.x / layout.canvas.width) * 100;
          const y = (slot.y / layout.canvas.height) * 100;
          const w = (slot.w / layout.canvas.width) * 100;
          const h = (slot.h / layout.canvas.height) * 100;
          return (
            <div
              key={slot.index}
              className="absolute bg-gray-400 border border-white flex items-center justify-center text-white text-xs font-bold"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: `${w}%`,
                height: `${h}%`,
              }}
            >
              {slot.index}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Layout Configuration / ตั้งค่ารูปแบบเลย์เอาต์</h2>
      <p className="text-sm text-gray-600 mb-6">Select which layout options are available for guests to choose. / เลือกรูปแบบที่แขกสามารถเลือกใช้งานได้</p>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {availableLayouts.map((layout) => {
          const isEnabled = enabledIds.has(layout.id);
          return (
            <div 
              key={layout.id} 
              className={`border rounded-lg p-4 transition-all ${isEnabled ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-200 bg-white opacity-75'}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-gray-800">{layout.nameEn}</h3>
                  <p className="text-sm text-gray-500">{layout.name}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={isEnabled}
                    onChange={() => toggleLayout(layout.id)}
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              
              <div className="flex justify-center mb-4 min-h-[150px] items-center">
                {renderLayoutPreview(layout)}
              </div>
              
              <div className="text-sm text-gray-600 border-t pt-3 mt-auto">
                <p><strong>Description:</strong> {layout.description}</p>
                <p><strong>Photos:</strong> {layout.photoCount} shots</p>
                <p><strong>Ratio:</strong> {layout.captureAspect}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-4 border-t border-gray-100">
        <button 
          onClick={handleSave}
          className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          Save Layout Settings / บันทึกการตั้งค่า
        </button>
      </div>
    </div>
  );
};
