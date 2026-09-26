/**
 * main.js —— 页面主线程逻辑。
 *
 * 任务代际（epoch）机制：
 *   - 每次提交、取消、编辑输入都会使 epoch 递增；
 *   - 提交时终止旧 Worker 并新建 Worker，回包仅当 id 与当前 epoch 一致才被采纳；
 *   - 因此编辑、取消或再次提交后，迟到的旧任务既不会覆盖当前草稿，也不会覆盖新结论。
 * 校验失败（自环 / 重复关系 / 不存在端点 / 数量越界等）时定位提示，并清除既有成功证据。
 */
import { parseInput, verifySolution, MIN_CHANNELS, MAX_CHANNELS, MAX_EDGES } from './coloring.js';

const els = {
  channels: document.getElementById('channels'),
  edges: document.getElementById('edges'),
  submit: document.getElementById('submit'),
  cancel: document.getElementById('cancel'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  result: document.getElementById('result'),
  chi: document.getElementById('chi'),
  bands: document.getElementById('bands'),
  assignment: document.getElementById('assignment'),
  proof: document.getElementById('proof'),
  recheck: document.getElementById('recheck'),
};

let epoch = 0; // 任务代际号，同时也是 Worker 回包校验 id
let worker = null; // 当前在跑的 Worker（若有）
let lastRun = null; // 最近一次成功结论的输入与结果，供“复算校验”使用

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.dataset.kind = kind || '';
}

function hideError() {
  els.error.hidden = true;
  els.error.textContent = '';
}

/** 清除既有成功证据（输入校验失败或 Worker 错误时调用）。 */
function clearResult() {
  els.result.hidden = true;
  els.chi.textContent = '';
  els.bands.replaceChildren();
  els.assignment.replaceChildren();
  els.proof.textContent = '';
  lastRun = null;
}

/** 终止在跑的 Worker 并使任何迟到回包失效。 */
function invalidateInFlight() {
  epoch++;
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function fieldLabel(field) {
  return field === 'channels' ? '通道列表' : field === 'edges' ? '干扰关系' : '输入';
}

function showError(err) {
  const parts = [];
  if (err.field) {
    let loc = fieldLabel(err.field);
    if (err.line != null) loc += ` · 第 ${err.line} 行`;
    if (err.index != null) loc += ` · 第 ${err.index} 项`;
    parts.push(`【${loc}】`);
  }
  parts.push(err.message || String(err));
  els.error.textContent = parts.join(' ');
  els.error.hidden = false;
}

function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function renderResult(result) {
  els.chi.textContent = String(result.chromaticNumber);

  els.bands.replaceChildren();
  for (const { band, channels } of result.bands) {
    const li = el('li');
    li.append(
      el('strong', `频段 ${band}`),
      document.createTextNode(`：${channels.join('、')}（组内无干扰边，可复算）`),
    );
    els.bands.append(li);
  }

  els.assignment.replaceChildren();
  for (const { channel, band } of result.assignment) {
    const tr = el('tr');
    tr.append(el('td', channel), el('td', `频段 ${band}`));
    els.assignment.append(tr);
  }

  const p = result.proof;
  els.proof.textContent =
    `精确判定证据：可行上界 ${p.upperBound}，可证明下界 ${p.lowerBound}` +
    (p.earlyExit
      ? '，上界等于下界，无需搜索即判定最优'
      : `，分支定界搜索节点 ${p.searchNodes} 个、剪枝 ${p.pruned} 次后收敛`) +
    '。';

  els.result.hidden = false;
}

function setRunning(running) {
  els.submit.disabled = running;
  els.cancel.disabled = !running;
}

function onSubmit() {
  invalidateInFlight();
  hideError();

  let parsed;
  try {
    parsed = parseInput(els.channels.value, els.edges.value);
  } catch (err) {
    clearResult(); // 校验失败：定位提示并清除既有成功证据
    setStatus('输入校验未通过', 'error');
    showError(err);
    return;
  }
  // 校验通过：既有结论保留展示，直至新结论到达（迟到旧任务由 epoch 机制拦截）。

  const id = epoch;
  setRunning(true);
  setStatus('求解中（Worker 内执行确定性 DSATUR 分支定界）…', 'running');

  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.id !== id || msg.id !== epoch) return; // 迟到/过期回包，丢弃
    worker.terminate();
    worker = null;
    setRunning(false);
    if (msg.ok) {
      lastRun = { channels: parsed.channels, edges: parsed.edges, result: msg.result };
      renderResult(msg.result);
      setStatus('求解完成', 'ok');
    } else {
      clearResult();
      setStatus('求解失败', 'error');
      showError(msg.error || { message: '未知错误' });
    }
  };
  worker.onerror = (event) => {
    if (id !== epoch) return;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    setRunning(false);
    clearResult();
    setStatus('求解失败', 'error');
    showError({ message: `Worker 异常：${event.message || '未知错误'}` });
  };
  worker.postMessage({ id, channels: parsed.channels, edges: parsed.edges });
}

function onCancel() {
  if (!worker) return;
  invalidateInFlight();
  setRunning(false);
  setStatus('已取消（未产生新结论，既有结论保持原样）', 'idle');
}

function onEdit() {
  // 编辑输入：在跑任务作废，迟到回包不得覆盖当前草稿或既有结论；既有结论保留展示。
  if (worker) {
    invalidateInFlight();
    setRunning(false);
    setStatus('输入已修改，在跑任务已作废；既有结论对应修改前的输入', 'idle');
  } else {
    epoch++;
    if (!els.result.hidden) {
      setStatus('输入已修改；当前结论对应修改前的输入，可重新提交', 'idle');
    }
  }
}

function onRecheck() {
  if (!lastRun) return;
  const { channels, edges, result } = lastRun;
  const check = verifySolution(channels, edges, result);
  if (check.ok) {
    setStatus(
      `复算校验通过：${result.chromaticNumber} 个频段内均不存在干扰边，分配与结论一致`,
      'ok',
    );
  } else {
    setStatus(`复算校验未通过：${check.problems.join('；')}`, 'error');
  }
}

els.submit.addEventListener('click', onSubmit);
els.cancel.addEventListener('click', onCancel);
els.recheck.addEventListener('click', onRecheck);
els.channels.addEventListener('input', onEdit);
els.edges.addEventListener('input', onEdit);

const EXAMPLES = {
  triangle: {
    channels: 'A, B, C',
    edges: 'A-B\nB-C\nA-C',
  },
  clique4: {
    channels: 'A, B, C, D',
    edges: 'A-B\nA-C\nA-D\nB-C\nB-D\nC-D',
  },
  path: {
    channels: 'A, B, C, D',
    edges: 'A-B\nB-C\nC-D',
  },
};

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    const example = EXAMPLES[btn.dataset.example];
    if (!example) return;
    invalidateInFlight();
    setRunning(false);
    hideError();
    els.channels.value = example.channels;
    els.edges.value = example.edges;
    setStatus('已载入示例，可提交求解', 'idle');
  });
}

els.channels.placeholder = `例如：A, B, C, D（${MIN_CHANNELS}~${MAX_CHANNELS} 个唯一大写字母）`;
els.edges.placeholder = `每行一条无向干扰关系，例如：\nA-B\nB-C\nC-D\n（至多 ${MAX_EDGES} 条）`;
setStatus('就绪', 'idle');
