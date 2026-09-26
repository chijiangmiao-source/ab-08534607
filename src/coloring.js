/**
 * coloring.js —— 频段分配核心模块（无 DOM 依赖，浏览器 Worker 与 Node 测试共用）。
 *
 * 问题模型：通道为顶点、相互干扰关系为无向边，求最少频段数（图色数 χ）
 * 以及一份与录入顺序无关的规范频段分配。
 *
 * 求解器：确定性的精确 DSATUR（Brelaz）分支定界。
 *   - 上界：贪心 DSATUR 可行染色（提交时即得的已知可行上界）；
 *   - 下界：最大团尺寸的贪心下界（可证明下界，团内顶点两两相邻，颜色数 ≥ 团大小）；
 *   - 剪枝：
 *       (a) 标准 Brelaz 截断 —— 顶点 v 尝试全新颜色的前提是已用颜色数 + 1 < 当前最优；
 *       (b) 未染色子图团下界 —— max(已用颜色数, 未染色诱导子图的团下界) >= 当前最优时剪枝；
 *   - 一旦 当前最优 == 全局下界，立即判定最优并终止（精确判定，非启发式）。
 *
 * 顶点固定按通道标识升序编号，所有平局按编号小者裁决，因此结果与录入顺序无关。
 * 顶点数上限 26，邻接关系用 32 位整数的位掩码表示。
 */

export const MIN_CHANNELS = 2;
export const MAX_CHANNELS = 26;
export const MAX_EDGES = 120;
export const CHANNEL_PATTERN = /^[A-Z]$/;

/** 输入校验错误，携带可定位信息（字段与行号）。 */
export class InputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InputError';
    this.field = details.field ?? null; // 'channels' | 'edges'
    this.line = details.line ?? null;   // 1 起始的行号（边列表）
    this.index = details.index ?? null; // 1 起始的序号（通道列表）
  }
}

/** 32 位整数的 popcount（顶点数 ≤ 26，掩码恒为非负 32 位整数）。 */
export function popcount32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** 最低有效位（lowbit）的下标，与 `mask &= mask - 1` 迭代配套；x 必须非零。 */
function lowbitIndex(x) {
  return 31 - Math.clz32(x & -x);
}

/**
 * 解析并校验录入内容。
 * @param {string} channelsText 通道标识列表（逗号/空白分隔，唯一的大写字母 A-Z，2~26 个）
 * @param {string} edgesText    干扰关系列表（每行一条 "X-Y"，无向，至多 120 条）
 * @returns {{channels: string[], edges: Array<[string, string]>}}
 * @throws {InputError} 自环、重复关系、不存在端点、数量越界等均抛出并携带定位信息
 */
export function parseInput(channelsText, edgesText) {
  const rawTokens = String(channelsText ?? '')
    .split(/[\s,，;；]+/)
    .filter((t) => t.length > 0);

  const channels = [];
  const seen = new Set();
  rawTokens.forEach((token, i) => {
    const at = { field: 'channels', index: i + 1 };
    if (!CHANNEL_PATTERN.test(token)) {
      throw new InputError(
        `第 ${i + 1} 个通道标识 "${token}" 无效：须为单个大写字母 A-Z`,
        at,
      );
    }
    if (seen.has(token)) {
      throw new InputError(`第 ${i + 1} 个通道 "${token}" 重复录入`, at);
    }
    seen.add(token);
    channels.push(token);
  });

  if (channels.length < MIN_CHANNELS || channels.length > MAX_CHANNELS) {
    throw new InputError(
      `通道数量为 ${channels.length}，须介于 ${MIN_CHANNELS}~${MAX_CHANNELS} 之间`,
      { field: 'channels' },
    );
  }

  const edges = [];
  const edgeKeys = new Set();
  const lines = String(edgesText ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (trimmed === '') return;
    const parts = trimmed.split('-').map((s) => s.trim());
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
      throw new InputError(
        `第 ${lineNo} 行 "${trimmed}" 格式无效：应为 X-Y（如 A-B）`,
        { field: 'edges', line: lineNo },
      );
    }
    const [a, b] = parts;
    if (!seen.has(a)) {
      throw new InputError(
        `第 ${lineNo} 行端点 "${a}" 不存在于通道列表`,
        { field: 'edges', line: lineNo },
      );
    }
    if (!seen.has(b)) {
      throw new InputError(
        `第 ${lineNo} 行端点 "${b}" 不存在于通道列表`,
        { field: 'edges', line: lineNo },
      );
    }
    if (a === b) {
      throw new InputError(
        `第 ${lineNo} 行 "${a}-${b}" 为自环：通道不能与自身构成干扰关系`,
        { field: 'edges', line: lineNo },
      );
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) {
      throw new InputError(
        `第 ${lineNo} 行 "${a}-${b}" 与此前录入的干扰关系重复`,
        { field: 'edges', line: lineNo },
      );
    }
    edgeKeys.add(key);
    edges.push([a, b]);
  });

  if (edges.length > MAX_EDGES) {
    throw new InputError(
      `干扰关系共 ${edges.length} 条，超过上限 ${MAX_EDGES} 条`,
      { field: 'edges' },
    );
  }

  return { channels, edges };
}

