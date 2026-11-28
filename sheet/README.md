# 格算：纯前端电子表格

一个能在电脑和 iPhone 上用的电子表格，公式引擎从零写起，不依赖任何第三方库。数据只保存在本机浏览器（IndexedDB）里，可以导入导出 Excel（.xlsx）和 CSV。

第一次打开会载入示例表格：家庭账本（分类汇总、占比、按月统计）、成绩单（排名、等级、查询）和一页跨表公式演示。

## 功能

| 功能 | 说明 |
| --- | --- |
| 公式 | 与 Excel 语法一致：`=SUM(A1:A10)`、`$A$1` 绝对引用、`B:B` 整列、`3:5` 整行、`Sheet2!A1`、`'名字 有空格'!A1:B2`、`{1,2;3,4}` 数组常量、`&` 连接、`%`、比较运算。158 个函数，见下表。 |
| 增量重算 | 改一个单元格只重算受影响的公式。在开发机的 Chromium 里，8 万个单元格（其中 2 万个是首尾相连的累计公式）改动第一个值后重算约 50 毫秒。 |
| 循环引用 | 公式直接或间接引用自己时显示 `#CIRC!`，断开循环后自动恢复；循环“下游”的公式照常计算（可以用 `IFERROR` 接住）。 |
| 编辑公式 | 输入公式时**点击或拖选单元格插入引用**（也可以用方向键指向），引用在编辑栏里着色，在表格上画出同色框；函数名自动补全；参数提示高亮当前参数；`F4` 切换 `$`；回车时自动补上缺的右括号；中文输入法直接在单元格里输入。 |
| 引用改写 | 复制粘贴、填充时相对引用自动平移；插入/删除行列、剪切粘贴时，**整个工作簿里**指向它们的公式都会改写，被删掉的引用变成 `#REF!`；重命名工作表时公式里的表名跟着改。 |
| 填充柄 | 拖动选区右下角：数字等差序列、日期逐日递增、“周一…周日”“一月…十二月”“第1组”这类文字序列、公式按相对引用复制。 |
| 格式 | 数字格式（千分位、货币、百分比、日期、时间、科学计数、自定义 Excel 格式代码如 `"¥"#,##0.00;[Red]-"¥"#,##0.00`）、加粗/倾斜/下划线/删除线、文字颜色、填充色、对齐、自动换行、列宽行高（拖动或双击自动列宽）。输入 `12%`、`2026-11-08`、`¥1,200` 会自动识别成数字并带上格式。 |
| 其他 | 撤销/重做（所有操作）、排序（自动识别标题行）、查找替换（跨工作表，可搜公式）、自动求和、多工作表（新建、重命名、复制、移动、删除）、名称框跳转、状态栏求和/平均/计数、深色模式。 |
| 导入导出 | 打开 `.xlsx` / `.csv` / `.json`（也可以把文件拖进窗口）；导出 `.xlsx`（标准 Office Open XML，保留公式、计算结果、数字格式、字体、填充、对齐、列宽行高）、当前工作表 CSV（带 BOM，Excel 打开中文不乱码）、格算自己的 `.json`。GBK 编码的 CSV 也能识别。 |
| iPhone | 点一下选中、再点一下在编辑栏里编辑；编辑时键盘上方有 `= ( ) , : $ + − × ÷ & "` 和 fx 函数按钮；输入公式时点单元格就能插入引用；长按弹出菜单；拖动右下角圆点扩展选区；安全区留白；可以“添加到主屏幕”离线使用。 |

### 支持的函数

