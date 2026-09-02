// ============================================================
//  糖果消消乐 - Candy Match 3
//  参考: Candy Crush Saga / dgkanatsios/MatchThreeGame
// ============================================================

// ===== 常量 =====
const BOARD_SIZE = 8;
const CANDY_TYPES = 6;
const CANDY_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

// ===== 游戏状态 =====
const GameState = {
    IDLE: 'idle',
    SWAPPING: 'swapping',
    CHECKING: 'checking',
    REMOVING: 'removing',
    FALLING: 'falling',
    GAME_OVER: 'game_over'
};

// ===== 成就定义 =====
const ACHIEVEMENTS = [
    { id: 'first_clear',   name: '🎯 初出茅庐', desc: '第一次通关',           check: g => g.level >= 2 },
    { id: 'combo_5',       name: '🔥 连击大师', desc: '达成5连击',           check: g => g.maxCombo >= 5 },
    { id: 'combo_8',      name: '⚡ 连击王者', desc: '达成8连击',           check: g => g.maxCombo >= 8 },
    { id: 'score_5000',   name: '💰 分数达人', desc: '单局得分超过5000',     check: g => g.score >= 5000 },
    { id: 'score_20000',  name: '👑 分数传说', desc: '单局得分超过20000',    check: g => g.score >= 20000 },
    { id: 'level_5',      name: '🗺️ 冒险家',   desc: '到达第5关',            check: g => g.level >= 5 },
    { id: 'level_10',     name: '🌟 资深玩家', desc: '到达第10关',           check: g => g.level >= 10 },
    { id: 'special_10',   name: '✨ 特殊收藏家', desc: '累计创建10个特殊糖果',  check: g => g.totalSpecials >= 10 },
    { id: 'bomb_combo',   name: '💥 终极组合', desc: '触发特殊糖果组合爆炸', check: g => g.specialComboTriggered },
    { id: 'daily_play',   name: '📅 每日一消', desc: '完成一次每日挑战',     check: g => g.dailyChallengeDone },
];

// ===== 安全存取工具 =====
function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
}
function safeGetJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch (e) { return fallback; }
}
function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* 隐私模式 */ }
}

// ===== 主游戏类 =====
class CandyGame {
    constructor() {
        this.board = [];          // 2D array of candy objects
        this.score = 0;
        this.level = 1;
        this.moves = 30;
        this.targetScore = 1000;
        this.objective = null; // 收集目标关：{ targets: {颜色: 数量}, collected: {颜色: 已收集} }
        this.state = GameState.IDLE;
        this.selectedCell = null;
        this.comboCount = 0;
        this.isProcessing = false;
        this.isPaused = false;
        this.vibrationEnabled = safeGet('candyMatch_vibration', 'on') !== 'off';

        // 存档：最高分 / 最高关卡
        this.bestScore = parseInt(safeGet('candyMatch_bestScore', 0)) || 0;
        this.bestLevel = parseInt(safeGet('candyMatch_bestLevel', 1)) || 1;

        // 成就系统
        this.maxCombo = 0;
        this.totalSpecials = parseInt(safeGet('candyMatch_totalSpecials', 0)) || 0;
        this.specialComboTriggered = false;
        this.dailyChallengeDone = safeGet('candyMatch_dailyDone', '') === new Date().toDateString();
        this.unlockedAchievements = safeGetJSON('candyMatch_achievements', []);

        // 道具系统
        this.stars = parseInt(safeGet('candyMatch_stars', 0)) || 0;

        // 统计系统
        const loadedStats = safeGetJSON('candyMatch_stats', null) || {};
        this.stats = { games: 0, cleared: 0, bestCombo: 0, seconds: 0, ...loadedStats };

        // 每日挑战
        this.gameMode = 'classic'; // 'classic' | 'daily'
        this.dailyTimer = null;
        this.dailyTimeLeft = 30;
        this.dailyStartTime = 0;
        this.gameEpoch = 0; // 异步竞态保护：restart/nextLevel 递增

        // 闲置提示 / 缩放重排
        this.HINT_DELAY = 8000;
        this.lastActionTime = Date.now();
        this.hintCells = null;
        this._rerenderPending = false;

        this.boardEl = document.getElementById('board');
        this.particlesEl = document.getElementById('particles');
        this.comboTextEl = document.getElementById('combo-text');

        this.audio = new GameAudio();
        this.cellSize = 0;

        this.init();
    }

