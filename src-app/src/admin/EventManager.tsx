import React, { useState } from 'react';
import { PhotoboothEvent, EventState } from '@/types';

interface EventManagerProps {
  events: PhotoboothEvent[];
  currentEvent: PhotoboothEvent | null;
  onCreateEvent: (name: string, email: string) => void;
  onOpenEvent: (id: string) => void;
  onCloseEvent: (id: string) => void;
}

export const EventManager: React.FC<EventManagerProps> = ({
  events,
  currentEvent,
  onCreateEvent,
  onOpenEvent,
  onCloseEvent
}) => {
  const [newEventName, setNewEventName] = useState('');
  const [newEventEmail, setNewEventEmail] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newEventName.trim() && newEventEmail.trim()) {
      onCreateEvent(newEventName, newEventEmail);
      setNewEventName('');
      setNewEventEmail('');
    }
  };

  const getStatusColor = (state: EventState) => {
    switch (state) {
      case EventState.Draft: return 'bg-gray-100 text-gray-800 border-gray-200';
      case EventState.Open: return 'bg-green-100 text-green-800 border-green-200';
      case EventState.Closing: return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case EventState.Exporting: return 'bg-blue-100 text-blue-800 border-blue-200';
      case EventState.Verified: return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case EventState.Closed: return 'bg-gray-100 text-gray-500 border-gray-200';
      case EventState.ExportFailed: return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-8">
      {/* Current Event Panel */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold mb-6 text-gray-800">Current Event / งานปัจจุบัน</h2>
        
        {currentEvent ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{currentEvent.name}</h3>
                <p className="text-sm text-gray-500">{currentEvent.ownerEmail}</p>
                <div className="mt-2 text-xs text-gray-500">
                  Created: {new Date(currentEvent.createdAt).toLocaleString()}
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-3">
                <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(currentEvent.state)}`}>
                  {currentEvent.state.toUpperCase()}
                </span>
                
                <div className="flex gap-2">
                  {currentEvent.state === EventState.Draft && (
                    <button 
                      onClick={() => onOpenEvent(currentEvent.id)}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors shadow-sm"
                    >
                      Open Event / เปิดงาน
                    </button>
                  )}
                  {currentEvent.state === EventState.Open && (
                    <button 
                      onClick={() => setShowCloseModal(true)}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors shadow-sm"
                    >
                      Close Event / ปิดงาน
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Export Status (Mocked for visual) */}
            {(currentEvent.state === EventState.Exporting || currentEvent.state === EventState.Verified) && (
              <div className="p-4 border border-blue-100 bg-blue-50 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-3">Export Status / สถานะการส่งออกข้อมูล</h4>
                <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                  <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: currentEvent.state === EventState.Verified ? '100%' : '65%' }}></div>
                </div>
                <div className="flex justify-between text-xs text-blue-800">
                  <span>{currentEvent.state === EventState.Verified ? '100% Complete' : '65% - Uploading to Cloud...'}</span>
                  <span>142 / 142 Files</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p>No active event running.</p>
            <p className="text-sm">Create a new event to start accepting guests.</p>
          </div>
        )}
      </div>

      {/* Create Event Form */}
      {(!currentEvent || currentEvent.state === EventState.Closed || currentEvent.state === EventState.Verified) && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Create New Event / สร้างงานใหม่</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Name / ชื่องาน</label>
              <input 
                type="text" 
                required
                value={newEventName}
                onChange={e => setNewEventName(e.target.value)}
                placeholder="e.g., Wedding A & B"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner Email / อีเมลเจ้าของงาน</label>
              <input 
                type="email" 
                required
                value={newEventEmail}
                onChange={e => setNewEventEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div className="md:col-span-2 flex justify-end mt-2">
              <button 
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shadow-sm"
              >
                Create Event / สร้างงาน
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Event History */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold mb-4 text-gray-800">Event History / ประวัติงาน</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {events.filter(e => e.id !== currentEvent?.id).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">No past events found.</td>
                </tr>
              ) : (
                events.filter(e => e.id !== currentEvent?.id).map((event) => (
                  <tr key={event.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{event.name}</div>
                      <div className="text-sm text-gray-500">{event.ownerEmail}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${getStatusColor(event.state)}`}>
                        {event.state}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(event.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button className="text-blue-600 hover:text-blue-900">View Data</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Close Confirmation Modal */}
      {showCloseModal && currentEvent && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowCloseModal(false)}></div>
            
            <div className="relative inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <h3 className="text-lg font-medium leading-6 text-gray-900 mb-2">Close Event / ปิดงาน</h3>
              <p className="text-sm text-gray-500 mb-6">
                Are you sure you want to close "{currentEvent.name}"? This will stop the kiosk and begin the cloud export process. This action cannot be undone.
              </p>
              
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none"
                  onClick={() => setShowCloseModal(false)}
                >
                  Cancel / ยกเลิก
                </button>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none shadow-sm"
                  onClick={() => {
                    onCloseEvent(currentEvent.id);
                    setShowCloseModal(false);
                  }}
                >
                  Confirm Close / ยืนยันการปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