/**
 * 贪心 DSATUR 可行染色 —— 提供已知可行上界。
 * 顶点选择：饱和度降序 → 度数降序 → 编号升序；颜色取最小可行编号。
 * @returns {number[]} 每个顶点的颜色（0 起始）
 */
function greedyDsaturColoring(adj, n, degree) {
  const colorOf = new Array(n).fill(-1);
  const satMask = new Int32Array(n); // 各顶点邻居已出现的颜色集合（位掩码）
  let remainingMask = (1 << n) - 1;

  for (let step = 0; step < n; step++) {
    let v = -1;
    let bestSat = -1;
    let bestDeg = -1;
    let rest = remainingMask;
    while (rest) {
      const u = lowbitIndex(rest);
      rest &= rest - 1;
      const sat = popcount32(satMask[u]);
      if (sat > bestSat || (sat === bestSat && degree[u] > bestDeg)) {
        v = u;
        bestSat = sat;
        bestDeg = degree[u];
      }
    }
    let c = 0;
    while (satMask[v] & (1 << c)) c++;
    colorOf[v] = c;
    remainingMask &= ~(1 << v);
    let nb = adj[v];
    while (nb) {
      const u = lowbitIndex(nb);
      nb &= nb - 1;
      satMask[u] |= 1 << c;
    }
  }
  return colorOf;
}

/**
 * 团下界：在 vertexMask 诱导的子图上做贪心最大团扩展。
 * 返回值为某个团的尺寸，因而是该子图色数的可证明下界。
 * @param {number} stopAt 找到尺寸 ≥ stopAt 的团即可提前返回（调用方用于剪枝）
 */
function cliqueLowerBound(adj, vertexMask, stopAt) {
  let best = 0;
  let seeds = vertexMask;
  while (seeds) {
    const s = lowbitIndex(seeds);
    seeds &= seeds - 1;
    let clique = 1 << s;
    let size = 1;
    let cand = vertexMask & adj[s];
    while (cand) {
      const u = lowbitIndex(cand);
      cand &= cand - 1;
      clique |= 1 << u;
      size++;
      cand &= adj[u];
    }
    if (size > best) {
      best = size;
      if (best >= stopAt) return best;
    }
  }
  return best;
}

/**
 * 精确 DSATUR 分支定界求色数。
 * @param {string[]} channels 通道标识（任意顺序，内部按升序规范化）
 * @param {Array<[string, string]>} edges 无向干扰关系
 * @returns {{
 *   chromaticNumber: number,
 *   assignment: Array<{channel: string, band: number}>, // 按通道升序，band 为规范编号（1 起始）
 *   bands: Array<{band: number, channels: string[]}>,   // 按频段编号升序，组内通道升序
 *   proof: {upperBound: number, lowerBound: number, searchNodes: number, pruned: number, earlyExit: boolean}
 * }}
 */
