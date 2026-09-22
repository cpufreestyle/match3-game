from playwright.sync_api import sync_playwright
import os, random, time

base = os.path.dirname(os.path.abspath(__file__))
file_url = f'file://{base}/index.html'
out_dir = os.path.join(base, 'tap_assets')
os.makedirs(out_dir, exist_ok=True)
video_path = os.path.join(out_dir, 'gameplay_recording.mp4')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={'width': 720, 'height': 1280},
        device_scale_factor=1,
        record_video_dir=out_dir,
        record_video_size={'width': 720, 'height': 1280},
    )
    page = context.new_page()
    page.goto(file_url)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)

    # 开始游戏
    page.click('#start-btn')
    page.wait_for_timeout(800)

    board = page.locator('#board').bounding_box()
    if not board:
        print('ERROR: board not found')
        browser.close()
        exit(1)

    # 进行约 16-18 秒的核心玩法操作（滑动交换）
    start = time.time()
    duration = 17  # 目标时长（秒）
    while time.time() - start < duration:
        # 随机选择起始格
        r = random.randint(0, 7)
        c = random.randint(0, 6)
        dx = random.choice([-1, 1]) if c > 0 and c < 7 else 1
        dy = random.choice([-1, 1]) if r > 0 and r < 7 else 1
        # 随机决定水平或垂直交换
        swap_h = random.random() > 0.5
        x1 = board['x'] + (c + 0.5) * (board['width'] / 8)
        y1 = board['y'] + (r + 0.5) * (board['height'] / 8)
        if swap_h and c + dx < 8:
            x2 = x1 + dx * (board['width'] / 8)
            y2 = y1
        elif not swap_h and r + dy < 8:
            x2 = x1
            y2 = y1 + dy * (board['height'] / 8)
        else:
            continue
        page.mouse.move(x1, y1)
        page.mouse.down()
        page.mouse.move(x2, y2, steps=6)
        page.mouse.up()
        # 等待消除动画
        page.wait_for_timeout(random.randint(600, 1000))

    page.wait_for_timeout(1000)

    # 保存视频（Playwright 在 context 关闭时写盘）
    context.close()
    browser.close()

# 查找录制生成的视频文件
videos = [f for f in os.listdir(out_dir) if f.endswith('.webm')]
print('recorded files:', videos)

import shutil
if videos:
    src_v = os.path.join(out_dir, videos[0])
    shutil.move(src_v, video_path)
    print('moved to:', video_path)

# 检查时长
import subprocess
try:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video_path], capture_output=True, text=True)
    print('duration:', r.stdout.strip(), 'seconds')
except Exception as e:
    print('ffprobe not available:', e)
print('ALL DONE')