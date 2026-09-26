/**
 * worker.js —— 在浏览器 Web Worker 中运行的精确求解器入口。
 * 主线程通过 postMessage 提交 { id, channels, edges }，
 * 本 Worker 以确定性 DSATUR 分支定界求精确色数后回传 { id, ok, result | error }。
 * 主线程依据 id 丢弃迟到/过期的回包，因此旧任务永远不会覆盖新结论。
 */
import { solveColoring } from './coloring.js';

self.onmessage = (event) => {
  const { id, channels, edges } = event.data || {};
  try {
    const result = solveColoring(channels, edges);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: {
        message: err && err.message ? err.message : String(err),
        field: err && err.field ? err.field : null,
        line: err && err.line ? err.line : null,
        index: err && err.index ? err.index : null,
      },
    });
  }
};