| 类别 | 个数 | 函数 |
| --- | --- | --- |
| 数学 | 42 | ABS ACOS ASIN ATAN ATAN2 CEILING COMBIN COS DEGREES EVEN EXP FACT FLOOR GCD INT LCM LN LOG LOG10 MOD MROUND ODD PI POWER PRODUCT QUOTIENT RADIANS RAND RANDBETWEEN ROUND ROUNDDOWN ROUNDUP SIGN SIN SQRT SUM SUMIF SUMIFS SUMPRODUCT SUMSQ TAN TRUNC |
| 统计 | 32 | AVERAGE AVERAGEIF AVERAGEIFS CORREL COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS LARGE MAX MAXIFS MEDIAN MIN MINIFS MODE MODE.SNGL PERCENTILE PERCENTILE.INC QUARTILE QUARTILE.INC RANK RANK.EQ SMALL STDEV STDEV.P STDEV.S STDEVP VAR VAR.P VAR.S VARP |
| 逻辑 | 12 | AND CHOOSE FALSE IF IFERROR IFNA IFS NOT OR SWITCH TRUE XOR |
| 文本 | 26 | CHAR CLEAN CODE CONCAT CONCATENATE EXACT FIND LEFT LEN LOWER MID PROPER REPLACE REPT RIGHT SEARCH SUBSTITUTE TEXT TEXTAFTER TEXTBEFORE TEXTJOIN TRIM UNICHAR UNICODE UPPER VALUE |
| 查找 | 13 | COLUMN COLUMNS HLOOKUP INDEX INDIRECT LOOKUP MATCH OFFSET ROW ROWS TRANSPOSE VLOOKUP XLOOKUP |
| 日期 | 19 | DATE DATEDIF DATEVALUE DAY DAYS EDATE EOMONTH HOUR MINUTE MONTH NETWORKDAYS NOW SECOND TIME TODAY WEEKDAY WEEKNUM WORKDAY YEAR |
| 信息 | 14 | ERROR.TYPE ISBLANK ISERR ISERROR ISEVEN ISLOGICAL ISNA ISNONTEXT ISNUMBER ISODD ISTEXT N NA T |

每个函数在“fx 函数”面板里都有中文说明和参数格式。条件函数支持 `">5"`、`"<>苹果"`、`"张*"`、`"?子"` 这类条件和通配符。和 Excel 365 一样，接受区域的参数（`SUM`、`MAX`、`OR`、`MATCH` 的查找范围、`SUMPRODUCT` 等）按数组逐个元素计算，所以 `=SUM((A2:A9="苹果")*C2:C9)`、`=MAX(IF(A2:A9="苹果",C2:C9))`、`=SUMPRODUCT((A2:A9="苹果")*(B2:B9>3)*C2:C9)` 这些写法都可以用，不用按 Ctrl+Shift+Enter。比较数字时按 15 位有效数字，所以 `=0.1+0.2=0.3` 是 TRUE；像 `"2026-01-05"` 这样的日期文字参与运算时按日期序列号算。

## 运行方法

需要 Node.js 18 或更新版本。运行网站本身不需要安装任何依赖。

```bash
cd sheet
npm start            # 等同于 node scripts/serve.js，默认端口 8080
```

- 电脑上打开 <http://localhost:8080>。地址后面加 `?blank` 是空白表格，`?fresh` 是不读取上次保存的数据（重新看示例）。
- iPhone 和电脑连同一个 Wi-Fi 时，用 Safari 打开启动日志里打印的局域网地址。
- 想长期在 iPhone 上用：把 `sheet/` 目录原样放到任意 HTTPS 静态托管（GitHub Pages、Cloudflare Pages 等，不需要构建），Safari 打开后“分享 → 添加到主屏幕”，就能离线使用。

> 直接双击 `index.html`（`file://`）打不开，浏览器不允许这样加载 ES 模块。

## 公式引擎是怎么工作的

```
"=SUM(A1:A3)*2"
   │  lexer.js      词法分析：一次性识别出 A1、$B$2、Sheet2!C3、'名 字'!A1:B2、C:C、3:5、"字符串"、#N/A
   ▼
 tokens
   │  parser.js     Pratt 语法分析，优先级与 Excel 一致（-2^2 = 4，2^3^2 = 64）；也能把 AST 打印回公式文本
   ▼
  AST  ───────────► rewrite.js   复制平移、插删行列、剪切移动、重命名工作表时改写 AST 里的引用
   │  evaluator.js  遍历求值。引用求值成“区域视图”（单个单元格是 1×1 区域），
   │                函数因此能区分“单元格里的文字”和“直接写的文字”，跟 Excel 的计算规则一致；
   │                接受区域的函数参数按数组逐元素计算；公式本身的结果对区域做隐式交集
   ▼
 value
```

**依赖图与重算**（`workbook.js`）：每个公式登记它读取的单元格（单格引用存成“被引用格 → 公式”的映射）和区域（按 256 行分桶的区间索引，整列引用单独放一组）。单元格变化后：

1. 从变化的单元格出发，沿“被谁引用”找出所有需要重算的公式；
2. 用 Kahn 算法按拓扑顺序计算，每个公式只算一次；
3. 排不出顺序的部分一定在环上或环的下游：用 Tarjan 算法（迭代实现，不会爆栈）找出真正的强连通分量，环上的单元格设为 `#CIRC!`，然后继续计算下游；
4. `INDIRECT`、`OFFSET` 的引用在运行时才知道，静态依赖图看不到。所以读取一个“还没重算”的单元格时会先就地把它算出来（带环检测），保证结果总是最新的。`RAND`、`TODAY` 等易失函数每次都会重算。

