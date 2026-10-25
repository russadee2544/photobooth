// "The Moment" receipt theme: the owner's Canva strip (192 x 576 design units, exported 1200 x 3600,
// K = 6.25 px per unit) with the café name. Run through build-moment.mjs.
// Paper: white (the design's beige would print as grey dots), the two vertical words cut from the export
// (café name at the top of the left column, "THE MOMENT" at the bottom). Over: the thin black photo borders.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

public static class MomentTheme
{
    const float K = 6.25f;
    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

    // spec items separated by '|':
    //   C,W,H                                   canvas (design units)
    //   T,srcX,srcY,srcW,srcH,dstX,dstY,scale   piece of the export (lettering), beige turned white
    //   R,x,y,w,h,stroke                        photo border
    public static void Variant(string src, string spec, string paperOut, string overOut)
    {
        var items = spec.Split('|');
        var head = items[0].Split(',');
        int W = (int)Math.Round(F(head[1]) * K), H = (int)Math.Round(F(head[2]) * K);
        using (var export = new Bitmap(src))
        using (var paper = new Bitmap(W, H, PixelFormat.Format24bppRgb))
        using (var over = new Bitmap(W, H, PixelFormat.Format32bppArgb))
        using (var pg = Graphics.FromImage(paper))
        using (var og = Graphics.FromImage(over))
        {
            pg.Clear(Color.White);
            pg.InterpolationMode = InterpolationMode.HighQualityBicubic;
            pg.PixelOffsetMode = PixelOffsetMode.HighQuality;
            og.SmoothingMode = SmoothingMode.AntiAlias;
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] == "T")
                {
                    var s = new RectangleF(F(p[1]) * K, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K);
                    float sc = F(p[7]);
                    var d = new RectangleF(F(p[5]) * K, F(p[6]) * K, s.Width * sc, s.Height * sc);
                    pg.DrawImage(export, d, s, GraphicsUnit.Pixel);
                }
                else if (p[0] == "R")
                {
                    using (var pen = new Pen(Color.Black, F(p[5]) * K))
                        og.DrawRectangle(pen, F(p[1]) * K, F(p[2]) * K, F(p[3]) * K, F(p[4]) * K);
                }
            }
            Whiten(paper);
            paper.Save(paperOut, ImageFormat.Png);   // lossless: JPEG noise around letters prints as stray dots
            over.Save(overOut, ImageFormat.Png);
        }
    }

    // Beige (#f8f7f2) and its anti-aliasing towards the black letters -> white-to-black greys.
    static void Whiten(Bitmap bmp)
    {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
        var px = new byte[data.Stride * bmp.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        for (int i = 0; i + 2 < px.Length; i += 3)
        {
            float l = px[i] * 0.114f + px[i + 1] * 0.587f + px[i + 2] * 0.299f;
            // beige luma ~247 -> pure white (a 254 would leave stray dots on the receipt), letters keep their greys
            byte v = l >= 238f ? (byte)255 : (byte)Math.Max(0, Math.Min(255, l * 255f / 247f));
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
    }
}
