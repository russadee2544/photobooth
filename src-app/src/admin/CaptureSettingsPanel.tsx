import React, { useState } from 'react';
import { CaptureSettings, GifCaptureConfig } from '@/types';

interface CaptureSettingsPanelProps {
  settings: CaptureSettings;
  onSave: (settings: CaptureSettings) => void;
}

export const CaptureSettingsPanel: React.FC<CaptureSettingsPanelProps> = ({
  settings: initialSettings,
  onSave
}) => {
  const [settings, setSettings] = useState<CaptureSettings>(initialSettings);
  const [isGifExpanded, setIsGifExpanded] = useState(false);

  const handleChange = (field: keyof CaptureSettings, value: any) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleGifChange = (field: keyof GifCaptureConfig, value: any) => {
    setSettings(prev => ({
      ...prev,
      gif: { ...prev.gif, [field]: value }
    }));
  };

  const handleSave = () => {
    onSave(settings);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-6 text-gray-800">Capture Settings / ตั้งค่าการถ่ายภาพ</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        {/* Core Settings */}
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              First Photo Countdown / เวลานับถอยหลังรูปแรก
            </label>
            <select
              value={settings.countdownFirst}
              onChange={(e) => handleChange('countdownFirst', parseInt(e.target.value))}
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Next Photos Countdown / เวลานับถอยหลังรูปถัดไป
            </label>
            <select
              value={settings.countdownNext}
              onChange={(e) => handleChange('countdownNext', parseInt(e.target.value))}
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </div>

          <div>
            <label className="flex justify-between text-sm font-medium text-gray-700 mb-2">
              <span>Preview Display Time / เวลาแสดงรูปตัวอย่าง</span>
              <span className="text-blue-600">{settings.previewDisplayMs / 1000}s</span>
            </label>
            <input
              type="range"
              min={500}
              max={5000}
              step={500}
              value={settings.previewDisplayMs}
              onChange={(e) => handleChange('previewDisplayMs', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.5s</span>
              <span>5s</span>
            </div>
          </div>
        </div>

        {/* Camera Settings */}
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Camera Selection / เลือกกล้อง
            </label>
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${settings.camera === 'front' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => handleChange('camera', 'front')}
              >
                Front / กล้องหน้า
              </button>
              <button
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${settings.camera === 'back' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => handleChange('camera', 'back')}
              >
                Back / กล้องหลัง
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-start gap-3 cursor-pointer p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  checked={settings.mirrorPreview}
                  onChange={(e) => handleChange('mirrorPreview', e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">Mirror Preview / พลิกภาพตัวอย่างเหมือนกระจก</span>
                <span className="text-xs text-gray-500">Makes the live view act like a mirror. Final photo remains unmirrored.</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* GIF Settings (Collapsible) */}
      <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden">
        <button 
          onClick={() => setIsGifExpanded(!isGifExpanded)}
          className="w-full px-6 py-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors focus:outline-none"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">GIF Settings / ตั้งค่า GIF</span>
            {settings.gif.enabled ? (
              <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">Enabled</span>
            ) : (
              <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">Disabled</span>
            )}
          </div>
          <svg className={`w-5 h-5 text-gray-500 transition-transform ${isGifExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        
        {isGifExpanded && (
          <div className="p-6 bg-white border-t border-gray-200">
            <div className="mb-6 flex items-center">
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={settings.gif.enabled}
                  onChange={(e) => handleGifChange('enabled', e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ml-3 text-sm font-medium text-gray-900">Enable GIF Capture Mode / เปิดโหมด GIF</span>
              </label>
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 ${!settings.gif.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Frame Count / จำนวนเฟรม
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="gifFrameCount" 
                        value={3} 
                        checked={settings.gif.frameCount === 3}
                        onChange={() => handleGifChange('frameCount', 3)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm">3 Frames</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="gifFrameCount" 
                        value={4} 
                        checked={settings.gif.frameCount === 4}
                        onChange={() => handleGifChange('frameCount', 4)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm">4 Frames</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                    <span>Delay Between Frames / ความหน่วงระหว่างเฟรม</span>
                    <span className="text-blue-600">{settings.gif.delayMs}ms</span>
                  </label>
                  <input
                    type="range"
                    min={100}
                    max={1000}
                    step={50}
                    value={settings.gif.delayMs}
                    onChange={(e) => handleGifChange('delayMs', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Fast (100ms)</span>
                    <span>Slow (1000ms)</span>
                  </div>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      checked={settings.gif.reverseLoop}
                      onChange={(e) => handleGifChange('reverseLoop', e.target.checked)}
                      className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">Reverse Loop (Boomerang) / เล่นวนกลับ</span>
                    <span className="text-xs text-gray-500">Adds reversed frames to create a seamless loop</span>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  GIF Overlay (Optional) / กรอบ GIF
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer min-h-[150px]">
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                  <span className="text-sm font-medium text-blue-600">Upload GIF Overlay</span>
                  <span className="text-xs text-gray-500 text-center mt-1">PNG with transparency<br/>Must match camera aspect ratio</span>
                  <input type="file" accept="image/png" className="hidden" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
        <button 
          onClick={handleSave}
          className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          Save Settings / บันทึกการตั้งค่า
        </button>
      </div>
    </div>
  );
};
