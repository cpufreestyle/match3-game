# GameDistribution 提交指引

## 提交包
gd_package.zip（index.html 在根目录 ✓，110KB，符合 ≤50MB 限制）

## 提交步骤（约15分钟）
1. 注册开发者：https://gamedistribution.com/developers → Sign Up（邮箱注册）
2. 后台 → Add Game → 上传 gd_package.zip
3. 填写游戏信息：
   - Title: Candy Match - 糖果消消乐
   - Description: Classic match-3 puzzle game. Swap adjacent candies, match 3+ to clear the board. Special candies (striped, wrapped, color bomb) and combo explosions! Levels, daily challenge, achievements and power-ups.
   - Category: Puzzle
   - Tags: match3, puzzle, candy, casual
   - Controls: Swipe or click/tap to swap adjacent candies
4. 上传封面图（用 tap_assets/icon.png 512x512 和 keyart_16x9_with_title.png）
5. 提交审核 → 通过后获得 gameId → 填入 game.js 的 AD_CONFIG.gd.gameId → provider 切 'gd'、enabled 改 true

## 注意
- SDK 已按官方协议集成（GD_OPTIONS + main.min.js + rewarded 流程）
- 审核要求：完整看一次广告验证SDK实现（本地无法测，需过审后在GD的iframe里测）
- 分成45%，Net30，PayPal/USDT
