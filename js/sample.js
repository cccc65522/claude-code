// A small example bank covering every question type, plus the CSV import template.

export const SAMPLE_BANK = {
  name: '示例题库（常识）',
  questions: [
    { type: '单选', question: '中国的首都是哪座城市？', options: ['上海', '北京', '广州', '深圳'], answer: 'B', explanation: '北京是中华人民共和国的首都。', tags: ['地理'] },
    { type: '单选', question: '在标准大气压下，水的沸点是多少摄氏度？', options: ['90', '100', '110', '120'], answer: 'B', explanation: '一个标准大气压下，纯水在 100℃ 沸腾。', tags: ['物理'] },
    { type: '单选', question: 'HTTP 状态码 404 表示什么？', options: ['服务器内部错误', '未授权', '请求的资源不存在', '请求成功'], answer: 'C', explanation: '404 Not Found：服务器找不到请求的资源。', tags: ['计算机'] },
    { type: '单选', question: '《红楼梦》的作者是？', options: ['罗贯中', '施耐庵', '曹雪芹', '吴承恩'], answer: 'C', explanation: '一般认为前八十回由曹雪芹所著。', tags: ['文学'] },
    { type: '多选', question: '下列数中，哪些是质数？', options: ['2', '9', '11', '15'], answer: 'AC', explanation: '9 = 3 × 3，15 = 3 × 5，都不是质数。', tags: ['数学'] },
    { type: '多选', question: '以下哪些是 JavaScript 的原始类型？', options: ['string', 'number', 'array', 'boolean'], answer: 'ABD', explanation: '数组属于对象类型，不是原始类型。', tags: ['计算机'] },
    { type: '判断', question: '光在真空中的速度约为每秒 30 万千米。', answer: '对', explanation: '约为 299 792 千米每秒。', tags: ['物理'] },
    { type: '判断', question: '地球是太阳系中体积最大的行星。', answer: '错', explanation: '体积最大的是木星。', tags: ['地理'] },
    { type: '判断', question: '在常见的二进制计量中，1 KB 等于 1024 字节。', answer: '对', explanation: '严格写法是 1 KiB = 1024 字节；国际单位制里 1 kB = 1000 字节。', tags: ['计算机'] },
    { type: '填空', question: '圆周率 π 保留两位小数约等于 ____。', answer: '3.14', explanation: 'π ≈ 3.14159…', tags: ['数学'] },
    { type: '填空', question: '一年有 ____ 个月。', answer: '12|十二', explanation: '', tags: ['常识'] },
    { type: '简答', question: '简述“番茄工作法”的基本做法。', answer: '选定一项任务，专注工作 25 分钟，然后休息 5 分钟；每完成 4 个番茄钟，休息 15–30 分钟。', explanation: '核心是短时段专注与固定间隔的休息。', tags: ['学习方法'] }
  ]
};

export const CSV_TEMPLATE_ROWS = [
  ['题型', '题目', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '标签'],
  ['单选', '中国的首都是哪座城市？', '上海', '北京', '广州', '深圳', 'B', '北京是首都', '地理'],
  ['多选', '下列数中哪些是质数？', '2', '9', '11', '15', 'AC', '', '数学'],
  ['判断', '地球是太阳系中体积最大的行星。', '', '', '', '', '错', '最大的是木星', ''],
  ['填空', '一年有____个月。', '', '', '', '', '12|十二', '多个可接受答案用 | 隔开', ''],
  ['简答', '简述番茄工作法。', '', '', '', '', '专注 25 分钟，休息 5 分钟', '简答题答完后自己判断对错', '']
];

export const TEXT_TEMPLATE = `一、单选题
1. 中国的首都是哪座城市？
A. 上海  B. 北京  C. 广州  D. 深圳
答案：B
解析：北京是首都。

二、判断题
1. 地球是太阳系中体积最大的行星。
答案：错
`;
