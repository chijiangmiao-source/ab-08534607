import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInput,
  solveColoring,
  verifySolution,
  InputError,
  MAX_EDGES,
} from '../src/coloring.js';

/** 由通道数与边对构造录入文本。 */
function toText(n, pairs) {
  const channels = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const edges = pairs
    .map(([i, j]) => `${String.fromCharCode(65 + i)}-${String.fromCharCode(65 + j)}`)
    .join('\n');
  return { channelsText: channels.join(', '), edgesText: edges };
}

function solvePairs(n, pairs) {
  const { channelsText, edgesText } = toText(n, pairs);
  const { channels, edges } = parseInput(channelsText, edgesText);
  return solveColoring(channels, edges);
}

/** 确定性伪随机数（仅测试用）。 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 朴素回溯精确色数（仅测试用，用于独立交叉验证，n 很小）。 */
function bruteForceChi(n, pairs) {
  const adj = Array.from({ length: n }, () => new Set());
  for (const [a, b] of pairs) {
    adj[a].add(b);
    adj[b].add(a);
  }
  const color = new Array(n).fill(-1);
  function canColor(k, v) {
    if (v === n) return true;
    for (let c = 0; c < k; c++) {
      let ok = true;
      for (const u of adj[v]) {
        if (color[u] === c) {
          ok = false;
          break;
        }
      }
      if (ok) {
        color[v] = c;
        if (canColor(k, v + 1)) return true;
        color[v] = -1;
      }
    }
    return false;
  }
  for (let k = 1; k <= n; k++) {
    color.fill(-1);
    if (canColor(k, 0)) return k;
  }
  return n;
}

function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 规格要求的基准情形 ----------

test('三角冲突需要 3 个频段', () => {
  const r = solvePairs(3, [[0, 1], [1, 2], [0, 2]]);
  assert.equal(r.chromaticNumber, 3);
  assert.deepEqual(
    r.assignment,
    [
      { channel: 'A', band: 1 },
      { channel: 'B', band: 2 },
      { channel: 'C', band: 3 },
    ],
  );
});

test('四通道完全冲突（K4）需要 4 个频段', () => {
  const pairs = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([i, j]);
  const r = solvePairs(4, pairs);
  assert.equal(r.chromaticNumber, 4);
  assert.equal(r.bands.length, 4);
});

test('二分链式关系（P4）需要 2 个频段', () => {
  const r = solvePairs(4, [[0, 1], [1, 2], [2, 3]]);
  assert.equal(r.chromaticNumber, 2);
  assert.deepEqual(r.bands, [
    { band: 1, channels: ['A', 'C'] },
    { band: 2, channels: ['B', 'D'] },
  ]);
});

test('无干扰边时 1 个频段即可', () => {
  const r = solvePairs(5, []);
  assert.equal(r.chromaticNumber, 1);
  assert.deepEqual(r.bands, [{ band: 1, channels: ['A', 'B', 'C', 'D', 'E'] }]);
});

// ---------- 录入顺序无关性与规范分配 ----------

test('改变录入顺序后规范分配保持一致', () => {
  const n = 6;
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 3], [2, 5]];
  const base = solvePairs(n, pairs);
  const rand = lcg(20260926);
  for (let t = 0; t < 25; t++) {
    // 同一张带标号的图，仅改变录入顺序：通道列表乱序、边列表乱序、端点方向随机翻转。
    const shuffledPairs = shuffled(pairs, rand).map(([a, b]) =>
      rand() < 0.5 ? [a, b] : [b, a],
    );
    const channelOrder = shuffled(
      Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)),
      rand,
    );
    const edgesText = shuffledPairs
      .map(([i, j]) => `${String.fromCharCode(65 + i)}-${String.fromCharCode(65 + j)}`)
      .join('\n');
    const parsed = parseInput(channelOrder.join(', '), edgesText);
    const r = solveColoring(parsed.channels, parsed.edges);
    assert.deepEqual(r, base, `第 ${t} 次重排后结果不一致`);
  }
});

