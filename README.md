# claude-code

和 Claude 一起做的小项目合集。每个文件夹是一个独立的项目，大多是纯前端网页应用：不需要后端和账号，数据只存在你自己的浏览器里，电脑和 iPhone 上都能用。

## 在线使用

这些应用发布在 GitHub Pages 上，直接点开就能用。iPhone 上用 Safari 打开后，点“分享 → 添加到主屏幕”，用起来就像一个 App。

| 应用 | 地址 | 是什么 | 离线可用 |
| --- | --- | --- | --- |
| 复习本 | [打开](https://cccc65522.github.io/claude-code/) | 导入题库、刷题、错题重练、学习记录 | 是 |
| 格算 | [打开](https://cccc65522.github.io/claude-code/sheet/) | 电子表格，公式引擎自己写的，能导入导出 Excel | 是 |
| 弈 | [打开](https://cccc65522.github.io/claude-code/xiangqi/) | 和电脑下中国象棋，有残局练习 | 是 |
| 方块小镇 | [打开](https://cccc65522.github.io/claude-code/voxel-world/) | 3D 方块世界，挖、放、合成、种地，有生存和创造模式 | 是 |
| 造物 | [打开](https://cccc65522.github.io/claude-code/physics/) | 2D 物理沙盒，画东西、连机关、倒水，还能闯关 | 是 |
| 门道 | [打开](https://cccc65522.github.io/claude-code/logic-lab/) | 数字电路实验台：逻辑门、触发器、自定义芯片、真值表、波形 | 是 |

“离线可用”指打开过一次以后，没有网络也能再打开。

所有应用在同一个网址下，但各自的数据是分开存的，互不影响。数据存在浏览器里，换浏览器或清除网站数据就没了；复习本、格算等有导出功能，重要的数据记得导出备份。

github.io 在国内打不开或很慢时，可以用 [cf-proxy](cf-proxy/) 把整个网站反向代理到自己的域名下，上面所有应用都能通过它访问（地址后面加 `/sheet/`、`/xiangqi/` 等）。

## 所有项目

| 文件夹 | 内容 | 技术 |
| --- | --- | --- |
| [review-app](review-app/) | 复习本 | 原生 JavaScript，IndexedDB |
| [sheet](sheet/) | 格算：电子表格 | 原生 JavaScript，零依赖 |
| [xiangqi](xiangqi/) | 弈：中国象棋 | 原生 JavaScript，零依赖 |
| [voxel-world](voxel-world/) | 方块小镇：3D 方块世界 | React + three.js，Vite |
| [physics](physics/) | 造物：2D 物理沙盒 | 原生 JavaScript，零依赖 |
| [logic-lab](logic-lab/) | 门道：数字电路实验台 | React + TypeScript，Vite |
| [food-site](food-site/) | 禾序食品官网前端（示例品牌和数据） | 单个 HTML 文件 |
| [red-heels-mv](red-heels-mv/) | 《红色高跟鞋》Claude 风格 MV，需要自己选音频文件 | 单个 HTML 文件，canvas |
| [trending-repos](trending-repos/) | 2026 年 10 月 GitHub 热门项目收藏清单 | 文档 |
| [cf-proxy](cf-proxy/) | 网站的 Cloudflare Workers 反向代理 | Cloudflare Worker |

每个项目的文件夹里有自己的 README，写了功能、用法和怎么在本地运行。

## 本地运行和测试

需要 Node.js 22 或更新版本。以门道为例：

```bash
cd logic-lab
npm install
npm run dev        # 开发模式
npm test           # 单元测试
npm run test:e2e   # 浏览器端到端测试（需要 Playwright 的 Chromium）
```

原生 JavaScript 的项目（复习本、格算、弈、造物）不用构建，`npm start` 启动一个本地静态服务器就能打开。

## 发布

`gh-pages` 分支就是线上网站的内容：根目录是复习本，其他应用各占一个子文件夹。原生 JavaScript 的项目复制运行需要的文件（`index.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`）；Vite 项目复制 `npm run build` 生成的 `dist/`。