    // ===== 初始化 =====
    init() {
        this.calculateCellSize();
        this.generateBoard();
        this.renderBoard();
        this.bindEvents();
        this.updateHUD();

        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.calculateCellSize();
                // 动画进行中时推迟重建，避免糖果元素与动画错乱
                if (this.isProcessing) this._rerenderPending = true;
            }, 150);
        });

        // 闲置提示轮询
        this.hintInterval = setInterval(() => this.checkIdleHint(), 1000);
        // 游戏时长统计（仅活跃时累计）
        this.playTimeInterval = setInterval(() => this.tickPlayTime(), 1000);
        // 关闭/切后台前自动存档
        window.addEventListener('pagehide', () => this.saveGame());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.saveGame();
        });
    }

    calculateCellSize() {
        const rect = this.boardEl.getBoundingClientRect();
        this.cellSize = (rect.width - 16 - 14) / BOARD_SIZE; // padding + gaps
    }

    // ===== 棋盘生成 =====
    generateBoard() {
        this.board = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            this.board[r] = [];
            for (let c = 0; c < BOARD_SIZE; c++) {
                let type;
                do {
                    type = Math.floor(Math.random() * CANDY_TYPES);
                } while (this.wouldCreateMatch(r, c, type));
                this.board[r][c] = {
                    type: type,
                    color: CANDY_COLORS[type],
                    special: null,  // null | 'striped-h' | 'striped-v' | 'wrapped' | 'color-bomb'
                    row: r,
                    col: c,
                    el: null
                };
            }
        }
    }

    wouldCreateMatch(r, c, type) {
        // 检查水平方向
        if (c >= 2 &&
            this.board[r] &&
            this.board[r][c - 1] && this.board[r][c - 1].type === type &&
            this.board[r][c - 2] && this.board[r][c - 2].type === type) {
            return true;
        }
        // 检查垂直方向
        if (r >= 2 &&
            this.board[r - 1] && this.board[r - 1][c] && this.board[r - 1][c].type === type &&
            this.board[r - 2] && this.board[r - 2][c] && this.board[r - 2][c].type === type) {
            return true;
        }
        return false;
    }

    // ===== 渲染 =====
    renderBoard() {
        this.boardEl.innerHTML = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;

                const candy = this.board[r][c];
                if (candy) {
                    const candyEl = this.createCandyElement(candy);
                    cell.appendChild(candyEl);
                    candy.el = candyEl;
                }
                this.boardEl.appendChild(cell);
            }
        }
    }

    createCandyElement(candy) {
        const el = document.createElement('div');
        el.className = `candy candy-${candy.color}`;
        if (candy.special) {
            el.classList.add(candy.special);
        }
        el.dataset.row = candy.row;
        el.dataset.col = candy.col;
        return el;
    }

    // ===== 事件绑定 =====
    bindEvents() {
        let startX = 0, startY = 0;
        let startCell = null;

        // 鼠标/触摸开始 - 仅记录起始位置，不选择
        const onPointerDown = (e) => {
            this.noteActivity();
            if (this.state !== GameState.IDLE || this.isProcessing || this.isPaused) return;
            const cell = this.getCellFromEvent(e);
            if (!cell) return;

            // 锤子模式：直接敲除
            if (this.hammerMode) {
                this.hammerRemove(cell.row, cell.col);
                return;
            }

            startCell = cell;
            const touch = e.touches ? e.touches[0] : e;
            startX = touch.clientX;
            startY = touch.clientY;
        };

        // 鼠标/触摸移动（滑动交换）
        const onPointerMove = (e) => {
            if (!startCell || this.state !== GameState.IDLE || this.isProcessing || this.isPaused) return;
            const touch = e.touches ? e.touches[0] : e;
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const threshold = 20;

            if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
                let targetRow = startCell.row;
                let targetCol = startCell.col;

                if (Math.abs(dx) > Math.abs(dy)) {
                    targetCol += dx > 0 ? 1 : -1;
                } else {
                    targetRow += dy > 0 ? 1 : -1;
                }

                if (targetRow >= 0 && targetRow < BOARD_SIZE && targetCol >= 0 && targetCol < BOARD_SIZE) {
                    this.deselectCell();
                    this.attemptSwap(startCell.row, startCell.col, targetRow, targetCol);
                }
                startCell = null;
                e.preventDefault();
            }
        };

        // 鼠标/触摸结束（点击选择/交换）
        const onPointerUp = (e) => {
            if (!startCell || this.state !== GameState.IDLE || this.isProcessing || this.isPaused) return;
            const cell = this.getCellFromEvent(e);
            // 如果是拖动结束（cell不同于startCell），忽略
            if (cell && (cell.row !== startCell.row || cell.col !== startCell.col)) {
                startCell = null;
                return;
            }

            const clickRow = cell ? cell.row : startCell.row;
            const clickCol = cell ? cell.col : startCell.col;

            if (this.selectedCell) {
                const sel = this.selectedCell;
                if (sel.row === clickRow && sel.col === clickCol) {
                    // 点击已选中的糖果 - 取消选择
                    this.deselectCell();
                } else {
                    const dr = Math.abs(sel.row - clickRow);
                    const dc = Math.abs(sel.col - clickCol);
                    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
                        // 相邻 - 交换
                        this.deselectCell();
                        this.attemptSwap(sel.row, sel.col, clickRow, clickCol);
                    } else {
                        // 不相邻 - 选中新格子
                        this.deselectCell();
                        this.selectCell(clickRow, clickCol);
                    }
                }
            } else {
                // 没有已选中的糖果 - 选择当前
                this.selectCell(clickRow, clickCol);
            }
            startCell = null;
        };

        this.boardEl.addEventListener('mousedown', onPointerDown);
        this.boardEl.addEventListener('mousemove', onPointerMove);
        this.boardEl.addEventListener('mouseup', onPointerUp);
        this.boardEl.addEventListener('touchstart', (e) => { e.preventDefault(); onPointerDown(e); }, { passive: false });
        this.boardEl.addEventListener('touchmove', onPointerMove, { passive: false });
        this.boardEl.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            onPointerUp({ target: document.elementFromPoint(touch.clientX, touch.clientY) });
        });
        this.boardEl.addEventListener('touchcancel', () => { startCell = null; });

        // 键盘支持（桌面端）
        document.addEventListener('keydown', (e) => {
            this.noteActivity();
            if (!this.selectedCell) {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) {
                    this.selectCell(4, 4);
                    e.preventDefault();
                }
                return;
            }
            const { row, col } = this.selectedCell;
            let nr = row, nc = col;
            if (e.key === 'ArrowUp') nr = Math.max(0, row - 1);
            else if (e.key === 'ArrowDown') nr = Math.min(BOARD_SIZE - 1, row + 1);
            else if (e.key === 'ArrowLeft') nc = Math.max(0, col - 1);
            else if (e.key === 'ArrowRight') nc = Math.min(BOARD_SIZE - 1, col + 1);
            else if (e.key === 'Enter' || e.key === ' ') {
                // 确认/取消选择
                this.deselectCell();
                e.preventDefault();
                return;
            }
            else return;
            e.preventDefault();
            const dr = Math.abs(nr - row), dc = Math.abs(nc - col);
            if (dr + dc === 1) {
                this.deselectCell();
                this.attemptSwap(row, col, nr, nc);
            } else {
                this.deselectCell();
                this.selectCell(nr, nc);
            }
        });
    }

    getCellFromEvent(e) {
        let target;
        if (e.touches) {
            const touch = e.touches[0];
            target = document.elementFromPoint(touch.clientX, touch.clientY);
        } else {
            target = e.target;
        }
        if (!target) return null;

        // 找到最近的cell
        const cellEl = target.closest('.cell');
        if (!cellEl) return null;

        return {
            row: parseInt(cellEl.dataset.row),
            col: parseInt(cellEl.dataset.col)
        };
    }

    // ===== 选择/取消选择 =====
    selectCell(row, col) {
        // 取消之前的选择
        this.deselectCell();

        this.selectedCell = { row, col };
        const candy = this.board[row][col];
        if (candy && candy.el) {
            candy.el.classList.add('selected');
        }
        this.audio.play('select');
    }

    deselectCell() {
        if (this.selectedCell) {
            const candy = this.board[this.selectedCell.row][this.selectedCell.col];
            if (candy && candy.el) {
                candy.el.classList.remove('selected');
            }
            this.selectedCell = null;
        }
    }

    // ===== 交换糖果 =====
    async attemptSwap(r1, c1, r2, c2) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.state = GameState.SWAPPING;
        try {
        const candy1 = this.board[r1][c1];
        const candy2 = this.board[r2][c2];

        if (!candy1 || !candy2) {
            this.isProcessing = false;
            this.state = GameState.IDLE;
            return;
        }

        // 执行交换动画
        this.audio.play('swap');
        if (this.vibrationEnabled && navigator.vibrate) navigator.vibrate(10);
        await this.animateSwap(candy1, candy2);

        // 交换数据
        this.board[r1][c1] = candy2;
        this.board[r2][c2] = candy1;
        candy1.row = r2; candy1.col = c2;
        candy2.row = r1; candy2.col = c1;
        candy1.el.dataset.row = r2; candy1.el.dataset.col = c2;
        candy2.el.dataset.row = r1; candy2.el.dataset.col = c1;

        // 移动DOM元素到正确的cell（同时重置transform，无视觉跳动）
        this.moveCandyToCell(candy2, r1, c1);
        this.moveCandyToCell(candy1, r2, c2);

        // ===== 特殊糖果组合检测 =====
        const comboResult = this.checkSpecialCombination(candy1, candy2, r1, c1, r2, c2);
        if (comboResult) {
            // 特殊糖果组合 - 消耗步数并执行组合爆炸
            this.moves--;
            this.updateHUD();
            this.audio.play('special');
            await this.executeSpecialCombo(comboResult, r1, c1, r2, c2);
            this.comboCount = 0;
            await this.processMatches();
            this.checkGameState();
            return;
        }

        // 检查是否有匹配
        const matches = this.findAllMatches();
        const hasSpecial = candy1.special === 'color-bomb' || candy2.special === 'color-bomb';

        if (matches.length === 0 && !hasSpecial) {
            // 无匹配 - 交换回去
            this.audio.play('invalid');

            // 计算反向偏移
            const cell1El = this.boardEl.children[r1 * BOARD_SIZE + c1];
            const cell2El = this.boardEl.children[r2 * BOARD_SIZE + c2];
            const rect1 = cell1El.getBoundingClientRect();
            const rect2 = cell2El.getBoundingClientRect();
            const backDx = rect1.left - rect2.left;
            const backDy = rect1.top - rect2.top;

            candy1.el.classList.add('swapping');
            candy2.el.classList.add('swapping');
            candy1.el.style.transform = `translate(${backDx}px, ${backDy}px)`;
            candy2.el.style.transform = `translate(${-backDx}px, ${-backDy}px)`;
            await this.wait(250);

            // 移回原位
            this.moveCandyToCell(candy1, r1, c1);
            this.moveCandyToCell(candy2, r2, c2);

            // 恢复数据
            this.board[r1][c1] = candy1;
            this.board[r2][c2] = candy2;
            candy1.row = r1; candy1.col = c1;
            candy2.row = r2; candy2.col = c2;
            candy1.el.dataset.row = r1; candy1.el.dataset.col = c1;
            candy2.el.dataset.row = r2; candy2.el.dataset.col = c2;

            this.isProcessing = false;
            this.state = GameState.IDLE;
            return;
        }

        // 消耗步数
        this.moves--;
        this.updateHUD();

        // 处理彩色炸弹
        if (candy1.special === 'color-bomb' || candy2.special === 'color-bomb') {
            const bombCandy = candy1.special === 'color-bomb' ? candy1 : candy2;
            const otherCandy = candy1.special === 'color-bomb' ? candy2 : candy1;
            const targetType = otherCandy.type;
            await this.activateColorBomb(bombCandy, targetType);
        }

        // 处理匹配
        this.comboCount = 0;
        await this.processMatches();

        // 检查游戏状态
        this.checkGameState();

        } finally {
            this.isProcessing = false;
            this.noteActivity();
            if (this._rerenderPending && this.state !== GameState.GAME_OVER) {
                this._rerenderPending = false;
                this.renderBoard();
            }
            if (this.state !== GameState.GAME_OVER) {
                this.state = GameState.IDLE;
            }
            this.saveGame();
        }
    }

    async animateSwap(candy1, candy2) {
        const cell1 = candy1.el.parentElement;
        const cell2 = candy2.el.parentElement;
        const rect1 = cell1.getBoundingClientRect();
        const rect2 = cell2.getBoundingClientRect();

        const dx = rect2.left - rect1.left;
        const dy = rect2.top - rect1.top;

        candy1.el.classList.add('swapping');
        candy2.el.classList.add('swapping');
        candy1.el.style.transform = `translate(${dx}px, ${dy}px)`;
        candy2.el.style.transform = `translate(${-dx}px, ${-dy}px)`;

        await this.wait(250);
        // Don't reset transforms here - caller handles DOM move + reset
    }

    moveCandyToCell(candy, row, col) {
        const cellEl = this.boardEl.children[row * BOARD_SIZE + col];
        cellEl.appendChild(candy.el);
        candy.el.classList.remove('swapping');
        candy.el.style.transform = '';
    }

    // ===== 匹配检测 =====
    findAllMatches() {
        const matches = [];

        // 水平检测
        for (let r = 0; r < BOARD_SIZE; r++) {
            let count = 1;
            for (let c = 1; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c - 1] &&
                    this.board[r][c].type === this.board[r][c - 1].type) {
                    count++;
                } else {
                    if (count >= 3) {
                        matches.push({
                            direction: 'h',
                            row: r,
                            startCol: c - count,
                            endCol: c - 1,
                            length: count,
                            type: this.board[r][c - 1].type
                        });
                    }
                    count = 1;
                }
            }
            if (count >= 3) {
                matches.push({
                    direction: 'h',
                    row: r,
                    startCol: BOARD_SIZE - count,
                    endCol: BOARD_SIZE - 1,
                    length: count,
                    type: this.board[r][BOARD_SIZE - 1].type
                });
            }
        }

        // 垂直检测
        for (let c = 0; c < BOARD_SIZE; c++) {
            let count = 1;
            for (let r = 1; r < BOARD_SIZE; r++) {
                if (this.board[r][c] && this.board[r - 1][c] &&
                    this.board[r][c].type === this.board[r - 1][c].type) {
                    count++;
                } else {
                    if (count >= 3) {
                        matches.push({
                            direction: 'v',
                            col: c,
                            startRow: r - count,
                            endRow: r - 1,
                            length: count,
                            type: this.board[r - 1][c].type
                        });
                    }
                    count = 1;
                }
            }
            if (count >= 3) {
                matches.push({
                    direction: 'v',
                    col: c,
                    startRow: BOARD_SIZE - count,
                    endRow: BOARD_SIZE - 1,
                    length: count,
                    type: this.board[BOARD_SIZE - 1][c].type
                });
            }
        }

        return matches;
    }

    // ===== 处理匹配 - 核心循环 =====
    async processMatches() {
        const epoch = this.gameEpoch;
        while (true) {
            if (epoch !== this.gameEpoch) return; // 棋盘已重置
            const matches = this.findAllMatches();
            if (matches.length === 0) break;

            this.comboCount++;
            if (this.comboCount > 50) break;

            const matchScore = this.calculateScore(matches);
            this.score += matchScore;
            this.updateHUD();

            if (this.comboCount >= 2) {
                this.showCombo(this.comboCount);
            }

            const toRemove = this.collectMatchedCandies(matches);
            const specialCreated = this.checkSpecialCreation(matches);
            const activatedSpecials = this.activateSpecialsInMatch(toRemove, matches);
            const allToRemove = new Set([...toRemove, ...activatedSpecials]);
            for (const sp of specialCreated) {
                allToRemove.delete(sp.key);
            }

            this.audio.play('match');
            if (this.vibrationEnabled && navigator.vibrate) navigator.vibrate(15);
            await this.removeCandies(allToRemove);
            if (epoch !== this.gameEpoch) return;

            for (const sp of specialCreated) {
                this.createSpecialAt(sp.row, sp.col, sp.special, sp.type);
            }

            await this.dropAndFill();
            if (epoch !== this.gameEpoch) return;

            this.updateHUD();
        }
    }

    collectMatchedCandies(matches) {
        const set = new Set();
        for (const match of matches) {
            if (match.direction === 'h') {
                for (let c = match.startCol; c <= match.endCol; c++) {
                    set.add(`${match.row},${c}`);
                }
            } else {
                for (let r = match.startRow; r <= match.endRow; r++) {
                    set.add(`${r},${match.col}`);
                }
            }
        }
        return set;
    }

    // ===== 特殊糖果创建检测 =====
    checkSpecialCreation(matches) {
        const specials = [];
        const usedPositions = new Set();

        for (const match of matches) {
            if (match.length === 4) {
                // 4连 - 条纹糖果
                let row, col;
                if (match.direction === 'h') {
                    row = match.row;
                    col = Math.floor((match.startCol + match.endCol) / 2);
                } else {
                    col = match.col;
                    row = Math.floor((match.startRow + match.endRow) / 2);
                }
                const key = `${row},${col}`;
                if (!usedPositions.has(key)) {
                    const special = match.direction === 'h' ? 'striped-v' : 'striped-h';
                    specials.push({ row, col, special, type: match.type, key });
                    usedPositions.add(key);
                }
            } else if (match.length >= 5) {
                // 5连 - 彩色炸弹
                let row, col;
                if (match.direction === 'h') {
                    row = match.row;
                    col = Math.floor((match.startCol + match.endCol) / 2);
                } else {
                    col = match.col;
                    row = Math.floor((match.startRow + match.endRow) / 2);
                }
                const key = `${row},${col}`;
                if (!usedPositions.has(key)) {
                    specials.push({ row, col, special: 'color-bomb', type: match.type, key });
                    usedPositions.add(key);
                }
            }

            // 检查L形/T形 - 包装糖果
            // (通过检查交叉点)
        }

        // 检查L/T形匹配
        specials.push(...this.checkLShapeMatches(matches, usedPositions));

        return specials;
    }

    checkLShapeMatches(matches, usedPositions) {
        const specials = [];
        // 简化版L形检测：检查水平匹配和垂直匹配的交叉点
        const hMatches = matches.filter(m => m.direction === 'h');
        const vMatches = matches.filter(m => m.direction === 'v');

        for (const hm of hMatches) {
            for (const vm of vMatches) {
                // 检查交叉点
                if (hm.type !== vm.type) continue;
                for (let c = hm.startCol; c <= hm.endCol; c++) {
                    if (c === vm.col) {
                        for (let r = vm.startRow; r <= vm.endRow; r++) {
                            if (r === hm.row) {
                                const key = `${r},${c}`;
                                if (!usedPositions.has(key) && hm.length >= 3 && vm.length >= 3) {
                                    // L/T形 - 长臂≥4生成十字糖，否则生成包装糖
                                    const special = (hm.length >= 4 || vm.length >= 4) ? 'cross' : 'wrapped';
                                    specials.push({ row: r, col: c, special, type: hm.type, key });
                                    usedPositions.add(key);
                                }
                            }
                        }
                    }
                }
            }
        }
        return specials;
    }

    // ===== 特殊糖果激活 =====
    activateSpecialsInMatch(toRemove, matches) {
        const additional = new Set();

        for (const key of toRemove) {
            const [r, c] = key.split(',').map(Number);
            const candy = this.board[r][c];
            if (!candy || !candy.special) continue;

            if (candy.special === 'striped-h') {
                // 消除整行
                for (let cc = 0; cc < BOARD_SIZE; cc++) {
                    additional.add(`${r},${cc}`);
                }
            } else if (candy.special === 'striped-v') {
                // 消除整列
                for (let rr = 0; rr < BOARD_SIZE; rr++) {
                    additional.add(`${rr},${c}`);
                }
            } else if (candy.special === 'cross') {
                // 十字糖：整行+整列
                for (let cc = 0; cc < BOARD_SIZE; cc++) {
                    additional.add(`${r},${cc}`);
                }
                for (let rr = 0; rr < BOARD_SIZE; rr++) {
                    additional.add(`${rr},${c}`);
                }
            } else if (candy.special === 'wrapped') {
                // 3x3爆炸
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                            additional.add(`${nr},${nc}`);
                        }
                    }
                }
            }
        }

        return additional;
    }

    // ===== 特殊糖果组合检测 =====
    checkSpecialCombination(candy1, candy2, r1, c1, r2, c2) {
        if (!candy1.special || !candy2.special) return null;

        const s1 = candy1.special;
        const s2 = candy2.special;
        const isStriped = s => s === 'striped-h' || s === 'striped-v';
        const isWrappedLike = s => s === 'wrapped' || s === 'cross';

        // 彩色炸弹 + 彩色炸弹 = 全屏大爆炸
        if (s1 === 'color-bomb' && s2 === 'color-bomb') {
            return { type: 'double-bomb' };
        }
        // 彩色炸弹 + 条纹 = 全部同色变条纹后引爆
        if (s1 === 'color-bomb' && isStriped(s2)) {
            return { type: 'bomb-striped', targetType: candy2.type, stripedDir: s2 };
        }
        if (s2 === 'color-bomb' && isStriped(s1)) {
            return { type: 'bomb-striped', targetType: candy1.type, stripedDir: s1 };
        }
        // 彩色炸弹 + 包装糖/十字糖 = 全部同色变包装后引爆
        if (s1 === 'color-bomb' && isWrappedLike(s2)) {
            return { type: 'bomb-wrapped', targetType: candy2.type };
        }
        if (s2 === 'color-bomb' && isWrappedLike(s1)) {
            return { type: 'bomb-wrapped', targetType: candy1.type };
        }
        // 条纹 + 条纹 = 十字连爆（整行+整列）
        if (isStriped(s1) && isStriped(s2)) {
            return { type: 'double-striped', row: r1, col: c1, row2: r2, col2: c2 };
        }
        // 条纹 + 包装糖/十字糖 = 3行3列大十字
        if ((isStriped(s1) && isWrappedLike(s2)) || (isWrappedLike(s1) && isStriped(s2))) {
            return { type: 'striped-wrapped', row: r1, col: c1, row2: r2, col2: c2 };
        }
        // 包装糖/十字糖 + 包装糖/十字糖 = 5x5大爆炸
        if (isWrappedLike(s1) && isWrappedLike(s2)) {
            return { type: 'double-wrapped', row: r1, col: c1, row2: r2, col2: c2 };
        }

        return null;
    }

    async executeSpecialCombo(combo, r1, c1, r2, c2) {
        this.specialComboTriggered = true;
        this.checkAchievements();
        const toRemove = new Set();

        switch (combo.type) {
            case 'double-bomb': {
                // 全屏大爆炸
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        toRemove.add(`${r},${c}`);
                    }
                }
                this.comboTextEl.textContent = '💥 全屏大爆炸！';
                this.comboTextEl.classList.remove('show');
                void this.comboTextEl.offsetHeight;
                this.comboTextEl.classList.add('show');
                this.audio.play('combo');
                break;
            }
            case 'bomb-striped': {
                // 所有同色糖果变成条纹糖后引爆
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const candy = this.board[r][c];
                        if (candy && candy.type === combo.targetType && !candy.special) {
                            candy.special = combo.stripedDir;
                            if (candy.el) candy.el.classList.add(combo.stripedDir);
                        }
                    }
                }
                // 然后消除所有同色（含刚变条纹的）
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const candy = this.board[r][c];
                        if (candy && candy.type === combo.targetType) {
                            toRemove.add(`${r},${c}`);
                        }
                    }
                }
                // 加上两个交换位置
                toRemove.add(`${r1},${c1}`);
                toRemove.add(`${r2},${c2}`);
                break;
            }
            case 'bomb-wrapped': {
                // 所有同色变包装后引爆（3x3连锁）
                for (let r = 0; r < BOARD_SIZE; r++) {
                    for (let c = 0; c < BOARD_SIZE; c++) {
                        const candy = this.board[r][c];
                        if (candy && candy.type === combo.targetType) {
                            toRemove.add(`${r},${c}`);
                        }
                    }
                }
                // 包装效果：每个被消除的同色周围3x3也消除
                const wrapped = new Set(toRemove);
                for (const key of wrapped) {
                    const [r, c] = key.split(',').map(Number);
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            const nr = r + dr, nc = c + dc;
                            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                                toRemove.add(`${nr},${nc}`);
                            }
                        }
                    }
                }
                toRemove.add(`${r1},${c1}`);
                toRemove.add(`${r2},${c2}`);
                break;
            }
            case 'double-striped': {
                // 十字连爆：整行 + 整列（以两个位置为中心）
                for (let i = 0; i < BOARD_SIZE; i++) {
                    toRemove.add(`${combo.row},${i}`);
                    toRemove.add(`${i},${combo.col}`);
                    toRemove.add(`${combo.row2},${i}`);
                    toRemove.add(`${i},${combo.col2}`);
                }
                break;
            }
            case 'striped-wrapped': {
                // 3行3列大十字
                for (let i = 0; i < BOARD_SIZE; i++) {
                    for (let dr = -1; dr <= 1; dr++) {
                        const row1 = combo.row + dr;
                        const row2 = combo.row2 + dr;
                        if (row1 >= 0 && row1 < BOARD_SIZE) toRemove.add(`${row1},${i}`);
                        if (row2 >= 0 && row2 < BOARD_SIZE) toRemove.add(`${row2},${i}`);
                        const col1 = combo.col + dr;
                        const col2 = combo.col2 + dr;
                        if (col1 >= 0 && col1 < BOARD_SIZE) toRemove.add(`${i},${col1}`);
                        if (col2 >= 0 && col2 < BOARD_SIZE) toRemove.add(`${i},${col2}`);
                    }
                }
                break;
            }
            case 'double-wrapped': {
                // 5x5大爆炸（两个位置各5x5）
                for (const [cr, cc] of [[combo.row, combo.col], [combo.row2, combo.col2]]) {
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            const nr = cr + dr, nc = cc + dc;
                            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                                toRemove.add(`${nr},${nc}`);
                            }
                        }
                    }
                }
                break;
            }
        }

        this.comboCount = Math.max(this.comboCount, 1);
        const comboScore = toRemove.size * 40 * this.comboCount;
        this.score += comboScore;
        await this.removeCandies(toRemove);
        await this.dropAndFill();
        this.updateHUD();
    }

    async activateColorBomb(bombCandy, targetType) {
        const toRemove = new Set();
        toRemove.add(`${bombCandy.row},${bombCandy.col}`);

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c].type === targetType) {
                    toRemove.add(`${r},${c}`);
                }
            }
        }

        // 被消除的同色特殊糖果也触发其效果
        const triggered = this.activateSpecialsInMatch(toRemove, []);
        for (const k of triggered) toRemove.add(k);

        this.comboCount = Math.max(this.comboCount, 1);
        const bombScore = toRemove.size * 40 * this.comboCount;
        this.score += bombScore;
        this.audio.play('special');
        await this.removeCandies(toRemove);
        await this.dropAndFill();
    }

    // ===== 创建特殊糖果 =====
    createSpecialAt(row, col, special, type) {
        this.totalSpecials++;
        safeSet('candyMatch_totalSpecials', this.totalSpecials);
        this.checkAchievements();
        const candy = {
            type: type,
            color: CANDY_COLORS[type],
            special: special,
            row: row,
            col: col,
            el: null
        };
        this.board[row][col] = candy;

        // 渲染
        const cellEl = this.boardEl.children[row * BOARD_SIZE + col];
        if (cellEl) {
            cellEl.innerHTML = '';
            const candyEl = this.createCandyElement(candy);
            cellEl.appendChild(candyEl);
            candy.el = candyEl;
        }
    }

    // ===== 消除糖果 =====
    async removeCandies(keys) {
        const positions = [];
        const elements = [];

        for (const key of keys) {
            const [r, c] = key.split(',').map(Number);
            const candy = this.board[r][c];
            if (!candy) continue;

            positions.push({ r, c, color: candy.color });
            // 收集目标关：累计已收集数量
            if (this.objective && this.objective.collected[candy.color] !== undefined) {
                this.objective.collected[candy.color]++;
            }

            if (candy.el) {
                candy.el.classList.add('removing');
                this.spawnParticles(candy.el, candy.color);
                elements.push(candy.el);
            }
            this.board[r][c] = null;
        }

        // 统计累计消除
        this.stats.cleared += positions.length;

        // 显示分数飘字
        if (positions.length > 0) {
            const avgR = positions.reduce((s, p) => s + p.r, 0) / positions.length;
            const avgC = positions.reduce((s, p) => s + p.c, 0) / positions.length;
            const score = positions.length * 30 * this.comboCount;
            this.showScorePopup(avgR, avgC, score);
        }

        await this.wait(400);

        // 清理DOM元素
        elements.forEach(el => el.remove());
    }

    // ===== 下落和填充 =====
    async dropAndFill() {
        this.state = GameState.FALLING;

        // 逐列处理下落
        for (let c = 0; c < BOARD_SIZE; c++) {
            let writeRow = BOARD_SIZE - 1;

            // 从底部向上扫描，将非空糖果下落
            for (let r = BOARD_SIZE - 1; r >= 0; r--) {
                if (this.board[r][c]) {
                    if (r !== writeRow) {
                        const candy = this.board[r][c];
                        this.board[writeRow][c] = candy;
                        this.board[r][c] = null;
                        candy.row = writeRow;
                        candy.el.dataset.row = writeRow;

                        // 移动到新cell并清除旧内容
                        const cellEl = this.boardEl.children[writeRow * BOARD_SIZE + c];
                        cellEl.innerHTML = '';
                        cellEl.appendChild(candy.el);
                        candy.el.classList.add('falling');

                        // 计算下落距离（从原位置到新位置）
                        const fallDistance = (writeRow - r) * (this.cellSize + 2);
                        candy.el.style.transform = `translateY(${-fallDistance}px)`;

                        // 触发回流
                        void candy.el.offsetHeight;

                        candy.el.style.transform = '';
                    }
                    writeRow--;
                }
            }

            // 填充顶部空位
            for (let r = writeRow; r >= 0; r--) {
                const type = Math.floor(Math.random() * CANDY_TYPES);
                const candy = {
                    type: type,
                    color: CANDY_COLORS[type],
                    special: null,
                    row: r,
                    col: c,
                    el: null
                };
                this.board[r][c] = candy;

                const cellEl = this.boardEl.children[r * BOARD_SIZE + c];
                cellEl.innerHTML = '';
                const candyEl = this.createCandyElement(candy);
                cellEl.appendChild(candyEl);
                candy.el = candyEl;
                candy.el.classList.add('falling');

                // 新糖果从棋盘上方落入
                const fallDistance = (r + 1) * (this.cellSize + 2);
                candy.el.style.transform = `translateY(${-fallDistance}px)`;
                void candy.el.offsetHeight;
                candy.el.style.transform = '';
            }
        }

        await this.wait(400);

        // 移除falling类
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c].el) {
                    this.board[r][c].el.classList.remove('falling');
                }
            }
        }
    }

    // ===== 计分 =====
    calculateScore(matches) {
        let total = 0;
        for (const match of matches) {
            let base = match.length * 30;
            if (match.length === 4) base = 120;
            if (match.length >= 5) base = 500;
            total += base;
        }
        total *= this.comboCount;
        return total;
    }

    // ===== 粒子效果 =====
    spawnParticles(el, color) {
        const rect = el.getBoundingClientRect();
        const boardRect = this.boardEl.getBoundingClientRect();
        const containerRect = this.particlesEl.getBoundingClientRect();
        const offsetX = boardRect.left - containerRect.left;
        const offsetY = boardRect.top - containerRect.top;
        const x = rect.left - boardRect.left + rect.width / 2 + offsetX;
        const y = rect.top - boardRect.top + rect.height / 2 + offsetY;

        const colorMap = {
            'red': '#ff6b6b',
            'blue': '#6bb6ff',
            'green': '#6bff9e',
            'yellow': '#ffe66b',
            'purple': '#c46bff',
            'orange': '#ffb36b'
        };

        const particleColor = colorMap[color] || '#fff';

        for (let i = 0; i < 8; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.width = '8px';
            particle.style.height = '8px';
            particle.style.background = particleColor;
            particle.style.boxShadow = `0 0 6px ${particleColor}`;

            const angle = (i / 8) * Math.PI * 2;
            const dist = 30 + Math.random() * 40;
            particle.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
            particle.style.setProperty('--dy', Math.sin(angle) * dist + 'px');

            this.particlesEl.appendChild(particle);
            setTimeout(() => particle.remove(), 800);
        }
    }

    // ===== 分数飘字 =====
    showScorePopup(row, col, score) {
        const popup = document.createElement('div');
        popup.className = 'score-popup';
        popup.textContent = `+${score}`;
        popup.style.left = `${(col / BOARD_SIZE) * 100}%`;
        popup.style.top = `${(row / BOARD_SIZE) * 100}%`;
        this.boardEl.appendChild(popup);
        setTimeout(() => popup.remove(), 1000);
    }

    // ===== Combo提示 =====
    showCombo(count) {
        this.maxCombo = Math.max(this.maxCombo, count);
        if (count > this.stats.bestCombo) this.stats.bestCombo = count;
        this.checkAchievements();
        const texts = ['', '', 'NICE!', 'GREAT!', 'AMAZING!', 'AWESOME!', 'INCREDIBLE!', 'UNBELIEVABLE!'];
        const text = texts[Math.min(count, texts.length - 1)] || `${count}x COMBO!`;
        this.comboTextEl.textContent = text;
        this.comboTextEl.classList.remove('show');
        void this.comboTextEl.offsetHeight;
        this.comboTextEl.classList.add('show');
        this.audio.play('combo');
    }

    // ===== 成就系统 =====
    checkAchievements() {
        for (const ach of ACHIEVEMENTS) {
            if (this.unlockedAchievements.includes(ach.id)) continue;
            if (ach.check(this)) {
                this.unlockAchievement(ach);
            }
        }
    }

    unlockAchievement(ach) {
        this.unlockedAchievements.push(ach.id);
        safeSet('candyMatch_achievements', JSON.stringify(this.unlockedAchievements));
        this.stars += 10; // 成就奖励星星
        safeSet('candyMatch_stars', this.stars);
        this.showAchievementToast(ach);
    }

    showAchievementToast(ach) {
        const toast = document.createElement('div');
        toast.className = 'achievement-toast';
        toast.innerHTML = `<span class="ach-icon">🏆</span><div><div class="ach-title">成就解锁！</div><div class="ach-name">${ach.name}</div><div class="ach-desc">${ach.desc} +10⭐</div></div>`;
        document.getElementById('game-container').appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 3500);
    }
    // ===== 暂停/恢复 =====
    pause() {
        if (this.state === GameState.GAME_OVER) return;
        this.isPaused = true;
        this.deselectCell();
        this.noteActivity();
        this.saveGame();
        // 暂停每日挑战计时器
        if (this.dailyTimer) {
            clearInterval(this.dailyTimer);
            this.dailyTimer = null;
            this._dailyPaused = true;
        }
        document.getElementById('pause-screen').classList.remove('hidden');
        // 挂起音频（暂停背景音乐与音效）
        if (this.audio.ctx && this.audio.ctx.state === 'running') this.audio.ctx.suspend();
    }

    resume() {
        this.isPaused = false;
        // 恢复每日挑战计时器
        if (this._dailyPaused && this.gameMode === 'daily' && this.state !== GameState.GAME_OVER) {
            this._dailyPaused = false;
            this.dailyTimer = setInterval(() => {
                this.dailyTimeLeft--;
                this.updateHUD();
                if (this.dailyTimeLeft <= 0) {
                    clearInterval(this.dailyTimer);
                    this.dailyTimer = null;
                    this.dailyChallengeEnd();
                }
            }, 1000);
        }
        document.getElementById('pause-screen').classList.add('hidden');
        if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
        this.noteActivity();
    }

    // ===== 存档 =====
    saveBestRecord() {
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            safeSet('candyMatch_bestScore', this.bestScore);
        }
        if (this.level > this.bestLevel) {
            this.bestLevel = this.level;
            safeSet('candyMatch_bestLevel', this.bestLevel);
        }
    }

    showBestRecord() {
        const el = document.getElementById('best-record');
        if (this.bestScore > 0 || this.bestLevel > 1) {
            el.classList.remove('hidden');
            document.getElementById('best-score-val').textContent = this.bestScore;
            document.getElementById('best-level-val').textContent = this.bestLevel;
        }
    }

    // ===== 中途存档续玩 =====
    saveGame() {
        this.saveStats();
        if (this.gameMode !== 'classic' || this.state === GameState.GAME_OVER) return;
        const cells = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const candy = this.board[r][c];
                cells.push(candy ? { t: candy.type, s: candy.special || null } : null);
            }
        }
        const data = {
            v: 1,
            cells,
            score: this.score,
            level: this.level,
            moves: this.moves,
            targetScore: this.targetScore,
            objective: this.objective ? { targets: this.objective.targets, collected: this.objective.collected } : null
        };
        safeSet('candyMatch_save', JSON.stringify(data));
    }

    clearSave() {
        try { localStorage.removeItem('candyMatch_save'); } catch (e) { /* 隐私模式 */ }
    }

    static hasSave() {
        const data = safeGetJSON('candyMatch_save', null);
        return !!(data && data.v === 1 && Array.isArray(data.cells) && data.cells.length === BOARD_SIZE * BOARD_SIZE);
    }

    restoreFromSave(data) {
        this.gameEpoch++;
        if (this.dailyTimer) { clearInterval(this.dailyTimer); this.dailyTimer = null; }
        this._dailyPaused = false;
        this.gameMode = 'classic';
        this.board = [];
        let i = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            this.board[r] = [];
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = data.cells[i++];
                this.board[r][c] = cell ? {
                    type: cell.t,
                    color: CANDY_COLORS[cell.t] || 'red',
                    special: cell.s || null,
                    row: r,
                    col: c,
                    el: null
                } : null;
            }
        }
        this.score = data.score || 0;
        this.level = data.level || 1;
        this.moves = data.moves || 30;
        this.targetScore = data.targetScore || 1000;
        this.objective = data.objective ? { targets: data.objective.targets, collected: data.objective.collected } : null;
        this.comboCount = 0;
        this.maxCombo = 0;
        this.adMoveBoostsUsed = 0;
        this.reviveUsed = false;
        document.getElementById('revive-ad-btn').style.display = '';
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('level-complete').classList.add('hidden');
        document.querySelector('#level-complete h1').textContent = '🎉 通关！';
        this.selectedCell = null;
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
        this.noteActivity();
    }

    // ===== 统计系统 =====
    saveStats() {
        safeSet('candyMatch_stats', JSON.stringify(this.stats));
    }

    recordGameStart() {
        this.stats.games++;
        this.saveStats();
    }

    tickPlayTime() {
        if (this.isPaused || this.state === GameState.GAME_OVER || document.hidden) return;
        if (document.querySelector('.overlay:not(.hidden)')) return;
        this.stats.seconds++;
        if (this.stats.seconds % 15 === 0) this.saveStats();
    }

    // ===== 闲置提示 =====
    checkIdleHint() {
        if (this.isProcessing || this.isPaused || this.state !== GameState.IDLE) return;
        if (this.hintCells) return;
        if (document.querySelector('.overlay:not(.hidden)')) return;
        if (Date.now() - this.lastActionTime < this.HINT_DELAY) return;
        const move = this.findValidMove();
        if (move && move.candy1.el && move.candy2.el) {
            this.hintCells = [move.candy1.el, move.candy2.el];
            this.hintCells.forEach(el => el.classList.add('hint'));
        }
    }

    findValidMove() {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const candy = this.board[r][c];
                if (!candy) continue;
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= BOARD_SIZE || nc >= BOARD_SIZE || !this.board[nr][nc]) continue;
                    // 彩色炸弹/双特殊糖果任意相邻交换都有效
                    if (candy.special === 'color-bomb' || this.board[nr][nc].special === 'color-bomb') {
                        return { candy1: candy, candy2: this.board[nr][nc] };
                    }
                    if (candy.special && this.board[nr][nc].special) {
                        return { candy1: candy, candy2: this.board[nr][nc] };
                    }
                    this.swapData(r, c, nr, nc);
                    const ok = this.findAllMatches().length > 0;
                    this.swapData(r, c, nr, nc);
                    if (ok) return { candy1: candy, candy2: this.board[nr][nc] };
                }
            }
        }
        return null;
    }

    noteActivity() {
        this.lastActionTime = Date.now();
        this.clearHint();
    }

    clearHint() {
        if (this.hintCells) {
            this.hintCells.forEach(el => { if (el) el.classList.remove('hint'); });
            this.hintCells = null;
        }
    }

    // ===== 游戏状态检查 =====
    checkGameState() {
        if (this.state === GameState.GAME_OVER) return;
        if (this.gameMode === 'daily') {
            // 每日挑战模式只看时间，不检查分数/步数
            if (!this.hasValidMoves()) this.shuffleBoard();
            return;
        }
        if (this.objective) {
            // 收集目标关
            if (this.objectiveMet()) {
                this.levelComplete();
            } else if (this.moves <= 0) {
                this.gameOver();
            }
        } else if (this.score >= this.targetScore) {
            this.levelComplete();
        } else if (this.moves <= 0) {
            this.gameOver();
        }

        // 检查是否有可移动的步骤
        if (this.state !== GameState.GAME_OVER && !this.hasValidMoves()) {
            this.shuffleBoard();
        }
    }

    // ===== 收集目标关卡 =====
    setupLevelObjective(level) {
        // 第3、5、7…关为收集目标关，其余为分数关
        if (level >= 3 && level % 2 === 1) {
            const tier = Math.floor((level - 3) / 2);
            const colorCount = Math.min(2 + Math.floor(tier / 3), 4);
            const perColor = 25 + tier * 10;
            const targets = {};
            const collected = {};
            const used = new Set();
            for (let i = 0; used.size < colorCount; i++) {
                used.add((level * 2 + i) % CANDY_TYPES);
            }
            for (const ci of used) {
                targets[CANDY_COLORS[ci]] = perColor;
                collected[CANDY_COLORS[ci]] = 0;
            }
            this.objective = { targets, collected };
        } else {
            this.objective = null;
        }
    }

    objectiveMet() {
        if (!this.objective) return true;
        return Object.keys(this.objective.targets).every(
            color => this.objective.collected[color] >= this.objective.targets[color]
        );
    }

    objectiveTotalNeeded() {
        if (!this.objective) return 0;
        return Object.values(this.objective.targets).reduce((s, n) => s + n, 0);
    }

    objectiveTotalCollected() {
        if (!this.objective) return 0;
        return Object.values(this.objective.collected).reduce((s, n) => s + n, 0);
    }

    hasValidMoves() {
        // 彩色炸弹总是可以交换
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c].special === 'color-bomb') return true;
            }
        }
        // 检查普通匹配
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (c < BOARD_SIZE - 1) {
                    this.swapData(r, c, r, c + 1);
                    if (this.findAllMatches().length > 0) { this.swapData(r, c, r, c + 1); return true; }
                    this.swapData(r, c, r, c + 1);
                }
                if (r < BOARD_SIZE - 1) {
                    this.swapData(r, c, r + 1, c);
                    if (this.findAllMatches().length > 0) { this.swapData(r, c, r + 1, c); return true; }
                    this.swapData(r, c, r + 1, c);
                }
            }
        }
        // 检查相邻特殊糖果组合（两个特殊糖果交换总是合法的）
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const candy = this.board[r][c];
                if (!candy || !candy.special) continue;
                if (c < BOARD_SIZE - 1 && this.board[r][c+1] && this.board[r][c+1].special) return true;
                if (r < BOARD_SIZE - 1 && this.board[r+1][c] && this.board[r+1][c].special) return true;
            }
        }
        return false;
    }

    swapData(r1, c1, r2, c2) {
        const temp = this.board[r1][c1];
        this.board[r1][c1] = this.board[r2][c2];
        this.board[r2][c2] = temp;
    }

    shuffleBoard() {
        const candies = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c]) candies.push(this.board[r][c]);
            }
        }
        // 循环洗牌直到有解且无预存匹配（上限10次）
        for (let attempt = 0; attempt < 10; attempt++) {
            for (let i = candies.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [candies[i], candies[j]] = [candies[j], candies[i]];
            }
            let idx = 0;
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    this.board[r][c] = candies[idx++];
                    if (this.board[r][c]) {
                        this.board[r][c].row = r;
                        this.board[r][c].col = c;
                    }
                }
            }
            if (this.findAllMatches().length === 0 && this.hasValidMoves()) break;
        }
        this.renderBoard();
    }

    // ===== 关卡完成 =====
    levelComplete() {
        this.clearSave();
        const bonus = this.moves * 50;
        const starsEarned = this.level * 5;
        this.score += bonus;
        this.saveBestRecord();
        this.stars += starsEarned;
        safeSet('candyMatch_stars', this.stars);
        this.checkAchievements();
        document.getElementById('final-score').textContent = this.score;
        document.getElementById('bonus-score').textContent = bonus;
        const starsEl = document.getElementById('stars-earned');
        if (starsEl) starsEl.textContent = starsEarned;
        document.getElementById('level-complete').classList.remove('hidden');
        this.audio.play('win');
        this.state = GameState.GAME_OVER;
    }

    // ===== 游戏结束 =====
    gameOver() {
        this.clearSave();
        this.saveBestRecord();
        this.checkAchievements();
        document.getElementById('game-over-score').textContent = this.score;
        document.getElementById('game-over-level').textContent = this.level;
        document.getElementById('game-over').classList.remove('hidden');
        this.audio.play('lose');
        this.state = GameState.GAME_OVER;
    }

    // ===== 每日挑战模式 =====
    startDailyChallenge() {
        // 已完成今日挑战则不允许重复刷星
        if (this.dailyChallengeDone) {
            this.showToast('今日挑战已完成，明天再来吧！', '📅');
            return;
        }
        this.gameMode = 'daily';
        this.score = 0;
        this.level = 1;
        this.targetScore = 999999;
        this.moves = 999;
        this.comboCount = 0;
        this.maxCombo = 0;
        this.objective = null;
        this.dailyTimeLeft = 30;
        document.getElementById('start-screen').classList.add('hidden');
        if (!game) {
            game = new CandyGame();
            game.gameMode = 'daily';
        }
        this.generateBoard();
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
        this.recordGameStart();

        this.updateHUD();
        if (this.dailyTimer) clearInterval(this.dailyTimer);
            this.dailyTimer = setInterval(() => {
                this.dailyTimeLeft--;
                this.updateHUD();
                if (this.dailyTimeLeft <= 0) { clearInterval(this.dailyTimer); this.dailyTimer = null; this.dailyChallengeEnd(); }
            }, 1000);
    }

    dailyChallengeEnd() {
        this.gameEpoch++;
        this.state = GameState.GAME_OVER;
        this.gameMode = 'classic';
        this.isDailyEnd = true; // 显式标志
        this.dailyChallengeDone = true;
        safeSet('candyMatch_dailyDone', new Date().toDateString());
        this.saveBestRecord();
        this.stars += Math.floor(this.score / 100);
        safeSet('candyMatch_stars', this.stars);
        this.checkAchievements();

        const today = new Date().toDateString();
        const bestKey = 'candyMatch_dailyBest_' + today;
        const prevBest = parseInt(safeGet(bestKey, 0)) || 0;
        if (this.score > prevBest) {
            safeSet(bestKey, this.score);
        }
        document.getElementById('final-score').textContent = this.score;
        document.getElementById('bonus-score').textContent = Math.floor(this.score / 100);
        document.getElementById('level-complete').classList.remove('hidden');
        document.querySelector('#level-complete h1').textContent = '⏱ 挑战结束！';
        this.audio.play('win');
    }

    // ===== 下一关 =====
    nextLevel() {
        this.gameEpoch++;
        this.level++;
        this.targetScore = 1000 + (this.level - 1) * 600;
        this.moves = 30 + Math.min((this.level - 1) * 2, 12);
        this.comboCount = 0;
        this.maxCombo = 0;
        this.setupLevelObjective(this.level);
        this.adMoveBoostsUsed = 0;
        this.reviveUsed = false;
        document.getElementById('revive-ad-btn').style.display = '';
        document.getElementById('level-complete').classList.add('hidden');
        // 恢复通关标题（每日挑战结束会改写此标题）
        document.querySelector('#level-complete h1').textContent = '🎉 通关！';
        this.generateBoard();
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
        this.showLevelBanner(this.level);
        if (this.objective) {
            this.showToast('🎯 本关目标：收集指定糖果！', '🎯');
        }
        this.saveGame();
    }

    showLevelBanner(level) {
        const banner = document.createElement('div');
        banner.className = 'level-banner';
        banner.textContent = `关卡 ${level}`;
        document.getElementById('game-container').appendChild(banner);
        setTimeout(() => banner.classList.add('show'), 50);
        setTimeout(() => { banner.classList.remove('show'); setTimeout(() => banner.remove(), 400); }, 1500);
    }

    // ===== 重新开始 =====
    restart() {
        this.gameEpoch++;
        this.gameMode = 'classic';
        if (this.dailyTimer) { clearInterval(this.dailyTimer); this.dailyTimer = null; }
        this.adMoveBoostsUsed = 0;
        this.reviveUsed = false;
        document.getElementById('revive-ad-btn').style.display = '';
        this.level = 1;
        this.score = 0;
        this.targetScore = 1000;
        this.moves = 30;
        this.comboCount = 0;
        this.maxCombo = 0;
        this.setupLevelObjective(1);
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('level-complete').classList.add('hidden');
        // 恢复通关标题（每日挑战结束会改写此标题）
        document.querySelector('#level-complete h1').textContent = '🎉 通关！';
        this.clearSave();
        this.generateBoard();
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
        this.recordGameStart();
    }

    // ===== HUD更新 =====
    updateHUD() {
        const scoreEl = document.getElementById('score-display');
        const movesEl = document.getElementById('moves-display');
        const levelEl = document.getElementById('level-display');
        const progressContainer = document.getElementById('progress-bar-container');

        const oldScore = parseInt(scoreEl.textContent);
        scoreEl.textContent = this.score;
        if (this.score > oldScore) {
            scoreEl.classList.add('pulse');
            setTimeout(() => scoreEl.classList.remove('pulse'), 400);
        }

        // 每日挑战模式：隐藏步数和进度条，显示计时器
        if (this.gameMode === 'daily') {
            movesEl.parentElement.style.display = 'none';
            if (progressContainer) progressContainer.style.display = 'none';
            levelEl.parentElement.querySelector('.hud-label').textContent = '⏱';
            levelEl.textContent = this.dailyTimeLeft + 's';
            levelEl.style.color = this.dailyTimeLeft <= 5 ? '#ff6b6b' : '#ffd700';
        } else {
            movesEl.parentElement.style.display = '';
            if (progressContainer) progressContainer.style.display = '';
            levelEl.parentElement.querySelector('.hud-label').textContent = '关卡';
            levelEl.style.color = '#fff';
            movesEl.textContent = this.moves;
            if (this.moves <= 5) {
                movesEl.style.color = '#ff6b6b';
            } else {
                movesEl.style.color = '#fff';
            }
            levelEl.textContent = this.level;
            let progress, text;
            if (this.objective) {
                const emojis = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
                text = Object.keys(this.objective.targets).map(color =>
                    `${emojis[color] || '🎯'} ${this.objective.collected[color]}/${this.objective.targets[color]}`
                ).join('  ');
                progress = 100 * this.objectiveTotalCollected() / this.objectiveTotalNeeded();
            } else {
                text = `${this.score} / ${this.targetScore}`;
                progress = Math.min(100, (this.score / this.targetScore) * 100);
            }
            document.getElementById('progress-bar').style.width = Math.min(100, progress) + '%';
            document.getElementById('progress-text').textContent = text;
        }

        // 星星货币
        this.updateStarDisplay();
    }

    // ===== 激励广告 =====
    watchAdForMoves() {
        // 每局限2次
        this.adMoveBoostsUsed = this.adMoveBoostsUsed || 0;
        if (this.adMoveBoostsUsed >= AD_CONFIG.moveBoostPerLevel) {
            this.showToast('本局限次已用完');
            return;
        }
        this.showRewardedAd(() => {
            this.adMoveBoostsUsed++;
            this.moves += AD_CONFIG.moveBoostAmount;
            this.updateHUD();
            this.showToast(`+${AD_CONFIG.moveBoostAmount}步！`, '📺');
        });
    }

    watchAdForStars() {
        const today = new Date().toDateString();
        const key = 'candyMatch_adStars_' + today;
        const used = parseInt(safeGet(key, 0)) || 0;
        if (used >= AD_CONFIG.dailyBonusLimit) {
            this.showToast('今日广告奖励已领完', '📺');
            return;
        }
        this.showRewardedAd(() => {
            safeSet(key, used + 1);
            this.stars += AD_CONFIG.dailyBonusStars;
            safeSet('candyMatch_stars', this.stars);
            this.updateStarDisplay();
            this.showToast(`+${AD_CONFIG.dailyBonusStars}⭐！`, '📺');
        });
    }

    watchAdToRevive() {
        if (this.reviveUsed) {
            this.showToast('本局已复活过');
            return;
        }
        this.reviveUsed = true;
        document.getElementById('revive-ad-btn').style.display = 'none';
        this.showRewardedAd(() => {
            this.moves = AD_CONFIG.reviveMoves;
            this.state = GameState.IDLE;
            document.getElementById('game-over').classList.add('hidden');
            this.updateHUD();
            this.showToast(`复活！+${AD_CONFIG.reviveMoves}步`, '📺');
        });
    }

    showRewardedAd(onReward) {
        this.showAdLoading();
        const provider = getAdProvider();
        provider.showRewardedAd(
            () => { this.hideAdLoading(); onReward(); },
            () => { this.hideAdLoading(); this.showToast('广告加载失败，请稍后再试', '⚠️'); }
        );
    }

    showAdLoading() {
        this.isPaused = true;
    }

    hideAdLoading() {
        this.isPaused = false;
    }

    // ===== 道具系统 =====
    useItem(item) {
        if (this.state !== GameState.IDLE || this.isProcessing || this.isPaused) return;
        // 再次点击锤子取消模式
        if (item === 'hammer' && this.hammerMode) {
            this.hammerMode = false;
            this.boardEl.style.cursor = '';
            this.showToast('已取消锤子模式');
            return;
        }
        const cost = { 'extra-moves': 30, 'hammer': 50, 'shuffle': 20 };
        if (this.stars < cost[item]) {
            this.showToast(`⭐不足！需要${cost[item]}⭐`);
            return;
        }
        this.stars -= cost[item];
        safeSet('candyMatch_stars', this.stars);

        if (item === 'extra-moves') {
            this.moves += 3;
            this.updateHUD();
            this.showToast('道具：+3步！');
        } else if (item === 'hammer') {
            this.hammerMode = true;
            this.boardEl.style.cursor = 'crosshair';
            this.showToast('道具：锤子！点击要敲除的糖果');
        } else if (item === 'shuffle') {
            this.shuffleBoard();
            this.showToast('道具：洗牌！');
        }
        this.updateStarDisplay();
    }

    async hammerRemove(row, col) {
        if (!this.hammerMode) return;
        this.hammerMode = false;
        this.boardEl.style.cursor = '';
        this.isProcessing = true;
        const candy = this.board[row][col];
        if (candy) {
            const toRemove = new Set([`${row},${col}`]);
            // 如果是特殊糖果，触发其效果
            if (candy.special) {
                const extra = this.activateSpecialsInMatch(toRemove, []);
                for (const k of extra) toRemove.add(k);
            }
            await this.removeCandies(toRemove);
            await this.dropAndFill();
        }
        this.checkGameState();
        this.isProcessing = false;
        this.state = GameState.IDLE;
        this.noteActivity();
        this.saveGame();
    }

    showToast(msg, icon = '道具', duration = 2000) {
        const toast = document.createElement('div');
        toast.className = 'achievement-toast';
        toast.innerHTML = `<span class="ach-icon">${icon}</span><div><div class="ach-name">${msg}</div></div>`;
        document.getElementById('game-container').appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, duration);
    }

    updateStarDisplay() {
        const el = document.getElementById('star-count');
        if (el) el.textContent = this.stars;
    }

    // ===== 工具方法 =====
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================
//  广告系统 — AdProvider 抽象层
//  当前使用 MockProvider（模拟5秒激励视频）。
//  接入真实广告时，实现 RealAdProvider 的 load()/show() 并在
//  AD_CONFIG.provider 中切换即可，游戏逻辑无需改动。
// ============================================================
const AD_CONFIG = {
    provider: 'gd',             // 'mock' | 'gd' (GameDistribution推荐) | 'real' (Google)
    enabled: true,              // 总开关：真实广告接入后改为 true 显示入口
    real: {
        // Google AdSense H5 Games Ads 官方协议（developers.google.com/admob/h5-games-ads）
        // 申请通过后：1) 填入 gameId 和 placementId  2) provider 改 'real'  3) enabled 改 true
        sdkUrl: 'https://googleads.g.doubleclick.net/tag/ads_h5_games.js',
        gameId: '',                 // AdSense 后台的 Game ID
        rewardedPlacementId: ''     // 激励视频 Placement ID
    },
    gd: {
        // GameDistribution（gamedistribution.com）：提交游戏通过审核后获得 gameId
        // 零门槛：无需版号/资质，45%分成，Net30 PayPal/USDT 结算
        // 接入：1) gamedistribution.com 注册开发者  2) 提交游戏过审  3) 填 gameId
        //      4) provider 改 'gd'  5) enabled 改 true
        gameId: '403d34ba8e3a4e178c7049699a770f7d'
    },
    dailyBonusStars: 20,
    dailyBonusLimit: 1,
    moveBoostAmount: 5,
    moveBoostPerLevel: 2,
    reviveMoves: 10
};

