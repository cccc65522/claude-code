// The sample workbook shown on first visit: a household ledger, a grade book,
// and a sheet of formula examples that reach across sheets.

const STYLES = [
  { bold: true, fill: '#e8f0fe' }, // 0 header
  { numFmt: '¥#,##0.00;[Red]-¥#,##0.00' }, // 1 money
  { numFmt: '0.0%' }, // 2 percent
  { numFmt: 'yyyy-mm-dd' }, // 3 date
  { numFmt: '0.0' }, // 4 one decimal
  { bold: true }, // 5 bold
  { bold: true, numFmt: '¥#,##0.00;[Red]-¥#,##0.00', fill: '#fef3c7' }, // 6 total money
  { color: '#5f6368', italic: true }, // 7 note
  { bold: true, align: 'center', fill: '#e8f0fe' }, // 8 centred header
  { align: 'center' } // 9 centre
];

function sheet(name, rows, { styles = {}, widths = {} } = {}) {
  const cells = [];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === null || v === undefined || v === '') return;
    const key = `${r},${c}`;
    const s = styles[key] ?? styles[`r${r}`] ?? styles[`c${c}`];
    cells.push(s === undefined ? [r, c, String(v)] : [r, c, String(v), s]);
  }));
  // style-only cells listed in `styles` with explicit keys
  for (const [key, s] of Object.entries(styles)) {
    const m = /^(\d+),(\d+)$/.exec(key);
    if (m && !cells.some(x => x[0] === +m[1] && x[1] === +m[2])) cells.push([+m[1], +m[2], '', s]);
  }
  return { name, colWidths: widths, cells };
}

const ledger = [
  ['日期', '类别', '项目', '金额', '支付方式', '', '类别', '合计', '占比', '笔数'],
  ['2026-10-03', '餐饮', '早餐', '18', '微信', '', '餐饮', '=SUMIF($B$2:$B$16,G2,$D$2:$D$16)', '=H2/$H$8', '=COUNTIF($B$2:$B$16,G2)'],
  ['2026-10-05', '交通', '地铁月卡', '200', '支付宝', '', '交通', '=SUMIF($B$2:$B$16,G3,$D$2:$D$16)', '=H3/$H$8', '=COUNTIF($B$2:$B$16,G3)'],
  ['2026-10-08', '购物', '运动鞋', '459', '信用卡', '', '购物', '=SUMIF($B$2:$B$16,G4,$D$2:$D$16)', '=H4/$H$8', '=COUNTIF($B$2:$B$16,G4)'],
  ['2026-10-12', '餐饮', '朋友聚餐', '326.5', '微信', '', '居住', '=SUMIF($B$2:$B$16,G5,$D$2:$D$16)', '=H5/$H$8', '=COUNTIF($B$2:$B$16,G5)'],
  ['2026-10-15', '居住', '房租', '3200', '银行转账', '', '娱乐', '=SUMIF($B$2:$B$16,G6,$D$2:$D$16)', '=H6/$H$8', '=COUNTIF($B$2:$B$16,G6)'],
  ['2026-10-18', '娱乐', '电影票', '90', '支付宝'],
  ['2026-10-22', '餐饮', '超市买菜', '146.8', '微信', '', '总计', '=SUM(H2:H6)', '=SUM(I2:I6)', '=SUM(J2:J6)'],
  ['2026-10-26', '居住', '水电燃气', '238.6', '支付宝'],
  ['2026-11-01', '交通', '打车', '43.2', '微信', '', '平均每笔', '=AVERAGE(D2:D16)'],
  ['2026-11-02', '购物', '书', '128', '支付宝', '', '最大一笔', '=MAX(D2:D16)', '=INDEX(C2:C16,MATCH(H11,D2:D16,0))'],
  ['2026-11-04', '餐饮', '咖啡', '32', '微信', '', '11 月支出', '=SUMPRODUCT((MONTH(A2:A16)=11)*D2:D16)'],
  ['2026-11-05', '娱乐', '演唱会', '680', '信用卡', '', '微信支付占比', '=SUMIF(E2:E16,"微信",D2:D16)/H8'],
  ['2026-11-06', '餐饮', '午餐', '25', '微信'],
  ['2026-11-07', '交通', '高铁', '153', '支付宝', '', '试试看：改一个金额，右边的汇总会立刻更新。'],
  ['2026-11-08', '购物', '日用品', '76.4', '微信']
];
const ledgerStyles = { r0: 0, c3: 1, c0: 3, '0,6': 0, '0,7': 0, '0,8': 0, '0,9': 0, '0,5': undefined };
for (let r = 1; r <= 7; r++) { ledgerStyles[`${r},7`] = 1; ledgerStyles[`${r},8`] = 2; ledgerStyles[`${r},9`] = 9; }
ledgerStyles['7,6'] = 5; ledgerStyles['7,7'] = 6; ledgerStyles['7,8'] = 2; ledgerStyles['7,9'] = 9;
ledgerStyles['9,7'] = 1; ledgerStyles['10,7'] = 1; ledgerStyles['11,7'] = 1; ledgerStyles['12,7'] = 2;
ledgerStyles['14,6'] = 7;
ledgerStyles['0,0'] = 0; ledgerStyles['0,3'] = 0;
delete ledgerStyles['0,5'];

