import React, { useState } from 'react';
import { PrinterStatus } from '@/types';

// Assuming a basic printer config type for the panel
export interface PrinterConfig {
  type: 'simulator' | 'real';
  ipAddress: string;
  port: number;
}

interface PrinterPanelProps {
  status: PrinterStatus;
  config: PrinterConfig;
  onTestPrint: () => Promise<{ success: boolean; error?: string }>;
  onResetPaper: () => void;
  onSaveConfig: (config: PrinterConfig) => void;
}

export const PrinterPanel: React.FC<PrinterPanelProps> = ({
  status,
  config: initialConfig,
  onTestPrint,
  onResetPaper,
  onSaveConfig
}) => {
  const [config, setConfig] = useState<PrinterConfig>(initialConfig);
  const [testPrintState, setTestPrintState] = useState<'idle' | 'printing' | 'success' | 'error'>('idle');
  const [testPrintMsg, setTestPrintMsg] = useState('');

  const handleChange = (field: keyof PrinterConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSaveConfig(config);
  };

  const handleTestPrint = async () => {
    setTestPrintState('printing');
    try {
      const result = await onTestPrint();
      if (result.success) {
        setTestPrintState('success');
        setTestPrintMsg('Test print successful! / พิมพ์ทดสอบสำเร็จ');
      } else {
        setTestPrintState('error');
        setTestPrintMsg(result.error || 'Unknown error occurred.');
      }
    } catch (e: any) {
      setTestPrintState('error');
      setTestPrintMsg(e.message || 'Print failed.');
    }
    
    // Reset state after 5 seconds
    setTimeout(() => {
      if (testPrintState === 'success' || testPrintState === 'error') {
        setTestPrintState('idle');
      }
    }, 5000);
  };

  // Mock paper stats (since PrinterStatus only has paperEstimateRemaining)
  const remainingPercent = status.paperEstimateRemaining !== null ? status.paperEstimateRemaining : 100;
  let paperStatusColor = 'bg-green-500';
  let paperWarning = null;
  
  if (remainingPercent <= 10) {
    paperStatusColor = 'bg-red-500';
    paperWarning = 'CRITICAL: Paper almost empty! / กระดาษใกล้หมด';
  } else if (remainingPercent <= 25) {
    paperStatusColor = 'bg-yellow-500';
    paperWarning = 'WARNING: Paper running low. / กระดาษเหลือน้อย';
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-start mb-6 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Printer Settings / ตั้งค่าปริ้นเตอร์</h2>
          <p className="text-sm text-gray-500">Configure 80mm thermal receipt printer</p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${status.connected ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <div className={`w-3 h-3 rounded-full ${status.connected ? 'bg-green-500' : 'bg-red-500'} ${status.connected ? 'animate-pulse' : ''}`}></div>
          <span className="font-semibold text-sm">
            {status.connected ? '🟢 Connected / เชื่อมต่อแล้ว' : '🔴 Disconnected / ขาดการเชื่อมต่อ'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Connection Settings */}
        <div className="space-y-6">
          <h3 className="font-medium text-gray-900 border-b pb-2">Connection / การเชื่อมต่อ</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Printer Type / ประเภทปริ้นเตอร์</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  value="simulator" 
                  checked={config.type === 'simulator'}
                  onChange={() => handleChange('type', 'simulator')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm">Simulator (Screen only)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  value="real" 
                  checked={config.type === 'real'}
                  onChange={() => handleChange('type', 'real')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm">Real (LAN TCP)</span>
              </label>
            </div>
          </div>

          <div className={`space-y-4 transition-opacity ${config.type === 'simulator' ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IP Address / ไอพีแอดเดรส</label>
              <input 
                type="text" 
                value={config.ipAddress}
                onChange={(e) => handleChange('ipAddress', e.target.value)}
                placeholder="192.168.1.100"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Port / พอร์ต (Default: 9100)</label>
              <input 
                type="number" 
                value={config.port}
                onChange={(e) => handleChange('port', parseInt(e.target.value))}
                placeholder="9100"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              onClick={handleSave}
              className="flex-1 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm text-sm"
            >
              Save Config / บันทึก
            </button>
            <button 
              onClick={handleTestPrint}
              disabled={testPrintState === 'printing' || (!status.connected && config.type === 'real')}
              className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors shadow-sm text-sm disabled:opacity-50"
            >
              {testPrintState === 'printing' ? 'Printing...' : 'Test Print / พิมพ์ทดสอบ'}
            </button>
          </div>
          
          {testPrintState === 'success' && (
             <div className="p-3 bg-green-50 text-green-700 text-sm rounded-md border border-green-200">
               ✅ {testPrintMsg}
             </div>
          )}
          {testPrintState === 'error' && (
             <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
               ❌ {testPrintMsg}
             </div>
          )}
          {status.errorMessage && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
              <strong>Printer Error:</strong> {status.errorMessage}
            </div>
          )}
        </div>

        {/* Paper Estimate */}
        <div className="space-y-6">
          <h3 className="font-medium text-gray-900 border-b pb-2">Paper Estimate / ปริมาณกระดาษ</h3>
          
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 flex flex-col items-center">
            <div className="relative w-48 h-48 mb-4">
              <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                <circle 
                  cx="50" cy="50" r="40" 
                  fill="none" stroke="#e5e7eb" strokeWidth="12" 
                />
                <circle 
                  cx="50" cy="50" r="40" 
                  fill="none" stroke={remainingPercent > 25 ? '#3b82f6' : (remainingPercent > 10 ? '#eab308' : '#ef4444')} 
                  strokeWidth="12" 
                  strokeDasharray={`${remainingPercent * 2.51} 251`}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-gray-800">{Math.round(remainingPercent)}%</span>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Remaining</span>
              </div>
            </div>
            
            <div className="w-full space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Roll Length:</span>
                <span className="font-medium text-gray-900">~60 m (Estimated)</span>
              </div>
              <div className="flex justify-between">
                <span>Printed Length:</span>
                <span className="font-medium text-gray-900">~{((100 - remainingPercent) * 0.6).toFixed(1)} m</span>
              </div>
            </div>

            {paperWarning && (
              <div className={`mt-4 w-full p-2 text-center text-sm font-bold rounded ${remainingPercent <= 10 ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-yellow-100 text-yellow-800 border border-yellow-200'}`}>
                {paperWarning}
              </div>
            )}
            
            <div className="mt-6 w-full pt-4 border-t border-gray-200">
              <button 
                onClick={onResetPaper}
                className="w-full py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm"
              >
                🔄 ใส่ม้วนใหม่ / Reset Paper Roll
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">Click this when you insert a brand new paper roll.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
