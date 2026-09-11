import { X, Download } from 'lucide-react';
import { downloadFile } from '../lib/supabase';

interface PdfViewerModalProps {
  fileUrl: string;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
}

function PdfViewerModal({ fileUrl, fileName, isOpen, onClose }: PdfViewerModalProps) {
  if (!isOpen) return null;

  const handleDownload = async () => {
    try {
      await downloadFile(fileUrl, fileName);
    } catch (error) {
      console.error('PDF download failed:', error);
      alert('Failed to download PDF. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex flex-col z-[60]">
      {/* Top bar: file name + close + download */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur-md">
        <h3 className="text-white font-medium truncate flex-1 mr-4">{fileName}</h3>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors text-sm mr-2"
          title="Download"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button
          onClick={onClose}
          className="bg-white/20 text-white p-2 rounded-lg hover:bg-white/30 transition-colors"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* PDF iframe — fills the rest of the screen */}
      <div className="flex-1 w-full">
        <iframe
          src={fileUrl}
          className="w-full h-full border-0"
          title={fileName}
        />
      </div>
    </div>
  );
}

export default PdfViewerModal;
