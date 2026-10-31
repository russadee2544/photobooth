// "Memory Report" receipt theme: the owner's Canva newspaper strip with the café name in the bottom bar.
// Export: 1200 x 3600 = 192 x 576 design units (K = 6.25). Run through build-memoryreport.mjs.
// Receipt paper cannot carry the crumpled beige paper (it prints as grey dots), so it turns white and the
// dark grey lettering turns black.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

public static class MemoryReportTheme
{
    const float K = 6.25f;
    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

    // Whole design -> black on white (same size).
    public static void Ink(string src, string dest)
    {
        using (var bmp = new Bitmap(src))
        {
            int w = bmp.Width, h = bmp.Height;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            var px = new byte[data.Stride * h];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            int stride = data.Stride;
            bmp.UnlockBits(data);
            using (var o = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                var od = o.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                var op = new byte[od.Stride * h];
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                    {
                        int i = y * stride + x * 3;
                        int min = Math.Min(px[i], Math.Min(px[i + 1], px[i + 2]));
                        byte v = (byte)Math.Max(0, Math.Min(255, (min - 75) * 255 / (165 - 75)));
                        int j = y * od.Stride + x * 3;
                        op[j] = op[j + 1] = op[j + 2] = v;
                    }
                Marshal.Copy(op, 0, od.Scan0, op.Length);
                o.UnlockBits(od);
                o.Save(dest, ImageFormat.Png);
            }
        }
    }

    // spec: C,W,H | P,srcY0,srcY1,dstY pieces of the design, in design units.
    public static void Variant(string art, string spec, string dest)
    {
        var items = spec.Split('|');
        var head = items[0].Split(',');
        int W = (int)Math.Round(F(head[1]) * K), H = (int)Math.Round(F(head[2]) * K);
        using (var src = new Bitmap(art))
        using (var page = new Bitmap(W, H, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(page))
        {
            g.Clear(Color.White);
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] != "P") continue;
                float y0 = F(p[1]) * K, y1 = F(p[2]) * K;
                var rect = new RectangleF(0, y0, W, y1 - y0);
                g.DrawImage(src, new RectangleF(0, F(p[3]) * K, W, y1 - y0), rect, GraphicsUnit.Pixel);
            }
            page.Save(dest, ImageFormat.Png);   // lossless: JPEG noise around letters prints as stray dots
        }
    }
}
