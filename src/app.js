/* autoWaveform UI — Copyright (c) 2026 autoWaveform contributors. MIT License. */
(() => {
  'use strict';
  const C = window.WaveCore;
  const $ = (id) => document.getElementById(id);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const originalHTML = '<!doctype html>\n' + document.documentElement.outerHTML;
  const originalEmbedded = $('project-data').outerHTML;
  let storageKey = 'autowaveform.project.v1';
  let legacyStorageKey = 'wavesketch.project.v1';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const num = (value) => Math.round(value * 1e8) / 1e8;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const icons = {
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
    folder:'<path d="M3 7V5h7l2 2h9v13H3z"/>', chevron:'<path d="m8 10 4 4 4-4"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    file:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/>',
    wave:'<path d="M2 17h5V7h10v10h5"/>', save:'<path d="M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-7h10v7"/>',
    box:'<path d="m12 3 9 5v10l-9 4-9-4V8zM3 8l9 5 9-5m-9 5v9M7.5 5.5l9 5"/>',
    cursor:'<path d="m5 3 14 10-7 1-3 7z"/>', pencil:'<path d="m4 16-1 5 5-1L21 7l-4-4zM14 6l4 4"/>',
    break:'<path d="M3 16h3M18 8h3M7 20C12 20 9 4 14 4M11 20C16 20 13 4 18 4"/>',
    magnet:'<path d="M4 4v9a8 8 0 0 0 16 0V4h-5v9a3 3 0 0 1-6 0V4zM4 8h5m6 0h5"/>',
    undo:'<path d="M4 9h10a6 6 0 0 1 0 12M4 9l5-5M4 9l5 5"/>',
    redo:'<path d="M20 9H10a6 6 0 0 0 0 12m16-12-5-5m5 5-5 5"/>',
    minus:'<path d="M5 12h14"/>', plus:'<path d="M5 12h14M12 5v14"/>',
    mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v6"/>',
    rise:'<path d="M2 18h5L17 6h5"/>', fall:'<path d="M2 6h5l10 12h5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    up:'<path d="m6 12 6-6 6 6m-6-6v14"/>', down:'<path d="m6 12 6 6 6-6m-6 6V4"/>',
    copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    bus:'<path d="m2 7 4 5-4 5m20-10-4 5 4 5M6 12l3-5h6l3 5-3 5H9z"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>'
  };
  function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || '') + '</svg>'; }
  all('[data-icon]').forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
  let project, selectedId, selectedEvent = 0, selectedBreak = -1, tool = 'select', ppu = 48;
  let canvasFrame = null;
  let gesture = null, lastBusClick = null, undoStack = [], redoStack = [], saveTimer, toastTimer, storageFailed = false;
  let initialMessage = '';
  try {
    const embedded = JSON.parse($('project-data').textContent);
    if (embedded) {
      project = C.normalizeProject(embedded); initialMessage = '已载入 HTML 中的波形';
      let hash = 2166136261;
      for (const char of JSON.stringify(embedded)) hash = Math.imul(hash ^ char.charCodeAt(0),16777619) >>> 0;
      const suffix = '.' + hash.toString(36);
      storageKey += suffix;
      legacyStorageKey += suffix;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) { project = C.normalizeProject(JSON.parse(saved)); initialMessage = '已恢复本地项目'; }
      else {
        const legacySaved = localStorage.getItem(legacyStorageKey);
        if (legacySaved !== null) {
          project = C.normalizeProject(JSON.parse(legacySaved));
          initialMessage = '已恢复旧版本本地项目';
          // A new-key copy makes migration one-time; retain the old draft for older HTML copies.
          try { localStorage.setItem(storageKey, JSON.stringify(project)); }
          catch (_) { initialMessage = '已恢复旧版本草稿；自动迁移失败，请保存项目文件'; }
        }
      }
    } catch (error) { initialMessage = '本地记录不可用；请用项目文件保存作品'; }
  } catch (error) { initialMessage = '内嵌项目读取失败：' + error.message; }
  if (!project) project = C.createDemo();
  project = C.normalizeProject(project);
  selectedId = project.signals[0]?.id || null;
  const signal = () => project.signals.find((s) => s.id === selectedId);
  const currentJSON = () => JSON.stringify(project);
  const absoluteTime = (offset) => num(project.startTime + offset);
  const relativeTime = (time) => num(time - project.startTime);
  const endTime = () => absoluteTime(project.duration);
  function setTimeBounds(ids) { ids.forEach(id => { $(id).min = project.startTime; $(id).max = endTime(); }); }
  function toast(message, error = false) {
    clearTimeout(toastTimer); $('toast').textContent = message;
    $('toast').classList.toggle('error', error); $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 5500 : 3200);
  }
  function autosave() {
    clearTimeout(saveTimer); $('save-status').textContent = '正在保存…';
    const snapshot = currentJSON();
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(storageKey, snapshot); $('save-status').textContent = '已在本地保存'; storageFailed = false; }
      catch (_) { $('save-status').textContent = '请保存项目文件'; if (!storageFailed) toast('浏览器无法自动保存，请从「项目」保存 JSON 或 HTML。', true); storageFailed = true; }
    }, 250);
  }
  function history(before) {
    if (before === currentJSON()) return;
    undoStack.push(before); if (undoStack.length > 80) undoStack.shift(); redoStack = [];
    autosave();
  }
  function repairSelection() {
    if (!signal()) { selectedId = project.signals[0]?.id || null; selectedBreak = -1; }
    selectedEvent = clamp(selectedEvent, 0, (signal()?.events.length || 1) - 1);
    if (!signal()?.breaks?.[selectedBreak]) selectedBreak = -1;
  }
  function transact(action, errorTarget = null) {
    const before = currentJSON();
    try { action(); project = C.normalizeProject(project); history(before); repairSelection(); render(); if (errorTarget) $(errorTarget).textContent = ''; return true; }
    catch (error) { project = JSON.parse(before); repairSelection(); render(); if (errorTarget) $(errorTarget).textContent = error.message || '操作未完成'; else toast(error.message || '操作未完成', true); return false; }
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(currentJSON()); project = JSON.parse(undoStack.pop()); repairSelection(); render(); autosave();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(currentJSON()); project = JSON.parse(redoStack.pop()); repairSelection(); render(); autosave();
  }
  function renderCanvas() {
    if (canvasFrame !== null) { cancelAnimationFrame(canvasFrame); canvasFrame = null; }
    $('wave-canvas').innerHTML = C.renderSVG(project, {pxPerUnit:ppu,interactive:true,selectedId,selectedEvent,selectedBreak,idPrefix:'canvas'});
    if (!project.signals.length) {
      const empty = document.createElement('div'); empty.className = 'empty-canvas';
      empty.textContent = '从一个信号开始。点击下方「添加信号」，用鼠标画出你的第一段时序。';
      $('wave-canvas').appendChild(empty);
    }
  }
  function renderCanvasSoon() { if (canvasFrame === null) canvasFrame = requestAnimationFrame(() => { canvasFrame = null; renderCanvas(); }); }
  function layout() { return C.getLayout(project,{pxPerUnit:ppu}); }
  function setField(id, value) { $(id).value = value; }
  function renderInspector() {
    const s = signal(); $('signal-fields').hidden = !s; $('no-selection').hidden = !!s;
    if (!s) return;
    $('signal-kind').textContent = s.type === 'bus' ? '总线信号' : '数字信号';
    $('selected-index').textContent = String(project.signals.indexOf(s) + 1).padStart(2,'0') + ' / ' + String(project.signals.length).padStart(2,'0');
    setField('signal-name', s.name); setField('signal-font', s.fontFamily || ''); setField('signal-color', s.color); setField('color-hex', s.color.toUpperCase());
    setField('signal-width', s.width); $('width-output').textContent = s.width + ' px';
    setField('signal-rise', s.rise); setField('signal-fall', s.fall); $('digital-fields').hidden = s.type !== 'digital';
    all('.unit-label').forEach((el) => { el.textContent = project.unit; });
    all('[data-color]').forEach((el) => { el.classList.toggle('active', el.dataset.color.toLowerCase() === s.color.toLowerCase()); });
    const event = s.events[selectedEvent], end = s.events[selectedEvent + 1]?.t ?? project.duration;
    setField('interval-value', event.value); setField('interval-start', absoluteTime(event.t)); setField('interval-end', absoluteTime(end));
    setTimeBounds(['interval-start','interval-end']);
    setField('interval-color', event.color || s.color);
    $('interval-range').textContent = absoluteTime(event.t) + '–' + absoluteTime(end) + ' ' + project.unit;
    $('interval-value').maxLength = s.type === 'digital' ? 1 : 80;
    $('interval-note').textContent = '填写起止时刻，可只对部分波形着色。';
    $('move-up').disabled = project.signals.indexOf(s) === 0;
    $('move-down').disabled = project.signals.indexOf(s) === project.signals.length - 1;
    renderBreakInspector();
  }
  function renderBreakInspector() {
    const s = signal(); if (!s) return;
    const list = $('break-list'); list.replaceChildren(new Option('新增位置','-1'));
    s.breaks.forEach((t,index) => list.add(new Option(absoluteTime(t) + ' ' + project.unit,String(index))));
    list.value = selectedBreak;
    const start = s.events[selectedEvent].t, end = s.events[selectedEvent + 1]?.t ?? project.duration;
    setField('break-time',absoluteTime(selectedBreak >= 0 ? s.breaks[selectedBreak] : (start + end) / 2));
    setTimeBounds(['break-time']);
    $('apply-break').textContent = selectedBreak >= 0 ? '更新位置' : '添加断线';
    $('remove-break').disabled = selectedBreak < 0;
    $('sync-break-all').disabled = selectedBreak < 0;
  }
  function render() {
    repairSelection(); renderCanvas(); renderInspector();
    setField('project-title', project.title); setField('time-start',project.startTime); setField('time-end',endTime()); setField('time-unit', project.unit);
    $('time-range-summary').textContent = '跨度 ' + num(project.duration) + ' ' + project.unit;
    setField('font-family',project.appearance.fontFamily); setField('font-size',project.appearance.fontSize);
    setField('row-height',project.appearance.rowHeight); setField('label-width',project.appearance.labelWidth); renderTimeBreaks();
    setField('z-style',project.appearance.zStyle); setField('x-style',project.appearance.xStyle);
    $('italic-labels').checked = project.appearance.italicLabels; $('bold-labels').checked = project.appearance.boldLabels;
    $('show-axis').checked = project.appearance.showAxis; $('show-grid').checked = project.appearance.showGrid;
    if (!$('time-unit').value) { const opt = document.createElement('option'); opt.value = project.unit; opt.textContent = project.unit; $('time-unit').appendChild(opt); $('time-unit').value = project.unit; }
    if (!Array.from($('snap').options).some((opt) => +opt.value === project.step)) { const opt = document.createElement('option'); opt.value = project.step; opt.textContent = '吸附 ' + project.step + ' 格'; $('snap').appendChild(opt); }
    setField('snap', project.step); $('signal-count').textContent = project.signals.length + ' 个信号';
    $('duration-summary').textContent = project.startTime + '–' + endTime() + ' ' + project.unit;
    if (!gesture) $('cursor-status').textContent = project.startTime + '–' + endTime() + ' ' + project.unit;
    $('undo-btn').disabled = !undoStack.length; $('redo-btn').disabled = !redoStack.length;
    $('zoom-fit').textContent = Math.round(ppu / 48 * 100) + '%';
    $('zoom-in').disabled = ppu >= 192; $('zoom-out').disabled = ppu <= .5;
  }
  function chooseTool(next) {
    tool = next;
    all('[data-tool]').forEach((el) => { el.classList.toggle('active', el.dataset.tool === next); el.setAttribute('aria-pressed', String(el.dataset.tool === next)); });
    const names = {draw:'智能画笔',select:'选择 / 调整边沿',break:'插入断线','0':'绘制低电平','1':'绘制高电平',X:'绘制未知态',Z:'绘制高阻态'};
    $('mode-status').textContent = names[next]; $('wave-canvas').classList.toggle('select-mode', next === 'select');
    $('tool-hint').textContent = next === 'break' ? '点击波形添加断线；拖动标记调整位置。右侧可对齐到全部信号。' : next === 'draw' ? '上半格画 1，下半格画 0；拖动边沿自由调整，Shift 吸附。' : next === 'select' ? '拖动边沿或断线调整时刻；Shift 吸附。双击总线编辑数值。' : '拖动绘制 ' + next + '；直接拖动边沿调整时刻。';
  }
  all('[data-tool]').forEach((el) => el.addEventListener('click', () => chooseTool(el.dataset.tool)));
  function selectSignal(id, eventIndex = 0, breakIndex = -1) { selectedId = id; selectedEvent = eventIndex; selectedBreak = breakIndex; repairSelection(); renderCanvas(); renderInspector(); }
  function point(event) {
    const svg = $('wave-canvas').querySelector('svg'); const rect = svg.getBoundingClientRect();
    const l = layout();
    const x = (event.clientX - rect.left) * svg.viewBox.baseVal.width / rect.width;
    const y = (event.clientY - rect.top) * svg.viewBox.baseVal.height / rect.height;
    return {t:l.timeForX(x), x, y, gap:l.gaps.find(g => x > g.xStart && x < g.xEnd), scale:rect.width / svg.viewBox.baseVal.width, row:Math.floor((y - l.headerHeight) / l.rowHeight)};
  }
  function visibleDragTime(time,left,right,l) {
    time = clamp(time,left,right);
    if (l.isTimeVisible(time)) return time;
    const gap = l.gaps.find(g => time > g.start && time < g.end);
    const candidates = gap ? [gap.start,gap.end].filter(t => t >= left && t <= right) : [];
    return candidates.sort((a,b) => Math.abs(a - time) - Math.abs(b - time))[0];
  }
  function paintVisibleRange(s,start,end,value) {
    let changed = false;
    for (const segment of layout().segments) {
      const left = Math.max(start,segment.start), right = Math.min(end,segment.end);
      if (right > left) { C.setRange(s,left,right,value,project.duration); changed = true; }
    }
    if (!changed) throw new Error('该区间已省略，请先取消省略再修改。');
  }
  function eventAt(s, t) { let index = 0; for (let i = 1; i < s.events.length; i++) { if (s.events[i].t > t + 1e-8) break; index = i; } return index; }
  function rangeAt(t) { const start = Math.floor(clamp(t, 0, project.duration - 1e-8) / project.step + 1e-8) * project.step; return {start:num(start),end:num(Math.min(project.duration,start + project.step))}; }
  function finishGesture(event, cancel = false) {
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    const g = gesture; gesture = null;
    if ($('wave-canvas').hasPointerCapture(g.pointerId)) $('wave-canvas').releasePointerCapture(g.pointerId);
    if (cancel) { project = JSON.parse(g.before); render(); return; }
    if (g.kind === 'bus') {
      renderInspector();
      if (g.moved) openBus(g.start, g.end, C.valueAt(signal(), g.start));
      return;
    }
    try { project = C.normalizeProject(project); history(g.before); }
    catch (error) { project = JSON.parse(g.before); toast(error.message, true); }
    render();
  }
  function updateGesture(event) {
    if (!gesture) return;
    const g = gesture, p = point(event), l = layout(), s = project.signals.find(item => item.id === g.signalId);
    if (!s || selectedId !== g.signalId) { finishGesture(event,true); return; }
    g.moved ||= Math.abs(event.clientX - g.clientX) > 4;
    if (g.moved) lastBusClick = null;
    if (g.kind === 'break') {
      if (!g.moved) return;
      const rawTime = l.timeForX(p.x + g.edgeX - g.pointerX);
      const desired = event.shiftKey ? num(Math.round(rawTime / project.step) * project.step) : num(Math.round(rawTime * 1000) / 1000);
      const left = s.breaks[g.index - 1] ?? 0, right = s.breaks[g.index + 1] ?? project.duration;
      const margin = Math.min(.001,(right - left) / 1000);
      const nextTime = visibleDragTime(desired,left + margin,right - margin,l);
      if (nextTime === undefined) return;
      s.breaks[g.index] = num(nextTime);
      $('cursor-status').textContent = '断线 ' + absoluteTime(s.breaks[g.index]) + ' ' + project.unit;
      setField('break-time',absoluteTime(s.breaks[g.index])); renderCanvasSoon();
    } else if (g.kind === 'edge') {
      if (!g.moved) return;
      const rawTime = l.timeForX(p.x + g.edgeX - g.pointerX);
      const desired = event.shiftKey ? num(Math.round(rawTime / project.step) * project.step) : num(Math.round(rawTime * 1000) / 1000);
      const left = s.events[g.index - 1].t, right = s.events[g.index + 1]?.t ?? project.duration;
      const margin = Math.min(.001,(right - left) / 1000);
      const nextTime = visibleDragTime(desired,left + margin,right - margin,l);
      if (nextTime === undefined) return;
      C.moveEvent(s,g.index,nextTime,project.duration);
      $('cursor-status').textContent = absoluteTime(s.events[g.index].t) + ' ' + project.unit;
      renderCanvasSoon();
    } else {
      if (p.gap) return;
      const r = rangeAt(p.t); g.start = Math.min(g.first.start,r.start); g.end = Math.max(g.first.end,r.end);
      if (g.kind === 'paint') {
        s.events = clone(g.events);
        try { paintVisibleRange(s,g.start,g.end,g.value); selectedEvent = eventAt(s,g.start); renderCanvasSoon(); }
        catch (error) { finishGesture(event,true); toast(error.message,true); }
      } else {
        $('cursor-status').textContent = '总线区间 ' + absoluteTime(g.start) + '–' + absoluteTime(g.end) + ' ' + project.unit;
      }
    }
  }
  $('wave-canvas').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || gesture) return;
    const target = event.target.closest('[data-signal-id]');
    if (!target) return;
    const id = target.dataset.signalId, s = project.signals.find((item) => item.id === id);
    if (!s) return;
    const edge = event.target.closest('[data-edge]'), label = event.target.closest('[data-label]'), breakTarget = event.target.closest('[data-break]');
    const p = point(event);
    const l = layout();
    if (p.gap && !label) return;
    if (breakTarget && !label) {
      const index = +breakTarget.dataset.break;
      selectSignal(id,eventAt(s,p.t),index); lastBusClick = null;
      event.preventDefault(); $('wave-canvas').focus({preventScroll:true});
      gesture = {pointerId:event.pointerId,signalId:id,before:currentJSON(),kind:'break',index,
        edgeX:l.xForTime(s.breaks[index]),pointerX:p.x,clientX:event.clientX,moved:false};
      $('wave-canvas').setPointerCapture(event.pointerId); return;
    }
    if (tool === 'break' && !label && p.x >= l.labelWidth && p.x <= l.xForTime(project.duration)) {
      selectedId = id; selectedEvent = eventAt(s,p.t); selectedBreak = -1; lastBusClick = null;
      const margin = Math.min(.001,project.duration / 1000);
      const t = visibleDragTime(num(Math.round(p.t / project.step) * project.step),margin,project.duration - margin,l);
      event.preventDefault(); $('wave-canvas').focus({preventScroll:true});
      transact(() => putBreak(t)); return;
    }
    let edgeIndex = edge ? +edge.dataset.edge : -1;
    if (!label && edgeIndex < 0 && p.x >= l.labelWidth) {
      let distance = 8 / p.scale;
      s.events.forEach((entry,index) => {
        const delta = Math.abs(l.xForTime(entry.t) - p.x);
        if (index > 0 && l.isTimeVisible(entry.t) && delta < distance) { edgeIndex = index; distance = delta; }
      });
    }
    const isEdge = edgeIndex > 0;
    selectSignal(id, isEdge ? edgeIndex : eventAt(s,p.t));
    if (label || p.x < l.labelWidth || p.x > l.xForTime(project.duration)) return;
    // SVG repaint replaces pointer targets, so recognize bus double-clicks on the stable canvas.
    if (s.type === 'bus' && !isEdge) {
      const last = lastBusClick;
      lastBusClick = {id,time:event.timeStamp,x:event.clientX,y:event.clientY};
      if (last?.id === id && event.timeStamp - last.time < 500 && Math.abs(last.x - event.clientX) < 7 && Math.abs(last.y - event.clientY) < 7) {
        lastBusClick = null; event.preventDefault();
        const ev = s.events[selectedEvent]; openBus(ev.t,s.events[selectedEvent + 1]?.t ?? project.duration,ev.value); return;
      }
    } else lastBusClick = null;
    if (tool === 'select' && !isEdge) return;
    event.preventDefault(); $('wave-canvas').focus({preventScroll:true});
    const first = rangeAt(p.t);
    gesture = {pointerId:event.pointerId,signalId:id,before:currentJSON(),events:clone(s.events),first,start:first.start,end:first.end,clientX:event.clientX,moved:false,
      kind:isEdge ? 'edge' : s.type === 'bus' ? 'bus' : 'paint',index:isEdge ? edgeIndex : 0,edgeX:isEdge ? l.xForTime(s.events[edgeIndex].t) : 0,pointerX:p.x,
      value:tool === 'draw' ? (p.y - l.headerHeight - p.row * l.rowHeight < l.rowHeight / 2 ? '1' : '0') : tool};
    $('wave-canvas').setPointerCapture(event.pointerId);
    if (gesture.kind === 'paint') updateGesture(event);
  });
  $('wave-canvas').addEventListener('pointermove', (event) => {
    const p = point(event); $('cursor-status').textContent = p.gap ? '省略 ' + absoluteTime(p.gap.start) + '–' + absoluteTime(p.gap.end) + ' ' + project.unit : absoluteTime(p.t).toFixed(2) + ' ' + project.unit;
    if (gesture?.pointerId === event.pointerId) updateGesture(event);
    else {
      const s = project.signals[p.row], l = layout();
      const nearEdge = s && !p.gap && p.x >= l.labelWidth && (s.events.some((entry,index) => index > 0 && l.isTimeVisible(entry.t) && Math.abs(l.xForTime(entry.t) - p.x) * p.scale < 8) || s.breaks.some(t => l.isTimeVisible(t) && Math.abs(l.xForTime(t) - p.x) * p.scale < 10));
      $('wave-canvas').style.cursor = nearEdge ? 'ew-resize' : tool === 'select' ? 'default' : 'crosshair';
    }
  });
  $('wave-canvas').addEventListener('pointerup', (event) => { if (gesture?.pointerId === event.pointerId) updateGesture(event); finishGesture(event); });
  $('wave-canvas').addEventListener('pointercancel', (event) => finishGesture(event,true));
  $('wave-canvas').addEventListener('lostpointercapture', (event) => finishGesture(event,true));
  $('wave-canvas').addEventListener('dblclick', (event) => {
    if ($('bus-dialog').open || tool === 'break' || event.target.closest('[data-break]')) return;
    const p = point(event), s = project.signals[p.row];
    if (s?.type !== 'bus' || p.gap || p.x < layout().labelWidth || p.x > layout().xForTime(project.duration)) return;
    selectedId = s.id; selectedEvent = eventAt(s,p.t);
    const ev = s.events[selectedEvent]; openBus(ev.t,s.events[selectedEvent + 1]?.t ?? project.duration,ev.value);
  });
  function openDialog(id) { $('file-menu').hidden = true; $('file-btn').setAttribute('aria-expanded','false'); $(id).showModal(); }
  all('.close-dialog').forEach((el) => el.addEventListener('click', () => el.closest('dialog').close()));
  all('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
  function openAdd() {
    if (project.signals.length >= 64) { toast('最多支持 64 路信号',true); return; }
    setField('new-name','signal_' + (project.signals.length + 1)); setField('new-value','0');
    document.querySelector('[name="signal-type"][value="digital"]').checked = true;
    $('add-error').textContent = ''; openDialog('add-dialog'); $('new-name').select();
  }
  $('add-btn').addEventListener('click',openAdd); $('empty-add-btn').addEventListener('click',openAdd);
  all('[name="signal-type"]').forEach((el) => el.addEventListener('change',() => { setField('new-value',el.value === 'bus' ? '0x00' : '0'); setField('new-name',el.value === 'bus' ? 'data[7:0]' : 'signal_' + (project.signals.length + 1)); }));
  const newId = () => 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9);
  $('add-form').addEventListener('submit',(event) => {
    event.preventDefault();
    try {
      const type = document.querySelector('[name="signal-type"]:checked').value;
      const s = C.normalizeSignal({id:newId(),name:$('new-name').value.trim() || 'signal',type,color:'#111111',width:1.5,rise:0,fall:0,events:[{t:0,value:$('new-value').value.trim()}]},project.duration);
      if (transact(() => { project.signals.push(s); selectedId = s.id; selectedEvent = 0; },'add-error')) { $('add-dialog').close(); toast('已添加 ' + s.name); }
    } catch (error) { $('add-error').textContent = error.message; }
  });
  function openBus(start,end,value) {
    setField('bus-start',absoluteTime(start)); setField('bus-end',absoluteTime(end)); setField('bus-value',value);
    setTimeBounds(['bus-start','bus-end']);
    $('bus-range-note').textContent = project.timeBreaks.length ? '只修改指定范围内的可见区间；省略区间保留原值。' : '只修改指定区间，其他区间保持原值。';
    $('bus-error').textContent = ''; openDialog('bus-dialog'); $('bus-value').select();
  }
  function applyRange(start,end,value,visibleOnly = false) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < project.startTime || end > endTime() || start >= end) throw new Error('请输入有效区间：' + project.startTime + ' ≤ 开始时刻 < 结束时刻 ≤ ' + endTime());
    if (!value.trim()) throw new Error('区间值不能为空');
    start = relativeTime(start); end = relativeTime(end);
    if (visibleOnly) paintVisibleRange(signal(),start,end,value.trim());
    else C.setRange(signal(),start,end,value.trim(),project.duration);
    selectedEvent = eventAt(signal(),start);
  }
  $('bus-form').addEventListener('submit',(event) => {
    event.preventDefault(); const start = $('bus-start').valueAsNumber, end = $('bus-end').valueAsNumber, value = $('bus-value').value;
    if (transact(() => applyRange(start,end,value,true),'bus-error')) $('bus-dialog').close();
  });
  $('apply-interval').addEventListener('click',() => { const start = $('interval-start').valueAsNumber,end = $('interval-end').valueAsNumber,value = $('interval-value').value; transact(() => applyRange(start,end,value)); });
  function colorInterval(reset = false) {
    const start = relativeTime($('interval-start').valueAsNumber), end = relativeTime($('interval-end').valueAsNumber), color = reset ? null : $('interval-color').value;
    transact(() => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > project.duration) throw new Error('请输入有效的区间起止时刻');
      C.setRangeColor(signal(),start,end,color,project.duration); selectedEvent = eventAt(signal(),start);
    });
  }
  $('apply-interval-color').addEventListener('click',() => colorInterval());
  $('reset-interval-color').addEventListener('click',() => colorInterval(true));
  function putBreak(t) {
    const s = signal(); if (!s) return;
    if (!Number.isFinite(t) || t <= 0 || t >= project.duration) throw new Error('断线时刻必须位于 ' + project.startTime + ' 与 ' + endTime() + ' ' + project.unit + ' 之间');
    const times = s.breaks.filter((_,index) => index !== selectedBreak);
    if (!times.some(time => Math.abs(time - t) < 1e-8)) times.push(t);
    times.sort((a,b) => a - b); s.breaks = times;
    selectedBreak = times.findIndex(time => Math.abs(time - t) < 1e-8);
  }
  $('break-list').addEventListener('change',() => { selectedBreak = +$('break-list').value; repairSelection(); renderCanvas(); renderBreakInspector(); });
  $('apply-break').addEventListener('click',() => { const t = relativeTime($('break-time').valueAsNumber); transact(() => putBreak(t)); });
  $('break-time').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); $('apply-break').click(); } });
  function deleteBreak() {
    if (!signal() || selectedBreak < 0) return;
    transact(() => { signal().breaks.splice(selectedBreak,1); selectedBreak = -1; });
  }
  $('remove-break').addEventListener('click',deleteBreak);
  $('sync-break-all').addEventListener('click',() => {
    const t = signal()?.breaks[selectedBreak]; if (t === undefined) return;
    if (transact(() => {
      project.signals.forEach(s => { if (!s.breaks.some(time => Math.abs(time - t) < 1e-8)) s.breaks.push(t); });
    })) toast('已在全部信号的 ' + absoluteTime(t) + ' ' + project.unit + ' 处添加断线');
  });
  function property(id,key,convert = (v) => v) {
    $(id).addEventListener('change',() => { if (!signal()) return; const value = convert($(id).value); transact(() => { signal()[key] = value; }); });
  }
  property('signal-name','name'); property('signal-font','fontFamily',v => v || null); property('signal-color','color'); property('color-hex','color',v => v.trim());
  property('signal-width','width',Number); property('signal-rise','rise',v => v === '' ? NaN : Number(v)); property('signal-fall','fall',v => v === '' ? NaN : Number(v));
  $('signal-width').addEventListener('input',() => { $('width-output').textContent = $('signal-width').value + ' px'; });
  all('[data-color]').forEach((el) => el.addEventListener('click',() => transact(() => { if(signal()) signal().color = el.dataset.color; })));
  $('clock-btn').addEventListener('click',() => { $('clock-error').textContent = ''; openDialog('clock-dialog'); });
  $('clock-form').addEventListener('submit',(event) => {
    event.preventDefault();
    const settings = {period:$('clock-period').valueAsNumber,duty:$('clock-duty').valueAsNumber / 100,phase:$('clock-phase').valueAsNumber,initial:$('clock-initial').value};
    if (transact(() => { C.generateClock(signal(),settings,project.duration); selectedEvent = 0; },'clock-error')) { $('clock-dialog').close(); toast('已生成时钟波形'); }
  });
  function moveSignal(delta) { const i = project.signals.findIndex((s) => s.id === selectedId), j = i + delta; if (i < 0 || j < 0 || j >= project.signals.length) return; transact(() => { [project.signals[i],project.signals[j]] = [project.signals[j],project.signals[i]]; }); }
  $('move-up').addEventListener('click',() => moveSignal(-1)); $('move-down').addEventListener('click',() => moveSignal(1));
  $('duplicate-btn').addEventListener('click',() => transact(() => { const s = clone(signal()); s.id = newId(); s.name = (s.name + '_copy').slice(0,64); project.signals.splice(project.signals.findIndex((item) => item.id === selectedId) + 1,0,s); selectedId = s.id; }));
  function deleteSignal() { if (!signal()) return; const name = signal().name; if (transact(() => { project.signals = project.signals.filter((s) => s.id !== selectedId); selectedEvent = 0; })) toast('已删除 ' + name + '，可撤销恢复'); }
  $('delete-btn').addEventListener('click',deleteSignal);
  $('project-title').addEventListener('change',() => { const title = $('project-title').value.trim() || '未命名波形'; transact(() => { project.title = title; }); });
  function applyTimeRange() {
    const startDraft = $('time-start').value, endDraft = $('time-end').value;
    const start = $('time-start').valueAsNumber, end = $('time-end').valueAsNumber;
    if (transact(() => { project = C.changeTimeRange(project,start,end); },'time-range-error')) {
      fit(); $('cursor-status').textContent = project.startTime + '–' + endTime() + ' ' + project.unit;
    } else { setField('time-start',startDraft); setField('time-end',endDraft); }
  }
  $('apply-time-range').addEventListener('click',applyTimeRange);
  function renderTimeBreaks() {
    setTimeBounds(['time-break-start','time-break-end']);
    $('time-break-start').placeholder = absoluteTime(project.duration * .4);
    $('time-break-end').placeholder = absoluteTime(project.duration * .8);
    const list = $('time-break-list'); list.replaceChildren();
    project.timeBreaks.forEach((gap,index) => {
      const row = document.createElement('div'); row.className = 'time-break-item';
      const label = document.createElement('span'); label.textContent = absoluteTime(gap.start) + '–' + absoluteTime(gap.end) + ' ' + project.unit;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button';
      remove.dataset.removeTimeBreak = index; remove.textContent = '取消省略'; remove.setAttribute('aria-label','取消省略 ' + label.textContent);
      row.append(label,remove); list.appendChild(row);
    });
    if (!project.timeBreaks.length) { const empty = document.createElement('p'); empty.className = 'time-break-empty'; empty.textContent = '时间轴连续'; list.appendChild(empty); }
  }
  function addTimeBreak() {
    const start = relativeTime($('time-break-start').valueAsNumber), end = relativeTime($('time-break-end').valueAsNumber);
    if (transact(() => { project.timeBreaks.push({start,end}); },'time-break-error')) {
      $('time-break-start').value = ''; $('time-break-end').value = '';
    }
  }
  $('add-time-break').addEventListener('click',addTimeBreak);
  ['time-break-start','time-break-end'].forEach(id => {
    $(id).addEventListener('input',() => { $('time-break-error').textContent = ''; });
    $(id).addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); addTimeBreak(); } });
  });
  $('time-break-list').addEventListener('click',event => {
    const button = event.target.closest('[data-remove-time-break]'); if (!button) return;
    transact(() => { project.timeBreaks.splice(+button.dataset.removeTimeBreak,1); },'time-break-error');
  });
  ['time-start','time-end'].forEach(id => {
    $(id).addEventListener('input',() => { $('time-range-error').textContent = ''; });
    $(id).addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); applyTimeRange(); } });
  });
  $('time-unit').addEventListener('change',() => {
    const value = $('time-unit').value, startDraft = $('time-start').value, endDraft = $('time-end').value;
    transact(() => { project.unit = value; });
    setField('time-start',startDraft); setField('time-end',endDraft);
  });
  $('snap').addEventListener('change',() => { const value = +$('snap').value; transact(() => { project.step = value; }); });
  function appearanceProperty(id,key,convert = v => v) {
    $(id).addEventListener('change',() => { const value = $(id).type === 'checkbox' ? $(id).checked : convert($(id).value); transact(() => { project.appearance[key] = value; }); });
  }
  appearanceProperty('show-grid','showGrid'); appearanceProperty('show-axis','showAxis');
  appearanceProperty('font-family','fontFamily'); appearanceProperty('font-size','fontSize',Number);
  appearanceProperty('italic-labels','italicLabels'); appearanceProperty('bold-labels','boldLabels');
  appearanceProperty('row-height','rowHeight',Number); appearanceProperty('label-width','labelWidth',Number);
  appearanceProperty('z-style','zStyle'); appearanceProperty('x-style','xStyle');
  $('monochrome-btn').addEventListener('click',() => transact(() => {
    project.signals.forEach(s => { s.color = '#111111'; s.width = 1.5; s.events.forEach(e => { delete e.color; }); });
  }));
  function tab(name) { ['signal','canvas'].forEach((item) => { $(item + '-tab').classList.toggle('active',item === name); $(item + '-tab').setAttribute('aria-selected',String(item === name)); $(item + '-panel').hidden = item !== name; }); }
  $('signal-tab').addEventListener('click',() => tab('signal')); $('canvas-tab').addEventListener('click',() => tab('canvas'));
  function zoom(value) { ppu = clamp(value,.5,192); render(); }
  function fit() { const l = layout(); zoom(($('canvas-scroll').clientWidth - (l.width - l.visibleDuration * l.ppu)) / l.visibleDuration); }
  $('zoom-in').addEventListener('click',() => zoom(ppu * 1.25)); $('zoom-out').addEventListener('click',() => zoom(ppu / 1.25)); $('zoom-fit').addEventListener('click',fit);
  $('undo-btn').addEventListener('click',undo); $('redo-btn').addEventListener('click',redo);
  $('file-btn').addEventListener('click',() => { $('file-menu').hidden = !$('file-menu').hidden; $('file-btn').setAttribute('aria-expanded',String(!$('file-menu').hidden)); });
  document.addEventListener('click',(event) => { if (!event.target.closest('.menu-wrap')) { $('file-menu').hidden = true; $('file-btn').setAttribute('aria-expanded','false'); } });
  function replaceProject(next) { transact(() => { project = next; selectedId = project.signals[0]?.id || null; selectedEvent = 0; selectedBreak = -1; }); fit(); $('file-menu').hidden = true; toast('已载入项目，撤销可恢复上一幅图'); }
  $('new-btn').addEventListener('click',() => replaceProject(C.createBlank())); $('demo-btn').addEventListener('click',() => replaceProject(C.createDemo()));
  $('help-btn').addEventListener('click',() => openDialog('help-dialog'));
  document.querySelector('.brand').addEventListener('click',e => {e.preventDefault();openDialog('help-dialog');});
  function filename(extension) { return (project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,80) || 'autoWaveform') + '.' + extension; }
  function download(blob,name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),30000); }
  function saveJSON() { download(new Blob([JSON.stringify(project,null,2)],{type:'application/json;charset=utf-8'}),filename('json')); $('file-menu').hidden = true; toast('已保存可继续编辑的项目文件'); }
  $('save-json-btn').addEventListener('click',saveJSON);
  $('save-html-btn').addEventListener('click',() => {
    const safe = currentJSON().replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const embedded = '<script type="application/json" id="project-data">' + safe + '<' + '/script>';
    const html = originalHTML.replace(originalEmbedded,() => embedded);
    download(new Blob([html],{type:'text/html;charset=utf-8'}),filename('html')); $('file-menu').hidden = true; toast('已保存包含当前波形的单文件 HTML');
  });
  $('open-btn').addEventListener('click',() => { $('file-menu').hidden = true; $('file-input').click(); });
  $('file-input').addEventListener('change',async () => {
    const file = $('file-input').files[0]; if (!file) return;
    try { if (file.size > 8 * 1024 * 1024) throw new Error('项目文件不能超过 8 MB'); const imported = C.normalizeProject(JSON.parse(await file.text())); replaceProject(imported); }
    catch (error) { toast('无法打开项目：' + error.message,true); }
    finally { $('file-input').value = ''; }
  });
  let customExportWidth = false, exportBusy = false;
  function defaultExportLayout() { const l = layout(); return C.getLayout(project,{pxPerUnit:Math.min(48,(12000 - l.gaps.length * l.gapWidth) / l.visibleDuration)}); }
  function resetExportWidth() {
    const l = defaultExportLayout(); customExportWidth = false;
    $('export-width').value = Math.max(l.minWidth,Math.ceil(l.width));
  }
  function exportSettings() {
    const width = Number($('export-width').value), minWidth = C.getLayout(project).minWidth;
    if (!Number.isInteger(width) || width < minWidth || width > 16000) throw new Error('图形宽度须为 ' + minWidth + '–16000 px 的整数。');
    const l = C.getLayout(project,{width});
    const scale = $('export-scale').value === 'auto' ? Math.min(2,16000 / l.width,16000 / l.height,Math.sqrt(24000000 / (l.width * l.height))) : +$('export-scale').value;
    return {width,layout:l,scale};
  }
  function exportSVG(width) { return C.renderSVG(project,{width,interactive:false,background:$('export-background').value,idPrefix:'export'}); }
  function pngDimensions(width,height,scale) {
    width = Math.ceil(width * scale); height = Math.ceil(height * scale);
    if (width > 32767 || height > 32767 || width * height > 32000000) throw new Error('图片尺寸过大，请减小图形宽度、选择「自适应 · 大图」，或导出 SVG。');
    return {width,height};
  }
  function exportFormat() { return document.querySelector('[name="export-format"]:checked').value; }
  function exportPreview() {
    const format = exportFormat(), isPNG = format === 'png', isPPT = format === 'pptx';
    $('export-scale').disabled = !isPNG; $('export-background').disabled = isPPT;
    $('export-submit').innerHTML = icon('download') + '下载 ' + format.toUpperCase();
    $('export-format-note').textContent = isPPT ? '在 PPT 中可改线宽、颜色、字体' : isPNG ? '实际像素 = 图形宽度 × 倍率' : '按信号分组的独立路径';
    $('export-width').removeAttribute('aria-invalid');
    try {
      const settings = exportSettings();
      const size = isPNG ? pngDimensions(settings.layout.width,settings.layout.height,settings.scale) : settings.layout;
      $('export-preview').innerHTML = exportSVG(settings.width);
      $('export-size').textContent = size.width + ' × ' + size.height + (isPNG ? ' px' : isPPT ? ' · 图形排布' : ' px · 矢量');
      $('export-error').textContent = ''; $('export-submit').disabled = exportBusy;
    } catch (error) {
      $('export-preview').replaceChildren(); $('export-size').textContent = '';
      $('export-error').textContent = error.message; $('export-submit').disabled = true;
      $('export-width').setAttribute('aria-invalid','true');
    }
  }
  $('export-btn').addEventListener('click',() => {
    $('export-width').min = C.getLayout(project).minWidth;
    if (!customExportWidth) resetExportWidth();
    exportPreview(); openDialog('export-dialog');
  });
  $('export-width').addEventListener('input',() => { customExportWidth = true; exportPreview(); });
  $('export-width-reset').addEventListener('click',() => { resetExportWidth(); exportPreview(); });
  all('[name="export-format"]').forEach(el => el.addEventListener('change',exportPreview)); $('export-background').addEventListener('change',exportPreview); $('export-scale').addEventListener('change',exportPreview);
  async function pngBlob(svg,scale) {
    const doc = new DOMParser().parseFromString(svg,'image/svg+xml'); const source = doc.documentElement;
    const {width,height} = pngDimensions(+source.getAttribute('width'),+source.getAttribute('height'),scale);
    const url = URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const img = new Image(); await new Promise((resolve,reject) => { img.onload = resolve; img.onerror = () => reject(new Error('波形图片渲染失败，请尝试 SVG 导出')); img.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器不支持图片绘制，请使用 SVG');
      ctx.drawImage(img,0,0,width,height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      if (!blob) throw new Error('PNG 生成失败，请降低分辨率'); return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  $('export-form').addEventListener('submit',async (event) => {
    event.preventDefault(); if (exportBusy) return;
    exportBusy = true; $('export-submit').disabled = true; $('export-error').textContent = '';
    try {
      const format = exportFormat(), settings = exportSettings(), svg = exportSVG(settings.width);
      let blob;
      if (format === 'pptx') {
        const data = await window.WavePptx.exportPptx(project,{width:settings.width});
        blob = new Blob([data],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
      } else if (format === 'png') blob = await pngBlob(svg,settings.scale);
      else blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg],{type:'image/svg+xml;charset=utf-8'});
      download(blob,filename(format)); $('export-dialog').close(); toast('已导出 ' + format.toUpperCase());
    } catch (error) { $('export-error').textContent = error.message; }
    finally { exportBusy = false; $('export-submit').disabled = $('export-width').getAttribute('aria-invalid') === 'true'; }
  });
  document.addEventListener('keydown',(event) => {
    if (gesture) {
      if (event.key === 'Escape') finishGesture(null,true);
      if (event.ctrlKey || event.metaKey || ['Escape','Delete','Backspace'].includes(event.key)) event.preventDefault();
      return;
    }
    const editable = event.target.closest('input,select,textarea,[contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveJSON(); return; }
    if (document.querySelector('dialog[open]') || editable) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'v') chooseTool('select'); else if (key === 'd') chooseTool('draw');
    else if (key === 'b') chooseTool('break');
    else if (['0','1','x','z'].includes(key)) chooseTool(key.toUpperCase());
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); selectedBreak >= 0 ? deleteBreak() : deleteSignal(); }
  });
  window.addEventListener('blur',() => { if (gesture) finishGesture(null,true); });
  window.addEventListener('beforeunload',() => { if (saveTimer) { try { localStorage.setItem(storageKey,gesture ? gesture.before : currentJSON()); } catch (_) {} } });
  render(); chooseTool('select');
  if ($('canvas-scroll').clientWidth > 450) fit();
  if (initialMessage) toast(initialMessage);
})();
