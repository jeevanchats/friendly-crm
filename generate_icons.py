import os
from PIL import Image, ImageDraw, ImageFont

def create_icon(size):
    # Brand colors
    teal = (22, 125, 121, 255)      # #167D79
    gold = (244, 184, 96, 255)      # #F4B860
    soft_white = (246, 248, 247, 255) # #F6F8F7
    slate = (36, 59, 64, 255)       # #243B40

    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rectangle background
    corner_radius = int(size * 0.22)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=corner_radius, fill=teal)

    # Decorative inner ring / accent
    pad = int(size * 0.08)
    draw.rounded_rectangle(
        [(pad, pad), (size - 1 - pad, size - 1 - pad)],
        radius=int(corner_radius * 0.8),
        outline=gold,
        width=max(2, int(size * 0.02))
    )

    # Stylized "F" and "C" shapes
    # Left vertical stem of F
    stem_x0 = int(size * 0.28)
    stem_x1 = int(size * 0.40)
    stem_y0 = int(size * 0.26)
    stem_y1 = int(size * 0.74)
    draw.rounded_rectangle([(stem_x0, stem_y0), (stem_x1, stem_y1)], radius=int(size * 0.03), fill=soft_white)

    # Top horizontal bar of F
    top_x1 = int(size * 0.62)
    top_y1 = int(size * 0.38)
    draw.rounded_rectangle([(stem_x0, stem_y0), (top_x1, top_y1)], radius=int(size * 0.03), fill=soft_white)

    # Middle horizontal bar of F (in Gold)
    mid_y0 = int(size * 0.46)
    mid_y1 = int(size * 0.56)
    mid_x1 = int(size * 0.58)
    draw.rounded_rectangle([(stem_x0, mid_y0), (mid_x1, mid_y1)], radius=int(size * 0.03), fill=gold)

    # Accent dot in Gold
    dot_x0 = int(size * 0.66)
    dot_y0 = int(size * 0.46)
    dot_x1 = int(size * 0.76)
    dot_y1 = int(size * 0.56)
    draw.rounded_rectangle([(dot_x0, dot_y0), (dot_x1, dot_y1)], radius=int(size * 0.03), fill=gold)

    # Bottom accent swoop in Gold
    draw.rounded_rectangle(
        [(int(size * 0.66), int(size * 0.64)), (int(size * 0.76), int(size * 0.74))],
        radius=int(size * 0.03),
        fill=soft_white
    )

    return img

def main():
    base_dir = r"C:\Users\jeeva\.gemini\antigravity\scratch\friendly-crm\apps\web\public"
    icons_dir = os.path.join(base_dir, "icons")
    os.makedirs(icons_dir, exist_ok=True)

    # 1. 512x512
    icon512 = create_icon(512)
    icon512.save(os.path.join(icons_dir, "icon-512.png"), "PNG")
    icon512.save(os.path.join(base_dir, "icon-512.png"), "PNG")

    # 2. 192x192
    icon192 = create_icon(192)
    icon192.save(os.path.join(icons_dir, "icon-192.png"), "PNG")
    icon192.save(os.path.join(base_dir, "icon-192.png"), "PNG")

    # 3. favicon.ico
    icon32 = create_icon(32)
    icon48 = create_icon(48)
    icon32.save(
        os.path.join(base_dir, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)]
    )

    print("Successfully generated PWA icons:")
    print(" - public/icons/icon-192.png")
    print(" - public/icons/icon-512.png")
    print(" - public/icon-192.png")
    print(" - public/icon-512.png")
    print(" - public/favicon.ico")

if __name__ == '__main__':
    main()