class MockAdProvider {
    showRewardedAd(onReward, onFail, onStateChange) {
        if (onStateChange) onStateChange('loading');
        const overlay = document.createElement('div');
        overlay.className = 'ad-overlay';
        overlay.innerHTML = `<div class="ad-box"><div class="ad-label">模拟广告</div><div class="ad-countdown">5</div><div class="ad-tip">接入真实广告SDK后此处播放激励视频</div></div>`;
        document.getElementById('game-container').appendChild(overlay);
        let left = 5;
        const timer = setInterval(() => {
            left--;
            const cd = overlay.querySelector('.ad-countdown');
            if (cd) cd.textContent = left;
            if (left <= 0) {
                clearInterval(timer);
                overlay.remove();
                if (onStateChange) onStateChange('closed');
                onReward();
            }
        }, 1000);
    }
}

class RealAdProvider {
    constructor(config) { this.config = config.real; this.sdkReady = false; }

    loadSdk(onReady, onFail) {
        if (this.sdkReady) { onReady(); return; }
        if (!this.config.sdkUrl) { onFail(); return; }
        if (window.h5gamesAds) { this.sdkReady = true; onReady(); return; }
        const s = document.createElement('script');
        s.src = this.config.sdkUrl;
        s.async = true;
        s.onload = () => {
            // Google H5 Games Ads 标准初始化协议
            if (window.h5gamesAds && window.h5gamesAds.init) {
                window.h5gamesAds.init(this.config.gameId)
                    .then(() => { this.sdkReady = true; onReady(); })
                    .catch(() => onFail());
            } else {
                this.sdkReady = true; onReady();
            }
        };
        s.onerror = () => onFail();
        document.head.appendChild(s);
    }

