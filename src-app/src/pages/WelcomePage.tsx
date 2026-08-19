import React, { useState, useRef, useEffect } from 'react';

// Assuming basic types that might be in types
export type WelcomeMode = 'camera' | 'artwork';
export type OperatingMode = 'paid_redeem' | 'event_free';

export interface WelcomePageProps {
  welcomeMode: WelcomeMode;
  operatingMode: OperatingMode;
  eventName?: string;
  artworkSrc?: string;
  onStart: () => void;
  onRedeem: () => void;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({
  welcomeMode,
  operatingMode,
  eventName,
  artworkSrc,
  onStart,
  onRedeem,
}) => {
  const [showEventModal, setShowEventModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (welcomeMode === 'camera' && videoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(err => console.error('Error accessing camera:', err));
    }
  }, [welcomeMode]);

  const handleStartClick = () => {
    if (operatingMode === 'event_free') {
      setShowEventModal(true);
    } else {
      onStart();
    }
  };

  const handleConfirmEventStart = () => {
    setShowEventModal(false);
    onStart();
  };

  return (
    <div className="relative w-screen h-screen bg-black text-white overflow-hidden flex flex-col items-center justify-center">
      {/* Background Mode */}
      {welcomeMode === 'camera' ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover transform -scale-x-100"
        />
      ) : (
        artworkSrc && (
          <img
            src={artworkSrc}
            alt="Artwork"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )
      )}

      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-between py-20 px-10">
        
        {/* Header / Event Branding */}
        <div className="text-center drop-shadow-lg">
          <h1 className="text-6xl font-bold mb-4">{eventName || 'PHOTOBOOTH'}</h1>
          <p className="text-2xl text-gray-200">Capture your moments / เก็บภาพความทรงจำ</p>
        </div>

        {/* Call to action */}
        <div className="flex flex-col items-center space-y-6">
          {operatingMode === 'paid_redeem' ? (
            <button
              onClick={onRedeem}
              className="px-12 py-6 bg-white text-black rounded-full text-4xl font-bold shadow-2xl active:scale-95 transition-transform"
            >
              <span className="block">กรอกรหัส</span>
              <span className="block text-2xl mt-1 text-gray-600">Enter Code</span>
            </button>
          ) : (
            <button
              onClick={handleStartClick}
              className="px-12 py-6 bg-white text-black rounded-full text-4xl font-bold shadow-2xl active:scale-95 transition-transform"
            >
              <span className="block">เริ่มใช้งาน</span>
              <span className="block text-2xl mt-1 text-gray-600">Start</span>
            </button>
          )}
        </div>
      </div>

      {/* Event Mode Modal */}
      {showEventModal && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8">
          <div className="bg-white text-black rounded-3xl p-10 max-w-2xl text-center space-y-8">
            <h2 className="text-3xl font-bold text-red-600">ข้อตกลง / Acknowledgement</h2>
            <p className="text-xl leading-relaxed text-gray-700">
              Event Mode อาจมีการส่งภาพหรือบันทึกภาพให้เจ้าของงานตามเงื่อนไขของ Event<br/><br/>
              By proceeding, you acknowledge that your photos may be shared with the event organizer.
            </p>
            <div className="flex space-x-6 justify-center pt-4">
              <button
                onClick={() => setShowEventModal(false)}
                className="px-8 py-4 bg-gray-200 rounded-xl text-2xl font-bold text-gray-700 active:scale-95"
              >
                ยกเลิก / Cancel
              </button>
              <button
                onClick={handleConfirmEventStart}
                className="px-8 py-4 bg-blue-600 rounded-xl text-2xl font-bold text-white active:scale-95"
              >
                ยอมรับ / Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
