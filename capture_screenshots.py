from playwright.sync_api import sync_playwright
import os, time

# 游戏静态页面
base = os.path.dirname(os.path.abspath(__file__))
file_url = f'file://{base}/index.html'
out_dir = os.path.join(base, 'screenshots')
os.makedirs(out_dir, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # 手机竖屏视角
    page = browser.new_page(viewport={'width': 720, 'height': 1280}, device_scale_factor=2)
    page.goto(file_url)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)

    # 截图1：开始界面
    page.screenshot(path=os.path.join(out_dir, 'screenshot_1_start.png'))
    print('shot1 done')

    # 点击开始游戏
    page.click('#start-btn')
    page.wait_for_timeout(1200)

    # 截图2：游戏进行界面（初始棋盘）
    page.screenshot(path=os.path.join(out_dir, 'screenshot_2_game.png'))
    print('shot2 done')

    # 模拟几次交换，产生消除画面，展示核心玩法
    # 找到糖果元素进行滑动
    board = page.locator('#board').bounding_box()
    if board:
        # 简单滑动几次以触发连续消除画面
        import random
        for i in range(5):
            try:
                r = random.randint(0, 7)
                c = random.randint(0, 6)
                x1 = board['x'] + (c + 0.5) * (board['width'] / 8)
                y1 = board['y'] + (r + 0.5) * (board['height'] / 8)
                x2 = x1 + board['width'] / 8
                y2 = y1
                page.mouse.move(x1, y1)
                page.mouse.down()
                page.mouse.move(x2, y2, steps=8)
                page.mouse.up()
                page.wait_for_timeout(700)
            except Exception as e:
                pass

    page.wait_for_timeout(600)
    # 截图3：进行中画面
    page.screenshot(path=os.path.join(out_dir, 'screenshot_3_playing.png'))

    # 截图4：分数/进度界面再截一张不同画面
    page.wait_for_timeout(800)
    page.screenshot(path=os.path.join(out_dir, 'screenshot_4_action.png'))
    print('shots 3-4 done')

    browser.close()

print('ALL DONE')