    showRewardedAd(onReward, onFail) {
        this.loadSdk(() => {
            // 官方协议: h5gamesAds.showAd(placementId) 返回 Promise<{hasReward}>
            if (window.h5gamesAds && window.h5gamesAds.showAd) {
                window.h5gamesAds.showAd(this.config.rewardedPlacementId)
                    .then(result => {
                        if (result && result.hasReward) onReward();
                        else onFail();
                    })
                    .catch(() => onFail());
            } else {
                onFail();
            }
        }, onFail);
    }
}

// ============================================================
//  GameDistribution Provider（推荐零门槛变现路径）
//  提交游戏到 gamedistribution.com 后获得 gameId，填入 AD_CONFIG.gd.gameId
//  协议: window.GD_OPTIONS 必须在 SDK script 之前定义
//  激励广告: gdsdk.preloadAd('rewarded') + showAd('rewarded')
//  奖励发放: SDK_REWARDED_WATCH_COMPLETE 事件
// ============================================================
class GameDistributionProvider {
    constructor(config) {
        this.config = config.gd;
        this.sdkReady = false;
        this._rewardGranted = false;
        this._pendingReward = null;
        this._pendingFail = null;
    }

    _initSdk(onReady, onFail) {
        if (this.sdkReady) { onReady(); return; }
        if (!this.config.gameId) { onFail(); return; }
        if (window.gdsdk) { this.sdkReady = true; onReady(); return; }

        const self = this;
        // GD_OPTIONS 必须在 SDK 加载前定义
        window.GD_OPTIONS = {
            gameId: this.config.gameId,
            onEvent(event) {
                switch (event.name) {
                    case 'SDK_READY':
                        self.sdkReady = true;
                        onReady();
                        break;
                    case 'SDK_GAME_PAUSE':
                        // 广告开始
                        break;
                    case 'SDK_REWARDED_WATCH_COMPLETE':
                        // 完整看完激励广告 → 标记发奖
                        self._rewardGranted = true;
                        break;
                    case 'SDK_GAME_START':
                        // 广告结束 → 恢复游戏并结算奖励
                        if (self._pendingReward && self._rewardGranted) {
                            self._pendingReward();
                        } else if (self._pendingFail) {
                            self._pendingFail();
                        }
                        self._rewardGranted = false;
                        self._pendingReward = null;
                        self._pendingFail = null;
                        // 预加载下一次激励广告
                        if (window.gdsdk && window.gdsdk.preloadAd) {
                            try { window.gdsdk.preloadAd('rewarded'); } catch (e) {}
                        }
                        break;
                    default:
                        break;
                }
            }
        };

        const s = document.createElement('script');
        s.src = 'https://html5.api.gamedistribution.com/main.min.js';
        s.async = true;
        s.onerror = () => onFail();
        document.head.appendChild(s);
        // SDK加载超时保护（15秒）
        setTimeout(() => { if (!this.sdkReady) onFail(); }, 15000);
    }

