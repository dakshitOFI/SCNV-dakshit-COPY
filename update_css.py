import os

path = r"c:\Users\abcom\OneDrive - Ofi Benelux B.V\Desktop\SCNV_AMIT_NEW - Copy\SCNV-Multi-Agent-System\SCNV_Frontend\src\styles\networkmap.css"
with open(path, "r", encoding="utf-8") as f:
    css = f.read()

# 1. Tokens
css = css.replace("--nm-bg: #0b0e13;", "--nm-bg: #F0F4F8;")
css = css.replace("--nm-surface: #131820;", "--nm-surface: #ffffff;")
css = css.replace("--nm-surface2: #1a2130;", "--nm-surface2: #E1E8F0;")
css = css.replace("--nm-border: #1e2630;", "--nm-border: #D1D9E6;")
css = css.replace("--nm-accent: #f5a623;", "--nm-accent: #7DA7D9;")
css = css.replace("--nm-accent2: #1db8ff;", "--nm-accent2: #4A90E2;")
css = css.replace("--nm-text: #e2e8f0;", "--nm-text: #2B2B2B;")
css = css.replace("--nm-muted: #6b7280;", "--nm-muted: #7A8B99;")
css = css.replace("--nm-node-plant: #22c55e;", "--nm-node-plant: #7DA7D9;")

# 2. Border radius updates for airy/pill shape
css = css.replace("border-radius: 8px;", "border-radius: 24px;")
css = css.replace("border-radius: 10px;", "border-radius: 24px;")

# 3. Node rendering
css = css.replace("""
.nm-node-rect {
  cursor: pointer;
  transition: opacity 0.3s;
  stroke-width: 1px;
}""", """
.nm-node-rect {
  cursor: pointer;
  transition: opacity 0.3s, fill 0.3s, stroke 0.3s;
  stroke-width: 2px;
}""")
css = css.replace("fill: #062c16;", "fill: #ffffff;")
css = css.replace("fill: #1c1606;", "fill: #ffffff;")
css = css.replace("fill: #1b0d2e;", "fill: #ffffff;")

# 4. Background Gradient
css = css.replace("background: radial-gradient(ellipse at 50% 40%, #0f1a2e 0%, var(--nm-bg) 70%);", "background: radial-gradient(ellipse at 50% 40%, #ffffff 0%, var(--nm-bg) 80%);")

# 5. Label Stroke
css = css.replace("stroke: var(--nm-bg);", "stroke: #ffffff;")
css = css.replace("font-size: 9px;", "font-size: 10px;")

# 6. Chip styles (removing rgba and replacing with custom text colors)
css = css.replace("color: #fff;", "color: var(--nm-text);")
css = css.replace("rgba(34, 197, 94, 0.3)", "rgba(125, 167, 217, 0.1)")
css = css.replace("rgba(167, 139, 250, 0.3)", "rgba(167, 139, 250, 0.1)")
css = css.replace("rgba(245, 166, 35, 0.3)", "rgba(245, 166, 35, 0.1)")

# 7. Sidebar width
css = css.replace("width: 260px;", "width: 280px;")
css = css.replace("padding: 6px 14px;", "padding: 8px 18px;")

with open(path, "w", encoding="utf-8") as f:
    f.write(css)

print("CSS updated successfully!")
