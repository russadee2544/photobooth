import React, { useState, useRef } from 'react';
import { Frame, FrameVersion, LayoutPresetId } from '@/types';

interface FrameUploadPanelProps {
  layoutId: LayoutPresetId;
  layouts: { id: LayoutPresetId; name: string }[]; // Added to support selection
  onSelectLayout: (id: LayoutPresetId) => void;
  currentFrame: Frame | null;
  versions: FrameVersion[];
  onUpload: (file: File) => void;
  onRollback: (versionId: string) => void;
  onPublish: (versionId: string) => void;
}

export const FrameUploadPanel: React.FC<FrameUploadPanelProps> = ({
  layoutId,
  layouts,
  onSelectLayout,
  currentFrame,
  versions,
  onUpload,
  onRollback,
  onPublish
}) => {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Dummy validation state for UI demonstration
  const [validationState, setValidationState] = useState<'idle' | 'valid' | 'warning' | 'error'>('idle');
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    // In a real app, validation logic would happen here or in the parent
    setPreviewFileUrl(URL.createObjectURL(file));
    setValidationState('valid'); // Mock success
    onUpload(file);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Frame Management / จัดการกรอบรูป</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Select Layout:</label>
          <select 
            value={layoutId} 
            onChange={(e) => onSelectLayout(e.target.value as LayoutPresetId)}
            className="border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
          >
            {layouts.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Upload & Resources */}
        <div className="flex flex-col gap-6">
          <div className="flex gap-4">
            <button className="flex-1 py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-md transition-colors border border-gray-300 flex justify-center items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              ดาวน์โหลด Guide PNG
            </button>
            <button className="flex-1 py-2 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-md transition-colors border border-blue-200 flex justify-center items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path></svg>
              Canva Template
            </button>
          </div>

          <div 
            className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/png" 
              onChange={handleChange} 
              className="hidden" 
            />
            <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
            <p className="text-gray-700 font-medium mb-1">Drag & Drop PNG file here</p>
            <p className="text-gray-500 text-sm mb-4">or click to browse</p>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Select File / เลือกไฟล์
            </button>
            
            {/* Validation Feedback overlay */}
            {validationState === 'valid' && (
              <div className="absolute top-4 right-4 bg-green-100 text-green-700 text-xs px-2 py-1 rounded-md border border-green-200 flex items-center gap-1">
                <span>✅</span> Valid Format
              </div>
            )}
            {validationState === 'warning' && (
              <div className="absolute top-4 right-4 bg-yellow-100 text-yellow-700 text-xs px-2 py-1 rounded-md border border-yellow-200 flex items-center gap-1">
                <span>⚠️</span> Dimensions Mismatch
                <button className="ml-2 underline text-yellow-800">Override</button>
              </div>
            )}
            {validationState === 'error' && (
              <div className="absolute top-4 right-4 bg-red-100 text-red-700 text-xs px-2 py-1 rounded-md border border-red-200 flex items-center gap-1">
                <span>❌</span> Invalid PNG format
              </div>
            )}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Version History / ประวัติเวอร์ชัน</h3>
            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
              {versions.length === 0 ? (
                <p className="text-sm text-gray-500">No versions available.</p>
              ) : (
                versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between bg-white p-3 border border-gray-200 rounded-md shadow-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-800">v{v.version}</span>
                        {v.isActive && (
                          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">Active</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(v.publishedAt).toLocaleDateString()} by {v.publishedBy}
                      </div>
                    </div>
                    {!v.isActive && (
                      <button 
                        onClick={() => onRollback(v.id)}
                        className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 transition-colors"
                      >
                        Rollback / ย้อนกลับ
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-gray-800">Preview / ตัวอย่าง</h3>
          <div className="bg-gray-100 border border-gray-300 rounded-lg flex-1 flex flex-col items-center justify-center p-6 min-h-[400px]">
            <div className="flex gap-4 w-full h-full justify-center">
              {/* Color Preview */}
              <div className="flex flex-col items-center gap-2 w-1/2 max-w-[200px]">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Color Preview</span>
                <div className="w-full bg-white shadow-md relative rounded aspect-[3/4] overflow-hidden flex items-center justify-center border border-gray-200">
                  {previewFileUrl ? (
                    <img src={previewFileUrl} alt="Frame preview" className="absolute inset-0 w-full h-full object-cover z-10" />
                  ) : (
                    <span className="text-gray-400 text-xs">No Frame</span>
                  )}
                  {/* Dummy sample photos underneath */}
                  <div className="grid grid-cols-2 gap-2 w-[80%] h-[80%] opacity-50 bg-gray-300 p-2">
                    <div className="bg-gray-400"></div><div className="bg-gray-400"></div>
                    <div className="bg-gray-400"></div><div className="bg-gray-400"></div>
                  </div>
                </div>
              </div>

              {/* Dithered Preview */}
              <div className="flex flex-col items-center gap-2 w-1/2 max-w-[200px]">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Print Preview (B&W)</span>
                <div className="w-full bg-white shadow-md relative rounded aspect-[3/4] overflow-hidden flex items-center justify-center border border-gray-200 grayscale contrast-125">
                  {previewFileUrl ? (
                    <img src={previewFileUrl} alt="Frame preview Dithered" className="absolute inset-0 w-full h-full object-cover z-10" />
                  ) : (
                    <span className="text-gray-400 text-xs">No Frame</span>
                  )}
                  {/* Dummy sample photos underneath */}
                  <div className="grid grid-cols-2 gap-2 w-[80%] h-[80%] opacity-50 bg-gray-300 p-2">
                    <div className="bg-gray-400"></div><div className="bg-gray-400"></div>
                    <div className="bg-gray-400"></div><div className="bg-gray-400"></div>
                  </div>
                </div>
              </div>
            </div>
            
            {previewFileUrl && (
              <button 
                onClick={() => onPublish('new_version_id')} 
                className="mt-6 px-6 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 shadow-sm transition-colors"
              >
                Publish New Frame / อัปเดตกรอบรูป
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
