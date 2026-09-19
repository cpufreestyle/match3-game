from playwright.sync_api import sync_playwright
import os

errors = []
results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width':720,'height':1280})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    url = f'file://{os.path.abspath("index.html")}'
    pg.goto(url)
    pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(600)

    # ===== 关卡地图 =====
    pg.click('#level-map-btn'); pg.wait_for_timeout(600)
    check('M1 关卡地图打开', pg.locator('#level-map').is_visible())
    cells = pg.locator('.map-cell').count()
    locked = pg.locator('.map-cell.locked').count()
    check('M2 地图格子渲染', cells >= 12, f'cells={cells}')
    check('M3 初始仅1关解锁', cells - locked == 1, f'解锁={cells-locked}')
    pg.click('#map-close-btn'); pg.wait_for_timeout(300)

    # ===== 签到面板 =====
    pg.click('#daily-panel-btn'); pg.wait_for_timeout(600)
    check('D1 签到面板打开', pg.locator('#daily-panel').is_visible())
    checkin_cells = pg.locator('.checkin-cell').count()
    quests = pg.locator('.quest-item').count()
    check('D2 签到7格', checkin_cells == 7, f'{checkin_cells}')
    check('D3 任务3个', quests == 3, f'{quests}')

    # 领取签到
    stars_before = pg.evaluate('window.game.stars')
    pg.click('#checkin-btn'); pg.wait_for_timeout(600)
    stars_after = pg.evaluate('window.game.stars')
    check('D4 签到发放星币', stars_after == stars_before + 10, f'{stars_before}->{stars_after}')
    btn_disabled = pg.evaluate('document.getElementById("checkin-btn").disabled')
    check('D5 签到后按钮禁用', btn_disabled)
    pg.click('#daily-close-btn'); pg.wait_for_timeout(300)

    # ===== 开始游戏，测试连胜 =====
    pg.click('#start-btn'); pg.wait_for_timeout(1200)
    check('G1 游戏开始', pg.locator('.candy').count() == 64)

    # 连胜初始为0，徽章隐藏
    badge_hidden = pg.evaluate('document.getElementById("streak-badge").style.display === "none"')
    check('S1 初始连胜徽章隐藏', badge_hidden)

    # 模拟通关（直接调用 levelComplete）
    pg.evaluate('window.game.levelComplete()')
    pg.wait_for_timeout(800)
    streak = pg.evaluate('window.game.stats.streak')
    check('S2 通关后连胜=1', streak == 1, f'streak={streak}')
    stars_shown = pg.locator('#level-stars').text_content()
    check('S3 星级显示', '⭐' in stars_shown or '☆' in stars_shown, stars_shown)
    # 星级写入
    lv1_stars = pg.evaluate('window.game.levelStars[1] || 0')
    check('S4 第1关星级已记录', lv1_stars >= 1, f'{lv1_stars}')
    # 解锁第2关
    unlocked = pg.evaluate('window.game.unlockedLevel')
    check('S5 第2关解锁', unlocked == 2, f'{unlocked}')

    # 再通关一次 → 连胜=2，徽章显示
    pg.click('#next-level-btn'); pg.wait_for_timeout(1200)
    pg.evaluate('window.game.levelComplete()')
    pg.wait_for_timeout(800)
    streak2 = pg.evaluate('window.game.stats.streak')
    check('S6 连胜累加到2', streak2 == 2, f'{streak2}')
    mult = pg.evaluate('window.game.streakMultiplier()')
    check('S7 连胜倍率×1.25', abs(mult - 1.25) < 0.001, f'{mult}')
    mult_text = pg.locator('#level-mult').text_content()
    check('S8 倍率文案显示', '连胜' in mult_text, mult_text)

    # 失败清零
    pg.evaluate('window.game.gameOver()')
    pg.wait_for_timeout(600)
    streak_after_lose = pg.evaluate('window.game.stats.streak')
    check('S9 失败清零连胜', streak_after_lose == 0, f'{streak_after_lose}')

    # ===== 任务进度追踪（用列表中实际存在的任务）=====
    pg.evaluate('window.game.restart()')
    pg.wait_for_timeout(600)
    metric = pg.evaluate('window.game.quests.list[0].metric')
    pg.evaluate(f'window.game.bumpQuest("{metric}", 5)')
    prog = pg.evaluate(f'''() => {{
        const q = window.game.quests.list.find(q => q.metric === "{metric}");
        return q ? q.progress : -1;
    }}''')
    check('Q1 任务进度累加', prog > 0 and prog <= 5, f'metric={metric} progress={prog}')

    # 完成任务并领取
    idx = pg.evaluate('''() => {
        const g = window.game;
        g.quests.list[0].progress = g.quests.list[0].goal;
        safeSet('candyMatch_quests', JSON.stringify(g.quests));
        return 0;
    }''')
    stars_b = pg.evaluate('window.game.stars')
    pg.evaluate(f'window.game.claimQuest({idx})')
    pg.wait_for_timeout(500)
    stars_a = pg.evaluate('window.game.stars')
    check('Q2 领取任务奖励', stars_a > stars_b, f'{stars_b}->{stars_a}')

    # ===== 地图星级显示（通关后回到地图）=====
    pg.evaluate('document.getElementById("start-screen").classList.remove("hidden")')
    pg.click('#level-map-btn'); pg.wait_for_timeout(600)
    stars_in_map = pg.evaluate('''() => {
        const cells = [...document.querySelectorAll('.map-cell')];
        return cells.filter(c => c.querySelector('.map-stars').textContent.includes('⭐')).length;
    }''')
    check('M4 地图显示已获星级', stars_in_map >= 1, f'{stars_in_map}')
    total = pg.locator('#map-total-stars').text_content()
    check('M5 累计星数显示', total != '0', f'total={total}')
    pg.click('#map-close-btn')

    # ===== 从地图选关 =====
    pg.click('#level-map-btn'); pg.wait_for_timeout(500)
    pg.locator('.map-cell:not(.locked)').nth(1).click()
    pg.wait_for_timeout(1000)
    lv = pg.evaluate('window.game.level')
    map_closed = not pg.locator('#level-map').is_visible()
    check('M6 选关进入指定关卡', lv == 2 and map_closed, f'level={lv} closed={map_closed}')

    check('Z1 无JS错误', len(errors) == 0, '; '.join(errors[:2]))

    print('===== P0 功能测试 =====')
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(('✓ ' if ok else '✗ FAIL ') + name + (f' [{detail}]' if detail and not ok else ''))
    print(f'===== {passed}/{len(results)} 通过 =====')
    if errors: print('JS ERRORS:', errors[:3])
    b.close()
