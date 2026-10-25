// "Lace" receipt theme from the owner's Canva strip (red fabric, lace doilies around oval photos, café name).
// Export: 1200 x 3600 = 192 x 576 design units (K = 6.25). Run through build-lace.mjs.
// Receipt paper cannot carry the dark red fabric, so the design becomes line art on white:
// fabric -> white, lace -> black outline with the pink eyelets in grey, lettering -> solid black.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

public static class LaceTheme
{
    const float K = 6.25f;
    static float F(string s) { return float.Parse(s, CultureInfo.InvariantCulture); }

    // Whole design -> line art (same size). textTop: design-unit y where the lettering starts.
    public static void LineArt(string src, string dest, float textTop)
    {
        using (var bmp = new Bitmap(src))
        {
            int w = bmp.Width, h = bmp.Height;
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            var px = new byte[data.Stride * h];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            bmp.UnlockBits(data);
            int stride = data.Stride;
            var lace = new bool[w * h];
            var pink = new bool[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * stride + x * 3;
                    int b = px[i], g = px[i + 1], r = px[i + 2];
                    int min = Math.Min(r, Math.Min(g, b));
                    lace[y * w + x] = min > 90;                         // cream lace / lettering (fabric min ~ 0-30)
                    pink[y * w + x] = min > 90 && r - g > 30;           // pink eyelets
                }
            int ty = (int)(textTop * K);
            const int R = 3;                                            // outline thickness (px at 1200 wide)
            var outBmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
            var od = outBmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
            var op = new byte[od.Stride * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    byte v = 255;
                    int k = y * w + x;
                    if (lace[k])
                    {
                        if (y >= ty) v = 0;                             // lettering: solid ink
                        else
                        {
                            bool edge = false;
                            for (int dy = -R; dy <= R && !edge; dy++)
                                for (int dx = -R; dx <= R; dx++)
                                {
                                    int xx = x + dx, yy = y + dy;
                                    if (xx < 0 || yy < 0 || xx >= w || yy >= h || !lace[yy * w + xx]) { edge = true; break; }
                                }
                            if (edge) v = 0;
                            else if (pink[k]) v = 150;
                        }
                    }
                    int o = y * od.Stride + x * 3;
                    op[o] = op[o + 1] = op[o + 2] = v;
                }
            Marshal.Copy(op, 0, od.Scan0, op.Length);
            outBmp.UnlockBits(od);
            outBmp.Save(dest, ImageFormat.Png);
            outBmp.Dispose();
        }
    }

    // spec: C,W,H | P,srcY0,srcY1,dstY  (full-width pieces of the line art, same size)
    public static void Variant(string lineArt, string spec, string paperOut)
    {
        var items = spec.Split('|');
        var head = items[0].Split(',');
        int W = (int)Math.Round(F(head[1]) * K), H = (int)Math.Round(F(head[2]) * K);
        using (var art = new Bitmap(lineArt))
        using (var paper = new Bitmap(W, H, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(paper))
        {
            g.Clear(Color.White);
            foreach (var raw in items)
            {
                var p = raw.Split(',');
                if (p[0] != "P") continue;
                var src = new Rectangle(0, (int)Math.Round(F(p[1]) * K), art.Width, (int)Math.Round((F(p[2]) - F(p[1])) * K));
                g.DrawImage(art, new Rectangle(0, (int)Math.Round(F(p[3]) * K), W, src.Height), src, GraphicsUnit.Pixel);
            }
            paper.Save(paperOut, ImageFormat.Png);
        }
    }
}