    showRewardedAd(onReward, onFail) {
        this._initSdk(() => {
            if (!window.gdsdk || !window.gdsdk.showAd) { onFail(); return; }
            this._pendingReward = onReward;
            this._pendingFail = onFail;
            this._rewardGranted = false;
            // 先预加载激励广告（幂等）
            try { if (window.gdsdk.preloadAd) window.gdsdk.preloadAd('rewarded'); } catch (e) {}
            window.gdsdk.showAd('rewarded').catch(() => {
                // 无法填充广告（网络/库存原因）
                this._pendingReward = null;
                this._pendingFail = null;
                onFail();
            });
        }, onFail);
    }
}

function getAdProvider() {
    if (AD_CONFIG.provider === 'gd') return new GameDistributionProvider(AD_CONFIG);
    if (AD_CONFIG.provider === 'real') return new RealAdProvider(AD_CONFIG);
    return new MockAdProvider();
}

// ===== 音效系统 (Web Audio API) =====
class GameAudio {
    constructor() {
        this.ctx = null;
        this.enabled = safeGet('candyMatch_sound', 'on') !== 'off';
        this.musicEnabled = safeGet('candyMatch_music', 'on') !== 'off';
        this.bgmTimer = null;
        this.bgmStep = 0;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // ===== 背景音乐（Web Audio 生成柔和循环琶音） =====
    startBgm() {
        if (!this.musicEnabled || this.bgmTimer) return;
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3]; // C大调五声扩展
        const pattern = [0, 2, 4, 7, 4, 2, 5, 2];
        this.bgmStep = 0;
        this.bgmTimer = setInterval(() => {
            if (!this.ctx || this.ctx.state !== 'running') return;
            const now = this.ctx.currentTime;
            const idx = pattern[this.bgmStep % pattern.length];
            const freq = scale[idx] / 2; // 低八度，更柔和
            this._bgmNote(freq, now, 0.9, 0.045, 'triangle');
            if (this.bgmStep % 8 === 0) this._bgmNote(freq / 2, now, 1.6, 0.05, 'sine');
            if (this.bgmStep % 4 === 2) this._bgmNote(scale[(idx + 2) % scale.length], now + 0.15, 0.5, 0.03, 'sine');
            this.bgmStep++;
        }, 420);
    }