test('规范分配满足：通道升序、频段按组内最小通道编号、组内升序', () => {
  const r = solvePairs(7, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 6]]);
  const channels = r.assignment.map((a) => a.channel);
  assert.deepEqual(channels, [...channels].sort());
  const bandNumbers = r.bands.map((b) => b.band);
  assert.deepEqual(bandNumbers, [...bandNumbers].sort((a, b) => a - b));
  for (const { channels: members } of r.bands) {
    assert.deepEqual(members, [...members].sort());
  }
  // 频段编号按其最小通道升序：频段 1 必含最小通道 A。
  assert.ok(r.bands[0].channels.includes('A'));
});

// ---------- 精确性：已知色数的图 ----------

test('奇圈 C5 需要 3 个频段，偶圈 C6 需要 2 个', () => {
  const c5 = solvePairs(5, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
  assert.equal(c5.chromaticNumber, 3);
  const c6 = solvePairs(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]);
  assert.equal(c6.chromaticNumber, 2);
});

test('完全二分图 K3,3 需要 2 个频段', () => {
  const pairs = [];
  for (const i of [0, 1, 2]) for (const j of [3, 4, 5]) pairs.push([i, j]);
  assert.equal(solvePairs(6, pairs).chromaticNumber, 2);
});

test('Grötzsch 图（无三角形但色数为 4）精确判定为 4', () => {
  // Mycielski(C5)：v=A..E，影子 u=F..J，根 w=K。
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 0], // C5
    [5, 1], [5, 4], // u0 接 v0 的邻居
    [6, 0], [6, 2], // u1
    [7, 1], [7, 3], // u2
    [8, 2], [8, 4], // u3
    [9, 3], [9, 0], // u4
    [10, 5], [10, 6], [10, 7], [10, 8], [10, 9], // w 接全部影子
  ];
  const r = solvePairs(11, pairs);
  assert.equal(r.chromaticNumber, 4);
  // 无三角形 ⇒ 团下界 ≤ 2，必须依靠分支定界搜索而非团下界直接命中。
  assert.ok(r.proof.lowerBound <= 2);
  assert.ok(r.proof.searchNodes > 1);
});

test('K16（恰好 120 条边，达上限）需要 16 个频段且上下界立即相等', () => {
  const pairs = [];
  for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) pairs.push([i, j]);
  assert.equal(pairs.length, MAX_EDGES);
  const r = solvePairs(16, pairs);
  assert.equal(r.chromaticNumber, 16);
  assert.equal(r.proof.upperBound, 16);
  assert.equal(r.proof.lowerBound, 16);
  assert.equal(r.proof.earlyExit, true);
});

// ---------- 与独立朴素精确解交叉验证（随机小图） ----------

test('随机小图（n≤10）与朴素精确解逐一吻合，且分配可复算', () => {
  const rand = lcg(123456789);
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(rand() * 9); // 2..10
    const p = rand();
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rand() < p) pairs.push([i, j]);
      }
    }
    const r = solvePairs(n, pairs);
    assert.equal(r.chromaticNumber, bruteForceChi(n, pairs), `n=${n} pairs=${JSON.stringify(pairs)}`);
    const text = toText(n, pairs);
    const { channels, edges } = parseInput(text.channelsText, text.edgesText);
    const check = verifySolution(channels, edges, r);
    assert.ok(check.ok, check.problems.join('；'));
    assert.ok(r.proof.lowerBound <= r.chromaticNumber);
    assert.ok(r.chromaticNumber <= r.proof.upperBound);
  }
});

// ---------- 输入校验：定位提示 ----------

test('自环：定位到行并拒绝', () => {
  assert.throws(
    () => parseInput('A, B, C', 'A-B\nB-B'),
    (err) => err instanceof InputError && err.field === 'edges' && err.line === 2 && /自环/.test(err.message),
  );
});

test('重复关系（含反向重复）：定位到行并拒绝', () => {
  assert.throws(
    () => parseInput('A, B, C', 'A-B\nB-A'),
    (err) => err.field === 'edges' && err.line === 2 && /重复/.test(err.message),
  );
  assert.throws(
    () => parseInput('A, B, C', 'A-B\nA-B'),
    (err) => err.field === 'edges' && err.line === 2 && /重复/.test(err.message),
  );
});