const grades = [
  ['姓名', '语文', '数学', '英语', '总分', '平均', '排名', '等级', '', '成绩查询', ''],
  ['张伟', '88', '95', '79', '=SUM(B2:D2)', '=ROUND(AVERAGE(B2:D2),1)', '=RANK(E2,$E$2:$E$9)', '=IFS(F2>=90,"优秀",F2>=80,"良好",F2>=60,"及格",TRUE,"不及格")', '', '姓名', '王芳'],
  ['王芳', '92', '89', '96', '=SUM(B3:D3)', '=ROUND(AVERAGE(B3:D3),1)', '=RANK(E3,$E$2:$E$9)', '=IFS(F3>=90,"优秀",F3>=80,"良好",F3>=60,"及格",TRUE,"不及格")', '', '总分', '=XLOOKUP(K2,A2:A9,E2:E9,"查无此人")'],
  ['李娜', '76', '68', '85', '=SUM(B4:D4)', '=ROUND(AVERAGE(B4:D4),1)', '=RANK(E4,$E$2:$E$9)', '=IFS(F4>=90,"优秀",F4>=80,"良好",F4>=60,"及格",TRUE,"不及格")', '', '排名', '=IFERROR(VLOOKUP(K2,A2:G9,7,FALSE),"—")'],
  ['刘洋', '65', '72', '58', '=SUM(B5:D5)', '=ROUND(AVERAGE(B5:D5),1)', '=RANK(E5,$E$2:$E$9)', '=IFS(F5>=90,"优秀",F5>=80,"良好",F5>=60,"及格",TRUE,"不及格")', '', '等级', '=IFERROR(INDEX(H2:H9,MATCH(K2,A2:A9,0)),"—")'],
  ['陈静', '95', '98', '93', '=SUM(B6:D6)', '=ROUND(AVERAGE(B6:D6),1)', '=RANK(E6,$E$2:$E$9)', '=IFS(F6>=90,"优秀",F6>=80,"良好",F6>=60,"及格",TRUE,"不及格")', '', '在 K2 输入别的名字试试'],
  ['杨磊', '58', '61', '49', '=SUM(B7:D7)', '=ROUND(AVERAGE(B7:D7),1)', '=RANK(E7,$E$2:$E$9)', '=IFS(F7>=90,"优秀",F7>=80,"良好",F7>=60,"及格",TRUE,"不及格")'],
  ['赵敏', '83', '77', '88', '=SUM(B8:D8)', '=ROUND(AVERAGE(B8:D8),1)', '=RANK(E8,$E$2:$E$9)', '=IFS(F8>=90,"优秀",F8>=80,"良好",F8>=60,"及格",TRUE,"不及格")'],
  ['黄强', '71', '90', '66', '=SUM(B9:D9)', '=ROUND(AVERAGE(B9:D9),1)', '=RANK(E9,$E$2:$E$9)', '=IFS(F9>=90,"优秀",F9>=80,"良好",F9>=60,"及格",TRUE,"不及格")'],
  [],
  ['各科平均', '=AVERAGE(B2:B9)', '=AVERAGE(C2:C9)', '=AVERAGE(D2:D9)', '=AVERAGE(E2:E9)'],
  ['最高分', '=MAX(B2:B9)', '=MAX(C2:C9)', '=MAX(D2:D9)', '=MAX(E2:E9)'],
  ['及格人数', '=COUNTIF(B2:B9,">=60")', '=COUNTIF(C2:C9,">=60")', '=COUNTIF(D2:D9,">=60")'],
  ['及格率', '=B13/COUNT(B2:B9)', '=C13/COUNT(C2:C9)', '=D13/COUNT(D2:D9)']
];
const gradeStyles = { r0: 8, c0: 5, '0,9': 0, '0,10': 0, '1,9': 5, '2,9': 5, '3,9': 5, '4,9': 5, '5,9': 7 };
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 7; c++) gradeStyles[`${r},${c}`] = c === 5 ? 4 : 9;
for (let c = 1; c <= 4; c++) { gradeStyles[`10,${c}`] = 4; gradeStyles[`11,${c}`] = 9; gradeStyles[`12,${c}`] = 9; gradeStyles[`13,${c}`] = 2; }
gradeStyles['0,8'] = undefined;
delete gradeStyles['0,8'];
gradeStyles['5,9'] = 7;