export function solveColoring(channels, edges) {
  const sorted = [...channels].sort();
  const n = sorted.length;
  const index = new Map(sorted.map((c, i) => [c, i]));

  const adj = new Int32Array(n);
  for (const [a, b] of edges) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) {
      throw new InputError(`干扰关系 ${a}-${b} 的端点不在通道列表中`, { field: 'edges' });
    }
    if (i === j) {
      throw new InputError(`干扰关系 ${a}-${b} 为自环`, { field: 'edges' });
    }
    adj[i] |= 1 << j;
    adj[j] |= 1 << i;
  }
  const degree = Array.from(adj, (m) => popcount32(m));

  // 已知可行上界（贪心 DSATUR）与可证明下界（最大团贪心下界）。
  const ubColors = greedyDsaturColoring(adj, n, degree);
  let best = Math.max(...ubColors) + 1;
  const rootLower = cliqueLowerBound(adj, (1 << n) - 1, Infinity);

  const proof = {
    upperBound: best,
    lowerBound: rootLower,
    searchNodes: 0,
    pruned: 0,
    earlyExit: false,
  };

  let bestColors = ubColors;

  if (rootLower < best) {
    // 分支定界主过程。
    const colorOf = new Int32Array(n).fill(-1);
    const counts = []; // counts[c] = 已染颜色 c 的顶点数
    const colorMaskOf = new Int32Array(n); // 各顶点邻居已占用的颜色集合（位掩码）
    // nbrColorCount[u*n+c] = 顶点 u 的已染邻居中颜色 c 的数量。
    // 撤销染色时据此判定某位颜色是否仍被其他邻居占用，避免位掩码被误清。
    const nbrColorCount = new Uint8Array(n * n);
    const fullMask = (1 << n) - 1;
    let coloredMask = 0;
    let usedColors = 0;

    const assign = (v, c) => {
      colorOf[v] = c;
      coloredMask |= 1 << v;
      counts[c]++;
      if (counts[c] === 1) usedColors++;
      let nb = adj[v];
      while (nb) {
        const u = lowbitIndex(nb);
        nb &= nb - 1;
        const idx = u * n + c;
        nbrColorCount[idx]++;
        if (nbrColorCount[idx] === 1) colorMaskOf[u] |= 1 << c;
      }
    };
    const unassign = (v, c) => {
      counts[c]--;
      if (counts[c] === 0) usedColors--;
      colorOf[v] = -1;
      coloredMask &= ~(1 << v);
      let nb = adj[v];
      while (nb) {
        const u = lowbitIndex(nb);
        nb &= nb - 1;
        const idx = u * n + c;
        nbrColorCount[idx]--;
        if (nbrColorCount[idx] === 0) colorMaskOf[u] &= ~(1 << c);
      }
    };

    const dfs = () => {
      proof.searchNodes++;
      if (best === rootLower) return; // 已触及全局下界，精确判定完成
      if (usedColors >= best) {
        proof.pruned++; // 不可能改进当前最优
        return;
      }
      if (coloredMask === fullMask) {
        best = usedColors;
        bestColors = Array.from(colorOf);
        return;
      }
      // 下界剪枝：χ(整体) ≥ max(已用颜色数, 未染色诱导子图的团下界)。
      const uncoloredMask = fullMask & ~coloredMask;
      const lb = Math.max(usedColors, cliqueLowerBound(adj, uncoloredMask, best));
      if (lb >= best) {
        proof.pruned++;
        return;
      }
      // DSATUR 选点：饱和度降序 → 度数降序 → 编号升序（完全确定）。
      let v = -1;
      let bestSat = -1;
      let bestDeg = -1;
      let rest = uncoloredMask;
      while (rest) {
        const u = lowbitIndex(rest);
        rest &= rest - 1;
        const sat = popcount32(colorMaskOf[u]);
        if (sat > bestSat || (sat === bestSat && degree[u] > bestDeg)) {
          v = u;
          bestSat = sat;
          bestDeg = degree[u];
        }
      }
      // 依次尝试现有颜色（编号升序）。
      const forbidden = colorMaskOf[v];
      for (let c = 0; c < counts.length; c++) {
        if (counts[c] > 0 && !(forbidden & (1 << c))) {
          assign(v, c);
          dfs();
          unassign(v, c);
          if (best === rootLower) return;
        }
      }
      // 标准 Brelaz 截断：仅当启用新颜色后总数仍可能优于当前最优时才分支。
      if (usedColors + 1 < best) {
        const c = counts.length;
        counts.push(0);
        assign(v, c);
        dfs();
        unassign(v, c);
        counts.pop();
      } else {
        proof.pruned++;
      }
    };

    dfs();
  } else {
    proof.earlyExit = true; // 上界 == 下界，无需搜索即精确判定
  }

  proof.lowerBound = rootLower;
  proof.chromaticNumber = best;

  // 规范化：频段按其最小通道标识升序编号，通道按标识升序列出 —— 与录入顺序无关。
  const minIndexOfColor = new Map();
  bestColors.forEach((c, i) => {
    if (!minIndexOfColor.has(c)) minIndexOfColor.set(c, i);
  });
  const colorOrder = [...minIndexOfColor.keys()].sort(
    (a, b) => minIndexOfColor.get(a) - minIndexOfColor.get(b),
  );
  const bandOfColor = new Map(colorOrder.map((c, k) => [c, k + 1]));

  const assignment = sorted.map((ch, i) => ({
    channel: ch,
    band: bandOfColor.get(bestColors[i]),
  }));
  const bandMap = new Map();
  for (const { channel, band } of assignment) {
    if (!bandMap.has(band)) bandMap.set(band, []);
    bandMap.get(band).push(channel);
  }
  const bands = [...bandMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, chs]) => ({ band, channels: chs }));

  return { chromaticNumber: best, assignment, bands, proof };
}

/**
 * 复算校验：确认分配合法（同频段内不存在干扰边）且频段数与结论一致。
 * 页面“复算校验”与测试共用。
 */
export function verifySolution(channels, edges, result) {
  const problems = [];
  const set = new Set(channels);
  const bandOf = new Map(result.assignment.map((a) => [a.channel, a.band]));

  for (const ch of channels) {
    if (!bandOf.has(ch)) problems.push(`通道 ${ch} 缺少频段分配`);
  }
  for (const ch of bandOf.keys()) {
    if (!set.has(ch)) problems.push(`分配中出现未知通道 ${ch}`);
  }
  for (const [a, b] of edges) {
    if (bandOf.get(a) !== undefined && bandOf.get(a) === bandOf.get(b)) {
      problems.push(`干扰通道 ${a} 与 ${b} 被分入同一频段 ${bandOf.get(a)}`);
    }
  }
  const usedBands = new Set(bandOf.values());
  if (usedBands.size !== result.chromaticNumber) {
    problems.push(`实际使用频段数 ${usedBands.size} 与结论 ${result.chromaticNumber} 不一致`);
  }
  if (result.bands.length !== result.chromaticNumber) {
    problems.push(`频段清单数量 ${result.bands.length} 与结论不一致`);
  }
  for (const { band, channels: members } of result.bands) {
    for (const ch of members) {
      if (bandOf.get(ch) !== band) problems.push(`通道 ${ch} 的频段清单与分配表不一致`);
    }
  }
  return { ok: problems.length === 0, problems };
}
