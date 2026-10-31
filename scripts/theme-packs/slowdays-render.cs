// "Slow Days" receipt theme: the owner's Canva strip (pink house on blue stripes, doodles) with the café
// name. Exports are 1200 x 3600 = 192 x 576 design units (K = 6.25). Run through build-slowdays.mjs.
// Receipt paper cannot carry the pink or the pale blue (they print as grey dots), so the design becomes
// black on white: house and pale stripes -> white, navy stripes and lettering -> black, the café pill
// inverted, the house outlined. Doodles (doodles export minus clean export) go in the layer over the photos.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

public static class SlowDaysTheme
{
    const float K = 6.25f;
    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

    static byte[] Pixels(Bitmap bmp, out int stride)
    {
        var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        var px = new byte[data.Stride * bmp.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        stride = data.Stride;
        bmp.UnlockBits(data);
        return px;
    }

    static byte Ramp(int v, int lo, int hi) { return (byte)Math.Max(0, Math.Min(255, (v - lo) * 255 / (hi - lo))); }

    // Clean export -> black on white. pill: x, y, w, h in design units.
    public static void Paper(string clean, string dest, float px0, float py0, float pw, float ph)
    {
        using (var bmp = new Bitmap(clean))
        {
            int w = bmp.Width, h = bmp.Height, stride;
            var px = Pixels(bmp, out stride);
            using (var o = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                var od = o.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                var op = new byte[od.Stride * h];
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                    {
                        int i = y * stride + x * 3;
                        int min = Math.Min(px[i], Math.Min(px[i + 1], px[i + 2]));
                        bool pill = x >= px0 * K && x < (px0 + pw) * K && y >= py0 * K && y < (py0 + ph) * K;
                        byte v = pill ? Ramp(min, 195, 240) : Ramp(min, 70, 165);
                        int j = y * od.Stride + x * 3;
                        op[j] = op[j + 1] = op[j + 2] = v;
                    }
                Marshal.Copy(op, 0, od.Scan0, op.Length);
                o.UnlockBits(od);
                o.Save(dest, ImageFormat.Png);
            }
        }
    }

    // doodles export minus clean export -> black doodles on transparent.
    public static void Doodles(string withDoodles, string clean, string dest)
    {
        using (var a = new Bitmap(withDoodles))
        using (var b = new Bitmap(clean))
        {
            int w = a.Width, h = a.Height, sa, sb;
            var pa = Pixels(a, out sa);
            var pb = Pixels(b, out sb);
            using (var o = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                var od = o.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                var op = new byte[od.Stride * h];
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++)
                    {
                        int i = y * sa + x * 3, k = y * sb + x * 3, d = 0;
                        for (int c = 0; c < 3; c++) d = Math.Max(d, Math.Abs(pa[i + c] - pb[k + c]));
                        op[y * od.Stride + x * 4 + 3] = Ramp(d, 12, 80);   // RGB stays 0: black ink
                    }
                Marshal.Copy(op, 0, od.Scan0, op.Length);
                o.UnlockBits(od);
                o.Save(dest, ImageFormat.Png);
            }
        }
    }

    // spec items separated by '|':
    //   C,W,H,headerEnd,houseEnd,srcHouseEnd      canvas and how the house stretches (design units)
    //   H,x1,y1,x2,y2,...                         house outline (closed), drawn on the paper
    //   R,x,y,w,h,stroke                          photo border, drawn over the photo
    //   S,srcX,srcY,srcW,srcH,dstX,dstY           doodle, over the photo
    public static void Variant(string paperSrc, string doodlesSrc, string spec, string paperOut, string overOut)
    {
        var items = spec.Split('|');
        var head = items[0].Split(',');
        float dw = F(head[1]), dh = F(head[2]), hEnd = F(head[3]), houseEnd = F(head[4]), srcHouseEnd = F(head[5]);
        int W = (int)Math.Round(dw * K), H = (int)Math.Round(dh * K);
        using (var src = new Bitmap(paperSrc))
        using (var doodles = new Bitmap(doodlesSrc))
        using (var paper = new Bitmap(W, H, PixelFormat.Format24bppRgb))
        using (var over = new Bitmap(W, H, PixelFormat.Format32bppArgb))
        using (var pg = Graphics.FromImage(paper))
        using (var og = Graphics.FromImage(over))
        {
            pg.Clear(Color.White);
            pg.InterpolationMode = InterpolationMode.NearestNeighbor;
            pg.PixelOffsetMode = PixelOffsetMode.Half;
            og.PixelOffsetMode = PixelOffsetMode.Half;
            // The stripes lean a little, so joined pieces would jog: stretch the plain middle in one go instead.
            pg.DrawImage(src, new RectangleF(0, 0, W, hEnd * K), new RectangleF(0, 0, W, hEnd * K), GraphicsUnit.Pixel);
            pg.DrawImage(src, new RectangleF(0, hEnd * K, W, (houseEnd - hEnd) * K),
                new RectangleF(0, hEnd * K, W, (srcHouseEnd - hEnd) * K), GraphicsUnit.Pixel);
            pg.DrawImage(src, new RectangleF(0, houseEnd * K, W, (dh - houseEnd) * K),
                new RectangleF(0, srcHouseEnd * K, W, (dh - houseEnd) * K), GraphicsUnit.Pixel);
            pg.SmoothingMode = SmoothingMode.AntiAlias;
            og.SmoothingMode = SmoothingMode.AntiAlias;
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] == "H")
                {
                    var pts = new PointF[(p.Length - 1) / 2];
                    for (int i = 0; i < pts.Length; i++) pts[i] = new PointF(F(p[1 + i * 2]) * K, F(p[2 + i * 2]) * K);
                    using (var pen = new Pen(Color.Black, 0.8f * K)) pg.DrawPolygon(pen, pts);
                }
                else if (p[0] == "R")
                {
                    using (var pen = new Pen(Color.Black, F(p[5]) * K))
                        og.DrawRectangle(pen, F(p[1]) * K, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K);
                }
                else if (p[0] == "S")
                {
                    var s = new RectangleF(F(p[1]) * K, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K);
                    og.DrawImage(doodles, new RectangleF(F(p[5]) * K, F(p[6]) * K, s.Width, s.Height), s, GraphicsUnit.Pixel);
                }
            }
            paper.Save(paperOut, ImageFormat.Png);   // lossless: JPEG noise prints as stray dots
            over.Save(overOut, ImageFormat.Png);
        }
    }
}
