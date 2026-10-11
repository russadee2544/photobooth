// Renders the "Boarding pass" receipt theme (58 mm), after the owner's Canva design: a cream ticket
// with a dotted world map on top, a navy stub below the perforation where the photos sit.
// Background (per layout height) and transparent stickers. Run through build-boarding.mjs.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public static class BoardingTheme
{
    const int S = 3;
    static readonly Color Navy = Color.FromArgb(27, 36, 112);
    static readonly Color Cream = Color.FromArgb(255, 252, 240);
    const string Cond = "Bahnschrift SemiBold Condensed";
    const string Label = "Bahnschrift";

    static Bitmap NewLayer(float w, float h, out Graphics g)
    {
        var bmp = new Bitmap((int)Math.Round(w * S), (int)Math.Round(h * S), PixelFormat.Format32bppArgb);
        g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.ScaleTransform(S, S);
        return bmp;
    }
    static void Save(Bitmap bmp, string dir, string name) { bmp.Save(Path.Combine(dir, name), ImageFormat.Png); bmp.Dispose(); }

    // align: -1 left, 0 centre, 1 right. Text is scaled to fit the box.
    static void Text(Graphics g, string text, string family, FontStyle style, RectangleF box, Color color, int align = 0)
    {
        var fam = new FontFamily(family);
        float size = 200f;
        GraphicsPath path = null;
        RectangleF b = RectangleF.Empty;
        for (int i = 0; i < 60; i++)
        {
            if (path != null) path.Dispose();
            path = new GraphicsPath(FillMode.Winding);   // variable fonts overlap contours: fill non-zero, not even-odd
            path.AddString(text, fam, (int)style, size, PointF.Empty, StringFormat.GenericTypographic);
            b = path.GetBounds();
            if (b.Width <= box.Width && b.Height <= box.Height) break;
            size *= Math.Min(0.98f, Math.Min(box.Width / Math.Max(1f, b.Width), box.Height / Math.Max(1f, b.Height)));
        }
        float x = align < 0 ? box.X - b.X : align > 0 ? box.Right - b.Right : box.X + (box.Width - b.Width) / 2f - b.X;
        var m = new Matrix();
        m.Translate(x, box.Y + (box.Height - b.Height) / 2f - b.Y);
        path.Transform(m);
        using (var brush = new SolidBrush(color)) g.FillPath(brush, path);
        path.Dispose();
    }

    static void Plane(Graphics g, RectangleF box, Color color)
    {
        Text(g, "✈", "Segoe UI Symbol", FontStyle.Regular, box, color);
    }

    static void Barcode(Graphics g, RectangleF box, Color color, int seed)
    {
        var rnd = new Random(seed);
        float x = box.X;
        using (var br = new SolidBrush(color))
            while (true)
            {
                float bar = 0.9f + rnd.Next(0, 4) * 0.8f, gap = 1f + rnd.Next(0, 3) * 0.8f;
                if (x + bar > box.Right) break;
                g.FillRectangle(br, x, box.Y, bar, box.Height);
                x += bar + gap;
            }
    }

    // Two-line field: small caption, value underneath.
    static void Field(Graphics g, string caption, string value, float x, float y, float w)
    {
        Text(g, caption, Label, FontStyle.Regular, new RectangleF(x, y, w, 7.5f), Navy, -1);
        Text(g, value, Cond, FontStyle.Regular, new RectangleF(x, y + 10, w, 15), Navy, -1);
    }

    // Everything on the cream ticket above the perforation.
    public static void Ticket(string dir, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        Plane(g, new RectangleF(0, 4, 14, 12), Navy);
        Text(g, "BORCELLE AIRLINES", Cond, FontStyle.Regular, new RectangleF(18, 5, 140, 11), Navy, -1);
        Text(g, "BOARDING PASS", Cond, FontStyle.Regular, new RectangleF(w - 120, 5, 120, 11), Navy, 1);
        Text(g, "FROM", Label, FontStyle.Regular, new RectangleF(0, 34, 110, 8), Navy);
        Text(g, "TO", Label, FontStyle.Regular, new RectangleF(w - 110, 34, 110, 8), Navy);
        Text(g, "PHA", Cond, FontStyle.Regular, new RectangleF(0, 46, 110, 50), Navy);
        Text(g, "BMA", Cond, FontStyle.Regular, new RectangleF(w - 110, 46, 110, 50), Navy);
        Plane(g, new RectangleF(w / 2 - 34, 48, 68, 46), Navy);
        Text(g, "07:00 AM", Label, FontStyle.Regular, new RectangleF(0, 102, 110, 9), Navy);
        Text(g, "10:00 PM", Label, FontStyle.Regular, new RectangleF(w - 110, 102, 110, 9), Navy);
        Text(g, "BOARDING TIME: 05:00 AM", Cond, FontStyle.Regular, new RectangleF(w / 2 - 90, 118, 180, 12), Navy);
        using (var pen = new Pen(Navy, 1.6f)) g.DrawLine(pen, 0, 140, w, 140);
        Field(g, "PASSENGER", "BAANMAI AI OON", 0, 150, 200);
        Field(g, "DATE", "28/07/25", 232, 150, 120);
        Field(g, "FLIGHT", "A1234", 0, 184, 100);
        Field(g, "GATE", "08", 132, 184, 80);
        Field(g, "SEAT", "A03", 232, 184, 100);
        g.Dispose(); Save(bmp, dir, "ticket.png");
    }

    // Top of the navy stub: mini route on the left, seat pill on the right.
    public static void StubHeader(string dir, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        Text(g, "BOARDING PASS", Label, FontStyle.Regular, new RectangleF(0, 2, 110, 8), Color.White, -1);
        Text(g, "PHA", Cond, FontStyle.Regular, new RectangleF(0, 14, 36, 18), Color.White, -1);
        Plane(g, new RectangleF(40, 15, 22, 16), Color.White);
        Text(g, "BMA", Cond, FontStyle.Regular, new RectangleF(66, 14, 36, 18), Color.White, -1);
        var pill = new RectangleF(w - 112, 6, 112, 28);
        using (var path = new GraphicsPath())
        {
            float r = pill.Height / 2;
            path.AddArc(pill.X, pill.Y, 2 * r, 2 * r, 90, 180);
            path.AddArc(pill.Right - 2 * r, pill.Y, 2 * r, 2 * r, 270, 180);
            path.CloseFigure();
            using (var b = new SolidBrush(Cream)) g.FillPath(b, path);
        }
        Text(g, "SEAT", Label, FontStyle.Regular, new RectangleF(pill.X + 16, pill.Y + 10, 30, 8), Navy, -1);
        Text(g, "A03", Cond, FontStyle.Regular, new RectangleF(pill.X + 52, pill.Y + 6, 42, 16), Navy, -1);
        g.Dispose(); Save(bmp, dir, "stub-header.png");
    }

    public static void StubFooter(string dir, float w, float h)
    {
        Graphics g; var bmp = NewLayer(w, h, out g);
        Barcode(g, new RectangleF(0, 0, w * 0.62f, h), Color.White, 21);
        Text(g, "FLIGHT A1234", Cond, FontStyle.Regular, new RectangleF(w * 0.66f, 2, w * 0.34f, 13), Color.White, 1);
        Text(g, "GATE 08 · SEAT A03", Label, FontStyle.Regular, new RectangleF(w * 0.66f, h - 11, w * 0.34f, 9), Color.White, 1);
        g.Dispose(); Save(bmp, dir, "stub-footer.png");
    }

    // Cream ticket with a dotted world map, the perforation with side notches, navy stub below.
    public static void Paper(string dir, string name, int w, int h, int perfY)
    {
        const int K = 2;
        using (var bmp = new Bitmap(w * K, h * K, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.ScaleTransform(K, K);
            using (var b = new SolidBrush(Cream)) g.FillRectangle(b, 0, 0, w, perfY);
            using (var b = new SolidBrush(Navy)) g.FillRectangle(b, 0, perfY, w, h - perfY);
            // dotted "continents": a dot grid kept where a smooth noise field is high
            var rnd = new Random(5);
            int gw = 9, gh = 7;
            var grid = new double[gw + 1, gh + 1];
            for (int i = 0; i <= gw; i++) for (int j = 0; j <= gh; j++) grid[i, j] = rnd.NextDouble();
            using (var dot = new SolidBrush(Color.FromArgb(226, 224, 214)))
                for (float y = 8; y < perfY - 6; y += 4.2f)
                    for (float x = 6; x < w - 6; x += 4.2f)
                    {
                        double fx = x / w * gw, fy = y / perfY * gh;
                        int ix = (int)fx, iy = (int)fy;
                        double tx = fx - ix, ty = fy - iy;
                        double a = grid[ix, iy] + (grid[ix + 1, iy] - grid[ix, iy]) * tx;
                        double c = grid[ix, iy + 1] + (grid[ix + 1, iy + 1] - grid[ix, iy + 1]) * tx;
                        if (a + (c - a) * ty > 0.55) g.FillEllipse(dot, x - 1.2f, y - 1.2f, 2.4f, 2.4f);
                    }
            // perforation: notches at both sides and a dashed tear line
            using (var white = new SolidBrush(Color.White))
            {
                g.FillEllipse(white, -12, perfY - 12, 24, 24);
                g.FillEllipse(white, w - 12, perfY - 12, 24, 24);
            }
            using (var pen = new Pen(Color.FromArgb(160, 166, 200), 1.2f)) { pen.DashPattern = new float[] { 3, 3 }; g.DrawLine(pen, 16, perfY, w - 16, perfY); }
            var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c2 => c2.MimeType == "image/jpeg");
            var prm = new EncoderParameters(1);
            prm.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 86L);
            bmp.Save(Path.Combine(dir, name), enc, prm);
        }
    }
}
