# 怎么贡献一个游戏

谢谢你愿意加一个游戏进来 🌵

## 步骤

### 1. Fork 这个仓库

点右上角 **Fork**，得到你自己名下的一份。

### 2. 复制模板

```bash
cp -r games/_template games/你的游戏名
```

游戏名用**英文小写加短横线**（如 `jump-rope`）。它会成为网址路径，别用中文和空格。

### 3. 写你的游戏

放进 `games/你的游戏名/index.html`。唯一硬性要求：**入口文件名必须是 `index.html`**。

其他随便 —— 任何框架、任何 CDN 都行，只要：
- 是纯前端（没有后端服务）
- 能在一个 `iframe` 里跑起来

### 4. 在清单里加一条

打开 `src/page.html`，找到 `<script type="application/json" id="games-data">`，照着已有条目加：

```json
{
  "id": "jump-rope",
  "zone": "full",
  "name": "跳绳挑战",
  "desc": "一句话说清楚这个游戏玩什么。",
  "tags": [["2 分钟", ""], ["较累", "y"], ["全身动作", "b"]],
  "entry": "games/jump-rope/index.html",
  "cover": "games/jump-rope/cover.png",
  "steps": ["动作一 → 效果一", "动作二 → 效果二"],
  "author": "你的 GitHub ID",
  "repo": "games/jump-rope"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识，英文小写 |
| `zone` | ✅ | `neck`（坐着玩）/ `full`（站着玩） |
| `name` | ✅ | 显示名 |
| `desc` | ✅ | 一句话，别超 30 字 |
| `tags` | | `[文字, 颜色]`，颜色可选 `""` / `"g"` / `"b"` / `"y"` |
| `entry` | ✅ | 入口路径 |
| `cover` | | CSS 类名（`cov-xxx`）或图片路径，两种都行 |
| `steps` | | 「怎么玩」浮层里的操作说明 |
| `author` | ✅ | 你的 GitHub ID |
| `repo` | | 源码目录，默认 `games/你的id` |

### 5. 加封面

**A. 用图片**（推荐）
放一张 `games/你的游戏名/cover.png`，`cover` 填路径即可。
比例建议 **4:3**，尺寸 **800×600** 起步。

**B. 用 CSS 类**
在 `src/page.html` 样式里加 `.cov-你的id{background-image:url("图片地址")}`。

### 6. 本地跑一遍

```bash
python -m http.server 8123
```

打开 `http://127.0.0.1:8123/` 确认：

- [ ] 游戏出现在正确的区里
- [ ] 封面显示正常
- [ ] 点进去能玩
- [ ] 摄像头/麦克风能正常申请（如果用到）
- [ ] 点「返回大厅」能顺利退出

### 7. 提 Pull Request

推送分支，回原仓库点 **New pull request**，说明这是什么游戏、玩起来什么感觉，有截图最好。

---

## 审核标准

| 会合并 | 会拒绝 |
| --- | --- |
| 能正常玩，没有明显 bug | 打不开、白屏、报错 |
| 体感游戏能真的识别动作 | 假体感（其实靠键盘） |
| 操作说明写清楚了 | 进去一脸懵 |
| 手机上也能用 | 手机上完全崩 |
| 内容健康 | 暴力、色情、政治敏感 |

---

## 几个技术提醒

**① 摄像头需要 https**
本地 `localhost` 没问题，部署后必须是 `https://`。

**② 你的游戏跑在 iframe 里**
大厅已加 `allow="camera; microphone; fullscreen; autoplay"`。
还需要别的权限（如陀螺仪）请在 PR 里说明。

**③ 别依赖 `window.top`**
你跑在 iframe 里，`window.top` 是外面的大厅，拿不到也不该拿。

**④ 用完记得释放摄像头**
玩家点「返回大厅」时大厅会卸掉 iframe，但你自己的 `MediaStream` 也应在 `beforeunload` 里 `stop()`，双保险。

**⑤ 加前缀**
CSS 类名和全局变量建议加个前缀（`.jr-`、`window.JR_`），养成习惯。

---

有问题直接开 Issue，不用客气。
