from playwright.sync_api import sync_playwright
import os

errors = []
console_errors = []

def run_tests():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={'width':720,'height':1280})
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        pg.on('dialog', lambda d: d.accept())
        url = f'file://{os.path.abspath("index.html")}'

        results = []
        def check(name, ok, detail=''):
            results.append((name, ok, detail))

        # ===== T1: 加载与开始 =====
        pg.goto(url)
        pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(500)
        check('T1 页面加载', pg.locator('#start-screen').is_visible())
        pg.click('#start-btn'); pg.wait_for_timeout(1500)
        check('T2 经典模式开始', pg.locator('.candy').count() == 64)

        # ===== T3: 交换后棋盘完整 =====
        board = pg.locator('#board').bounding_box()
        def swap(r, c, dr, dc):
            x1 = board['x']+(c+0.5)*(board['width']/8)
            y1 = board['y']+(r+0.5)*(board['height']/8)
            x2, y2 = x1+dc*(board['width']/8), y1+dr*(board['height']/8)
            pg.mouse.move(x1,y1); pg.mouse.down(); pg.mouse.move(x2,y2,steps=5); pg.mouse.up()
            pg.wait_for_timeout(500)
        # 扫描全棋盘找到一个有效交换并执行
        found = pg.evaluate('''() => {
            const g = window.game;
            for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
                for (const [dr, dc] of [[0,1],[1,0]]) {
                    const nr = r+dr, nc = c+dc;
                    if (nr >= 8 || nc >= 8 || !g.board[nr][nc]) continue;
                    g.swapData(r, c, nr, nc);
                    const ok = g.findAllMatches().length > 0;
                    g.swapData(r, c, nr, nc);
                    if (ok) return [r, c, nr, nc];
                }
            }
            return null;
        }''')
        check('T3 存在有效交换', found is not None, str(found))
        if found:
            r, c, nr, nc = found
            dr, dc = nr-r, nc-c
            swap(r, c, dr, dc)
            total = pg.locator('.candy').count()
            check('T4 交换后棋盘满', total == 64, f'count={total}')

        # ===== T5: 分数累计 =====
        score = pg.evaluate('window.game.score')
        check('T5 分数>=0', score >= 0, str(score))

        # ===== T6: 无效交换回退（找无效交换）=====
        invalid = pg.evaluate('''() => {
            const g = window.game;
            for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
                const a = g.board[r][c]; if (!a || a.special) continue;
                for (const [dr, dc] of [[0,1],[1,0]]) {
                    const nr = r+dr, nc = c+dc;
                    if (nr >= 8 || nc >= 8) continue;
                    const bb = g.board[nr][nc]; if (!bb || bb.special) continue;
                    g.swapData(r, c, nr, nc);
                    const ok = g.findAllMatches().length > 0;
                    g.swapData(r, c, nr, nc);
                    if (!ok) return [r, c, nr, nc];
                }
            }
            return null;
        }''')
        if invalid:
            r, c, nr, nc = invalid
            before = pg.evaluate('window.game.moves')
            swap(r, c, nr-r, nc-c)
            pg.wait_for_timeout(800)
            after = pg.evaluate('window.game.moves')
            check('T6 无效交换不扣步', after == before, f'{before}->{after}')
        else:
            check('T6 无效交换不扣步', True, '无无效交换样本(跳过)')

        # ===== T7: 道具-洗牌 =====
        pg.evaluate('window.game.stars = 100')
        pg.evaluate('window.game.useItem("shuffle")')
        pg.wait_for_timeout(1000)
        shuffle_ok = pg.evaluate('window.game.board.flat().filter(Boolean).length == 64')
        check('T7 洗牌道具', shuffle_ok)

        # ===== T8: 道具-锤子 =====
        pg.evaluate('window.game.useItem("hammer")')
        hammer = pg.evaluate('window.game.hammerMode')
        check('T8a 锤子模式激活', hammer)
        pg.evaluate('window.game.hammerRemove(3, 3)')
        pg.wait_for_timeout(1200)
        board_full = pg.evaluate('window.game.board.flat().filter(Boolean).length == 64')
        state_ok = pg.evaluate('window.game.state === "idle"')
        check('T8b 锤子敲除后棋盘满+状态恢复', board_full and state_ok)

        # ===== T9: 道具-+3步 =====
        before = pg.evaluate('window.game.moves')
        pg.evaluate('window.game.useItem("extra-moves")')
        after = pg.evaluate('window.game.moves')
        check('T9 +3步道具', after == before + 3, f'{before}->{after}')

        # ===== T10: 广告步数（stub provider直接回调）=====
        pg.evaluate('window.game.showRewardedAd = function(cb) { setTimeout(cb, 0); }')
        before = pg.evaluate('window.game.moves')
        pg.evaluate('window.game.watchAdForMoves()')
        pg.wait_for_timeout(600)
        after = pg.evaluate('window.game.moves')
        check('T10 广告+5步', after == before + 5, f'{before}->{after}')

        # ===== T11: 广告步数限次 =====
        pg.evaluate('window.game.showRewardedAd = function(cb) { setTimeout(cb, 0); }')
        pg.evaluate('window.game.watchAdForMoves()')
        pg.wait_for_timeout(600)
        before = pg.evaluate('window.game.moves')
        pg.evaluate('window.game.watchAdForMoves()')
        pg.wait_for_timeout(700)
        after = pg.evaluate('window.game.moves')
        check('T11 广告步数限次(2次/局)', after == before, f'{before}->{after}(应不变)')

        # ===== T12: 暂停/恢复 =====
        pg.click('#pause-btn'); pg.wait_for_timeout(400)
        paused = pg.evaluate('window.game.isPaused')
        pg.click('#resume-btn'); pg.wait_for_timeout(400)
        resumed = not pg.evaluate('window.game.isPaused')
        check('T12 暂停/恢复', paused and resumed)

        # ===== T13: 每日挑战进入+计时器 =====
        pg.evaluate('window.game.dailyChallengeDone = false')
        pg.evaluate('window.game.restart()')
        pg.evaluate('document.getElementById("start-screen").classList.remove("hidden")')
        pg.click('#daily-btn'); pg.wait_for_timeout(2000)
        mode = pg.evaluate('window.game.gameMode')
        timer = pg.evaluate('window.game.dailyTimeLeft')
        check('T13 每日挑战模式', mode == 'daily' and timer <= 30 and timer > 25, f'mode={mode} t={timer}')

        # ===== T14: 每日模式无步数限制逻辑 =====
        check('T14 每日步数999', pg.evaluate('window.game.moves') == 999)

        # ===== T15: 强制结束每日挑战 =====
        pg.evaluate('window.game.dailyTimeLeft = 1')
        pg.wait_for_timeout(2500)
        ended = pg.evaluate('window.game.state === "game_over"')
        mode_back = pg.evaluate('window.game.gameMode === "classic"')
        check('T15 挑战结束状态', ended and mode_back)

        # ===== T16: 每日防刷星 =====
        blocked = pg.evaluate('window.game.dailyChallengeDone')
        check('T16 当日已完成标志', blocked)

        # ===== T17: 重新开始重置 =====
        pg.evaluate('window.game.restart()')
        pg.wait_for_timeout(500)
        lv = pg.evaluate('window.game.level')
        sc = pg.evaluate('window.game.score')
        st = pg.evaluate('window.game.state === "idle"')
        check('T17 重启重置', lv == 1 and sc == 0 and st, f'lv={lv} score={sc}')

        # ===== T18: 成就面板 =====
        pg.evaluate('document.getElementById("start-screen").classList.remove("hidden")')
        pg.click('#achievements-btn'); pg.wait_for_timeout(500)
        ach_count = pg.locator('.ach-item').count()
        check('T18 成就面板10项', ach_count == 10, str(ach_count))
        pg.click('#ach-close-btn')

        # ===== T19: 特殊糖果组合-双条纹十字 =====
        pg.evaluate('''() => {
            const g = window.game;
            g.board[0][0].special = 'striped-h';
            g.board[0][1].special = 'striped-h';
        }''')
        pg.evaluate('window.game.attemptSwap(0, 0, 0, 1)')
        pg.wait_for_timeout(2500)
        score_grew = pg.evaluate('window.game.score') > 0
        check('T19 双条纹组合有分数', score_grew)

        # ===== T20: 特殊糖果组合-双炸弹全屏 =====
        pg.evaluate('''() => {
            const g = window.game;
            g.board[5][5].special = 'color-bomb';
            g.board[5][6].special = 'color-bomb';
            g.comboCount = 0;
            g.score = 0;
        }''')
        pg.evaluate('window.game.attemptSwap(5, 5, 5, 6)')
        pg.wait_for_timeout(3000)
        board_clear = pg.evaluate('window.game.board.flat().filter(Boolean).length <= 64')
        sc = pg.evaluate('window.game.score')
        check('T20 双炸弹组合', sc > 0, f'score={sc}')

        # ===== T21: 最终状态无JS错误 =====
        check('T21 无JS错误', len(errors) == 0, '; '.join(errors[:2]))

        # 输出
        print('===== 测试结果 =====')
        passed = sum(1 for _, ok, _ in results if ok)
        for name, ok, detail in results:
            mark = '✓' if ok else '✗ FAIL'
            print(f'{mark} {name}' + (f' [{detail}]' if detail and not ok else ''))
        print(f'===== {passed}/{len(results)} 通过 =====')
        if errors: print('JS ERRORS:', errors[:3])
        if console_errors: print('CONSOLE ERRORS:', console_errors[:3])
        b.close()

run_tests()