    _bgmNote(freq, when, dur, vol, type) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, when);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(vol, when + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(when);
        osc.stop(when + dur + 0.05);
    }

    stopBgm() {
        if (this.bgmTimer) {
            clearInterval(this.bgmTimer);
            this.bgmTimer = null;
        }
    }

    play(type) {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const ctx = this.ctx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        switch (type) {
            case 'select':
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
            case 'swap':
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(700, now + 0.1);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            case 'invalid':
                osc.type = 'square';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.linearRampToValueAtTime(100, now + 0.15);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            case 'match':
                this.playMatchSound(now);
                break;
            case 'combo':
                this.playComboSound(now);
                break;
            case 'special':
                this.playSpecialSound(now);
                break;
            case 'win':
                this.playWinSound(now);
                break;
            case 'lose':
                this.playLoseSound(now);
                break;
        }
    }

    playMatchSound(now) {
        const notes = [523, 659, 784];
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(freq, now + i * 0.05);
            gain.gain.setValueAtTime(0.15, now + i * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.15);
            osc.start(now + i * 0.05);
            osc.stop(now + i * 0.05 + 0.15);
        });
    }

    playComboSound(now) {
        const baseFreq = 440 + this.randomInt(0, 200);
        for (let i = 0; i < 4; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(baseFreq + i * 100, now + i * 0.03);
            gain.gain.setValueAtTime(0.12, now + i * 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.03 + 0.1);
            osc.start(now + i * 0.03);
            osc.stop(now + i * 0.03 + 0.1);
        }
    }

    playSpecialSound(now) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, now);
        filter.frequency.exponentialRampToValueAtTime(200, now + 0.5);

        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
    }

    playWinSound(now) {
        const melody = [523, 659, 784, 1047];
        melody.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.frequency.setValueAtTime(freq, now + i * 0.12);
            gain.gain.setValueAtTime(0.2, now + i * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
            osc.start(now + i * 0.12);
            osc.stop(now + i * 0.12 + 0.3);
        });
    }

    playLoseSound(now) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.6);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.start(now);
        osc.stop(now + 0.7);
    }

    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

