# 🍬 糖果消消乐 - Candy Match 3

纯原生 HTML/CSS/JavaScript 三消休闲游戏（零依赖，无框架）。

## 功能
- 经典三消 + 6种特殊糖果组合（十字/大爆炸/全屏）
- 障碍物系统（冰块/果冻）+ 4种关卡目标轮换
- 连胜倍率、关卡地图3星评分、7天签到、每日任务
- 成就系统、记忆碎片剧情（6章）、国风主题皮肤
- GameDistribution 激励广告变现（已接入）

## 在线试玩
https://cpufreestyle.github.io/match3-game/

## 开发
```bash
# 本地打开 index.html 或启动静态服务
python3 -m http.server 8080

# 运行测试（需 Playwright）
python3 full_test.py   # 主回归 22用例
python3 test_p0.py     # 留存功能 24用例
python3 test_p1.py     # 障碍物 33用例
python3 test_p2.py     # 主题+剧情 23用例
```

## 平台发布
- TapTap（审核中）：游戏ID 909116
- GameDistribution：gameId=403d34ba8e3a4e178c7049699a770f7d
- GitHub Pages：main 分支自动部署
