import React, { useState } from 'react';
import { FilterPreset, FilterId } from '@/types';

interface FilterConfigPanelProps {
  filters: FilterPreset[];
  onSave: (enabledIds: FilterId[]) => void;
}

export const FilterConfigPanel: React.FC<FilterConfigPanelProps> = ({
  filters,
  onSave
}) => {
  // Initialize state with currently enabled filters
  const [enabledIds, setEnabledIds] = useState<Set<FilterId>>(
    new Set(filters.filter(f => f.enabled).map(f => f.id))
  );

  const toggleFilter = (id: FilterId) => {
    if (id === 'original') return; // Cannot disable 'original'
    
    const newSet = new Set(enabledIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setEnabledIds(newSet);
  };

  const handleSave = () => {
    onSave(Array.from(enabledIds));
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Filter Configuration / ตั้งค่าฟิลเตอร์</h2>
      <p className="text-sm text-gray-600 mb-6">Select which filters are available for guests. / เลือกฟิลเตอร์ที่เปิดให้แขกใช้งาน</p>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {filters.map((filter) => {
          const isEnabled = enabledIds.has(filter.id);
          const isOriginal = filter.id === 'original';
          
          return (
            <div 
              key={filter.id} 
              className={`flex flex-col border rounded-lg overflow-hidden transition-all ${isEnabled ? 'border-blue-500 shadow-sm' : 'border-gray-200 opacity-70'}`}
            >
              {/* Sample Photo with Filter Applied */}
              <div className="aspect-[3/4] bg-gray-200 relative overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80" 
                  alt={`Sample with ${filter.nameEn} filter`}
                  className="w-full h-full object-cover"
                  style={{ filter: filter.cssFilter }}
                />
              </div>
              
              <div className="p-3 bg-white flex flex-col flex-1">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-sm text-gray-800">{filter.nameEn}</span>
                  <label className={`relative inline-flex items-center ${isOriginal ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={isEnabled}
                      disabled={isOriginal}
                      onChange={() => toggleFilter(filter.id)}
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <span className="text-xs text-gray-500">{filter.name}</span>
                {isOriginal && (
                  <span className="text-[10px] text-blue-600 mt-1 uppercase font-semibold">Always Enabled</span>
                )}
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
          Save Filters / บันทึกฟิลเตอร์
        </button>
      </div>
    </div>
  );
};
