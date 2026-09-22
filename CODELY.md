

## Codely Structured Memories

### User

### Feedback
- [2026-08-25 22:39:27] 用户多次要求"提交"时指：推送代码到 GitHub + 提交新版本到 TapTap 审核。两步都需完成。GitHub 推送用 git clone+commit+push（token 在 URL 中），TapTap 提交用 Playwright storage_state 会话走完整提审流程（资质弹窗→继续提审→免责→确定提交→预审→继续提审）。用户会直接给 GitHub PAT token（ghp_ 开头）。

### Project
- [2026-08-17 18:05:14] 本机 (a1-6 Mac) 浏览器自动化环境：browser-use/browser-harness 本地 Chrome 远程调试不可用——macOS TCC 拦截读取 DevToolsActivePort（即使 Chrome 已在 chrome://inspect 允许远程调试、授予终端完全磁盘访问也无解）。可靠替代：Playwright headless=False 的 Chromium（"Google Chrome for Testing"）确实能在用户屏幕弹出窗口，需配 osascript `tell application "System Events" to set frontmost ...` 把窗口带到前台；该 Shell 环境自身 DISPLAY 为空但 osascript 可用。
- [2026-09-02 16:47:13] match3-game 已提交 TapTap（MichaelQiu的工作室，厂商ID 428430）。实际提审游戏 ID 909116（以 TAPTAP_SUBMISSION.md 为准；909050 为早期记录），版本 V-20260817，过审立即发布。登录会话 .playwright-state/taptap_auth.json 可复用。提审流程：编辑页提交→资质弹窗→继续提审→免责→确定提交→预审提示→继续提审。

- [2026-09-19 09:45:20] match3-game 功能进度（全部本地完成，未推送）：v8已推送(1380d4f)+提审。P0留存三件套：连胜系统（stats.streak/bestStreak，倍率1+min(s-1,4)*0.25）、关卡地图+3星（levelStars/unlockedLevel，calcStarRating按剩余步数≥40%三星，startLevel(n)）、7天签到+每日任务（checkin/quests，8任务池抽3）。P2差异化：国风主题（body[data-theme="guofeng"]，传统色朱红/靛青/石绿/藤黄/紫棠/琥珀+月饼环纹，CandyGame.THEMES/applyTheme/toggleTheme，页面加载即应用）、记忆碎片剧情册（fragments，6章STORY_CHAPTERS按3/6/10/15/21/28片解锁，与铜哨叙事衔接）。P1玩法深度：障碍物系统（this.obstacles[r][c]，冰块hp1-2阻挡交换+相邻消除受损，果冻消除糖果时清除，applyObstacleDamage/initObstacles/pickObstacleCells确定性生成）、4种关卡目标（分数/collect收集色/ice破冰/jelly果冻，按level%4轮换）。测试：full_test.py(22)+test_p0.py(24)+test_p2.py(23)+test_p1.py(33)=102用例全通过。SW缓存v11。新增localStorage键：candyMatch_theme/fragments。









### Reference

