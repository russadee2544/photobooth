import type { PrintJob } from './domain/models';

export interface PrinterGateway {
  printSet(job: PrintJob, onProgress: (completed: 0 | 1 | 2) => void): Promise<void>;
}

class BrowserPrinterSimulator implements PrinterGateway {
  async printSet(_job: PrintJob, onProgress: (completed: 0 | 1 | 2) => void): Promise<void> {
    onProgress(0);
    await delay(700);
    onProgress(1);
    await delay(700);
    onProgress(2);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function createPrinterGateway(): PrinterGateway {
  // The web build never calls window.print(). Android will inject its ESC/POS
  // implementation behind this interface after physical-printer certification.
  return new BrowserPrinterSimulator();
}