test('不存在的端点：定位到行并拒绝', () => {
  assert.throws(
    () => parseInput('A, B, C', 'A-Z'),
    (err) => err.field === 'edges' && err.line === 1 && /不存在/.test(err.message),
  );
});

test('重复通道：定位到项并拒绝', () => {
  assert.throws(
    () => parseInput('A, B, A', ''),
    (err) => err.field === 'channels' && err.index === 3 && /重复/.test(err.message),
  );
});

test('非法通道标识：定位到项并拒绝', () => {
  assert.throws(
    () => parseInput('A, b, C', ''),
    (err) => err.field === 'channels' && err.index === 2 && /无效/.test(err.message),
  );
  assert.throws(
    () => parseInput('A, AB, C', ''),
    (err) => err.field === 'channels' && err.index === 2,
  );
});

test('通道数量越界：少于 2 个拒绝；合法标识至多 26 个', () => {
  assert.throws(
    () => parseInput('A', ''),
    (err) => err.field === 'channels' && /2~26/.test(err.message),
  );
  // 26 个合法通道可接受；第 27 个必然重复或非法，均被拒绝。
  const all26 = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  assert.doesNotThrow(() => parseInput(all26.join(','), ''));
  assert.throws(() => parseInput([...all26, 'A'].join(','), ''), InputError);
});

test('干扰关系超过 120 条：拒绝并提示上限', () => {
  const pairs = [];
  for (let i = 0; i < 17 && pairs.length <= MAX_EDGES; i++) {
    for (let j = i + 1; j < 17 && pairs.length <= MAX_EDGES; j++) pairs.push([i, j]);
  }
  assert.equal(pairs.length, MAX_EDGES + 1);
  const { channelsText, edgesText } = toText(17, pairs);
  assert.throws(
    () => parseInput(channelsText, edgesText),
    (err) => err.field === 'edges' && /120/.test(err.message),
  );
});

test('边格式非法：定位到行并拒绝', () => {
  assert.throws(
    () => parseInput('A, B, C', 'AB'),
    (err) => err.field === 'edges' && err.line === 1 && /格式/.test(err.message),
  );
  assert.throws(
    () => parseInput('A, B, C', 'A-B-C'),
    (err) => err.field === 'edges' && err.line === 1,
  );
});

test('支持中文逗号、分号与空白混合分隔通道', () => {
  const { channels } = parseInput('A，B；C\nD  E', 'A-B');
  assert.deepEqual(channels, ['A', 'B', 'C', 'D', 'E']);
});

test('求解器对自环与未知端点做防御性拒绝', () => {
  assert.throws(() => solveColoring(['A', 'B'], [['A', 'A']]), InputError);
  assert.throws(() => solveColoring(['A', 'B'], [['A', 'Z']]), InputError);
});

// ---------- 复算校验 ----------

test('verifySolution 接受正确结论、拒绝被篡改的结论', () => {
  const pairs = [[0, 1], [1, 2], [0, 2]];
  const { channelsText, edgesText } = toText(3, pairs);
  const { channels, edges } = parseInput(channelsText, edgesText);
  const r = solveColoring(channels, edges);
  assert.ok(verifySolution(channels, edges, r).ok);

  const tampered = {
    ...r,
    assignment: r.assignment.map((a) => ({ ...a, band: 1 })),
  };
  const check = verifySolution(channels, edges, tampered);
  assert.equal(check.ok, false);
  assert.ok(check.problems.length > 0);
});

// ---------- 性能冒烟：26 通道上限规模 ----------

test('26 通道、接近上限规模在 5 秒内精确求解', () => {
  const rand = lcg(987654321);
  const n = 26;
  let pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rand() < 0.4) pairs.push([i, j]);
    }
  }
  if (pairs.length > MAX_EDGES) pairs = pairs.slice(0, MAX_EDGES);
  const start = Date.now();
  const r = solvePairs(n, pairs);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `耗时 ${elapsed}ms 超预期`);
  assert.ok(r.chromaticNumber >= 2);
});
