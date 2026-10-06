/* autoWaveform editable PPTX exporter — Copyright (c) 2026 autoWaveform contributors. MIT License. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.WavePptx = factory(root.WaveCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const DRAW = NS + 'drawingml/2006/main';
  const PRES = NS + 'presentationml/2006/main';
  const REL = NS + 'officeDocument/2006/relationships';
  const EMU = 9525; // 96 pixels per inch, 914400 EMUs per inch.
  const INCH = 914400;
  const encoder = new TextEncoder();
  const escapeXML = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value.slice(1).toUpperCase() : '000000';
  const integer = value => Math.round(value);
  const fontName = value => String(value || 'Times New Roman').split(',')[0].trim().replace(/^["']|["']$/g, '') || 'Times New Roman';
  const fillXML = value => value && value !== 'none' ? '<a:solidFill><a:srgbClr val="' + color(value) + '"/></a:solidFill>' : '<a:noFill/>';

  const crcTable = Array.from({length:256}, (_, n) => {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function header(length) { const bytes = new Uint8Array(length); return {bytes,view:new DataView(bytes.buffer)}; }
  function zip(files) {
    const chunks = [], directory = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const filename = encoder.encode(name), bytes = encoder.encode(text), crc = crc32(bytes);
      const local = header(30); const l = local.view;
      l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true);
      l.setUint16(12,0x5d45,true); l.setUint32(14,crc,true); l.setUint32(18,bytes.length,true); l.setUint32(22,bytes.length,true); l.setUint16(26,filename.length,true);
      chunks.push(local.bytes,filename,bytes);
      const central = header(46); const d = central.view;
      d.setUint32(0,0x02014b50,true); d.setUint16(4,20,true); d.setUint16(6,20,true); d.setUint16(8,0x800,true);
      d.setUint16(14,0x5d45,true); d.setUint32(16,crc,true); d.setUint32(20,bytes.length,true); d.setUint32(24,bytes.length,true); d.setUint16(28,filename.length,true); d.setUint32(42,offset,true);
      directory.push(central.bytes,filename); offset += local.bytes.length + filename.length + bytes.length;
    }
    const directorySize = directory.reduce((sum, part) => sum + part.length,0), count = Object.keys(files).length;
    const end = header(22); end.view.setUint32(0,0x06054b50,true); end.view.setUint16(8,count,true); end.view.setUint16(10,count,true); end.view.setUint32(12,directorySize,true); end.view.setUint32(16,offset,true);
    const result = new Uint8Array(offset + directorySize + 22); let cursor = 0;
    for (const part of [...chunks,...directory,end.bytes]) { result.set(part,cursor); cursor += part.length; }
    return result;
  }
  function relationships(items) { return XML + '<Relationships xmlns="' + NS + 'package/2006/relationships">' + items.map(([id,type,target]) => '<Relationship Id="' + id + '" Type="' + REL + '/' + type + '" Target="' + target + '"/>').join('') + '</Relationships>'; }
  function rootGroup() { return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'; }
  function nonVisual(id,name,textBox = false) { return '<p:nvSpPr><p:cNvPr id="' + id + '" name="' + escapeXML(name) + '"/><p:cNvSpPr' + (textBox ? ' txBox="1"' : '') + '/><p:nvPr/></p:nvSpPr>'; }
  function transform(bounds) { return '<a:xfrm><a:off x="' + bounds.x + '" y="' + bounds.y + '"/><a:ext cx="' + bounds.w + '" cy="' + bounds.h + '"/></a:xfrm>'; }
  function lineXML(item,scale) {
    if (item.stroke === 'none') return '<a:ln><a:noFill/></a:ln>';
    return '<a:ln w="' + Math.max(1,integer((item.strokeWidth || 1) * scale)) + '" cap="flat" cmpd="sng" algn="ctr">' + fillXML(item.stroke) + '<a:prstDash val="' + (item.dash === 'dot' ? 'sysDot' : item.dash === 'dash' ? 'dash' : item.dash === 'dashdot' ? 'dashDot' : 'solid') + '"/><a:round/><a:headEnd type="none"/><a:tailEnd type="none"/></a:ln>';
  }
  function polyline(item,id,layout,name) {
    if (!Array.isArray(item.points) || item.points.length < 2) throw new Error('PPTX 波形路径至少需要两个点');
    const points = item.points.map(([x,y]) => [integer(layout.x + x * layout.scale),integer(layout.y + y * layout.scale)]);
    if (points.some(p => p.some(v => !Number.isFinite(v)))) throw new Error('PPTX 波形路径含无效坐标');
    const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
    const bounds = {x,y,w:Math.max(1,Math.max(...points.map(p => p[0])) - x),h:Math.max(1,Math.max(...points.map(p => p[1])) - y)};
    const command = points.map((p,i) => '<a:' + (i ? 'lnTo' : 'moveTo') + '><a:pt x="' + (p[0] - x) + '" y="' + (p[1] - y) + '"/></a:' + (i ? 'lnTo' : 'moveTo') + '>').join('');
    const close = item.closed || points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1] ? '<a:close/>' : '';
    const geometry = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="' + bounds.w + '" h="' + bounds.h + '" fill="' + (item.fill && item.fill !== 'none' ? 'norm' : 'none') + '" stroke="' + (item.stroke === 'none' ? '0' : '1') + '" extrusionOk="0">' + command + close + '</a:path></a:pathLst></a:custGeom>';
    return {bounds,xml:'<p:sp>' + nonVisual(id,name) + '<p:spPr>' + transform(bounds) + geometry + fillXML(item.fill) + lineXML(item,layout.scale) + '</p:spPr></p:sp>'};
  }
  let measureContext;
  function textWidth(item,font) {
    if (measureContext === undefined) {
      try { measureContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; }
      catch (_) { measureContext = null; }
    }
    const lines = String(item.text).split('\n');
    if (measureContext) {
      measureContext.font = (item.italic ? 'italic ' : '') + (item.bold ? 'bold ' : '') + item.fontSize + 'px "' + font.replace(/"/g,'') + '"';
      return Math.max(...lines.map(line => measureContext.measureText(line).width));
    }
    return Math.max(...lines.map(line => Array.from(line).reduce((sum,c) => sum + (/[^\u0000-\u00ff]/.test(c) ? 1 : /[ilI.,' ]/.test(c) ? .3 : /[MW@]/.test(c) ? .9 : .58),0))) * item.fontSize;
  }
  function textShape(item,id,layout,name) {
    const font = fontName(item.fontFamily), size = Math.max(1,Number(item.fontSize) || 20), lineCount = String(item.text).split('\n').length;
    const width = Math.max(size * .6,textWidth({...item,fontSize:size},font) + size * .35), height = size * (1.5 + (lineCount - 1) * 1.2);
    const anchor = item.anchor === 'end' ? 'r' : item.anchor === 'middle' ? 'ctr' : 'l';
    const left = item.x - (anchor === 'r' ? width : anchor === 'ctr' ? width / 2 : 0);
    const bounds = {x:integer(layout.x + left * layout.scale),y:integer(layout.y + (item.y - size * 1.15) * layout.scale),w:Math.max(1,integer(width * layout.scale)),h:Math.max(1,integer(height * layout.scale))};
    const fontSize = Math.max(100,Math.min(400000,integer(size * layout.scale / 127)));
    const runProps = '<a:rPr lang="en-US" sz="' + fontSize + '" b="' + (item.bold ? 1 : 0) + '" i="' + (item.italic ? 1 : 0) + '" dirty="0">' + fillXML(item.fill || '#000000') + '<a:latin typeface="' + escapeXML(font) + '"/><a:ea typeface="' + escapeXML(font) + '"/><a:cs typeface="' + escapeXML(font) + '"/></a:rPr>';
    const paragraphs = String(item.text).split('\n').map(line => '<a:p><a:pPr marL="0" marR="0" indent="0" algn="' + anchor + '"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr><a:r>' + runProps + '<a:t xml:space="preserve">' + escapeXML(line) + '</a:t></a:r><a:endParaRPr lang="en-US" sz="' + fontSize + '"/></a:p>').join('');
    return {bounds,xml:'<p:sp>' + nonVisual(id,name,true) + '<p:spPr>' + transform(bounds) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + paragraphs + '</p:txBody></p:sp>'};
  }
  function groupXML(items,id,name) {
    const x = Math.min(...items.map(s => s.bounds.x)), y = Math.min(...items.map(s => s.bounds.y));
    const w = Math.max(1,Math.max(...items.map(s => s.bounds.x + s.bounds.w)) - x), h = Math.max(1,Math.max(...items.map(s => s.bounds.y + s.bounds.h)) - y);
    return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + id + '" name="' + escapeXML(name) + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/><a:chOff x="' + x + '" y="' + y + '"/><a:chExt cx="' + w + '" cy="' + h + '"/></a:xfrm></p:grpSpPr>' + items.map(s => s.xml).join('') + '</p:grpSp>';
  }
  function themeXML() {
    const colors = {dk1:'000000',lt1:'FFFFFF',dk2:'111111',lt2:'EEEEEE',accent1:'000000',accent2:'B22222',accent3:'235AA6',accent4:'14805E',accent5:'7B4FA3',accent6:'B87916',hlink:'0563C1',folHlink:'954F72'};
    const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
    const fonts = '<a:latin typeface="Times New Roman"/><a:ea typeface="Times New Roman"/><a:cs typeface="Times New Roman"/>';
    return XML + '<a:theme xmlns:a="' + DRAW + '" name="autoWaveform"><a:themeElements><a:clrScheme name="autoWaveform">' + Object.entries(colors).map(([name,value]) => '<a:' + name + '><a:srgbClr val="' + value + '"/></a:' + name + '>').join('') + '</a:clrScheme><a:fontScheme name="autoWaveform"><a:majorFont>' + fonts + '</a:majorFont><a:minorFont>' + fonts + '</a:minorFont></a:fontScheme><a:fmtScheme name="autoWaveform"><a:fillStyleLst>' + fills + '</a:fillStyleLst><a:lnStyleLst>' + [9525,19050,28575].map(w => '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>').join('') + '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + fills + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }
  function exportPptx(project,options = {}) {
    if (!C || typeof C.buildScene !== 'function') throw new Error('PPTX 导出需要新版波形绘制核心');
    const scene = C.buildScene(project,{...options,interactive:false});
    if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0) throw new Error('PPTX 画布尺寸无效');
    const pad = INCH / 4, maximum = 56 * INCH;
    const scale = Math.min(EMU,(maximum - 2 * pad) / scene.width,(maximum - 2 * pad) / scene.height);
    const width = Math.max(INCH,integer(scene.width * scale + 2 * pad)), height = Math.max(INCH,integer(scene.height * scale + 2 * pad));
    const layout = {scale,x:(width - scene.width * scale) / 2,y:(height - scene.height * scale) / 2};
    const names = new Map((project.signals || []).map(signal => [signal.id,signal.name]));
    const groups = new Map(), ordered = []; let nextId = 2;
    for (const item of scene.elements) {
      const signalName = names.get(item.signalId), name = (signalName ? signalName + ' / ' : '') + item.id;
      if (item.kind === 'polyline') {
        const shape = polyline(item,nextId++,layout,name);
        if (item.signalId) {
          if (!groups.has(item.signalId)) { const group = {id:nextId++,name:'Waveform / ' + (signalName || item.signalId),items:[]}; groups.set(item.signalId,group); ordered.push(group); }
          groups.get(item.signalId).items.push(shape);
        } else ordered.push(shape);
      } else if (item.kind === 'text') ordered.push(textShape(item,nextId++,layout,name));
      else throw new Error('PPTX 不支持的场景元素：' + item.kind);
    }
    const shapes = ordered.map(item => item.items ? groupXML(item.items,item.id,item.name) : item.xml).join('');
    const namespaces = ' xmlns:a="' + DRAW + '" xmlns:r="' + REL + '" xmlns:p="' + PRES + '"';
    const clrMap = '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';
    const files = {};
    const contentTypes = [
      ['ppt/presentation.xml','presentationml.presentation.main'],['ppt/slides/slide1.xml','presentationml.slide'],['ppt/slideMasters/slideMaster1.xml','presentationml.slideMaster'],['ppt/slideLayouts/slideLayout1.xml','presentationml.slideLayout'],['ppt/theme/theme1.xml','theme'],['docProps/app.xml','extended-properties']
    ];
    files['[Content_Types].xml'] = XML + '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + contentTypes.map(([part,type]) => '<Override PartName="/' + part + '" ContentType="application/vnd.openxmlformats-officedocument.' + type + '+xml"/>').join('') + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    files['_rels/.rels'] = XML + '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="' + NS + 'package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="' + REL + '/extended-properties" Target="docProps/app.xml"/></Relationships>';
    files['docProps/core.xml'] = XML + '<cp:coreProperties xmlns:cp="' + NS + 'package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + escapeXML(project.title || 'autoWaveform') + '</dc:title><dc:creator>autoWaveform</dc:creator><cp:lastModifiedBy>autoWaveform</cp:lastModifiedBy><dc:description>Editable digital timing diagram. Native vector shapes and text.</dc:description></cp:coreProperties>';
    files['docProps/app.xml'] = XML + '<Properties xmlns="' + NS + 'officeDocument/2006/extended-properties" xmlns:vt="' + NS + 'officeDocument/2006/docPropsVTypes"><Application>autoWaveform</Application><PresentationFormat>Custom</PresentationFormat><Slides>1</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><Company></Company><AppVersion>1.0</AppVersion></Properties>';
    files['ppt/presentation.xml'] = XML + '<p:presentation' + namespaces + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="' + width + '" cy="' + height + '" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
    files['ppt/_rels/presentation.xml.rels'] = relationships([['rId1','slideMaster','slideMasters/slideMaster1.xml'],['rId2','slide','slides/slide1.xml']]);
    files['ppt/slides/slide1.xml'] = XML + '<p:sld' + namespaces + '><p:cSld name="' + escapeXML(project.title || 'autoWaveform') + '"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' + rootGroup() + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
    files['ppt/slides/_rels/slide1.xml.rels'] = relationships([['rId1','slideLayout','../slideLayouts/slideLayout1.xml']]);
    files['ppt/slideMasters/slideMaster1.xml'] = XML + '<p:sldMaster' + namespaces + '><p:cSld><p:spTree>' + rootGroup() + '</p:spTree></p:cSld>' + clrMap + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
    files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = relationships([['rId1','slideLayout','../slideLayouts/slideLayout1.xml'],['rId2','theme','../theme/theme1.xml']]);
    files['ppt/slideLayouts/slideLayout1.xml'] = XML + '<p:sldLayout' + namespaces + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + rootGroup() + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = relationships([['rId1','slideMaster','../slideMasters/slideMaster1.xml']]);
    files['ppt/theme/theme1.xml'] = themeXML();
    return zip(files);
  }
  return {exportPptx};
});
