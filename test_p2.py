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
    pg.goto(f'file://{os.path.abspath("index.html")}')
    pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(600)

    # ===== 主题系统 =====
    theme0 = pg.evaluate('document.body.dataset.theme')
    check('TH1 默认经典主题', theme0 == 'classic', f'{theme0}')

    pg.click('#settings-btn'); pg.wait_for_timeout(500)
    check('TH2 设置面板有主题按钮', pg.locator('#theme-toggle').is_visible())
    label0 = pg.locator('#theme-toggle').text_content()
    check('TH3 主题按钮文案', '经典糖果' in label0, label0)

    # 切换到国风
    pg.click('#theme-toggle'); pg.wait_for_timeout(500)
    theme1 = pg.evaluate('document.body.dataset.theme')
    check('TH4 切换到国风', theme1 == 'guofeng', f'{theme1}')
    saved = pg.evaluate('safeGet("candyMatch_theme", "")')
    check('TH5 主题已持久化', saved == 'guofeng', f'{saved}')
    label1 = pg.locator('#theme-toggle').text_content()
    check('TH6 按钮文案更新', '国风古韵' in label1, label1)

    # 验证国风糖果配色生效
    pg.click('#settings-close-btn'); pg.wait_for_timeout(300)
    pg.evaluate('document.getElementById("start-screen").classList.add("hidden")')
    if not pg.evaluate('!!window.game'):
        pg.click('#start-btn'); pg.wait_for_timeout(1000)
    pg.wait_for_timeout(500)
    red_bg = pg.evaluate('''() => {
        const el = document.querySelector('.candy-red');
        return el ? getComputedStyle(el).backgroundImage : '';
    }''')
    check('TH7 国风配色生效(朱红)', 'rgb' in red_bg, red_bg[:60])

    # 切回经典
    pg.evaluate('window.game.toggleTheme()'); pg.wait_for_timeout(400)
    theme2 = pg.evaluate('document.body.dataset.theme')
    check('TH8 可切回经典', theme2 == 'classic', f'{theme2}')

    # ===== 记忆碎片 =====
    pg.evaluate('window.game.fragments = 0; safeSet("candyMatch_fragments", 0)')
    pg.evaluate('document.getElementById("start-screen").classList.remove("hidden")')
    pg.click('#story-btn'); pg.wait_for_timeout(600)
    check('ST1 碎片面板打开', pg.locator('#story-panel').is_visible())
    items = pg.locator('.story-item').count()
    locked = pg.locator('.story-item.locked').count()
    check('ST2 六章故事', items == 6, f'{items}')
    check('ST3 初始全锁定', locked == 6, f'locked={locked}')
    cnt = pg.locator('#frag-count').text_content()
    check('ST4 碎片数显示0', cnt == '0', cnt)

    # 锁定章节点击无效
    pg.locator('.story-item').first.click(); pg.wait_for_timeout(300)
    reader_hidden = pg.locator('#story-reader').is_hidden()
    check('ST5 锁定章节不可读', reader_hidden)

    # 发放碎片 → 解锁第1章
    pg.evaluate('window.game.grantFragments(3)'); pg.wait_for_timeout(400)
    frags = pg.evaluate('window.game.fragments')
    check('ST6 碎片累加', frags == 3, f'{frags}')
    unlocked = pg.evaluate('window.game.unlockedChapters()')
    check('ST7 解锁第1章', unlocked == 1, f'{unlocked}')

    # 重渲染后第1章可点
    pg.evaluate('window.game.renderStoryPanel()'); pg.wait_for_timeout(400)
    locked2 = pg.locator('.story-item.locked').count()
    check('ST8 锁定量减1', locked2 == 5, f'{locked2}')
    pg.locator('.story-item:not(.locked)').first.click(); pg.wait_for_timeout(500)
    check('ST9 章节可阅读', pg.locator('#story-reader').is_visible())
    title = pg.locator('#story-title').text_content()
    check('ST10 章节标题正确', '铜哨初鸣' in title, title)
    body_len = len(pg.locator('#story-body').text_content())
    check('ST11 正文有内容', body_len > 20, f'{body_len}字')

    # 返回目录
    pg.click('#story-back-btn'); pg.wait_for_timeout(400)
    check('ST12 返回目录', pg.locator('#story-list').is_visible())
    pg.click('#story-close-btn'); pg.wait_for_timeout(300)

    # 通关发放碎片（1星=1片，3星=2片）
    pg.evaluate('window.game.fragments = 0; safeSet("candyMatch_fragments", 0)')
    pg.evaluate('document.getElementById("start-screen").classList.add("hidden")')
    if not pg.evaluate('window.game.state === "idle"'):
        pg.evaluate('window.game.restart()'); pg.wait_for_timeout(800)
    pg.evaluate('window.game.levelStartMoves = 30; window.game.moves = 5')  # 少步数→1星
    pg.evaluate('window.game.levelComplete()'); pg.wait_for_timeout(600)
    f1 = pg.evaluate('window.game.fragments')
    check('ST13 1星通关得1片', f1 == 1, f'{f1}')

    pg.evaluate('window.game.nextLevel()'); pg.wait_for_timeout(800)
    pg.evaluate('window.game.levelStartMoves = 30; window.game.moves = 25')  # 多步数→3星
    pg.evaluate('window.game.levelComplete()'); pg.wait_for_timeout(600)
    f2 = pg.evaluate('window.game.fragments')
    check('ST14 3星通关得2片', f2 == 3, f'{f2}(应=1+2)')

    check('Z1 无JS错误', len(errors) == 0, '; '.join(errors[:2]))

    print('===== P2 功能测试 =====')
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(('✓ ' if ok else '✗ FAIL ') + name + (f' [{detail}]' if detail and not ok else ''))
    print(f'===== {passed}/{len(results)} 通过 =====')
    if errors: print('JS ERRORS:', errors[:3])
    b.close()
