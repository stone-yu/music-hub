"""
歌单封面生成器 - 使用 Pillow 生成精美的歌单封面
"""
import io
import math
import random
from typing import Tuple, Optional
from PIL import Image, ImageDraw, ImageFont

# 预设主题配色方案
THEME_COLORS = {
    "default":   {"bg1": (99, 102, 241),  "bg2": (139, 92, 246),  "accent": (255, 255, 255)},
    "民谣":      {"bg1": (180, 140, 80),   "bg2": (120, 80, 40),   "accent": (255, 240, 210)},
    "摇滚":      {"bg1": (180, 30, 30),    "bg2": (100, 10, 10),   "accent": (255, 200, 100)},
    "电子":      {"bg1": (0, 200, 200),    "bg2": (0, 50, 150),    "accent": (255, 255, 255)},
    "古典":      {"bg1": (60, 60, 80),     "bg2": (30, 20, 40),    "accent": (212, 175, 55)},
    "流行":      {"bg1": (236, 72, 153),   "bg2": (168, 85, 247),  "accent": (255, 255, 255)},
    "爵士":      {"bg1": (50, 50, 70),     "bg2": (20, 20, 35),    "accent": (218, 165, 32)},
    "嘻哈":      {"bg1": (255, 165, 0),    "bg2": (200, 50, 0),    "accent": (255, 255, 255)},
    "R&B":       {"bg1": (100, 50, 150),   "bg2": (40, 10, 60),    "accent": (255, 200, 220)},
    "轻音乐":    {"bg1": (100, 180, 200),  "bg2": (60, 120, 160),  "accent": (255, 255, 255)},
    "国风":      {"bg1": (180, 50, 50),    "bg2": (80, 20, 20),    "accent": (255, 215, 0)},
    "日语":      {"bg1": (255, 183, 197),  "bg2": (255, 105, 140), "accent": (255, 255, 255)},
    "韩语":      {"bg1": (135, 206, 235),  "bg2": (70, 130, 180),  "accent": (255, 255, 255)},
    "粤语":      {"bg1": (200, 150, 50),   "bg2": (120, 80, 20),   "accent": (255, 255, 240)},
    "深夜":      {"bg1": (30, 30, 60),     "bg2": (10, 10, 30),    "accent": (180, 180, 255)},
    "早晨":      {"bg1": (255, 200, 100),  "bg2": (255, 140, 50),  "accent": (255, 255, 255)},
    "运动":      {"bg1": (0, 200, 100),    "bg2": (0, 100, 150),   "accent": (255, 255, 255)},
    "80后":      {"bg1": (180, 120, 60),   "bg2": (100, 60, 30),   "accent": (255, 230, 180)},
    "90后":      {"bg1": (100, 150, 255),  "bg2": (60, 80, 200),   "accent": (255, 255, 255)},
    "伤感":      {"bg1": (80, 80, 120),    "bg2": (40, 40, 70),    "accent": (180, 200, 255)},
    "治愈":      {"bg1": (150, 220, 180),  "bg2": (80, 160, 120),  "accent": (255, 255, 255)},
    "浪漫":      {"bg1": (255, 150, 180),  "bg2": (200, 80, 120),  "accent": (255, 255, 255)},
}

# 装饰图案样式
PATTERNS = ["circles", "waves", "dots", "lines", "stars", "geometric"]


def get_theme_colors(name: str) -> dict:
    """根据歌单名称智能匹配主题颜色"""
    name_lower = name.lower()
    for keyword, colors in THEME_COLORS.items():
        if keyword in name_lower:
            return colors
    # 随机选一个好看的配色
    return random.choice(list(THEME_COLORS.values()))


def _draw_gradient(draw: ImageDraw.ImageDraw, width: int, height: int,
                   color1: Tuple[int, ...], color2: Tuple[int, ...]):
    """绘制渐变背景"""
    for y in range(height):
        ratio = y / height
        r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
        g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
        b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))


