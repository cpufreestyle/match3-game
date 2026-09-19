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
    pg.evaluate('''() => {
        window.game = new CandyGame();
        document.getElementById('start-screen').classList.add('hidden');
    }''')
    pg.wait_for_timeout(1200)

    # ===== 障碍物基础 =====
    pg.evaluate('''() => {
        const g = window.game;
        g.initObstacles({kind: 'ice', hp: 1, cells: [[2,2],[2,3]]});
        g.renderBoard();
    }''')
    pg.wait_for_timeout(500)
    ice_cells = pg.locator('.cell.ob-ice').count()
    check('O1 冰块渲染', ice_cells == 2, f'{ice_cells}')
    check('O2 isLocked生效', pg.evaluate('window.game.isLocked(2,2)'))
    check('O3 非障碍格未锁', not pg.evaluate('window.game.isLocked(0,0)'))

    # 冰块阻挡交换
    before = pg.evaluate('window.game.board[2][2].type')
    pg.evaluate('window.game.attemptSwap(2, 2, 2, 3)')
    pg.wait_for_timeout(600)
    after = pg.evaluate('window.game.board[2][2].type')
    check('O4 冰块阻挡交换', before == after, f'{before}->{after}')

    # 冰块受损击碎
    pg.evaluate('window.game.damageIce(2, 2, 1)')
    pg.wait_for_timeout(400)
    check('O5 冰块击碎', pg.evaluate('window.game.obstacles[2][2] === null'))
    ice_left = pg.locator('.cell.ob-ice').count()
    check('O6 击碎后DOM更新', ice_left == 1, f'{ice_left}')

    # hp=2 冰块需两次
    pg.evaluate('window.game.initObstacles({kind: "ice", hp: 2, cells: [[4,4]]}); window.game.renderBoard();')
    pg.wait_for_timeout(400)
    check('O7 二级冰块样式', pg.locator('.cell.ob-ice-2').count() == 1)
    pg.evaluate('window.game.damageIce(4, 4, 1)')
    pg.wait_for_timeout(300)
    check('O8 一级伤害后仍存在', pg.evaluate('window.game.obstacles[4][4] !== null'))
    check('O9 剩余hp=1', pg.evaluate('window.game.obstacles[4][4].hp === 1'))
    pg.evaluate('window.game.damageIce(4, 4, 1)')
    pg.wait_for_timeout(300)
    check('O10 二次伤害击碎', pg.evaluate('window.game.obstacles[4][4] === null'))

    # ===== 果冻 =====
    pg.evaluate('''() => {
        const g = window.game;
        g.initObstacles({kind: 'jelly', cells: [[6,6],[6,7],[7,6]]});
        g.renderBoard();
    }''')
    pg.wait_for_timeout(500)
    jelly_cells = pg.locator('.cell.ob-jelly').count()
    check('O11 果冻渲染', jelly_cells == 3, f'{jelly_cells}')
    check('O12 果冻不阻挡交换', not pg.evaluate('window.game.isLocked(6,6)'))

    # 消除果冻上的糖果 → 果冻清除
    pg.evaluate('window.game.clearJelly(6, 6)')
    pg.wait_for_timeout(400)
    check('O13 果冻清除', pg.evaluate('window.game.obstacles[6][6] === null'))
    check('O14 果冻DOM更新', pg.locator('.cell.ob-jelly').count() == 2)

    # 相邻消除损伤冰块（applyObstacleDamage）
    pg.evaluate('''() => {
        const g = window.game;
        g.initObstacles({kind: 'ice', hp: 1, cells: [[3,3]]});
        g.renderBoard();
        g.applyObstacleDamage(['3,4']);  // 消除冰块右边一格
    }''')
    pg.wait_for_timeout(400)
    check('O15 相邻消除破冰', pg.evaluate('window.game.obstacles[3][3] === null'))

    # 消除果冻上的格子 → 自动清果冻
    pg.evaluate('''() => {
        const g = window.game;
        g.initObstacles({kind: 'jelly', cells: [[5,5]]});
        g.renderBoard();
        g.applyObstacleDamage(['5,5']);
    }''')
    pg.wait_for_timeout(400)
    check('O16 消除自动清果冻', pg.evaluate('window.game.obstacles[5][5] === null'))

    # ===== 关卡目标类型 =====
    types = pg.evaluate('''() => {
        const g = window.game;
        const out = {};
        for (const lv of [1, 2, 3, 5, 6, 7, 9, 10, 11]) {
            g.setupLevelObjective(lv);
            out[lv] = g.objective ? g.objective.type : 'score';
        }
        return out;
    }''')
    check('L1 第3关=收集', types['3'] == 'collect', str(types))
    check('L2 第5关=破冰', types['5'] == 'ice', str(types))
    check('L3 第6关=果冻', types['6'] == 'jelly', str(types))
    check('L4 第1/2关=分数', types['1'] == 'score' and types['2'] == 'score', str(types))
    check('L5 第7关=收集', types['7'] == 'collect', str(types))
    check('L6 第9关=破冰', types['9'] == 'ice', str(types))
    check('L7 第10关=果冻', types['10'] == 'jelly', str(types))

    # ===== 破冰关完整流程 =====
    pg.evaluate('window.game.startLevel(5)')
    pg.wait_for_timeout(1200)
    objs = pg.evaluate('window.game.objective.type')
    ice_on_board = pg.evaluate('window.game.countObstacles("ice")')
    check('L8 破冰关生成冰块', objs == 'ice' and ice_on_board > 0, f'type={objs} ice={ice_on_board}')
    label = pg.locator('#progress-text').text_content()
    check('L9 破冰进度文案', '破冰' in label, label)
    # 目标未达成
    check('L10 目标未达成', not pg.evaluate('window.game.objectiveMet()'))
    # 清空所有冰块 → 目标达成
    pg.evaluate('''() => {
        const g = window.game;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            if (g.obstacles[r][c] && g.obstacles[r][c].type === 'ice') g.obstacles[r][c] = null;
        }
    }''')
    check('L11 清空后目标达成', pg.evaluate('window.game.objectiveMet()'))
    check('L12 进度计数正确', pg.evaluate('window.game.objectiveTotalCollected() === window.game.objective.total'))

    # ===== 果冻关完整流程 =====
    pg.evaluate('window.game.startLevel(6)')
    pg.wait_for_timeout(1200)
    jt = pg.evaluate('window.game.objective.type')
    jelly_n = pg.evaluate('window.game.countObstacles("jelly")')
    check('L13 果冻关生成果冻', jt == 'jelly' and jelly_n > 0, f'type={jt} jelly={jelly_n}')
    label2 = pg.locator('#progress-text').text_content()
    check('L14 果冻进度文案', '果冻' in label2, label2)

    # ===== 存档持久化障碍 =====
    pg.evaluate('window.game.startLevel(5)')
    pg.wait_for_timeout(1000)
    ice_before = pg.evaluate('window.game.countObstacles("ice")')
    pg.evaluate('window.game.saveGame()')
    saved = pg.evaluate('!!safeGetJSON("candyMatch_save", null).obstacles')
    check('L15 障碍写入存档', saved)
    pg.evaluate('''() => {
        const g = window.game;
        const d = safeGetJSON('candyMatch_save', null);
        g.restoreFromSave(d);
    }''')
    pg.wait_for_timeout(1000)
    ice_after = pg.evaluate('window.game.countObstacles("ice")')
    check('L16 存档还原障碍', ice_before == ice_after, f'{ice_before}->{ice_after}')

    check('Z1 无JS错误', len(errors) == 0, '; '.join(errors[:2]))

    print('===== P1 功能测试 =====')
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(('✓ ' if ok else '✗ FAIL ') + name + (f' [{detail}]' if detail and not ok else ''))
    print(f'===== {passed}/{len(results)} 通过 =====')
    if errors: print('JS ERRORS:', errors[:3])
    b.close()