// ===== 启动游戏 =====
var game;

// 用户手势后启动背景音乐（浏览器自动播放策略要求）
function startBgmOnGesture() {
    if (game && game.audio.musicEnabled) game.audio.startBgm();
}

// 音效开关（HUD按钮与设置面板共用）
function setSoundEnabled(on) {
    safeSet('candyMatch_sound', on ? 'on' : 'off');
    document.getElementById('sound-icon').textContent = on ? '🔊' : '🔇';
    if (game) game.audio.enabled = on;
}

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-screen').classList.add('hidden');
    if (!game) {
        game = new CandyGame();
        game.recordGameStart();
    } else {
        game.showBestRecord();
    }
    startBgmOnGesture();
});

// 继续游戏（恢复中途存档）
document.getElementById('continue-btn').addEventListener('click', () => {
    const data = safeGetJSON('candyMatch_save', null);
    if (!data) return;
    document.getElementById('start-screen').classList.add('hidden');
    if (!game) game = new CandyGame();
    game.restoreFromSave(data);
    game.showToast('已恢复上局进度', '▶');
    startBgmOnGesture();
});

document.getElementById('next-level-btn').addEventListener('click', () => {
    if (!game) return;
    if (game.isDailyEnd) {
        game.isDailyEnd = false;
        game.restart();
        document.getElementById('start-screen').classList.remove('hidden');
        return;
    }
    game.nextLevel();
});

