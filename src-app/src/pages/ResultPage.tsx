import React, { useState, useEffect } from 'react';

export interface ResultPageProps {
  printProgress: { current: number; total: number };
  qrCodeUrl?: string;
  timeoutSeconds: number;
  onDone: () => void;
}

export const ResultPage: React.FC<ResultPageProps> = ({
  printProgress,
  qrCodeUrl,
  timeoutSeconds,
  onDone
}) => {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);

  useEffect(() => {
    if (timeLeft <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, onDone]);

  const isPrinting = printProgress.current < printProgress.total;
  const progressPercent = Math.min(100, Math.max(0, (printProgress.current / printProgress.total) * 100));

  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-8 text-center">
      
      <h1 className="text-5xl font-bold mb-4 text-blue-400">ขอบคุณที่ใช้บริการ</h1>
      <p className="text-3xl text-gray-300 mb-16">Thank you!</p>

      <div className="flex w-full max-w-5xl gap-12 bg-gray-800 rounded-[3rem] p-12 shadow-2xl">
        
        {/* Left: Printing Status */}
        <div className="flex-1 flex flex-col items-center justify-center border-r border-gray-700 pr-12">
          {isPrinting ? (
            <>
              <div className="w-32 h-32 mb-8 animate-spin rounded-full border-b-8 border-blue-500" />
              <h2 className="text-4xl font-bold mb-2">กำลังพิมพ์...</h2>
              <p className="text-2xl text-gray-400 mb-8">Printing your photo...</p>
              
              <div className="w-full bg-gray-700 rounded-full h-6 mb-4 overflow-hidden">
                <div 
                  className="bg-blue-500 h-6 rounded-full transition-all duration-500" 
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xl font-mono text-gray-400">
                {Math.round(progressPercent)}%
              </p>
            </>
          ) : (
            <>
              <div className="w-32 h-32 mb-8 bg-green-500 rounded-full flex items-center justify-center text-6xl shadow-[0_0_30px_rgba(34,197,94,0.5)]">
                ✓
              </div>
              <h2 className="text-4xl font-bold text-green-400 mb-2">พิมพ์เสร็จสิ้น</h2>
              <p className="text-2xl text-gray-400">Print complete! Please take your photo.</p>
            </>
          )}
        </div>

        {/* Right: Digital Download */}
        <div className="flex-1 flex flex-col items-center justify-center pl-12">
          <h2 className="text-3xl font-bold mb-4">ดาวน์โหลดรูปภาพ</h2>
          <p className="text-xl text-gray-400 mb-8">Download digital copy</p>
          
          <div className="bg-white p-6 rounded-3xl shadow-xl mb-8">
            {qrCodeUrl ? (
               <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64" />
            ) : (
               <div className="w-64 h-64 bg-gray-200 flex items-center justify-center text-gray-500 text-lg">
                 Generating QR...
               </div>
            )}
          </div>
          <p className="text-gray-400">สแกน QR Code เพื่อรับไฟล์ภาพและ GIF</p>
        </div>

      </div>

      <div className="mt-16 flex flex-col items-center">
        <button 
          onClick={onDone}
          className="px-16 py-6 bg-gray-700 hover:bg-gray-600 rounded-full text-3xl font-bold shadow-xl active:scale-95 transition"
        >
          เสร็จสิ้น / Done
        </button>
        <p className="text-gray-500 mt-6 text-xl">
          กลับสู่หน้าแรกใน {timeLeft} วินาที / Returning in {timeLeft}s
        </p>
      </div>

    </div>
  );
};
