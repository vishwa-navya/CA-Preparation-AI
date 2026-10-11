import { CalendarClock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useScheduledPhotoDelivery } from '../hooks/useScheduledPhotoDelivery';

interface SchedulePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (localDateTime: string) => Promise<void>;
  isScheduling: boolean;
  error: string | null;
}

function getLocalDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function SchedulePhotoModal({ isOpen, onClose, onConfirm, isScheduling, error }: SchedulePhotoModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  // This modal is always mounted inside Chat2 and Chat3, so it is also where the
  // backup delivery check runs while the couple chat is open.
  useScheduledPhotoDelivery();

  useEffect(() => {
    if (isOpen) {
      const now = new Date(Date.now() + 60 * 60 * 1000);
      setDate(getLocalDateValue(now));
      setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const minDate = getLocalDateValue(new Date());
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onConfirm(`${date}T${time}`);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-800">
            <CalendarClock className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Schedule photo</h2>
          </div>
          <button type="button" onClick={onClose} disabled={isScheduling} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Date
            <input type="date" value={date} min={minDate} onChange={(event) => setDate(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} disabled={isScheduling} className="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={isScheduling} className="flex-1 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {isScheduling ? 'Scheduling…' : 'Confirm schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default SchedulePhotoModal;