import React, { useState, useEffect, useRef } from 'react';
import { LayoutPreset } from '../../types';

export interface CaptureSettings {
  countdownSeconds: number;
  photoPreviewSeconds: number;
}

export interface CapturePageProps {
  layout: LayoutPreset;
  captureSettings: CaptureSettings;
  onComplete: (photos: string[]) => void;
  onCancel: () => void;
  onTimeout?: () => void;
}

export const CapturePage: React.FC<CapturePageProps> = ({
  layout,
  captureSettings,
  onComplete,
  onCancel,
  onTimeout
}) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout>();

  const totalSlots = layout.slots;

  // Init Camera
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(err => console.error(err));

    resetInactivityTimer();
    return () => clearTimeout(inactivityTimerRef.current);
  }, []);

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    // 2 minutes timeout
    inactivityTimerRef.current = setTimeout(() => {
      onTimeout && onTimeout();
    }, 120000);
  };

  const startCapture = () => {
    if (photos.length >= totalSlots) return;
    setIsCapturing(true);
    setCountdown(captureSettings.countdownSeconds);
  };

  // Countdown Loop
  useEffect(() => {
    if (countdown === null) return;
    
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
        resetInactivityTimer();
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      takePhoto();
    }
  }, [countdown]);

  const takePhoto = () => {
    setCountdown(null);
    setShowFlash(true);
    
    // Simulate photo capture from video
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Handle mirror effect on capture
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, 0, 0);
        
        const dataUrl = canvas.toDataURL('image/jpeg');
        const newPhotos = [...photos, dataUrl];
        
        setTimeout(() => setShowFlash(false), 200);
        
        setPreviewPhoto(dataUrl);
        setTimeout(() => {
          setPreviewPhoto(null);
          setPhotos(newPhotos);
          setIsCapturing(false);
          resetInactivityTimer();
          
          if (newPhotos.length >= totalSlots) {
            onComplete(newPhotos);
          }
        }, captureSettings.photoPreviewSeconds * 1000);
      }
    }
  };

  const handleRetake = () => {
    if (photos.length > 0) {
      setPhotos(photos.slice(0, -1));
    }
  };

  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden" onClick={resetInactivityTimer}>
      
      {/* Viewfinder */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover transform -scale-x-100"
      />

      {/* Flash Overlay */}
      {showFlash && <div className="absolute inset-0 bg-white z-50 opacity-100 transition-opacity duration-200" />}

      {/* Header */}
      <div className="absolute top-8 left-8 right-8 flex justify-between items-start z-40">
        <button 
          onClick={onCancel}
          className="px-6 py-3 bg-red-600/80 backdrop-blur-md rounded-xl text-white text-xl font-bold shadow-lg"
        >
          &times; ยกเลิก / Cancel
        </button>

        <div className="bg-black/50 backdrop-blur-md px-8 py-4 rounded-2xl text-white text-center">
          <div className="text-3xl font-bold">
            ภาพที่ {Math.min(photos.length + 1, totalSlots)} / {totalSlots}
          </div>
          <div className="text-xl text-gray-300">
            Photo {Math.min(photos.length + 1, totalSlots)} / {totalSlots}
          </div>
        </div>
      </div>

      {/* Countdown overlay */}
      {countdown !== null && countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-30">
          <div className="text-[25rem] font-bold text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.8)] animate-pulse">
            {countdown}
          </div>
        </div>
      )}

      {/* Just captured preview overlay */}
      {previewPhoto && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80">
          <img src={previewPhoto} className="h-4/5 object-contain rounded-2xl shadow-2xl transform -scale-x-100" />
        </div>
      )}

      {/* Bottom controls */}
      {!isCapturing && !previewPhoto && (
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center z-40 space-y-8">
          
          {/* Thumbnails */}
          <div className="flex space-x-4 bg-black/40 p-4 rounded-2xl backdrop-blur-sm">
            {Array.from({ length: totalSlots }).map((_, i) => (
              <div key={i} className={`w-20 h-20 rounded-lg overflow-hidden border-2 ${i === photos.length ? 'border-white' : 'border-transparent'} bg-gray-800`}>
                {photos[i] ? (
                  <img src={photos[i]} className="w-full h-full object-cover transform -scale-x-100" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-2xl font-bold">{i + 1}</div>
                )}
              </div>
            ))}
          </div>

          <div className="flex space-x-8">
            {photos.length > 0 && (
              <button 
                onClick={handleRetake}
                className="px-8 py-5 bg-gray-700/80 rounded-full text-white text-2xl font-bold shadow-xl backdrop-blur-md active:scale-95"
              >
                ถ่ายใหม่ / Retake Last
              </button>
            )}
            
            <button 
              onClick={startCapture}
              className="px-16 py-5 bg-white text-black rounded-full text-3xl font-bold shadow-[0_0_40px_rgba(255,255,255,0.4)] active:scale-95"
            >
              ถ่ายภาพ / Capture
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
