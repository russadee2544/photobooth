import React, { useState } from 'react';
import { WelcomeScreenMode } from '@/types';

interface WelcomeScreenConfigProps {
  currentMode: WelcomeScreenMode;
  artworkUrl: string | null;
  onSave: (mode: WelcomeScreenMode, artwork?: File) => void;
}

export const WelcomeScreenConfig: React.FC<WelcomeScreenConfigProps> = ({
  currentMode,
  artworkUrl,
  onSave,
}) => {
  const [mode, setMode] = useState<WelcomeScreenMode>(currentMode);
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(artworkUrl);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSave = () => {
    onSave(mode, selectedFile);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Welcome Screen Configuration / ตั้งค่าหน้าจอเริ่ม</h2>
      
      <div className="flex flex-col gap-6">
        <div className="flex gap-4">
          <label className={`flex-1 flex flex-col p-4 border rounded-lg cursor-pointer transition-colors ${mode === WelcomeScreenMode.CameraPreview ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3 mb-2">
              <input 
                type="radio" 
                name="welcomeMode" 
                value={WelcomeScreenMode.CameraPreview}
                checked={mode === WelcomeScreenMode.CameraPreview}
                onChange={() => setMode(WelcomeScreenMode.CameraPreview)}
                className="w-5 h-5 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium">Camera Preview / กล้องสด</span>
            </div>
            <p className="text-sm text-gray-600 pl-8">Shows a live mirror view to attract guests. / แสดงภาพจากกล้องให้แขกเห็นเหมือนกระจก</p>
          </label>

          <label className={`flex-1 flex flex-col p-4 border rounded-lg cursor-pointer transition-colors ${mode === WelcomeScreenMode.StaticGraphic ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3 mb-2">
              <input 
                type="radio" 
                name="welcomeMode" 
                value={WelcomeScreenMode.StaticGraphic}
                checked={mode === WelcomeScreenMode.StaticGraphic}
                onChange={() => setMode(WelcomeScreenMode.StaticGraphic)}
                className="w-5 h-5 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium">Static Graphic / ภาพนิ่ง</span>
            </div>
            <p className="text-sm text-gray-600 pl-8">Shows a custom artwork or video loop. / แสดงภาพนิ่งหรือวิดีโอที่กำหนดเอง</p>
          </label>
        </div>

        {mode === WelcomeScreenMode.CameraPreview && (
          <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-64 h-80 bg-gray-300 rounded overflow-hidden relative flex items-center justify-center">
               <span className="text-gray-500 font-medium">📷 Camera Preview</span>
            </div>
            <p className="mt-4 text-sm text-gray-500 text-center max-w-md">
              The camera preview acts as a mirror, horizontally flipped, so guests see themselves naturally.
              <br/>
              ภาพจากกล้องจะกลับซ้ายขวาเหมือนกระจก เพื่อให้แขกเห็นตัวเองอย่างเป็นธรรมชาติ
            </p>
          </div>
        )}

        {mode === WelcomeScreenMode.StaticGraphic && (
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 flex flex-col gap-4">
            <h3 className="font-medium text-gray-700">Upload Artwork / อัปโหลดรูปภาพ</h3>
            
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 bg-white hover:bg-gray-50 transition-colors">
              {previewUrl ? (
                <div className="flex flex-col items-center gap-4 w-full">
                  <img src={previewUrl} alt="Preview" className="max-h-64 object-contain rounded" />
                  <label className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                    Change Image / เปลี่ยนรูป
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer min-h-[200px]">
                  <svg className="w-10 h-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  <span className="text-sm font-medium text-blue-600 mb-1">Click to upload / คลิกเพื่ออัปโหลด</span>
                  <span className="text-xs text-gray-500">PNG, JPG up to 10MB (Portrait aspect ratio recommended)</span>
                  <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                </label>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button 
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Save Changes / บันทึกการเปลี่ยนแปลง
          </button>
        </div>
      </div>
    </div>
  );
};