**撤销**（`history.js`）：普通编辑只记录被改动单元格的前后状态；插删行列、剪切粘贴、工作表操作会改写整个工作簿里的公式，所以记录整本快照。

**xlsx**（`io/`）：自己实现了 ZIP 读写（CRC-32、用浏览器自带的 `CompressionStream` 做 deflate 压缩/解压）和一个小型 XML 解析器。导出时给 Excel 2010 以后新增的函数加上文件格式要求的 `_xlfn.` 前缀，导入时去掉；导入支持共享字符串、富文本、共享公式（按主单元格的位置平移展开）、内置数字格式编号。导出的文件用 Python 的 openpyxl（独立的 xlsx 实现）验证过能正确读出公式、缓存值、日期、格式和列宽；还没有在 Excel、Numbers、WPS 里实际打开测试过。

## 代码结构

```
index.html, css/app.css, manifest.webmanifest, sw.js, icons/
js/
  engine/                 公式引擎（不依赖 DOM，Node 里也能跑）
    address.js            A1 地址、列名换算
    lexer.js, parser.js   词法、语法分析，AST 打印
    values.js, range.js   值类型、错误值、类型转换、区域视图、隐式交集
    evaluator.js          求值、数组运算
    functions.js          158 个函数（带中文说明）
    format.js             Excel 数字格式代码
    dates.js, input.js    日期序列号、输入识别（12%、日期、货币…）
    rewrite.js            引用改写
    workbook.js           工作簿、依赖图、增量重算、填充、排序、序列化
    history.js            撤销 / 重做
  io/                     csv.js、zip.js、xml.js、xlsx.js
  ui/
    grid.js               虚拟滚动表格（只渲染可见区域），鼠标与触摸交互
    editor.js             单元格编辑器、编辑栏、引用着色、自动补全、参数提示
    assist.js             编辑辅助的纯函数（光标处的函数和参数、F4、Ctrl+方向键边缘…）
    controller.js         选区、快捷键、剪贴板、所有命令
    panels.js             文件菜单、函数面板、查找替换、帮助
    widgets.js, storage.js, sample.js
  app.js                  启动、自动保存
scripts/serve.js          零依赖静态服务器
tests/unit/               Node 自带测试运行器（70 个测试）
tests/e2e/                Playwright 端到端测试（电脑 + iPhone 13 尺寸）
```

## 测试

```bash
cd sheet
npm test                 # 单元测试，无需安装依赖
npm install              # 只有端到端测试需要（安装 @playwright/test）
npm run test:e2e         # 电脑和 iPhone 两种尺寸
```

单元测试覆盖：词法/语法分析和打印、运算符优先级、全部函数类别（包括 Excel 的取整规则、条件通配符、近似查找、日期边界）、增量重算次数、菱形依赖、长环检测、动态引用、复制粘贴/插删行列/剪切移动的引用改写、填充序列、排序、撤销重做、序列化、CSV、ZIP（CRC-32 标准校验值）、xlsx 往返和读取 openpyxl 生成的文件、数字格式、编辑辅助函数，以及一组性能断言。

端到端测试在真实浏览器里操作：用点击构建公式、自动补全、F4、填充柄拖动、右键插删行并撤销、复制粘贴和剪切粘贴、从外部粘贴表格文本、跨工作表点选引用、循环引用提示、格式与排序、查找替换、刷新后数据还在、导出 xlsx 再打开；iPhone 尺寸下测试点按编辑、点单元格插入引用、长按菜单、拖动选区手柄、函数面板，以及页面没有横向溢出、输入框字号不会触发 Safari 自动放大。

## 已知限制

- 不支持合并单元格、图表、条件格式、数据验证、冻结窗格、批注。
- 公式本身的结果是数组时不会“溢出”到相邻单元格（Excel 365 的动态数组），只取对应位置的一个值（隐式交集），比如 `=A1:A3*10` 写在第 2 行得到 `A2*10`。函数参数里的数组运算不受影响，见上面的“公式”。
- 打开 xlsx 时会忽略上面这些不支持的内容，以及定义名称；超过 4 GB 的 ZIP64 文件打不开。
- 日期从 1900-03-01 起与 Excel 完全一致，更早的日期序列号与 Excel 差一天（Excel 把 1900 年当成闰年）。
- 数据只在当前设备的浏览器里，换设备请用“文件 → 导出”。