document.getElementById('restart-btn').addEventListener('click', () => {
    if (game) game.restart();
});

// 暂停/恢复
document.getElementById('pause-btn').addEventListener('click', () => {
    if (game) game.pause();
});

document.getElementById('resume-btn').addEventListener('click', () => {
    if (game) game.resume();
});

document.getElementById('restart-from-pause-btn').addEventListener('click', () => {
    if (game) {
        game.resume();
        game.restart();
    }
});

// 每日挑战

document.getElementById('daily-btn').addEventListener('click', () => {

    document.getElementById('start-screen').classList.add('hidden');

    if (!game) { game = new CandyGame(); }

    game.startDailyChallenge();

    startBgmOnGesture();

});


// 返回主菜单

document.getElementById('back-to-menu-btn').addEventListener('click', () => {

    if (game) {

        game.resume();

        game.restart();

        document.getElementById('start-screen').classList.remove('hidden');

    }

});


// 成就面板

document.getElementById('achievements-btn').addEventListener('click', () => {

    const ach = ACHIEVEMENTS;

    const unlocked = game ? game.unlockedAchievements : safeGetJSON('candyMatch_achievements', []);

    const list = document.getElementById('ach-list');

    list.innerHTML = ach.map(a => {

        const isUnlocked = unlocked.includes(a.id);

        return `<div class="ach-item ${isUnlocked ? 'unlocked' : 'locked'}">

            <span class="ach-item-name">${isUnlocked ? a.name : '🔒 ' + a.name}</span>

            <span class="ach-item-desc">${a.desc}</span>

        </div>`;

    }).join('');

    document.getElementById('achievements-panel').classList.remove('hidden');

});


document.getElementById('ach-close-btn').addEventListener('click', () => {

    document.getElementById('achievements-panel').classList.add('hidden');

});

// 道具按钮
document.getElementById('item-extra-moves').addEventListener('click', () => { if (game) game.useItem('extra-moves'); });
document.getElementById('item-hammer').addEventListener('click', () => { if (game) game.useItem('hammer'); });
document.getElementById('item-shuffle').addEventListener('click', () => { if (game) game.useItem('shuffle'); });
document.getElementById('item-ad-moves').addEventListener('click', () => { if (game) game.watchAdForMoves(); });
document.getElementById('revive-ad-btn').addEventListener('click', () => { if (game) game.watchAdToRevive(); });

// 音效开关
document.getElementById('sound-btn').addEventListener('click', () => {
    var on = safeGet('candyMatch_sound', 'on') !== 'off';
    setSoundEnabled(!on);
});

// ===== 统计面板 =====
document.getElementById('stats-btn').addEventListener('click', () => {
    const stats = game ? game.stats : (safeGetJSON('candyMatch_stats', null) || {});
    const games = stats.games || 0;
    const cleared = stats.cleared || 0;
    const bestCombo = stats.bestCombo || 0;
    const specials = parseInt(safeGet('candyMatch_totalSpecials', 0)) || 0;
    const bestScore = parseInt(safeGet('candyMatch_bestScore', 0)) || 0;
    const sec = stats.seconds || 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const timeText = h > 0 ? `${h}时${m}分` : (m > 0 ? `${m}分${s}秒` : `${s}秒`);
    document.getElementById('stat-games').textContent = games;
    document.getElementById('stat-cleared').textContent = cleared;
    document.getElementById('stat-bestcombo').textContent = bestCombo;
    document.getElementById('stat-specials').textContent = specials;
    document.getElementById('stat-time').textContent = timeText;
    document.getElementById('stat-best-score').textContent = bestScore;
    document.getElementById('stats-panel').classList.remove('hidden');
});

document.getElementById('stats-close-btn').addEventListener('click', () => {
    document.getElementById('stats-panel').classList.add('hidden');
});

// ===== 设置面板 =====
function syncSettingsUI() {
    var musicOn = safeGet('candyMatch_music', 'on') !== 'off';
    var soundOn = safeGet('candyMatch_sound', 'on') !== 'off';
    var vibOn = safeGet('candyMatch_vibration', 'on') !== 'off';
    var musicBtn = document.getElementById('music-toggle');
    var soundBtn = document.getElementById('sound-toggle');
    var vibBtn = document.getElementById('vibration-toggle');
    musicBtn.textContent = '🎵 背景音乐：' + (musicOn ? '开' : '关');
    musicBtn.classList.toggle('off', !musicOn);
    soundBtn.textContent = '🔊 音效：' + (soundOn ? '开' : '关');
    soundBtn.classList.toggle('off', !soundOn);
    vibBtn.textContent = '📳 震动：' + (vibOn ? '开' : '关');
    vibBtn.classList.toggle('off', !vibOn);
}

function openSettings() {
    syncSettingsUI();
    document.getElementById('settings-panel').classList.remove('hidden');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-pause-btn').addEventListener('click', openSettings);

document.getElementById('settings-close-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden');
});

document.getElementById('music-toggle').addEventListener('click', () => {
    var on = safeGet('candyMatch_music', 'on') !== 'off';
    safeSet('candyMatch_music', on ? 'off' : 'on');
    if (game) {
        game.audio.musicEnabled = !on;
        if (!on) {
            game.audio.startBgm();
        } else {
            game.audio.stopBgm();
        }
    }
    syncSettingsUI();
});

document.getElementById('sound-toggle').addEventListener('click', () => {
    var on = safeGet('candyMatch_sound', 'on') !== 'off';
    setSoundEnabled(!on);
    syncSettingsUI();
});

document.getElementById('vibration-toggle').addEventListener('click', () => {
    var on = safeGet('candyMatch_vibration', 'on') !== 'off';
    safeSet('candyMatch_vibration', on ? 'off' : 'on');
    if (game) game.vibrationEnabled = !on;
    syncSettingsUI();
});

// 页面加载时恢复音效设置
(function() {
    var soundPref = safeGet('candyMatch_sound', 'on');
    if (soundPref === 'off') {
        document.getElementById('sound-icon').textContent = '🔇';
    }
    // 显示历史最佳记录
    var bestScore = parseInt(safeGet('candyMatch_bestScore', 0)) || 0;
    var bestLevel = parseInt(safeGet('candyMatch_bestLevel', 1)) || 1;
    if (bestScore > 0 || bestLevel > 1) {
        document.getElementById('best-record').classList.remove('hidden');
        document.getElementById('best-score-val').textContent = bestScore;
        document.getElementById('best-level-val').textContent = bestLevel;
    }
    // 显示星星货币
    var stars = parseInt(safeGet('candyMatch_stars', 0)) || 0;
    var starEl = document.getElementById('star-count');
    if (starEl) starEl.textContent = stars;

    // 每日挑战状态
    var dailyDone = safeGet('candyMatch_dailyDone', '') === new Date().toDateString();
    var dailyBtn = document.getElementById('daily-btn');
    if (dailyDone && dailyBtn) {
        var today = new Date().toDateString();
        var bestKey = 'candyMatch_dailyBest_' + today;
        var best = parseInt(safeGet(bestKey, 0)) || 0;
        dailyBtn.textContent = '✓ 今日最佳 ' + best;
        dailyBtn.disabled = true;
        dailyBtn.style.opacity = '0.5';
    }

    // 中途存档：显示继续按钮
    if (CandyGame.hasSave()) {
        var contBtn = document.getElementById('continue-btn');
        if (contBtn) contBtn.classList.remove('hidden');
    }

    // PWA Service Worker（仅 http/https 环境注册）
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        navigator.serviceWorker.register('sw.js').catch(function() {});
    }

    // 广告总开关：未接入真实广告时隐藏入口
    if (!AD_CONFIG.enabled) {
        var adMoveBtn = document.getElementById('item-ad-moves');
        if (adMoveBtn) adMoveBtn.style.display = 'none';
        var reviveBtn = document.getElementById('revive-ad-btn');
        if (reviveBtn) reviveBtn.style.display = 'none';
    }
})();
