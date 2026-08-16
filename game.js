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

// ===== 主游戏类 =====
class CandyGame {
    constructor() {
        this.board = [];          // 2D array of candy objects
        this.score = 0;
        this.level = 1;
        this.moves = 30;
        this.targetScore = 1000;
        this.state = GameState.IDLE;
        this.selectedCell = null;
        this.comboCount = 0;
        this.isProcessing = false;
        this.isPaused = false;

        // 存档：最高分 / 最高关卡
        this.bestScore = parseInt(localStorage.getItem('candyMatch_bestScore')) || 0;
        this.bestLevel = parseInt(localStorage.getItem('candyMatch_bestLevel')) || 1;

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

        window.addEventListener('resize', () => {
            this.calculateCellSize();
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
            if (this.state !== GameState.IDLE || this.isProcessing || this.isPaused) return;
            const cell = this.getCellFromEvent(e);
            if (!cell) return;

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
        this.boardEl.addEventListener('touchstart', onPointerDown, { passive: false });
        this.boardEl.addEventListener('touchmove', onPointerMove, { passive: false });
        this.boardEl.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            onPointerUp({ target: document.elementFromPoint(touch.clientX, touch.clientY) });
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

        const candy1 = this.board[r1][c1];
        const candy2 = this.board[r2][c2];

        if (!candy1 || !candy2) {
            this.isProcessing = false;
            this.state = GameState.IDLE;
            return;
        }

        // 执行交换动画
        this.audio.play('swap');
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

        this.isProcessing = false;
        this.state = GameState.IDLE;
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
        const matched = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(false));

        // 水平检测
        for (let r = 0; r < BOARD_SIZE; r++) {
            let count = 1;
            for (let c = 1; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c - 1] &&
                    this.board[r][c].type === this.board[r][c - 1].type) {
                    count++;
                } else {
                    if (count >= 3) {
                        const match = {
                            direction: 'h',
                            row: r,
                            startCol: c - count,
                            endCol: c - 1,
                            length: count,
                            type: this.board[r][c - 1].type
                        };
                        matches.push(match);
                        for (let k = match.startCol; k <= match.endCol; k++) {
                            matched[r][k] = true;
                        }
                    }
                    count = 1;
                }
            }
            if (count >= 3) {
                const match = {
                    direction: 'h',
                    row: r,
                    startCol: BOARD_SIZE - count,
                    endCol: BOARD_SIZE - 1,
                    length: count,
                    type: this.board[r][BOARD_SIZE - 1].type
                };
                matches.push(match);
                for (let k = match.startCol; k <= match.endCol; k++) {
                    matched[r][k] = true;
                }
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
                        const match = {
                            direction: 'v',
                            col: c,
                            startRow: r - count,
                            endRow: r - 1,
                            length: count,
                            type: this.board[r - 1][c].type
                        };
                        matches.push(match);
                        for (let k = match.startRow; k <= match.endRow; k++) {
                            matched[k][c] = true;
                        }
                    }
                    count = 1;
                }
            }
            if (count >= 3) {
                const match = {
                    direction: 'v',
                    col: c,
                    startRow: BOARD_SIZE - count,
                    endRow: BOARD_SIZE - 1,
                    length: count,
                    type: this.board[BOARD_SIZE - 1][c].type
                };
                matches.push(match);
                for (let k = match.startRow; k <= match.endRow; k++) {
                    matched[k][c] = true;
                }
            }
        }

        return matches;
    }

    // ===== 处理匹配 - 核心循环 =====
    async processMatches() {
        let iteration = 0;
        while (true) {
            const matches = this.findAllMatches();
            if (matches.length === 0) break;

            this.comboCount++;
            iteration++;

            // 计算分数
            const matchScore = this.calculateScore(matches);
            this.score += matchScore;
            this.updateHUD();

            // 显示combo
            if (this.comboCount >= 2) {
                this.showCombo(this.comboCount);
            }

            // 收集要消除的糖果
            const toRemove = this.collectMatchedCandies(matches);

            // 检查并创建特殊糖果
            const specialCreated = this.checkSpecialCreation(matches);

            // 激活特殊糖果
            const activatedSpecials = this.activateSpecialsInMatch(toRemove, matches);

            // 合并所有要消除的
            const allToRemove = new Set([...toRemove, ...activatedSpecials]);

            // 从specialCreated中移除将要变为特殊糖果的位置
            for (const sp of specialCreated) {
                allToRemove.delete(sp.key);
            }

            // 播放消除动画
            this.audio.play('match');
            await this.removeCandies(allToRemove);

            // 创建特殊糖果
            for (const sp of specialCreated) {
                this.createSpecialAt(sp.row, sp.col, sp.special, sp.type);
            }

            // 下落和填充
            await this.dropAndFill();

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
                                    // L形 - 创建包装糖果
                                    specials.push({ row: r, col: c, special: 'wrapped', type: hm.type, key });
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

    async activateColorBomb(bombCandy, targetType) {
        // 彩色炸弹：消除所有目标类型的糖果
        const toRemove = new Set();
        toRemove.add(`${bombCandy.row},${bombCandy.col}`);

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c] && this.board[r][c].type === targetType) {
                    toRemove.add(`${r},${c}`);
                }
            }
        }

        this.audio.play('special');
        await this.removeCandies(toRemove);
        await this.dropAndFill();
    }

    // ===== 创建特殊糖果 =====
    createSpecialAt(row, col, special, type) {
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

            if (candy.el) {
                candy.el.classList.add('removing');
                this.spawnParticles(candy.el, candy.color);
                elements.push(candy.el);
            }
            this.board[r][c] = null;
        }

        // 显示分数飘字
        if (positions.length > 0) {
            const avgR = positions.reduce((s, p) => s + p.r, 0) / positions.length;
            const avgC = positions.reduce((s, p) => s + p.c, 0) / positions.length;
            const score = positions.length * 60 * this.comboCount;
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
        const x = rect.left - boardRect.left + rect.width / 2;
        const y = rect.top - boardRect.top + rect.height / 2;

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
        const texts = ['', '', 'NICE!', 'GREAT!', 'AMAZING!', 'AWESOME!', 'INCREDIBLE!', 'UNBELIEVABLE!'];
        const text = texts[Math.min(count, texts.length - 1)] || `${count}x COMBO!`;
        this.comboTextEl.textContent = text;
        this.comboTextEl.classList.remove('show');
        void this.comboTextEl.offsetHeight;
        this.comboTextEl.classList.add('show');
        this.audio.play('combo');
    }

    // ===== 暂停/恢复 =====
    pause() {
        if (this.state === GameState.GAME_OVER) return;
        this.isPaused = true;
        this.deselectCell();
        document.getElementById('pause-screen').classList.remove('hidden');
    }

    resume() {
        this.isPaused = false;
        document.getElementById('pause-screen').classList.add('hidden');
    }

    // ===== 音效开关 =====
    toggleSound() {
        this.audio.enabled = !this.audio.enabled;
        localStorage.setItem('candyMatch_sound', this.audio.enabled ? 'on' : 'off');
        document.getElementById('sound-icon').textContent = this.audio.enabled ? '🔊' : '🔇';
    }

    // ===== 存档 =====
    saveBestRecord() {
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('candyMatch_bestScore', this.bestScore);
        }
        if (this.level > this.bestLevel) {
            this.bestLevel = this.level;
            localStorage.setItem('candyMatch_bestLevel', this.bestLevel);
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

    // ===== 游戏状态检查 =====
    checkGameState() {
        if (this.score >= this.targetScore) {
            this.levelComplete();
        } else if (this.moves <= 0) {
            this.gameOver();
        }

        // 检查是否有可移动的步骤
        if (!this.hasValidMoves()) {
            this.shuffleBoard();
        }
    }

    hasValidMoves() {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                // 尝试与右边交换
                if (c < BOARD_SIZE - 1) {
                    this.swapData(r, c, r, c + 1);
                    if (this.findAllMatches().length > 0) {
                        this.swapData(r, c, r, c + 1);
                        return true;
                    }
                    this.swapData(r, c, r, c + 1);
                }
                // 尝试与下面交换
                if (r < BOARD_SIZE - 1) {
                    this.swapData(r, c, r + 1, c);
                    if (this.findAllMatches().length > 0) {
                        this.swapData(r, c, r + 1, c);
                        return true;
                    }
                    this.swapData(r, c, r + 1, c);
                }
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
        // 简单洗牌
        const candies = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.board[r][c]) candies.push(this.board[r][c]);
            }
        }
        // Fisher-Yates洗牌
        for (let i = candies.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candies[i], candies[j]] = [candies[j], candies[i]];
        }
        // 放回棋盘
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
        this.renderBoard();
    }

    // ===== 关卡完成 =====
    levelComplete() {
        const bonus = this.moves * 50;
        this.score += bonus;
        this.saveBestRecord();
        document.getElementById('final-score').textContent = this.score;
        document.getElementById('bonus-score').textContent = bonus;
        document.getElementById('level-complete').classList.remove('hidden');
        this.audio.play('win');
        this.state = GameState.GAME_OVER;
    }

    // ===== 游戏结束 =====
    gameOver() {
        this.saveBestRecord();
        document.getElementById('game-over-score').textContent = this.score;
        document.getElementById('game-over-level').textContent = this.level;
        document.getElementById('game-over').classList.remove('hidden');
        this.audio.play('lose');
        this.state = GameState.GAME_OVER;
    }

    // ===== 下一关 =====
    nextLevel() {
        this.level++;
        this.targetScore = 1000 + (this.level - 1) * 800;
        this.moves = 25 + Math.min(this.level * 2, 15);
        this.comboCount = 0;
        document.getElementById('level-complete').classList.add('hidden');
        this.generateBoard();
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
    }

    // ===== 重新开始 =====
    restart() {
        this.level = 1;
        this.score = 0;
        this.targetScore = 1000;
        this.moves = 30;
        this.comboCount = 0;
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('level-complete').classList.add('hidden');
        this.generateBoard();
        this.renderBoard();
        this.updateHUD();
        this.state = GameState.IDLE;
    }

    // ===== HUD更新 =====
    updateHUD() {
        const scoreEl = document.getElementById('score-display');
        const movesEl = document.getElementById('moves-display');
        const levelEl = document.getElementById('level-display');

        const oldScore = parseInt(scoreEl.textContent);
        scoreEl.textContent = this.score;
        if (this.score > oldScore) {
            scoreEl.classList.add('pulse');
            setTimeout(() => scoreEl.classList.remove('pulse'), 400);
        }

        movesEl.textContent = this.moves;
        if (this.moves <= 5) {
            movesEl.style.color = '#ff6b6b';
        } else {
            movesEl.style.color = '#fff';
        }

        levelEl.textContent = this.level;

        // 进度条
        const progress = Math.min(100, (this.score / this.targetScore) * 100);
        document.getElementById('progress-bar').style.width = progress + '%';
        document.getElementById('progress-text').textContent = `${this.score} / ${this.targetScore}`;
    }

    // ===== 工具方法 =====
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ===== 音效系统 (Web Audio API) =====
class GameAudio {
    constructor() {
        this.ctx = null;
        this.enabled = localStorage.getItem('candyMatch_sound') !== 'off';
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
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

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-screen').classList.add('hidden');
    if (!game) {
        game = new CandyGame();
    } else {
        game.showBestRecord();
    }
});

document.getElementById('next-level-btn').addEventListener('click', () => {
    if (game) game.nextLevel();
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

// 音效开关
document.getElementById('sound-btn').addEventListener('click', () => {
    if (game) {
        game.toggleSound();
    } else {
        // 游戏未开始时也能切换
        var icon = document.getElementById('sound-icon');
        var enabled = icon.textContent === '🔊';
        icon.textContent = enabled ? '🔇' : '🔊';
        localStorage.setItem('candyMatch_sound', enabled ? 'off' : 'on');
    }
});

// 页面加载时恢复音效设置
(function() {
    var soundPref = localStorage.getItem('candyMatch_sound');
    if (soundPref === 'off') {
        document.getElementById('sound-icon').textContent = '🔇';
    }
    // 显示历史最佳记录
    var bestScore = parseInt(localStorage.getItem('candyMatch_bestScore')) || 0;
    var bestLevel = parseInt(localStorage.getItem('candyMatch_bestLevel')) || 1;
    if (bestScore > 0 || bestLevel > 1) {
        document.getElementById('best-record').classList.remove('hidden');
        document.getElementById('best-score-val').textContent = bestScore;
        document.getElementById('best-level-val').textContent = bestLevel;
    }
})();
