import { useEffect, useRef, useState } from 'react';
import type { CapturedPhoto } from './domain/models';

interface CameraCaptureProps {
  capturedCount: number;
  requiredCount: number;
  onCapture: (photo: CapturedPhoto) => void;
  captureLabel: string;
}

export function CameraCapture({ capturedCount, requiredCount, onCapture, captureLabel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('อุปกรณ์นี้ไม่รองรับการใช้กล้องผ่านเว็บ');
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('ไม่พบกล้องหรือยังไม่ได้อนุญาตให้ใช้กล้อง'));

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready || video.videoWidth === 0) return;
    const scale = Math.min(1, 1280 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture({
      id: crypto.randomUUID(),
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      capturedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="camera-shell">
      <div className="camera-viewport">
        <video ref={videoRef} autoPlay muted playsInline onCanPlay={() => setReady(true)} aria-label="Camera preview" />
        <div className="camera-counter">{Math.min(capturedCount + 1, requiredCount)} / {requiredCount}</div>
        {error && <div className="camera-error">{error}</div>}
      </div>
      <button className="shutter" type="button" onClick={capture} disabled={!ready}>
        <span aria-hidden="true" />{captureLabel}
      </button>
    </div>
  );
}
