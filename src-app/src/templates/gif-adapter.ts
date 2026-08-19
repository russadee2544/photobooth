import type { GifCaptureConfig, GifOverlay } from '../types';

export interface GifCaptureAdapter {
  configureCapture(config: GifCaptureConfig): void;
  captureFrames(): Promise<Blob[]>;
  generateGif(frames: Blob[], overlay?: GifOverlay): Promise<Blob>;
}

export class DefaultGifAdapter implements GifCaptureAdapter {
  private config?: GifCaptureConfig;
  
  configureCapture(config: GifCaptureConfig): void {
    this.config = config;
    console.log('GIF capture configured', config);
  }
  
  async captureFrames(): Promise<Blob[]> {
    // Skeleton implementation
    console.log('Capturing GIF frames...');
    return [];
  }
  
  async generateGif(frames: Blob[], overlay?: GifOverlay): Promise<Blob> {
    // Skeleton implementation
    console.log('Generating GIF with', frames.length, 'frames and overlay', overlay);
    return new Blob(['gif-placeholder'], { type: 'image/gif' });
  }
}
