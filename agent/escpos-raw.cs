// Prints an image on a receipt printer as ESC/POS raster data sent straight to the Windows spooler
// (datatype RAW), so the printer driver's own image conversion is never used. Many receipt printer
// drivers print text fine but feed out a blank slip for pictures; this path avoids that.
// Each copy: photo (Floyd-Steinberg dithered to black/white dots) + paper feed + cut.
// Loaded by printer-win.mjs through PowerShell Add-Type.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class EscPosRaw
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    class DocInfo { public string Name = "Photobooth"; public string Output = null; public string DataType = "RAW"; }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);

    // Image -> ESC/POS bytes for `copies` slips, `dots` wide (58 mm: 384, 80 mm: 576).
    public static byte[] Build(string imageFile, int dots, int copies, bool cut)
    {
        bool[,] black;
        int w = dots, h;
        using (var src = new Bitmap(imageFile))
        {
            h = Math.Max(1, (int)Math.Round(src.Height * (double)w / src.Width));
            using (var scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(scaled))
                {
                    g.Clear(Color.White);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(src, 0, 0, w, h);
                }
                black = Dither(scaled);
            }
        }
        int bytesPerLine = (w + 7) / 8;
        var outp = new MemoryStream();
        for (int c = 0; c < copies; c++)
        {
            outp.Write(new byte[] { 0x1B, 0x40 }, 0, 2);                 // ESC @ reset
            const int band = 128;                                        // rows per GS v 0 block (small printer buffers)
            for (int y0 = 0; y0 < h; y0 += band)
            {
                int rows = Math.Min(band, h - y0);
                outp.Write(new byte[] { 0x1D, 0x76, 0x30, 0x00, (byte)(bytesPerLine & 0xFF), (byte)(bytesPerLine >> 8),
                                        (byte)(rows & 0xFF), (byte)(rows >> 8) }, 0, 8);
                var data = new byte[bytesPerLine * rows];
                for (int y = 0; y < rows; y++)
                    for (int x = 0; x < w; x++)
                        if (black[x, y0 + y]) data[y * bytesPerLine + (x >> 3)] |= (byte)(0x80 >> (x & 7));
                outp.Write(data, 0, data.Length);
            }
            outp.Write(new byte[] { 0x1B, 0x64, 0x04 }, 0, 3);           // feed 4 lines past the cutter
            if (cut) outp.Write(new byte[] { 0x1D, 0x56, 0x42, 0x00 }, 0, 4);  // partial cut
        }
        return outp.ToArray();
    }

    static bool[,] Dither(Bitmap bmp)
    {
        int w = bmp.Width, h = bmp.Height;
        var gray = new float[w * h];
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        var bytes = new byte[data.Stride * h];
        Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
        bmp.UnlockBits(data);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = y * data.Stride + x * 3;
                gray[y * w + x] = bytes[i + 2] * 0.299f + bytes[i + 1] * 0.587f + bytes[i] * 0.114f;
            }
        var black = new bool[w, h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = y * w + x;
                float old = gray[i], nv = old < 128 ? 0 : 255, err = old - nv;
                black[x, y] = nv == 0;
                if (x + 1 < w) gray[i + 1] += err * 7 / 16;
                if (y + 1 < h)
                {
                    if (x > 0) gray[i + w - 1] += err * 3 / 16;
                    gray[i + w] += err * 5 / 16;
                    if (x + 1 < w) gray[i + w + 1] += err * 1 / 16;
                }
            }
        return black;
    }

    // 0 = the spooler accepted every byte, 2 = nothing was sent (printer missing), 3 = failed part-way.
    public static int Send(string printer, byte[] payload)
    {
        if (printer.StartsWith("FILE:")) { File.WriteAllBytes(printer.Substring(5), payload); return 0; }   // tests
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero)) return 2;
        try
        {
            if (StartDocPrinter(h, 1, new DocInfo()) == 0) return 2;
            bool ok = StartPagePrinter(h);
            int written = 0;
            ok = ok && WritePrinter(h, payload, payload.Length, out written) && written == payload.Length;
            EndPagePrinter(h);
            EndDocPrinter(h);
            return ok ? 0 : 3;
        }
        finally { ClosePrinter(h); }
    }
}
