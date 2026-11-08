import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calc, book, val, NOW } from './helpers.js';
import { FUNCTIONS } from '../../js/engine/functions.js';

const DATA = {
  A1: '水果', B1: '数量', C1: '单价', D1: '日期',
  A2: '苹果', B2: '10', C2: '3.5', D2: '2026-01-15',
  A3: '香蕉', B3: '20', C3: '2', D3: '2026-02-20',
  A4: '苹果', B4: '5', C4: '4', D4: '2026-03-01',
  A5: '橙子', B5: '', C5: '6', D5: '2026-03-15',
  A6: '葡萄', B6: 'n/a', C6: '10', D6: '2026-04-30'
};

function check(cases, cells = DATA) {
  const wb = book({ ...cells, ...Object.fromEntries(cases.map(([f], i) => [`Z${i + 1}`, '=' + f])) });
  cases.forEach(([f, expected], i) => {
    const got = val(wb, `Z${i + 1}`);
    if (typeof expected === 'number' && typeof got === 'number') {
      assert.ok(Math.abs(got - expected) < 1e-9, `${f}: expected ${expected}, got ${got}`);
    } else {
      assert.deepEqual(got, expected, f);
    }
  });
}

test('aggregates follow Excel rules for text, blanks and booleans', () => {
  check([
    ['SUM(B2:B6)', 35], // text "n/a" and blank ignored inside ranges
    ['SUM(1,"2",TRUE)', 4], // direct args are coerced
    ['SUM("abc")', '#VALUE!'],
    ['SUM(B:B)', 35],
    ['AVERAGE(B2:B6)', 35 / 3],
    ['COUNT(B2:B6)', 3],
    ['COUNT(1,"2","x",TRUE)', 3],
    ['COUNTA(B2:B6)', 4],
    ['COUNTBLANK(B2:B6)', 1],
    ['MAX(B2:B6)', 20],
    ['MIN(C2:C6)', 2],
    ['MAX(A2:A6)', 0],
    ['PRODUCT(B2:B4)', 1000],
    ['MEDIAN(C2:C6)', 4],
    ['MODE(1,2,2,3,3)', 2],
    ['LARGE(C2:C6,2)', 6],
    ['SMALL(C2:C6,1)', 2],
    ['RANK(C3,C2:C6)', 5],
    ['RANK(C3,C2:C6,1)', 1],
    ['STDEV(2,4,4,4,5,5,7,9)', 2.138089935299395],
    ['STDEVP(2,4,4,4,5,5,7,9)', 2],
    ['VAR(1,2,3,4)', 5 / 3],
    ['PERCENTILE({1,2,3,4,5},0.25)', 2],
    ['QUARTILE({1,2,3,4,5,6,7,8},3)', 6.25],
    ['CORREL({1,2,3},{2,4,6})', 1],
    ['AVERAGE(A2:A3)', '#DIV/0!'],
    ['SUMSQ(3,4)', 25]
  ]);
});

test('conditional aggregates with criteria strings and wildcards', () => {
  check([
    ['SUMIF(A2:A6,"苹果",B2:B6)', 15],
    ['SUMIF(B2:B6,">5")', 30],
    ['SUMIF(A2:A6,"*果",C2:C6)', 7.5],
    ['SUMIF(A2:A6,"<>苹果",C2:C6)', 18],
    ['COUNTIF(A2:A6,"苹果")', 2],
    ['COUNTIF(A2:A6,"?子")', 1],
    ['COUNTIF(C2:C6,">=4")', 3],
    ['COUNTIF(B2:B6,"")', 1],
    ['COUNTIF(B2:B6,"<>")', 4],
    ['COUNTIF(B2:B6,10)', 1],
    ['COUNTIF(D2:D6,">2026-03-01")', 2],
    ['COUNTIFS(A2:A6,"苹果",B2:B6,">6")', 1],
    ['SUMIFS(C2:C6,A2:A6,"苹果",B2:B6,"<8")', 4],
    ['AVERAGEIF(A2:A6,"苹果",C2:C6)', 3.75],
    ['AVERAGEIFS(C2:C6,C2:C6,">3")', 5.875],
    ['MAXIFS(C2:C6,A2:A6,"苹果")', 4],
    ['MINIFS(C2:C6,C2:C6,">3")', 3.5],
    ['COUNTIF(A2:A6,"~*")', 0],
    ['SUMIFS(C2:C3,A2:A6,"苹果")', '#VALUE!']
  ]);
});