const demo = [
  ['说明', '公式', '结果'],
  ['今天', "'=TODAY()", '=TODAY()'],
  ['距离 2027 年元旦', "'=DATE(2027,1,1)-TODAY()", '=DATE(2027,1,1)-TODAY()&" 天"'],
  ['2000-05-20 出生的周岁', "'=DATEDIF(DATE(2000,5,20),TODAY(),\"Y\")", '=DATEDIF(DATE(2000,5,20),TODAY(),"Y")'],
  ['本月工作日天数', "'=NETWORKDAYS(EOMONTH(TODAY(),-1)+1,EOMONTH(TODAY(),0))", '=NETWORKDAYS(EOMONTH(TODAY(),-1)+1,EOMONTH(TODAY(),0))'],
  ['金额格式化', "'=TEXT(1234567.891,\"¥#,##0.00\")", '=TEXT(1234567.891,"¥#,##0.00")'],
  ['中文日期', "'=TEXT(TODAY(),\"yyyy年m月d日 aaaa\")", '=TEXT(TODAY(),"yyyy年m月d日 aaaa")'],
  ['跨表连接姓名', "'=TEXTJOIN(\"、\",TRUE,成绩单!A2:A5)", '=TEXTJOIN("、",TRUE,成绩单!A2:A5)'],
  ['数学 ≥ 90 分的人数', "'=COUNTIF(成绩单!C2:C9,\">=90\")", '=COUNTIF(成绩单!C2:C9,">=90")'],
  ['微信支付的餐饮花费', "'=SUMIFS(家庭账本!D2:D16,家庭账本!B2:B16,\"餐饮\",家庭账本!E2:E16,\"微信\")", '=SUMIFS(家庭账本!D2:D16,家庭账本!B2:B16,"餐饮",家庭账本!E2:E16,"微信")'],
  ['语文和数学都 ≥ 80', "'=SUMPRODUCT((成绩单!B2:B9>=80)*(成绩单!C2:C9>=80))", '=SUMPRODUCT((成绩单!B2:B9>=80)*(成绩单!C2:C9>=80))'],
  ['总分最高的人', "'=INDEX(成绩单!A2:A9,MATCH(MAX(成绩单!E2:E9),成绩单!E2:E9,0))", '=INDEX(成绩单!A2:A9,MATCH(MAX(成绩单!E2:E9),成绩单!E2:E9,0))'],
  ['出错时给默认值', "'=IFERROR(1/0,\"除数为零\")", '=IFERROR(1/0,"除数为零")'],
  ['随机数（每次修改都会变）', "'=RANDBETWEEN(1,100)", '=RANDBETWEEN(1,100)'],
  ['按名字取另一个表的单元格', "'=INDIRECT(\"成绩单!K3\")", '=INDIRECT("成绩单!K3")'],
  [],
  ['提示：编辑公式时点击单元格可以插入引用；按 F4 切换 $ 绝对引用。']
];
const demoStyles = { r0: 0, c1: 7, '1,2': 3, '16,0': 7 };

export const SAMPLE = {
  app: 'gesuan',
  version: 1,
  styles: STYLES,
  sheets: [
    sheet('家庭账本', ledger, { styles: ledgerStyles, widths: { 0: 104, 2: 110, 4: 90, 5: 24, 6: 110, 7: 110, 8: 150, 9: 64 } }),
    sheet('成绩单', grades, { styles: gradeStyles, widths: { 0: 88, 4: 72, 5: 72, 6: 64, 7: 80, 8: 24, 9: 96, 10: 120 } }),
    sheet('函数演示', demo, { styles: demoStyles, widths: { 0: 200, 1: 520, 2: 200 } })
  ]
};
