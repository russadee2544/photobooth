import React, { useState } from 'react';

export interface RedeemPageProps {
  onSubmit: (code: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string;
}

export const RedeemPage: React.FC<RedeemPageProps> = ({ onSubmit, onCancel, isLoading, error }) => {
  const [code, setCode] = useState('');
  
  const handleKeyPress = (key: string) => {
    if (code.length < 8) {
      setCode(prev => prev + key);
    }
  };

  const handleBackspace = () => {
    setCode(prev => prev.slice(0, -1));
  };

  const handleSubmit = () => {
    if (code.length > 0) {
      onSubmit(code);
    }
  };

  // Simple numeric/alphabetic layout
  const rows = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M']
  ];

  return (
    <div className="w-screen h-screen bg-gray-900 text-white flex flex-col items-center p-8">
      
      <div className="w-full flex justify-start mb-8">
        <button 
          onClick={onCancel}
          className="px-6 py-3 bg-gray-700 rounded-xl text-xl font-bold"
        >
          &larr; กลับ / Back
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl space-y-12">
        
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">กรอกรหัส / Enter Code</h1>
          <p className="text-xl text-gray-400">Please enter your redeem code</p>
        </div>

        {/* Code Display */}
        <div className="w-full max-w-2xl h-24 bg-gray-800 border-4 border-gray-600 rounded-2xl flex items-center justify-center text-5xl tracking-[0.5em] font-mono shadow-inner">
          {code || <span className="text-gray-600 tracking-normal text-3xl">_ _ _ _ _ _ _ _</span>}
        </div>

        {error && (
          <div className="text-red-400 text-2xl font-bold bg-red-900/30 px-6 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Keyboard */}
        <div className="w-full space-y-4 bg-gray-800 p-6 rounded-3xl shadow-xl">
          {rows.map((row, i) => (
            <div key={i} className="flex justify-center space-x-3">
              {row.map(key => (
                <button
                  key={key}
                  onClick={() => handleKeyPress(key)}
                  className="w-16 h-16 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl text-3xl font-bold transition-colors shadow-sm"
                >
                  {key}
                </button>
              ))}
              {i === rows.length - 1 && (
                <button
                  onClick={handleBackspace}
                  className="px-6 bg-red-900/50 hover:bg-red-900/70 active:bg-red-800 rounded-xl text-2xl font-bold text-red-200 transition-colors shadow-sm"
                >
                  DEL
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isLoading || code.length === 0}
          className={`px-16 py-6 rounded-full text-4xl font-bold transition-all shadow-2xl mt-8 ${
            code.length > 0 && !isLoading 
              ? 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95' 
              : 'bg-gray-700 text-gray-500 opacity-50'
          }`}
        >
          {isLoading ? 'กำลังตรวจสอบ...' : 'ยืนยัน / Confirm'}
        </button>
      </div>
    </div>
  );
};