test('SUMPRODUCT evaluates its arguments element-wise', () => {
  check([
    ['SUMPRODUCT(B2:B4,C2:C4)', 10 * 3.5 + 20 * 2 + 5 * 4],
    ['SUMPRODUCT((A2:A6="苹果")*C2:C6)', 7.5],
    ['SUMPRODUCT(--(C2:C6>3))', 4],
    ['SUMPRODUCT((A2:A6="苹果")*(C2:C6>3)*C2:C6)', 7.5],
    ['SUMPRODUCT(LEN(A2:A6))', 10],
    ['SUMPRODUCT(IF(C2:C6>5,1,0))', 2],
    ['SUMPRODUCT({1,2,3},{4,5,6})', 32],
    ['SUMPRODUCT(B2:B3,C2:C4)', '#VALUE!']
  ]);
});

test('implicit intersection picks the value in the formula row', () => {
  const wb = book({ A1: '1', A2: '2', A3: '3', B2: '=A1:A3*10', B5: '=A1:A3' });
  assert.equal(val(wb, 'B2'), 20);
  assert.equal(val(wb, 'B5'), '#VALUE!');
});

test('lookup functions', () => {
  check([
    ['VLOOKUP("香蕉",A2:C6,3,FALSE)', 2],
    ['VLOOKUP("西瓜",A2:C6,3,FALSE)', '#N/A'],
    ['VLOOKUP("橙*",A2:C6,3,0)', 6],
    ['VLOOKUP(15,{0,"低";10,"中";20,"高"},2)', '中'],
    ['VLOOKUP(25,{0,"低";10,"中";20,"高"},2,TRUE)', '高'],
    ['VLOOKUP(-1,{0,"低";10,"中"},2)', '#N/A'],
    ['VLOOKUP("苹果",A2:C6,4,FALSE)', '#REF!'],
    ['HLOOKUP("单价",A1:D6,3,FALSE)', 2],
    ['MATCH("橙子",A2:A6,0)', 4],
    ['MATCH(4.5,{1,3,5,7})', 2],
    ['MATCH(4,{9,7,5,3},-1)', 3],
    ['INDEX(A2:C6,3,3)', 4],
    ['INDEX(C2:C6,2)', 2],
    ['INDEX(A1:D1,2)', '数量'],
    ['SUM(INDEX(B2:C6,0,2))', 25.5],
    ['INDEX(A2:C6,9,1)', '#REF!'],
    ['INDEX(A2:A6,MATCH("葡萄",A2:A6,0))', '葡萄'],
    ['XLOOKUP("橙子",A2:A6,C2:C6)', 6],
    ['XLOOKUP("西瓜",A2:A6,C2:C6,"无")', '无'],
    ['XLOOKUP("苹果",A2:A6,C2:C6,,0,-1)', 4],
    ['XLOOKUP(5,C2:C6,A2:A6,,-1)', '苹果'],
    ['XLOOKUP(5,C2:C6,A2:A6,,1)', '橙子'],
    ['XLOOKUP(3.5,C2:C6,A2:A6)', '苹果'],
    ['LOOKUP(4.5,{1,3,5},{"a","b","c"})', 'b'],
    ['CHOOSE(2,"一","二","三")', '二'],
    ['CHOOSE(4,"一","二","三")', '#VALUE!'],
    ['ROW(C5)', 5],
    ['COLUMN(D1)', 4],
    ['ROWS(A2:C6)', 5],
    ['COLUMNS(A2:C6)', 3],
    ['SUM(OFFSET(B2,1,0,2,1))', 25],
    ['INDIRECT("C"&3)', 2],
    ['SUM(INDIRECT("B2:B4"))', 35],
    ['INDIRECT("nonsense")', '#REF!'],
    ['SUMPRODUCT(TRANSPOSE({1,2,3}),{1;1;1})', 6],
    ['XLOOKUP("西瓜",A2:A6,C2:C6,,0)', '#N/A']
  ]);
});

test('logical functions are lazy where Excel is', () => {
  check([
    ['IF(1>0,"是","否")', '是'],
    ['IF(FALSE,1)', false],
    ['IF(FALSE,1,)', 0],
    ['IF(TRUE,1,1/0)', 1], // untaken branch is never evaluated
    ['IF("x",1,2)', '#VALUE!'],
    ['IFS(C2>5,"贵",C2>3,"中",TRUE,"便宜")', '中'],
    ['IFS(FALSE,1)', '#N/A'],
    ['IFERROR(1/0,"除零")', '除零'],
    ['IFERROR(5,"x")', 5],
    ['IFNA(VLOOKUP("x",A2:B6,2,0),"没有")', '没有'],
    ['IFNA(1/0,"x")', '#DIV/0!'],
    ['SWITCH(2,1,"一",2,"二","其他")', '二'],
    ['SWITCH(9,1,"一","其他")', '其他'],
    ['SWITCH(9,1,"一")', '#N/A'],
    ['AND(TRUE,1,C2:C3)', true],
    ['AND(TRUE,0)', false],
    ['OR(FALSE,0,"FALSE")', false],
    ['OR(A2:A3)', '#VALUE!'],
    ['XOR(TRUE,TRUE,TRUE)', true],
    ['NOT(0)', true],
    ['TRUE()', true]
  ]);
});

