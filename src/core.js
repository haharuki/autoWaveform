/* autoWaveform core — MIT License. No browser APIs or dependencies required. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WaveCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const HEADER_HEIGHT = 16;
  const LABEL_WIDTH = 132;
  const ROW_HEIGHT = 64;
  const FONT_FAMILIES = Object.freeze(['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Courier New']);
  const EPS = 1e-8;
  const LIMITS = Object.freeze({ maxSignals: 64, maxEvents: 4096, maxTotalEvents: 20000 });
  let nextId = 1;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const round = (v) => Math.round(v * 1e9) / 1e9;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const fmt = (v) => String(round(v));
  function fail(message) { throw new Error(message); }
  function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + '格式不正确');
  }
  function number(value, fallback, min, max, name) {
    if (value === undefined) return fallback;
    if (!finite(value) || value < min || value > max) fail(name + '必须在 ' + min + '–' + max + ' 之间');
    return value;
  }
  function text(value, fallback, max, name) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(name + '格式不正确或过长');
    for (const character of value) {
      const codepoint = character.codePointAt(0);
      if ((codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint === 0xfffe || codepoint === 0xffff) fail(name + '包含无法导出为 SVG 的字符');
    }
    return value;
  }
  function valueFor(type, value) {
    if (type === 'digital') {
      if (value === 0 || value === 1) value = String(value);
      if (typeof value !== 'string' || !/^[01XZ]$/i.test(value)) fail('数字信号仅支持 0、1、X、Z');
      return value.toUpperCase();
    }
    return text(value, '', 128, '总线值');
  }
  function colorFor(value, fallback) {
    const color = text(value, fallback, 9, '线条颜色');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail('线条颜色应为六位十六进制颜色');
    return color.toLowerCase();
  }
  function fontFor(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (!FONT_FAMILIES.includes(value)) fail('不支持的字体');
    return value;
  }
  function boolean(value, fallback, name) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail(name + '必须为布尔值');
    return value;
  }
  function choice(value, fallback, choices, name) {
    if (value === undefined) return fallback;
    if (!choices.includes(value)) fail(name + '格式不正确');
    return value;
  }
  function normalizeAppearance(raw) {
    if (raw === undefined) raw = {};
    object(raw, '图形外观');
    return {
      fontFamily: fontFor(raw.fontFamily, 'Times New Roman'),
      fontSize: number(raw.fontSize, 18, 10, 36, '字体大小'),
      italicLabels: boolean(raw.italicLabels, true, '斜体标签'),
      boldLabels: boolean(raw.boldLabels, false, '粗体标签'),
      showAxis: boolean(raw.showAxis, true, '显示时间轴'),
      showGrid: boolean(raw.showGrid, false, '显示网格'),
      zStyle: choice(raw.zStyle, 'hatch', ['hatch', 'line'], 'Z 状态样式'),
      xStyle: choice(raw.xStyle, 'crosshatch', ['crosshatch', 'cross'], 'X 状态样式'),
      rowHeight: number(raw.rowHeight, ROW_HEIGHT, 48, 120, '行高'),
      labelWidth: number(raw.labelWidth, LABEL_WIDTH, 80, 300, '名称列宽度')
    };
  }
  const equalState = (a, b) => a.value === b.value && a.color === b.color;
  function copyEvent(event, t = event.t) {
    const copy = { t: round(t), value: event.value };
    if (event.color) copy.color = event.color;
    return copy;
  }
  function canonical(events) {
    const result = [];
    for (const event of events) {
      const entry = copyEvent(event);
      if (result.length && Math.abs(entry.t - result[result.length - 1].t) < EPS) {
        entry.t = result[result.length - 1].t;
        result[result.length - 1] = entry;
        if (result.length > 1 && equalState(result[result.length - 2], entry)) result.pop();
      } else if (!result.length || !equalState(result[result.length - 1], entry)) result.push(entry);
    }
    return result;
  }
  function normalizeSignal(raw, duration) {
    object(raw, '信号');
    number(duration, undefined, 0.25, 1000, '时长');
    const type = raw.type === undefined ? 'digital' : raw.type;
    if (type !== 'digital' && type !== 'bus') fail('不支持的信号类型');
    const id = text(raw.id, 'signal-' + nextId++, 80, '信号 ID');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('信号 ID 格式不正确');
    const color = colorFor(raw.color, '#111111');
    const source = raw.events === undefined ? [{ t: 0, value: type === 'bus' ? '0x00' : '0' }] : raw.events;
    if (!Array.isArray(source) || !source.length || source.length > LIMITS.maxEvents) fail('每个信号需要 1–4096 个状态节点');
    let previous = -1;
    const events = source.map((event, index) => {
      object(event, '状态节点');
      if (!own(event, 'value') || !finite(event.t) || event.t < 0 || event.t > duration || event.t <= previous) fail('节点时间必须按顺序排列，且位于时间轴范围内');
      if (index === 0 && event.t !== 0) fail('信号的首个节点必须从 0 开始');
      previous = event.t;
      const normalized = { t: event.t, value: valueFor(type, event.value) };
      if (event.color !== undefined && event.color !== null) normalized.color = colorFor(event.color);
      return normalized;
    }).filter((event) => event.t < duration);
    const breakSource = raw.breaks === undefined ? [] : raw.breaks;
    if (!Array.isArray(breakSource) || breakSource.length > 64 || breakSource.some((t) => !finite(t) || t <= 0 || t >= duration)) fail('断线位置必须在时间轴内部，且每个信号最多支持 64 处断线');
    const breaks = breakSource.map(round).sort((a, b) => a - b).filter((t, i, all) => t > 0 && t < duration && (!i || t - all[i - 1] >= EPS));
    return {
      id, name: text(raw.name, '新信号', 80, '信号名称'), type, color,
      width: number(raw.width, 1.5, 0.5, 8, '线宽'),
      rise: number(raw.rise, 0, 0, 1000, '上升时间'),
      fall: number(raw.fall, 0, 0, 1000, '下降时间'),
      fontFamily: fontFor(raw.fontFamily, null),
      breaks,
      events: canonical(events)
    };
  }
  function normalizeProject(raw) {
    object(raw, '工程');
    if (raw.version !== VERSION) fail('工程版本不受支持');
    const duration = number(raw.duration, 16, 0.25, 1000, '时长');
    const startTime = number(raw.startTime, 0, -1000000, 1000000, '开始时刻');
    if (Math.abs(round(startTime + duration)) > 1000000) fail('结束时刻必须在 -1000000–1000000 之间');
    if (!Array.isArray(raw.signals) || raw.signals.length > LIMITS.maxSignals) fail('信号列表格式不正确，最多支持 64 路信号');
    if (raw.signals.reduce((count, signal) => count + (Array.isArray(signal && signal.events) ? signal.events.length : 0), 0) > LIMITS.maxTotalEvents) fail('工程节点总数不能超过 20000');
    const signals = raw.signals.map((signal) => normalizeSignal(signal, duration));
    if (new Set(signals.map((signal) => signal.id)).size !== signals.length) fail('信号 ID 不能重复');
    return {
      version: VERSION, title: text(raw.title, '未命名波形', 128, '标题'), startTime, duration,
      unit: text(raw.unit, 'ns', 16, '时间单位'),
      step: number(raw.step, Math.min(1, duration), 0.001, 1000, '网格步长'), appearance: normalizeAppearance(raw.appearance), signals
    };
  }
  function createBlank() {
    return { version: VERSION, title: '未命名波形', startTime: 0, duration: 16, unit: 'ns', step: 1, appearance: normalizeAppearance(), signals: [] };
  }
  function createDemo() {
    const make = (id, name, type, pairs) => normalizeSignal({ id, name, type, events: pairs.map(([t, value, color]) => color ? { t, value, color } : { t, value }) }, 16);
    return {
      version: VERSION, title: 'SPI 总线时序', startTime: 0, duration: 16, unit: 'ns', step: 1, appearance: normalizeAppearance(),
      signals: [
        make('clk', 'clk', 'digital', Array.from({ length: 16 }, (_, t) => [t, String(t % 2)])),
        make('rst_n', 'rst_n', 'digital', [[0, '0'], [2, '1']]),
        make('cs_n', 'cs_n', 'digital', [[0, '1'], [3, '0'], [13, '1']]),
        make('mosi', 'mosi', 'digital', [[0, '0'], [3, '1'], [5, '0'], [6, '1'], [7, '0'], [9, '1'], [11, '0'], [12, '1'], [13, '0']]),
        make('data', 'data[7:0]', 'bus', [[0, 'Z'], [3, '0xA5'], [8, '0x3C'], [13, 'Z']]),
        make('ack', 'ack', 'digital', [[0, '0'], [12, '1', '#b32025'], [14, '0']])
      ]
    };
  }
  function changeTimeRange(raw, start, end) {
    if (!finite(start) || !finite(end) || Math.abs(start) > 1000000 || Math.abs(end) > 1000000) fail('起止时刻必须是 -1000000–1000000 之间的有效数值');
    const duration = round(end - start);
    number(duration, undefined, 0.25, 1000, '时间跨度');
    const p = normalizeProject(raw);
    p.startTime = start;
    p.duration = duration;
    for (const signal of p.signals) {
      signal.events = signal.events.filter((event) => event.t < duration);
      signal.breaks = signal.breaks.filter((t) => t < duration);
    }
    return normalizeProject(p);
  }
  function stateAt(signal, t) {
    let low = 0, high = signal.events.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (signal.events[middle].t <= t + EPS) low = middle;
      else high = middle - 1;
    }
    return signal.events[low];
  }
  function valueAt(signal, t) { return stateAt(signal, t).value; }
  function editRange(signal, start, end, duration, edit) {
    if (!finite(start) || !finite(end) || !finite(duration)) fail('编辑范围必须为有效时间');
    start = round(Math.max(0, Math.min(duration, start)));
    end = round(Math.max(0, Math.min(duration, end)));
    if (end < start) [start, end] = [end, start];
    if (start < EPS) start = 0;
    if (duration - end < EPS) end = duration;
    if (end - start < EPS) return signal;
    const events = signal.events.map((event) => copyEvent(event));
    if (!events.some((event) => Math.abs(event.t - start) < EPS)) events.push(copyEvent(stateAt(signal, start), start));
    if (end < duration - EPS && !events.some((event) => Math.abs(event.t - end) < EPS)) events.push(copyEvent(stateAt(signal, end), end));
    for (const event of events) if (event.t >= start - EPS && event.t < end - EPS) edit(event);
    events.sort((a, b) => a.t - b.t);
    const next = canonical(events);
    if (next.length > LIMITS.maxEvents) fail('每个信号最多支持 4096 个状态节点');
    signal.events = next;
    return signal;
  }
  function setRange(signal, start, end, value, duration) {
    value = valueFor(signal.type, value);
    return editRange(signal, start, end, duration, (event) => { event.value = value; });
  }
  function setRangeColor(signal, start, end, color, duration) {
    const checked = color === null ? null : colorFor(color);
    return editRange(signal, start, end, duration, (event) => { if (checked === null) delete event.color; else event.color = checked; });
  }
  function moveEvent(signal, index, t, duration) {
    if (!Number.isInteger(index) || index <= 0 || index >= signal.events.length || !finite(t)) return signal;
    const left = signal.events[index - 1].t;
    const right = signal.events[index + 1] ? signal.events[index + 1].t : duration;
    const gap = Math.min(Math.max(1e-6, duration * 1e-8), (right - left) / 4);
    const lower = left + gap;
    const upper = right - gap;
    signal.events[index].t = round(Math.max(lower, Math.min(upper, t)));
    return signal;
  }
  function generateClock(signal, settings, duration) {
    if (signal.type !== 'digital') fail('仅数字信号支持生成时钟');
    const period = number(settings.period, 2, 0.001, 2000, '时钟周期');
    const duty = number(settings.duty, 0.5, 0.001, 0.999, '占空比');
    const phase = number(settings.phase, 0, 0, duration, '相位');
    const initial = settings.initial === undefined ? '0' : valueFor('digital', settings.initial);
    if (initial !== '0' && initial !== '1') fail('时钟初始状态必须为 0 或 1');
    const events = [{ t: 0, value: initial }];
    let t = phase + period * (initial === '1' ? duty : 1 - duty);
    let value = initial;
    while (t < duration - EPS) {
      value = value === '1' ? '0' : '1';
      events.push({ t: round(t), value });
      if (events.length > LIMITS.maxEvents) fail('周期过短，生成时钟将超过 4096 个节点');
      t += period * (value === '1' ? duty : 1 - duty);
    }
    signal.events = canonical(events);
    return signal;
  }
  function axisMetrics(p, ppu) {
    const fontSize = p.appearance.fontSize * 0.8;
    const measure = (value) => Array.from(fmt(value)).reduce((width, c) => width + fontSize * (c === '.' ? 0.3 : c === '-' ? 0.36 : 0.56), 0);
    const startWidth = measure(p.startTime), endWidth = measure(p.startTime + p.duration);
    const spacing = Math.max(38, p.appearance.fontSize * 2, startWidth + 16, endWidth + 16);
    return { spacing, startWidth, endWidth, short: p.duration * ppu < spacing };
  }
  function layoutFor(p, options) {
    const o = options || {}, a = p.appearance;
    const ppu = number(o.pxPerUnit, 48, 0.01, 10000, '缩放比例');
    const rowHeight = number(o.rowHeight, a.rowHeight, 48, 120, '行高');
    const labelWidth = number(o.labelWidth, a.labelWidth, 80, 300, '名称列宽度');
    const showAxis = boolean(o.showAxis, a.showAxis, '显示时间轴');
    const axisHeight = showAxis ? Math.max(58, a.fontSize * 2 + 18) : 0;
    const metrics = axisMetrics(p, ppu);
    const rightPadding = showAxis ? Math.max(24, metrics.endWidth * (metrics.short ? 1 : 0.5) + 8) : 24;
    return {
      width: round(labelWidth + p.duration * ppu + rightPadding),
      height: round(HEADER_HEIGHT + p.signals.length * rowHeight + axisHeight + 8),
      headerHeight: HEADER_HEIGHT, rowHeight, labelWidth, ppu, axisHeight
    };
  }
  function getLayout(raw, options) { return layoutFor(normalizeProject(raw), options); }
  function boundedText(value, width, fontSize) {
    let size = 0, result = '';
    const measure = (c) => fontSize * (c.codePointAt(0) > 255 ? 1 : /[MW@%]/.test(c) ? 0.9 : /[il.,' ]/.test(c) ? 0.3 : 0.56);
    const chars = Array.from(value);
    if (chars.reduce((total, c) => total + measure(c), 0) <= width) return value;
    for (const c of chars) {
      if (size + measure(c) + fontSize > width) break;
      result += c; size += measure(c);
    }
    return result ? result + '…' : '';
  }
  function signalRuns(signal, duration) {
    const runs = [];
    for (let i = 0; i < signal.events.length;) {
      let j = i + 1;
      while (j < signal.events.length && signal.events[j].value === signal.events[i].value) j++;
      const run = { first: i, last: j - 1, start: signal.events[i].t, end: signal.events[j] ? signal.events[j].t : duration,
        value: signal.events[i].value, previous: i ? signal.events[i - 1].value : signal.events[i].value };
      for (let k = i; k < j; k++) runs[k] = run;
      i = j;
    }
    return runs;
  }
  function transitionDuration(signal, run) {
    return run.previous === run.value ? 0 : Math.min(run.end - run.start, run.value === '1' ? signal.rise : signal.fall);
  }
  function transitionColor(signal, event, run) {
    // An explicit destination color owns an edge; otherwise a colored outgoing
    // interval carries its color to the edge without recoloring the next plateau.
    return event.color || signal.events[run.first - 1]?.color || signal.color;
  }
  function visibleColorAt(signal, t, runs) {
    const event = stateAt(signal, t), i = signal.events.indexOf(event), run = runs[i];
    const onTransition = signal.type === 'digital' && /^[01]$/.test(event.value) && run.previous !== event.value &&
      (Math.abs(t - run.start) < EPS || t < run.start + transitionDuration(signal, run));
    return onTransition ? transitionColor(signal, event, run) : event.color || signal.color;
  }
  function clipSegmentToPolygon(a, b, polygon) {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const next = polygon[(i + 1) % polygon.length];
      area += polygon[i][0] * next[1] - next[0] * polygon[i][1];
    }
    const direction = area >= 0 ? 1 : -1, dx = b[0] - a[0], dy = b[1] - a[1];
    let from = 0, to = 1;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const atStart = direction * (ex * (a[1] - p[1]) - ey * (a[0] - p[0]));
      const rate = direction * (ex * dy - ey * dx);
      if (Math.abs(rate) < EPS) { if (atStart < -EPS) return null; }
      else if (rate > 0) from = Math.max(from, -atStart / rate);
      else to = Math.min(to, -atStart / rate);
      if (to - from < EPS) return null;
    }
    return [[a[0] + dx * from, a[1] + dy * from], [a[0] + dx * to, a[1] + dy * to]];
  }
  function mergedGaps(centers) {
    const gaps = [];
    for (const center of centers) {
      const left = center - 8, right = center + 8, last = gaps[gaps.length - 1];
      if (last && left <= last[1]) last[1] = Math.max(last[1], right);
      else gaps.push([left, right]);
    }
    return gaps;
  }
  function clipPolylineGaps(points, gaps) {
    const pieces = [];
    let current = [];
    const flush = () => { if (current.length > 1) pieces.push(current); current = []; };
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1];
      let ranges = [[0, 1]];
      for (const [left, right] of gaps) {
        if (Math.abs(dx) < EPS) {
          if (a[0] > left + EPS && a[0] < right - EPS) { ranges = []; break; }
          continue;
        }
        const ends = [(left - a[0]) / dx, (right - a[0]) / dx].sort((p, q) => p - q);
        const from = Math.max(0, ends[0]), to = Math.min(1, ends[1]);
        if (to - from < EPS) continue;
        ranges = ranges.flatMap(([r0, r1]) => {
          if (to <= r0 || from >= r1) return [[r0, r1]];
          const result = [];
          if (from > r0 + EPS) result.push([r0, from]);
          if (to < r1 - EPS) result.push([to, r1]);
          return result;
        });
      }
      if (!ranges.length) { flush(); continue; }
      for (const [from, to] of ranges) {
        const first = [round(a[0] + from * dx), round(a[1] + from * dy)];
        const last = [round(a[0] + to * dx), round(a[1] + to * dy)];
        if (!same(current[current.length - 1], first)) { flush(); current.push(first); }
        if (!same(current[current.length - 1], last)) current.push(last);
        if (to < 1 - EPS) flush();
      }
    }
    flush();
    return pieces;
  }
  function largestVisibleWindow(start, end, gaps) {
    let best = [start, start], cursor = start;
    for (const [left, right] of gaps) {
      if (right <= cursor || left >= end) continue;
      const stop = Math.min(left, end);
      if (stop - cursor > best[1] - best[0]) best = [cursor, stop];
      cursor = Math.max(cursor, Math.min(end, right));
    }
    if (end - cursor > best[1] - best[0]) best = [cursor, end];
    return best;
  }
  function sceneFor(p, options) {
    const o = options || {}, a = p.appearance, l = layoutFor(p, o);
    const { width, height, rowHeight, labelWidth, ppu } = l;
    const elements = [], x = (t) => round(labelWidth + t * ppu);
    const sceneIds = new Set();
    function uniqueId(id) {
      let result = id, suffix = 2;
      while (sceneIds.has(result)) result = id + '-' + suffix++;
      sceneIds.add(result);
      return result;
    }
    function line(id, points, stroke, strokeWidth, signalId, dash, role) {
      const rounded = points.map((point) => point.map(round)).filter((point, i, all) => !i || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
      const element = { kind: 'polyline', id: uniqueId(id), points: rounded, stroke, strokeWidth, fill: 'none' };
      if (signalId) element.signalId = signalId;
      if (dash) element.dash = dash;
      if (role) element.role = role;
      elements.push(element);
    }
    function label(id, xx, y, value, settings) {
      const s = settings || {};
      elements.push({ kind: 'text', id: uniqueId(id), x: round(xx), y: round(y), text: value, fontFamily: s.fontFamily || a.fontFamily, fontSize: s.fontSize || a.fontSize,
        bold: Boolean(s.bold), italic: Boolean(s.italic), anchor: s.anchor || 'start', fill: s.fill || '#111111', ...(s.signalId ? { signalId: s.signalId } : {}), ...(s.role ? { role: s.role } : {}) });
    }
    const metrics = axisMetrics(p, ppu);
    let tick = p.step;
    while (tick * ppu < metrics.spacing) tick *= 2;
    while (p.duration / tick > 250) tick *= 2;
    const ticks = [];
    for (let t = 0; t <= p.duration + EPS; t += tick) ticks.push(round(t));
    if (Math.abs(ticks[ticks.length - 1] - p.duration) > EPS) {
      while (ticks.length > 1 && (p.duration - ticks[ticks.length - 1]) * ppu < metrics.spacing) ticks.pop();
      ticks.push(p.duration);
    }
    const bottom = HEADER_HEIGHT + p.signals.length * rowHeight;
    if (boolean(o.showGrid, a.showGrid, '显示网格')) ticks.forEach((t, i) => line('grid-' + i, [[x(t), HEADER_HEIGHT], [x(t), bottom]], '#dedede', 0.65, null, 'dot'));
    p.signals.forEach((s, row) => {
      const signalElementStart = elements.length;
      const top = HEADER_HEIGHT + row * rowHeight, mid = top + rowHeight / 2;
      const hi = mid - 14, lo = mid + 14, fontFamily = s.fontFamily || a.fontFamily;
      const gaps = mergedGaps(s.breaks.map(x));
      const hatchSpacing = Math.max(8, p.duration * ppu / 1600);
      label(s.id + '-label', labelWidth - 18, mid + a.fontSize * 0.34, boundedText(s.name, labelWidth - 28, a.fontSize),
        { signalId: s.id, role: 'label', fontFamily, italic: a.italicLabels, bold: a.boldLabels, anchor: 'end' });
      const runs = signalRuns(s, p.duration);
      s.events.forEach((event, i) => {
        const run = runs[i], startT = event.t, endT = s.events[i + 1] ? s.events[i + 1].t : p.duration;
        const start = x(startT), end = x(endT), value = event.value, color = event.color || s.color;
        const runStart = x(run.start), runEnd = x(run.end), runSpan = runEnd - runStart;
        const id = s.id + '-segment-' + i;
        const trace = (suffix, points, dash) => line(id + '-' + suffix, points, color, s.width, s.id, dash);
        const state = value.toUpperCase(), inset = s.type === 'bus' ? Math.min(6, runSpan / 4) : 0;
        const inlet = run.first > 0 ? inset : 0, outlet = run.last < s.events.length - 1 ? inset : 0;
        const envelope = (xx, level) => {
          if (inlet && xx < runStart + inlet) return mid + (level - mid) * (xx - runStart) / inlet;
          if (outlet && xx > runEnd - outlet) return mid + (level - mid) * (runEnd - xx) / outlet;
          return level;
        };
        const corners = [start, runStart + inlet, runEnd - outlet, end].filter((xx) => xx >= start && xx <= end).sort((aa, bb) => aa - bb);
        const upper = corners.map((xx) => [xx, envelope(xx, hi)]), lower = corners.map((xx) => [xx, envelope(xx, lo)]);
        const region = [[runStart, inlet ? mid : hi], [runStart + inlet, hi], [runEnd - outlet, hi], [runEnd, outlet ? mid : hi],
          [runEnd, outlet ? mid : lo], [runEnd - outlet, lo], [runStart + inlet, lo], [runStart, inlet ? mid : lo]];
        const intervalRegion = [[start, hi], [end, hi], [end, lo], [start, lo]];
        const patterned = (state === 'Z' && a.zStyle === 'hatch') || (state === 'X' && a.xStyle === 'crosshatch');
        if (patterned) {
          const borderWidth = Math.max(0.5, s.width * 0.7), hatchWidth = Math.max(0.45, Math.min(1.2, s.width * 0.5));
          line(id + '-upper', upper, color, borderWidth, s.id, null, 'pattern-boundary');
          line(id + '-lower', lower, color, borderWidth, s.id, null, 'pattern-boundary');
          const first = Math.floor((start - labelWidth - (lo - hi)) / hatchSpacing), last = Math.ceil((end - labelWidth) / hatchSpacing);
          for (let n = first; n <= last; n++) {
            const anchor = labelWidth + n * hatchSpacing;
            const directions = state === 'X' ? [1, -1] : [1];
            for (const direction of directions) {
              let segment = clipSegmentToPolygon([anchor, direction > 0 ? lo : hi], [anchor + lo - hi, direction > 0 ? hi : lo], region);
              if (segment) segment = clipSegmentToPolygon(segment[0], segment[1], intervalRegion);
              if (segment) line(id + (direction > 0 ? '-hatch-' : '-crosshatch-') + n, segment, color, hatchWidth, s.id, null, 'hatch');
            }
          }
        } else if (state === 'X') {
          const yDown = (xx) => hi + (lo - hi) * (xx - runStart) / runSpan;
          const yUp = (xx) => lo - (lo - hi) * (xx - runStart) / runSpan;
          for (const [suffix, points] of [['x-down', [[start, yDown(start)], [end, yDown(end)]]], ['x-up', [[start, yUp(start)], [end, yUp(end)]]]]) {
            const clipped = clipSegmentToPolygon(points[0], points[1], region);
            if (clipped) trace(suffix, clipped, 'dash');
          }
          trace('upper', upper, 'dash'); trace('lower', lower, 'dash');
        } else if (s.type === 'bus' && state !== 'Z') {
          trace('upper', upper); trace('lower', lower);
        } else if (state === 'Z') {
          const window = largestVisibleWindow(runStart, runEnd, gaps);
          const center = (window[0] + window[1]) / 2, gap = s.type === 'bus' && window[1] - window[0] > 28 ? a.fontSize * 0.55 : 0;
          if (!gap) trace('z', [[start, mid], [end, mid]], 'dash');
          else {
            if (start < center - gap) trace('z-left', [[start, mid], [Math.min(end, center - gap), mid]], 'dash');
            if (end > center + gap) trace('z-right', [[Math.max(start, center + gap), mid], [end, mid]], 'dash');
          }
        } else {
          const target = value === '1' ? hi : lo;
          const from = run.previous === '1' ? hi : run.previous === '0' ? lo : mid;
          const ramp = transitionDuration(s, run);
          const rampEnd = run.start + ramp;
          const levelAt = (t) => ramp > 0 && t < rampEnd ? from + (target - from) * (t - run.start) / ramp : target;
          const edgeColor = transitionColor(s, event, run);
          const hasTransition = from !== target && (i === run.first || startT < rampEnd);
          if (hasTransition && edgeColor !== color) {
            if (ramp === 0) {
              line(id + '-edge', [[start, from], [start, target]], edgeColor, s.width, s.id);
              trace('trace', [[start, target], [end, target]]);
            } else {
              const edgeEnd = Math.min(endT, rampEnd);
              line(id + '-edge', [[start, levelAt(startT)], [x(edgeEnd), levelAt(edgeEnd)]], edgeColor, s.width, s.id);
              if (endT > rampEnd) trace('trace', [[x(rampEnd), target], [end, target]]);
            }
          } else {
            const points = [[start, levelAt(startT)]];
            if (i === run.first && from !== target && ramp === 0) points.unshift([start, from]);
            if (rampEnd > startT && rampEnd < endT) points.push([x(rampEnd), target]);
            points.push([end, levelAt(endT)]);
            trace('trace', points);
          }
        }
        if (i === run.first && s.type === 'bus' && runSpan > 28 && !patterned && state !== 'X') {
          const window = largestVisibleWindow(runStart, runEnd, gaps), center = (window[0] + window[1]) / 2;
          const centerT = (center - labelWidth) / ppu, centerColor = stateAt(s, centerT).color || s.color;
          const fontSize = a.fontSize * 0.9;
          const visible = boundedText(value, window[1] - window[0] - 20, fontSize);
          if (visible) label(id + '-value', center, mid + fontSize * 0.34, visible, { signalId: s.id, fontFamily, fontSize, anchor: 'middle', fill: centerColor });
        }
        if (i === run.first && s.type === 'digital' && state === 'Z' && a.zStyle === 'line' && runSpan > 28) {
          const window = largestVisibleWindow(runStart, runEnd, gaps);
          if (window[1] - window[0] > 24) label(id + '-value', (window[0] + window[1]) / 2, mid - 5, 'Z', { signalId: s.id, fontFamily, fontSize: a.fontSize * 0.8, anchor: 'middle', fill: color });
        }
      });
      if (gaps.length) {
        const signalElements = elements.splice(signalElementStart);
        for (const element of signalElements) {
          if (element.kind !== 'polyline') { elements.push(element); continue; }
          clipPolylineGaps(element.points, gaps).forEach((points, index) => {
            elements.push({ ...element, id: index ? uniqueId(element.id + '-part-' + (index + 1)) : element.id, points });
          });
        }
        s.breaks.forEach((t, index) => {
          const center = x(t), color = visibleColorAt(s, t, runs);
          for (let slash = 0; slash < 2; slash++) {
            const offset = slash ? 3 : -3;
            const points = Array.from({ length: 17 }, (_, n) => {
              const u = n / 16;
              return [center + offset + (u - 0.5) * 6 + Math.sin(u * Math.PI * 2) * 1.2, lo + 3 - u * (lo - hi + 6)];
            });
            line(s.id + '-break-' + index + '-slash-' + slash, points, color, s.width, s.id, null, 'break');
          }
        });
      }
    });
    if (l.axisHeight) {
      const axisY = bottom + 4, tickFont = a.fontSize * 0.8;
      line('axis-baseline', [[labelWidth, axisY], [x(p.duration), axisY]], '#111111', 1);
      ticks.forEach((t, i) => {
        line('axis-tick-' + i, [[x(t), axisY], [x(t), axisY + 5]], '#111111', 1);
        const anchor = metrics.short ? (i === 0 ? 'end' : 'start') : 'middle';
        label('axis-value-' + i, x(t), axisY + 8 + tickFont, fmt(p.startTime + t), { fontSize: tickFont, anchor });
      });
      label('axis-label', (labelWidth + x(p.duration)) / 2, bottom + l.axisHeight - 3, 'Time (' + p.unit + ')', { anchor: 'middle' });
    }
    return { width, height, elements };
  }
  function buildScene(raw, options) { return sceneFor(normalizeProject(raw), options); }
  function renderSVG(raw, options) {
    const p = normalizeProject(raw), o = options || {}, l = layoutFor(p, o), scene = sceneFor(p, o);
    const idPrefix = text(o.idPrefix, 'wave', 80, 'SVG ID 前缀');
    if (!/^[A-Za-z0-9_-]+$/.test(idPrefix)) fail('SVG ID 前缀格式不正确');
    const { width, height, rowHeight, labelWidth, ppu } = l, interactive = Boolean(o.interactive);
    const x = (t) => round(labelWidth + t * ppu);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(p.title)}">`, `<title>${esc(p.title)}</title>`];
    if (o.background !== 'transparent') parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
    if (interactive) p.signals.forEach((s, row) => {
      if (s.id !== o.selectedId) return;
      const top = HEADER_HEIGHT + row * rowHeight;
      parts.push(`<rect x="5" y="${top + 3}" width="${width - 10}" height="${rowHeight - 6}" rx="4" fill="#5577a1" fill-opacity="0.025"/>`);
      if (Number.isInteger(o.selectedEvent) && s.events[o.selectedEvent]) {
        const start = x(s.events[o.selectedEvent].t), end = x(s.events[o.selectedEvent + 1]?.t ?? p.duration);
        parts.push(`<rect x="${start}" y="${top + 7}" width="${end - start}" height="${rowHeight - 14}" fill="${s.events[o.selectedEvent].color || s.color}" fill-opacity="0.045" data-selection="interval"/>`);
      }
    });
    let activeGroup = null;
    scene.elements.forEach((element) => {
      const nextGroup = element.signalId || null;
      if (activeGroup !== nextGroup) {
        if (activeGroup) parts.push('</g>');
        activeGroup = nextGroup;
        if (activeGroup) parts.push(`<g id="${esc(idPrefix + '-signal-' + activeGroup)}" data-signal-id="${esc(activeGroup)}">`);
      }
      const id = esc(idPrefix + '-' + element.id), signalAttr = element.signalId ? ` data-signal-id="${esc(element.signalId)}"` : '';
      if (element.kind === 'polyline') {
        const d = element.points.map((point, i) => (i ? 'L ' : 'M ') + point.join(' ')).join(' ');
        parts.push(`<path id="${id}"${signalAttr} d="${d}" fill="${element.fill || 'none'}" stroke="${element.stroke}" stroke-width="${element.strokeWidth}" stroke-linejoin="miter" stroke-linecap="butt"${element.dash ? ` stroke-dasharray="${element.dash === 'dot' ? '1 4' : '5 4'}"` : ''}/>`);
      } else {
        parts.push(`<text id="${id}"${signalAttr}${element.role === 'label' && interactive ? ' data-label="true"' : ''} x="${element.x}" y="${element.y}" font-family="${esc(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.bold ? '700' : '400'}" font-style="${element.italic ? 'italic' : 'normal'}" text-anchor="${element.anchor}" fill="${element.fill}">${esc(element.text)}</text>`);
      }
    });
    if (activeGroup) parts.push('</g>');
    if (interactive) p.signals.forEach((s, row) => {
      const top = HEADER_HEIGHT + row * rowHeight, mid = top + rowHeight / 2, hi = mid - 14, lo = mid + 14, sid = esc(s.id);
      parts.push(`<g data-signal-id="${sid}"><rect x="5" y="${top + 3}" width="${labelWidth - 10}" height="${rowHeight - 6}" fill="transparent" data-label="true" data-signal-id="${sid}"/>`);
      s.events.forEach((event, i) => {
        const start = x(event.t), end = x(s.events[i + 1]?.t ?? p.duration);
        parts.push(`<rect x="${start}" y="${top + 3}" width="${end - start}" height="${rowHeight - 6}" fill="transparent" data-signal-id="${sid}" data-segment="${i}" style="cursor:crosshair"><title>${esc(s.name)} · ${fmt(p.startTime + event.t)} ${esc(p.unit)} · ${esc(event.value)}</title></rect>`);
      });
      const runs = signalRuns(s, p.duration);
      if (s.id === o.selectedId) s.events.forEach((event, i) => {
        if (!i) return;
        const xx = x(event.t), run = runs[i];
        const isTransition = s.type === 'digital' && /^[01]$/.test(event.value) && run.previous !== event.value && (i === run.first || event.t < run.start + transitionDuration(s, run));
        const color = isTransition ? transitionColor(s, event, run) : event.color || s.color;
        parts.push(`<g data-signal-id="${sid}" data-edge="${i}" style="cursor:ew-resize"><rect x="${xx - 11}" y="${hi - 7}" width="22" height="42" fill="transparent"/><circle cx="${xx}" cy="${mid}" r="3" fill="#ffffff" stroke="${color}" stroke-width="1"/></g>`);
      });
      s.breaks.forEach((t, index) => {
        const xx = x(t), color = visibleColorAt(s, t, runs), selected = s.id === o.selectedId && o.selectedBreak === index;
        parts.push(`<g data-signal-id="${sid}" data-break="${index}" style="cursor:ew-resize"><title>断线 · ${fmt(p.startTime + t)} ${esc(p.unit)}</title><rect x="${xx - 12}" y="${hi - 9}" width="24" height="46" rx="3" fill="${selected ? '#5577a1' : 'transparent'}"${selected ? ' fill-opacity="0.10"' : ''}/>`);
        if (s.id === o.selectedId) parts.push(`<circle cx="${xx}" cy="${hi - 7}" r="${selected ? 3 : 2}" fill="#ffffff" stroke="${color}" stroke-width="1"/>`);
        parts.push('</g>');
      });
      parts.push('</g>');
    });
    parts.push('</svg>');
    return parts.join('');
  }
  return Object.freeze({ VERSION, HEADER_HEIGHT, LABEL_WIDTH, ROW_HEIGHT, FONT_FAMILIES, LIMITS, createBlank, createDemo, normalizeProject, normalizeSignal, changeTimeRange, valueAt, setRange, setRangeColor, moveEvent, generateClock, getLayout, buildScene, renderSVG });
});