def _draw_pattern(draw: ImageDraw.ImageDraw, width: int, height: int,
                  color: Tuple[int, ...], pattern: str):
    """绘制装饰图案"""
    # 半透明效果通过降低颜色饱和度实现
    c = tuple(max(0, min(255, int(v * 0.15))) for v in color)

    if pattern == "circles":
        for _ in range(15):
            x = random.randint(0, width)
            y = random.randint(0, height)
            r = random.randint(20, 100)
            draw.ellipse([x-r, y-r, x+r, y+r], outline=c, width=2)

    elif pattern == "waves":
        for i in range(0, width, 30):
            points = []
            for x in range(0, width, 5):
                y_offset = math.sin((x + i) * 0.02) * 30
                points.append((x, height // 3 + i + y_offset))
            if len(points) > 1:
                draw.line(points, fill=c, width=2)

    elif pattern == "dots":
        for _ in range(50):
            x = random.randint(0, width)
            y = random.randint(0, height)
            r = random.randint(2, 8)
            draw.ellipse([x-r, y-r, x+r, y+r], fill=c)

    elif pattern == "lines":
        for _ in range(10):
            x1 = random.randint(0, width)
            y1 = random.randint(0, height)
            x2 = random.randint(0, width)
            y2 = random.randint(0, height)
            draw.line([(x1, y1), (x2, y2)], fill=c, width=2)

    elif pattern == "stars":
        for _ in range(20):
            x = random.randint(0, width)
            y = random.randint(0, height)
            size = random.randint(5, 20)
            draw.polygon([
                (x, y - size), (x + size//3, y - size//3),
                (x + size, y), (x + size//3, y + size//3),
                (x, y + size), (x - size//3, y + size//3),
                (x - size, y), (x - size//3, y - size//3),
            ], outline=c)

    elif pattern == "geometric":
        for _ in range(8):
            x = random.randint(0, width)
            y = random.randint(0, height)
            size = random.randint(30, 80)
            draw.rectangle([x, y, x+size, y+size], outline=c, width=2)


def _draw_text(draw: ImageDraw.ImageDraw, width: int, height: int,
               text: str, color: Tuple[int, ...], font_size: int = 60):
    """绘制文字（居中）"""
    try:
        # 尝试加载中文字体
        font_paths = [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
        ]
        font = None
        for fp in font_paths:
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except:
                continue
        if font is None:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    # 计算文字位置
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    # 如果文字太长，缩小字体
    while text_width > width * 0.85 and font_size > 20:
        font_size -= 5
        try:
            for fp in font_paths:
                try:
                    font = ImageFont.truetype(fp, font_size)
                    break
                except:
                    continue
        except:
            pass
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

    x = (width - text_width) // 2
    y = (height - text_height) // 2 - 20

    # 绘制阴影
    shadow_color = tuple(max(0, v - 80) for v in color[:3])
    draw.text((x + 2, y + 2), text, font=font, fill=shadow_color)

    # 绘制主文字
    draw.text((x, y), text, font=font, fill=color)


def _draw_subtitle(draw: ImageDraw.ImageDraw, width: int, height: int,
                   text: str, color: Tuple[int, ...], font_size: int = 24):
    """绘制副标题"""
    try:
        font_paths = [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
            "/System/Library/Fonts/PingFang.ttc",
            "C:/Windows/Fonts/msyh.ttc",
        ]
        font = None
        for fp in font_paths:
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except:
                continue
        if font is None:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    # 降低透明度效果
    dim_color = tuple(int(v * 0.6) for v in color[:3])

    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    x = (width - text_width) // 2
    y = height // 2 + 50

    draw.text((x, y), text, font=font, fill=dim_color)


def generate_cover(
    title: str,
    subtitle: str = "",
    size: Tuple[int, int] = (600, 600),
    theme: Optional[str] = None,
    pattern: Optional[str] = None,
) -> bytes:
    """
    生成歌单封面图片

    Args:
        title: 歌单名称（显示在封面上）
        subtitle: 副标题（如歌曲数量等）
        size: 图片尺寸
        theme: 主题关键词（自动匹配颜色）
        pattern: 装饰图案样式（不指定则随机）

    Returns:
        JPEG 图片的 bytes
    """
    width, height = size

    # 获取配色
    if theme:
        colors = THEME_COLORS.get(theme, get_theme_colors(title))
    else:
        colors = get_theme_colors(title)

    # 创建图片
    img = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(img)

    # 绘制渐变背景
    _draw_gradient(draw, width, height, colors["bg1"], colors["bg2"])

    # 绘制装饰图案
    if pattern is None:
        pattern = random.choice(PATTERNS)
    _draw_pattern(draw, width, height, colors["accent"], pattern)

    # 重新创建 draw 对象（在图案之上绘制文字）
    draw = ImageDraw.Draw(img)

    # 绘制标题
    _draw_text(draw, width, height, title, colors["accent"])

    # 绘制副标题
    if subtitle:
        _draw_subtitle(draw, width, height, subtitle, colors["accent"])

    # 导出为 JPEG
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=92)
    return buf.getvalue()


def generate_cover_to_file(title: str, output_path: str, **kwargs) -> str:
    """生成封面并保存到文件"""
    data = generate_cover(title, **kwargs)
    with open(output_path, 'wb') as f:
        f.write(data)
    return output_path