test('text functions', () => {
  check([
    ['LEN("格算表格")', 4],
    ['LEFT("Hello",2)', 'He'],
    ['LEFT("Hello")', 'H'],
    ['RIGHT("Hello",3)', 'llo'],
    ['MID("Hello",2,3)', 'ell'],
    ['MID("Hello",0,1)', '#VALUE!'],
    ['UPPER("abc")', 'ABC'],
    ['PROPER("hello wORLD-foo")', 'Hello World-Foo'],
    ['TRIM("  a   b  ")', 'a b'],
    ['SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
    ['SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
    ['REPLACE("abcdef",2,3,"X")', 'aXef'],
    ['FIND("b","abcB")', 2],
    ['FIND("B","abcB")', 4],
    ['FIND("z","abc")', '#VALUE!'],
    ['SEARCH("B","abcB")', 2],
    ['SEARCH("c?","abcde")', 3],
    ['REPT("ab",3)', 'ababab'],
    ['CONCATENATE("a",1,TRUE)', 'a1TRUE'],
    ['CONCAT(A2:A3,"!")', '苹果香蕉!'],
    ['TEXTJOIN("、",TRUE,A2:A6,"")', '苹果、香蕉、苹果、橙子、葡萄'],
    ['TEXTJOIN("-",FALSE,B4:B5)', '5-'],
    ['"值："&C2', '值：3.5'],
    ['0.1+0.2&""', '0.3'],
    ['TEXT(1234.567,"#,##0.00")', '1,234.57'],
    ['TEXT(0.256,"0.0%")', '25.6%'],
    ['TEXT(D2,"yyyy年m月d日")', '2026年1月15日'],
    ['TEXT(D2,"aaaa")', '星期四'],
    ['TEXT("abc","0")', 'abc'],
    ['TEXT(-5,"0;(0)")', '(5)'],
    ['TEXT(7,"000")', '007'],
    ['VALUE("1,234.5")', 1234.5],
    ['VALUE("12%")', 0.12],
    ['VALUE("2026-01-01")', 46023],
    ['VALUE("abc")', '#VALUE!'],
    ['EXACT("a","A")', false],
    ['CODE("A")', 65],
    ['CHAR(66)', 'B'],
    ['UNICODE("格")', 26684],
    ['UNICHAR(26684)', '格'],
    ['TEXTBEFORE("张三@example.com","@")', '张三'],
    ['TEXTAFTER("a.b.c",".",-1)', 'c'],
    ['TEXTAFTER("abc","x")', '#N/A'],
    ['CLEAN("a"&CHAR(10)&"b")', 'ab']
  ]);
});

test('math functions, including Excel rounding', () => {
  check([
    ['ROUND(2.675,2)', 2.68],
    ['ROUND(-2.5,0)', -3],
    ['ROUND(1234.5678,-2)', 1200],
    ['ROUNDUP(3.2,0)', 4],
    ['ROUNDUP(-3.2,0)', -4],
    ['ROUNDDOWN(3.99,1)', 3.9],
    ['TRUNC(-4.7)', -4],
    ['INT(-4.3)', -5],
    ['MOD(10,3)', 1],
    ['MOD(-10,3)', 2],
    ['MOD(10,-3)', -2],
    ['MOD(1,0)', '#DIV/0!'],
    ['QUOTIENT(7,2)', 3],
    ['POWER(2,10)', 1024],
    ['SQRT(16)', 4],
    ['SQRT(-1)', '#NUM!'],
    ['ABS(-3)', 3],
    ['SIGN(-0.5)', -1],
    ['LOG(8,2)', 3],
    ['LOG(1000)', 3],
    ['LN(EXP(2))', 2],
    ['CEILING(4.3,0.5)', 4.5],
    ['CEILING(-4.3,-0.5)', -4.5],
    ['CEILING(4.3,-1)', '#NUM!'],
    ['FLOOR(4.7,0.5)', 4.5],
    ['MROUND(10,3)', 9],
    ['EVEN(1.5)', 2],
    ['ODD(2)', 3],
    ['FACT(5)', 120],
    ['COMBIN(5,2)', 10],
    ['GCD(12,18)', 6],
    ['LCM(4,6)', 12],
    ['PI()', Math.PI],
    ['DEGREES(PI())', 180],
    ['1/0', '#DIV/0!'],
    ['0^0', '#NUM!'],
    ['(-8)^(1/3)', '#NUM!'],
    ['"3"+"4"', 7],
    ['"a"+1', '#VALUE!'],
    ['10^400', '#NUM!']
  ]);
});

test('random functions are volatile and deterministic under a seeded rng', () => {
  check([
    ['AND(RAND()>=0,RAND()<1)', true],
    ['AND(RANDBETWEEN(1,6)>=1,RANDBETWEEN(1,6)<=6)', true],
    ['RANDBETWEEN(5,1)', '#NUM!']
  ]);
  assert.equal(FUNCTIONS.RAND.volatile, true);
});

test('date functions use Excel serial numbers', () => {
  check([
    ['DATE(2026,11,8)', 46334],
    ['DATE(2026,14,1)', 46419], // month overflow -> 2027-02-01
    ['DATE(2026,3,0)', 46081], // day 0 -> last day of February
    ['TODAY()', Math.floor(NOW)],
    ['NOW()', NOW],
    ['YEAR(D2)', 2026],
    ['MONTH("2026-02-20")', 2],
    ['DAY(D6)', 30],
    ['WEEKDAY(DATE(2026,11,8))', 1], // Sunday
    ['WEEKDAY(DATE(2026,11,8),2)', 7],
    ['WEEKNUM(DATE(2026,1,4))', 2],
    ['EDATE(DATE(2026,1,31),1)', 46081], // clamps to Feb 28
    ['EOMONTH(DATE(2026,1,15),1)', 46081],
    ['DAYS(D3,D2)', 36],
    ['DATEDIF(D2,D6,"M")', 3],
    ['DATEDIF(DATE(2020,5,10),DATE(2026,11,8),"Y")', 6],
    ['DATEDIF(DATE(2020,5,10),DATE(2026,11,8),"YM")', 5],
    ['DATEDIF(DATE(2020,5,10),DATE(2026,11,8),"MD")', 29],
    ['DATEDIF(D6,D2,"D")', '#NUM!'],
    ['NETWORKDAYS(DATE(2026,11,2),DATE(2026,11,13))', 10],
    ['NETWORKDAYS(DATE(2026,11,2),DATE(2026,11,13),DATE(2026,11,4))', 9],
    ['WORKDAY(DATE(2026,11,6),1)', 46335], // Friday + 1 workday = Monday
    ['HOUR(0.75)', 18],
    ['MINUTE(TIME(9,45,0))', 45],
    ['SECOND("12:30:15")', 15],
    ['DATEVALUE("2026/11/8")', 46334],
    ['DATE(-1,1,1)', '#NUM!']
  ]);
});

test('information functions see through references', () => {
  check([
    ['ISBLANK(B5)', true],
    ['ISBLANK("")', false],
    ['ISNUMBER(B2)', true],
    ['ISNUMBER(B6)', false],
    ['ISTEXT(A2)', true],
    ['ISLOGICAL(TRUE)', true],
    ['ISERROR(1/0)', true],
    ['ISERR(NA())', false],
    ['ISNA(NA())', true],
    ['ISEVEN(4)', true],
    ['ISODD(-3)', true],
    ['N(TRUE)', 1],
    ['N("x")', 0],
    ['T(5)', ''],
    ['ERROR.TYPE(1/0)', 2],
    ['NA()', '#N/A']
  ]);
});

test('errors propagate through operators and functions', () => {
  check([
    ['A99+NA()', '#N/A'],
    ['SUM(1,NA())', '#N/A'],
    ['NOSUCHFUNC(1)', '#NAME?'],
    ['undefinedName+1', '#NAME?'],
    ['Nowhere!A1', '#REF!'],
    ['ROUND(1)', '#VALUE!'], // too few arguments
    ['#DIV/0!', '#DIV/0!']
  ]);
});

test('every function has Chinese help text', () => {
  for (const [name, spec] of Object.entries(FUNCTIONS)) {
    assert.ok(spec.syntax && spec.desc && spec.category, name);
    assert.ok(spec.syntax.startsWith(name.replace(/\..*$/, '')) || spec.syntax.includes('('), name);
  }
  assert.ok(Object.keys(FUNCTIONS).length >= 150);
});

test('a formula returning a blank cell shows 0', () => {
  assert.equal(calc('=B5', DATA), 0);
  assert.equal(calc('=IF(TRUE,B5)', DATA), 0);
});
