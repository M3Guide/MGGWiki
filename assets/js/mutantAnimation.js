(function () {
"use strict";

const CFG = Object.assign({
  base: "../../assets/anim",   // folder that holds sprites.xml and sprites/
  manifest: null,              // default base + "/sprites.xml"
  spritesDir: null,            // default base + "/sprites"
  etcDir: null,                // default spritesDir  (.etc1.z / .etca.z)
  files: null,                 // default base + "/files.json" (optional)
  etcExt: ".z",                // suffix of the compressed ETC files
  etcFlip: true,               // engine UV rule: memory row 0 = picture bottom (sandbox default)
  skipIdle: false,             // false = blink / wait delays play like the game
  panel: {w: 368, h: 654, oy: 180, sc: 1}   
}, window.MUTANT_ANIM || {});
CFG.manifest = CFG.manifest || (CFG.base.replace(/\/+$/, "") + "/sprites.xml");
CFG.spritesDir = (CFG.spritesDir || (CFG.base.replace(/\/+$/, "") + "/sprites")).replace(/\/+$/, "");
CFG.etcDir = (CFG.etcDir || (CFG.spritesDir)).replace(/\/+$/, "");
CFG.files = CFG.files || (CFG.base.replace(/\/+$/, "") + "/files.json");
const GAME_PANEL = CFG.panel;
const log = (...a) => console.log("[MutantAnim]", ...a);

const STATIC1 = true, DUPKEY_LAST = false, ALPHA_HOLD = false, VLAG = 1, VLAG_LEGACY = false;
const ZORDER_OLD = false, BLANK_FRAMES = true, SYNCH_ON = true, TICK_HZ = 30, MUL_ON = true;
function rootLoops() { return false; }  

function charValue(v) {
  let rcx;
  if (v >= 0x61 && v <= 0x7a) rcx = v - 0x61;
  else if (v >= 0x41 && v <= 0x5a) rcx = v - 0x27;
  else if (v >= 0x30 && v <= 0x39) rcx = v + 4;
  else if (v === 0x2b || v === 0x2d) return 3;
  else if (v === 0x2f || v === 0x5f) return 4;
  else throw new Error("unexpected char 0x" + v.toString(16));
  return (rcx + 5) % 64;
}
function decodeCore(payload) {
  const n = payload.length;
  const seed = charValue(payload[0]);
  const totalPairs = Math.floor((n - 1) / 2);
  const seedParity = seed & 1;

  let rbx = seed;
  let i = 1;
  const out = [];

  for (let iter = 1; iter <= totalPairs; iter++) {
    const c1 = payload[i];
    const c2 = payload[i + 1];
    const val = (c1 + (c2 << 8)) >>> 0;
    let r12_1 = (val + 0x10000) >>> 0;
    if (val >= rbx) r12_1 = val;
    const r12_2 = (r12_1 - rbx) >>> 0;
    const highByte = (r12_2 >>> 8) & 0xff;
    out.push(highByte);

    const isLast = (iter === totalPairs);
    const skipLow = isLast && (seedParity === 1);
    if (!skipLow) out.push(r12_2 & 0xff);

    const r12_3 = (r12_2 + iter) >>> 0;
    const term = Math.imul(r12_3, 3) >>> 0;
    const rbx8 = ((rbx + r12_3 + ((term << 2) >>> 0) - 0xd) >>> 0);
    rbx = rbx8 % 9999;

    i += 2;
  }
  return new Uint8Array(out);
}
async function inflateZlib(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
async function decodeXmz(raw) {
  const marker = raw[0];
  const payload = raw.slice(1);
  const decoded = decodeCore(payload);

  if (marker === 0x7e) { 
    const footer = "T4RT1FL3773";
    let text = new TextDecoder("latin1").decode(decoded);
    if (text.endsWith(footer)) text = text.slice(0, -footer.length);
    return text;
  } else if (marker === 0x24) {
    const inflated = await inflateZlib(decoded);
    return new TextDecoder("utf-8").decode(inflated);
  } else {
    throw new Error("unknown marker byte 0x" + marker.toString(16));
  }
}

function frameSequenceDuration(frameEls) {
  let total = 0;
  for (const f of frameEls || []) {
    const rep = f.getAttribute("rep") === null ? 0 : Math.max(0, Math.round(num(f, "rep", 0)));
    total += rep + 1;
  }
  return total;
}
function frameSequenceInfo(frameEls) {
  const delays = [];
  const tags = [];
  let frame = 0;
  for (const f of frameEls || []) {
    const rep = f.getAttribute("rep") === null ? 0 : Math.max(0, Math.round(num(f, "rep", 0)));
    const delay = f.getAttribute("delay") === null ? 0 : Math.max(0, Math.round(num(f, "delay", 0)));
    const count = rep + 1;
    const fsTags = Array.from(f.querySelectorAll(":scope > Tag")).map(t => ({
      key: t.getAttribute("key") || "",
      value: t.getAttribute("value") || ""
    }));
    if (fsTags.length) tags.push({ frame, tags: fsTags });
    for (let i = 0; i < count; i++) delays.push(delay);
    frame += count;
  }
  return { frameCount: frame, delays, tags };
}
function hasSynchTag(spriteEl) {  
  const tags = Array.from(spriteEl.querySelectorAll(":scope > Tag, :scope > Tags > Tag"));
  return tags.some(t => ((t.getAttribute("key") || t.getAttribute("name") || "") === "synch") && ((t.getAttribute("value") || "") === "parent"));
}
function nodeDrawnAt(node, f) {  
  const keys = node.keys;
  if (!keys || !keys.length) return false;
  if (STATIC1 && keys.length === 1 && keys[0].frame === 0) return true;
  let prev = null;
  for (const k of keys) { if (k.frame <= f) { if (DUPKEY_LAST || prev === null || k.frame > prev.frame) prev = k; } else break; }  
  return !!prev && (prev.visible || prev.frame === f);
}
function num(el, attr, fallback) {
  const v = el.getAttribute(attr);
  if (v === null) return fallback;
  const f = parseFloat(v);
  return isNaN(f) ? fallback : f;
}
function sortKeysRecursive(nodes) {
  for (const n of nodes) {
    n.keys.sort((a, b) => a.frame - b.frame);
    if (n.type === "group") sortKeysRecursive(n.children);
  }
}
function collectNodeKeyFrames(nodes, out = []) {
  for (const n of nodes || []) {
    for (const k of n.keys || []) out.push(k.frame);
    if (n.type === "group") collectNodeKeyFrames(n.children, out);
  }
  return out;
}
function imgLeafSig(o) {
  return [o.srcX, o.srcY, o.width, o.height, o.dstX0, o.dstY0, o.a, o.b, o.c, o.d]
    .map(v => Math.round((v || 0) * 1000) / 1000).join(',');
}
function structuralSig(node) {
  if (node.type === "image") return "i:" + imgLeafSig(node);
  if (node.type === "group") return "g[" + node.children.map(structuralSig).join("|") + "]";
  if (node.type === "flipbook") return "f[" + node.frames.map(fr => fr.images.map(imgLeafSig).join(";")).join("/") + "]";
  return "u:" + node.name;
}
function fragCanFold() { return false; }
function simImgsOf(frameEl) {
  return Array.from(frameEl.querySelectorAll(":scope > Image")).map(imgEl => ({
    srcX: num(imgEl, "srcX", 0), srcY: num(imgEl, "srcY", 0), width: num(imgEl, "width", 0), height: num(imgEl, "height", 0),
    dstX0: num(imgEl, "dstX", 0), dstY0: num(imgEl, "dstY", 0), a: num(imgEl, "a", 1), b: num(imgEl, "b", 0), c: num(imgEl, "c", 0), d: num(imgEl, "d", 1)
  }));
}
function simFlipInfo(spriteEl) {
  const fEls = Array.from(spriteEl.querySelectorAll(":scope > Frame"));
  const info = frameSequenceInfo(fEls), imgs = [];
  for (const f of fEls) {
    const rep = f.getAttribute("rep") === null ? 0 : Math.max(0, Math.round(num(f, "rep", 0)));
    const arr = simImgsOf(f);
    for (let i = 0; i <= rep; i++) imgs.push(arr);
  }
  return { count: info.frameCount, framerate: Math.max(1, Math.round(num(spriteEl, "framerate", 1))),
    loopFrame: spriteEl.getAttribute("loopFrame") === null ? 0 : Math.max(0, Math.round(num(spriteEl, "loopFrame", 0))),
    minDelay: num(spriteEl, "minDelay", 0) || 0, rndDelay: num(spriteEl, "rndDelay", 0) || 0, delays: info.delays, imgs };
}
function buildNodes(parentEl, idPrefix, state) {
  const ordered = [];
  const fragmentMap = new Map();

  const composites = Array.from(parentEl.querySelectorAll(":scope > Composite"));
  for (const comp of composites) {
    const children = Array.from(comp.children);
    let i = 0;
    while (i < children.length) {
      const child = children[i];
      if (child.tagName !== "Sprite") { i++; continue; }

      const nestedComposites = Array.from(child.querySelectorAll(":scope > Composite"));

      i++;
      const keyEls = [];
      while (i < children.length && children[i].tagName === "Key") { keyEls.push(children[i]); i++; }

      const parsedKeys = keyEls.map(k => {
        const frame = Math.round(num(k, "frame", 0));
        return {
          frame,
          xRaw: k.getAttribute("x"), yRaw: k.getAttribute("y"),
          scaleX: num(k, "scaleX", 1),
          scaleY: num(k, "scaleY", 1),
          angle: num(k, "angle", 0) * Math.PI / 180,
          alpha: num(k, "alpha", 1),
          visible: k.getAttribute("visible") !== "false",
          rAdd: num(k, "rAdd", 0),
          gAdd: num(k, "gAdd", 0),
          bAdd: num(k, "bAdd", 0),
          rMul: num(k, "rMul", 1),  
          gMul: num(k, "gMul", 1),
          bMul: num(k, "bMul", 1)
        };
      });

      if (nestedComposites.length > 0) {
        const childNodes = buildNodes(child, idPrefix, state);
        const identityKey = [{ frame: 0, x: 0, y: 0, scaleX: 1, scaleY: 1,
          angle: 0, alpha: 1, visible: true, rAdd: 0, gAdd: 0, bAdd: 0 }];
        const directImgs = Array.from(child.querySelectorAll(':scope > Image'));
        const baseLeaves = [];
        for (const imgEl of directImgs) {
          baseLeaves.push({
            type: "image",
            name: idPrefix + "#" + (state.layerIdx++),
            srcX: num(imgEl, "srcX", 0), srcY: num(imgEl, "srcY", 0),
            width: num(imgEl, "width", 0), height: num(imgEl, "height", 0),
            dstX0: num(imgEl, "dstX", 0), dstY0: num(imgEl, "dstY", 0),
            a: num(imgEl, "a", 1), b: num(imgEl, "b", 0),
            c: num(imgEl, "c", 0), d: num(imgEl, "d", 1),
            keys: identityKey
          });
        }
        childNodes.unshift(...baseLeaves);
        let _fIns = baseLeaves.length;
        const fbInsert = (nd) => { if (ZORDER_OLD) childNodes.push(nd); else childNodes.splice(_fIns++, 0, nd); };
        for (const f of Array.from(child.querySelectorAll(':scope > Frame'))) {
          const imgs = Array.from(f.querySelectorAll(':scope > Image'));
          if (imgs.length === 0) continue;
          if (Array.from(child.querySelectorAll(':scope > Frame')).length > 1) {
            const frames = Array.from(child.querySelectorAll(':scope > Frame')).map(ff => ({
              n: (ff.getAttribute('rep') === null ? 0 : Math.max(0, Math.round(num(ff,'rep',0)))) + 1,   
              durationTicks: (() => { const rep = ff.getAttribute('rep') === null ? 0 : Math.max(0, Math.round(num(ff,'rep',0))); const delay = ff.getAttribute('delay') === null ? 0 : Math.max(0, Math.round(num(ff,'delay',0))); return (rep + 1) * (1 + delay); })(),
              images: Array.from(ff.querySelectorAll(':scope > Image')).map(imgEl => ({
                srcX:num(imgEl,'srcX',0), srcY:num(imgEl,'srcY',0), width:num(imgEl,'width',0), height:num(imgEl,'height',0),
                dstX0:num(imgEl,'dstX',0), dstY0:num(imgEl,'dstY',0), a:num(imgEl,'a',1), b:num(imgEl,'b',0), c:num(imgEl,'c',0), d:num(imgEl,'d',1)
              }))
            }));
            fbInsert({ type:'flipbook', name:idPrefix+'#flipbook'+(state.unresolvedIdx++), frames,
              totalTicks:frames.reduce((n,x)=>n+x.durationTicks,0), timelineStartFrame:0, keys:identityKey,
              simParent:true, sim:{ imgs: frames.flatMap(fr => Array.from({length: fr.n}, () => fr.images)) } }); 
            break;
          }
          for (const imgEl of imgs) fbInsert({
            type:'image', name:idPrefix+'#'+(state.layerIdx++),
            srcX:num(imgEl,'srcX',0), srcY:num(imgEl,'srcY',0), width:num(imgEl,'width',0), height:num(imgEl,'height',0),
            dstX0:num(imgEl,'dstX',0), dstY0:num(imgEl,'dstY',0), a:num(imgEl,'a',1), b:num(imgEl,'b',0), c:num(imgEl,'c',0), d:num(imgEl,'d',1), keys:identityKey
          });
        }

        const wrapperFrames = Array.from(child.querySelectorAll(":scope > Frame"));
        const wrapperDuration = frameSequenceDuration(wrapperFrames);
        const autoLoop = child.getAttribute("autoLoop") === "true";
        const groupStartFrame = parsedKeys.length ? parsedKeys[0].frame : 0;
        const childKeyFrames = collectNodeKeyFrames(childNodes);
        const childStartFrame = childKeyFrames.length ? Math.min(...childKeyFrames) : 0;
        const childEndFrame = childKeyFrames.length ? Math.max(...childKeyFrames) : 0;
        const childDuration = childKeyFrames.length
          ? childEndFrame - childStartFrame + 1
          : 0;

        const newGroupKeys = parsedKeys.map(pk => ({
          frame: pk.frame,
          x: pk.xRaw !== null ? parseFloat(pk.xRaw) : 0,
          y: pk.yRaw !== null ? parseFloat(pk.yRaw) : 0,
          scaleX: pk.scaleX, scaleY: pk.scaleY,
          angle: pk.angle, alpha: pk.alpha, visible: pk.visible,
          rAdd: pk.rAdd, gAdd: pk.gAdd, bAdd: pk.bAdd, rMul: pk.rMul, gMul: pk.gMul, bMul: pk.bMul
        }));

        const groupSig = "group:" + structuralSig({ type: "group", children: childNodes });
        let existingGroup = fragmentMap.get(groupSig);
        if (existingGroup && !fragCanFold(existingGroup.keys, newGroupKeys)) existingGroup = null;

        if (existingGroup) {
          existingGroup.keys.push(...newGroupKeys);
          existingGroup.groupStartFrame = Math.min(existingGroup.groupStartFrame, groupStartFrame);
          existingGroup.autoLoop = existingGroup.autoLoop || autoLoop;
        } else {
          const groupNode = {
            type: "group",
            name: idPrefix + "#group" + (state.groupIdx++),
            keys: newGroupKeys,
            children: childNodes,
            autoLoop,
            groupStartFrame,
            wrapperDuration,
            childStartFrame,
            childEndFrame,
            childDuration,
            framerate: Math.max(1, Math.round(num(child, "framerate", 1))),
            synch: hasSynchTag(child), 
            loopFrame: child.getAttribute("loopFrame") === null ? null : Math.max(0, Math.round(num(child, "loopFrame", 0))), 
            minDelayMs: num(child, "minDelay", 0) || 0,
            rndDelayMs: num(child, "rndDelay", 0) || 0,
            simDelays: frameSequenceInfo(wrapperFrames).delays   
          };
          fragmentMap.set(groupSig, groupNode);
          ordered.push(groupNode);
        }
        continue;
      }

      const _allFrameEls = Array.from(child.querySelectorAll(":scope > Frame"));
      const _imgFrameEls = _allFrameEls.filter(f => f.querySelector(":scope > Image") !== null);
      const frameEls = (BLANK_FRAMES && _imgFrameEls.length >= 1 && _allFrameEls.length > 1) ? _allFrameEls : _imgFrameEls;

      if (frameEls.length > 1) {
        const directImgs = Array.from(
          child.querySelectorAll(":scope > Image")
        );

        const identityKeys = parsedKeys.map(pk => ({
          frame: pk.frame,
          x: pk.xRaw !== null ? parseFloat(pk.xRaw) : 0,
          y: pk.yRaw !== null ? parseFloat(pk.yRaw) : 0,
          scaleX: pk.scaleX,
          scaleY: pk.scaleY,
          angle: pk.angle,
          alpha: pk.alpha,
          visible: pk.visible,
          rAdd: pk.rAdd,
          gAdd: pk.gAdd,
          bAdd: pk.bAdd,
          rMul: pk.rMul, gMul: pk.gMul, bMul: pk.bMul
        }));
        for (const imgEl of directImgs) {
          ordered.push({
            type: "image",
            name: idPrefix + "#" + (state.layerIdx++),
            srcX: num(imgEl, "srcX", 0),
            srcY: num(imgEl, "srcY", 0),
            width: num(imgEl, "width", 0),
            height: num(imgEl, "height", 0),
            dstX0: num(imgEl, "dstX", 0),
            dstY0: num(imgEl, "dstY", 0),
            a: num(imgEl, "a", 1),
            b: num(imgEl, "b", 0),
            c: num(imgEl, "c", 0),
            d: num(imgEl, "d", 1),
            keys: identityKeys
          });
        }
        const frames = frameEls.map(f => ({
          n: (f.getAttribute("rep") === null ? 1 : Math.max(1, Math.round(num(f, "rep", 0)) + 1)),
          durationTicks: (() => {
            const repCount = f.getAttribute("rep") === null
              ? 1
              : Math.max(1, Math.round(num(f, "rep", 0)) + 1);
            const delayTicks = f.getAttribute("delay") === null
              ? 0
              : Math.max(0, Math.round(num(f, "delay", 0)));
            return repCount * (1 + delayTicks);
          })(),

          images: Array.from(
            f.querySelectorAll(":scope > Image")
          ).map(imgEl => ({
            srcX: num(imgEl, "srcX", 0),
            srcY: num(imgEl, "srcY", 0),
            width: num(imgEl, "width", 0),
            height: num(imgEl, "height", 0),
            dstX0: num(imgEl, "dstX", 0),
            dstY0: num(imgEl, "dstY", 0),
            a: num(imgEl, "a", 1),
            b: num(imgEl, "b", 0),
            c: num(imgEl, "c", 0),
            d: num(imgEl, "d", 1)
          }))
        }));

        const totalTicks = frames.reduce(
          (s, f) => s + f.durationTicks,
          0
        );

        const timelineStartFrame = parsedKeys.length
          ? parsedKeys[0].frame
          : 0;

        ordered.push({
          type: "flipbook",
          name: idPrefix + "#flipbook" +
                (state.unresolvedIdx++) +
                " (" + frames.length +
                " frames, packSz=" +
                (child.getAttribute("packSz") || "?") + ")",
          frames,
          totalTicks,
          timelineStartFrame,
          synch: hasSynchTag(child),  
          sim: simFlipInfo(child), 
          keys: identityKeys
        });

        continue;
      }

      const firstFrameEl = frameEls[0] || null;
      const imgEls = Array.from(child.querySelectorAll(":scope > Image"))
        .concat(firstFrameEl ? Array.from(firstFrameEl.querySelectorAll(":scope > Image")) : []);

      if (imgEls.length === 0) {
        ordered.push({
          type: "unresolved",
          name: idPrefix + "#unresolved" + (state.unresolvedIdx++) +
                " {" + Array.from(child.attributes).map(a => a.name + "=" + a.value).join(" ") + "}",
          keys: parsedKeys.map(pk => ({
            frame: pk.frame,
            x: pk.xRaw !== null ? parseFloat(pk.xRaw) : 0,
            y: pk.yRaw !== null ? parseFloat(pk.yRaw) : 0,
            scaleX: pk.scaleX, scaleY: pk.scaleY,
            angle: pk.angle, alpha: pk.alpha, visible: pk.visible,
            rAdd: pk.rAdd, gAdd: pk.gAdd, bAdd: pk.bAdd, rMul: pk.rMul, gMul: pk.gMul, bMul: pk.bMul
          }))
        });
        continue;
      }
      const imageLeaves = imgEls.map(imgEl => ({
        srcX: num(imgEl, "srcX", 0), srcY: num(imgEl, "srcY", 0),
        width: num(imgEl, "width", 0), height: num(imgEl, "height", 0),
        dstX0: num(imgEl, "dstX", 0), dstY0: num(imgEl, "dstY", 0),
        a: num(imgEl, "a", 1), b: num(imgEl, "b", 0),
        c: num(imgEl, "c", 0), d: num(imgEl, "d", 1)
      }));

      const newKeys = parsedKeys.map(pk => ({
        frame: pk.frame,
        x: pk.xRaw !== null ? parseFloat(pk.xRaw) : 0,
        y: pk.yRaw !== null ? parseFloat(pk.yRaw) : 0,
        scaleX: pk.scaleX, scaleY: pk.scaleY,
        angle: pk.angle, alpha: pk.alpha, visible: pk.visible,
        rAdd: pk.rAdd, gAdd: pk.gAdd, bAdd: pk.bAdd, rMul: pk.rMul, gMul: pk.gMul, bMul: pk.bMul
      }));

      const leafSig = "leaf:" + imageLeaves.map(imgLeafSig).join("#");
      let existingKeys = fragmentMap.get(leafSig);
      if (existingKeys && !fragCanFold(existingKeys, newKeys)) existingKeys = null;

      if (existingKeys) {
        existingKeys.push(...newKeys);
      } else {
        fragmentMap.set(leafSig, newKeys);
        if (imageLeaves.length === 1) {
          ordered.push({
            type: "image",
            name: idPrefix + "#" + (state.layerIdx++),
            ...imageLeaves[0],
            keys: newKeys
          });
        } else {
          for (const leaf of imageLeaves) {
            ordered.push({
              type: "image",
              name: idPrefix + "#" + (state.layerIdx++),
              ...leaf,
              keys: newKeys
            });
          }
        }
      }
    }
  }
  return ordered;
}
function effVisible(keys, prev, sampleFrame) {
  if (prev.visible || VLAG <= 0) return !!prev.visible;
  if (!VLAG_LEGACY) return sampleFrame === prev.frame;
  const past = sampleFrame - VLAG; let pk = null;
  for (const k of keys) { if (k.frame <= past) pk = k; else break; }
  return !!(pk && pk.visible);
}
function assignWrap(nodes, count, loops) {
  for (const n of nodes) {
    n.wrap = { count, loops };
    if (n.type === "group") {
      const c = n.wrapperDuration > 0 ? n.wrapperDuration : (n.childEndFrame + 1);
      assignWrap(n.children, c, !!n.autoLoop);
    }
  }
}
function interpolateAtFrame(layer, frame) {
  const keys = layer.keys;
  if (!keys || keys.length === 0) return null;
  if (STATIC1 && keys.length === 1 && keys[0].frame === 0) {
    const k0 = keys[0];
    return { ...k0, visible: true, rAdd: k0.rAdd || 0, gAdd: k0.gAdd || 0, bAdd: k0.bAdd || 0,
             rMul: k0.rMul ?? 1, gMul: k0.gMul ?? 1, bMul: k0.bMul ?? 1, atKeyFrame: 0 };
  }
  const sampleFrame = Math.floor(frame + 1e-7);
  if (sampleFrame < keys[0].frame) return null;
  let prev = null, next = null;
  for (const k of keys) {
    if (k.frame <= sampleFrame) { if (DUPKEY_LAST || prev === null || k.frame > prev.frame) prev = k; }
    else if (next === null) next = k;
  }
  if (!prev) return null;
  if (!next && layer.wrap && keys.length > 1) {
    const lp = layer.wrap.loops === "root" ? rootLoops() : layer.wrap.loops;
    if (lp && layer.wrap.count > prev.frame) next = { ...keys[0], frame: layer.wrap.count };
  }
  const vis = effVisible(keys, prev, sampleFrame);
  if (!next) {
    return {
      ...prev,
      visible: vis,
      rAdd: prev.rAdd || 0,
      gAdd: prev.gAdd || 0,
      bAdd: prev.bAdd || 0,
      rMul: prev.rMul ?? 1, gMul: prev.gMul ?? 1, bMul: prev.bMul ?? 1,
      atKeyFrame: prev.frame
    };
  }
  const span = next.frame - prev.frame;
  const t = span > 0
    ? Math.max(0, Math.min(1, (frame - prev.frame) / span))
    : 0;
  return {
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    scaleX: prev.scaleX + (next.scaleX - prev.scaleX) * t,
    scaleY: prev.scaleY + (next.scaleY - prev.scaleY) * t,
    angle: prev.angle + (next.angle - prev.angle) * t, 
    alpha: (ALPHA_HOLD && !prev.visible) ? prev.alpha : prev.alpha + (next.alpha - prev.alpha) * t,
    rAdd: (prev.rAdd||0) + ((next.rAdd||0) - (prev.rAdd||0)) * t,
    gAdd: (prev.gAdd||0) + ((next.gAdd||0) - (prev.gAdd||0)) * t,
    bAdd: (prev.bAdd||0) + ((next.bAdd||0) - (prev.bAdd||0)) * t,
    rMul: (prev.rMul ?? 1) + ((next.rMul ?? 1) - (prev.rMul ?? 1)) * t,
    gMul: (prev.gMul ?? 1) + ((next.gMul ?? 1) - (prev.gMul ?? 1)) * t,
    bMul: (prev.bMul ?? 1) + ((next.bMul ?? 1) - (prev.bMul ?? 1)) * t,
    visible: vis,
    atKeyFrame: prev.frame
  };
}
function parseSpriteXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const perr = doc.querySelector("parsererror");
  if (perr) throw new Error("XML parse error: " + perr.textContent.slice(0, 200));
  const results = [];
  for (const spriteEl of Array.from(doc.querySelectorAll("ArrayOfSprite > Sprite"))) {
    const id = spriteEl.getAttribute("id") || "(unnamed)";
    const spriteAutoLoop = spriteEl.getAttribute("autoLoop") === "true";
    const spriteLoopFrame = Math.max(0, Math.round(num(spriteEl, "loopFrame", 0)));
    const st = { maxFrame: 0, layerIdx: 0, groupIdx: 0, unresolvedIdx: 0 };
    const root = buildNodes(spriteEl, id, st);
    sortKeysRecursive(root);
    const rootFrameEls = Array.from(spriteEl.querySelectorAll(":scope > Frame"));
    const rootKeyFrames = [];
    for (const comp of spriteEl.querySelectorAll(":scope > Composite")) {
      const kids = Array.from(comp.children);
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].tagName !== "Sprite") continue;
        i++;
        while (i < kids.length && kids[i].tagName === "Key") { rootKeyFrames.push(Math.round(num(kids[i], "frame", 0))); i++; }
      }
    }
    const rootKeyDuration = rootKeyFrames.length ? Math.max(...rootKeyFrames) + 1 : 1;
    const rootInfo = frameSequenceInfo(rootFrameEls);
    const sceneDuration = rootInfo.frameCount > 0 ? rootInfo.frameCount : Math.max(1, rootKeyDuration);
    assignWrap(root, sceneDuration, spriteAutoLoop); 
    if (root.length > 0) {
      results.push({
        id, root, maxFrame: sceneDuration - 1, frameDelays: rootInfo.delays,
        autoLoop: spriteAutoLoop, loopFrame: Math.min(spriteLoopFrame, sceneDuration - 1),
        minDelay: Math.max(0, Math.round(num(spriteEl, "minDelay", 0))),
        rndDelay: Math.max(0, Math.round(num(spriteEl, "rndDelay", 0))),
        framerate: Math.max(1, Math.round(num(spriteEl, "framerate", 1)))
      });
    }
  }
  return results;
}
function matIdentity() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
function matTranslate(tx, ty) { return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }; }
function matScale(sx, sy) { return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }; }
function matRaw(a, b, c, d) { return { a, b, c, d, e: 0, f: 0 }; }
function matMul(A, B) {
  return {
    a: A.a * B.a + A.c * B.b,
    b: A.b * B.a + A.d * B.b,
    c: A.a * B.c + A.c * B.d,
    d: A.b * B.c + A.d * B.d,
    e: A.a * B.e + A.c * B.f + A.e,
    f: A.b * B.e + A.d * B.f + A.f
  };
}
function matApply(M, x, y) {
  return { x: M.a * x + M.c * y + M.e, y: M.b * x + M.d * y + M.f };
}
function keyLocalMatrix(key) {
  const angle = Number.isFinite(key.angle) ? key.angle : 0;
  const sx = Number.isFinite(key.scaleX) ? key.scaleX : 1;
  const sy = Number.isFinite(key.scaleY) ? key.scaleY : 1;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    a: c * sx,
    b: s * sx,
    c: -s * sy,
    d: c * sy,
    e: Number.isFinite(key.x) ? key.x : 0,
    f: Number.isFinite(key.y) ? key.y : 0
  };
}
function layerMatrix(layer, key) {
  let M = keyLocalMatrix(key);
  M = matMul(M, matTranslate(layer.dstX0, layer.dstY0));
  M = matMul(M, matRaw(layer.a, layer.b, layer.c, layer.d));
  return M;
}
function imageDefMatrix(def, key) {
  let M = keyLocalMatrix(key);
  M = matMul(M, matTranslate(def.dstX0, def.dstY0));
  M = matMul(M, matRaw(def.a, def.b, def.c, def.d));
  return M;
}
const dlyTicks = v => (CFG.skipIdle ? 0 : v);
let SIM = { rt: new Map() };
const state = { currentScene: null, currentFrame: 0, playbackDelay: 0, playbackAccumulator: 0, playbackRateCounter: 0, playFrame: 0,
                idleActive: false, idlePose: null, idleFrame: -1, lastVis: null };
function simRt(n) { let r = SIM.rt.get(n); if (!r) { r = { acc: 0, delay: 0, rate: 0, frame: 0, T: 0, latch: 1 }; SIM.rt.set(n, r); } return r; }
function simDraw(n) { return simRt(n); }
function simDefOf(n) {
  if (n.sim && n.sim.count !== undefined) return n.sim;
  if (!n._simDef) n._simDef = { count: Math.max(1, n.wrapperDuration > 0 ? n.wrapperDuration : (n.childEndFrame | 0) + 1), framerate: Math.max(1, n.framerate | 0),
    loopFrame: n.loopFrame == null ? 0 : n.loopFrame, minDelay: n.minDelayMs || 0, rndDelay: n.rndDelayMs || 0, delays: n.simDelays || [] };
  return n._simDef;
}
function simStep(def, rt, dt, loops) { 
  const count = def.count, fr = Math.max(1, def.framerate | 0);
  const lf = Math.max(0, Math.min(def.loopFrame | 0, Math.max(0, count - 1)));
  rt.acc += TICK_HZ * dt;
  const n = Math.floor(rt.acc);
  for (let i = 0; i < n; i++) {
    rt.acc -= 1;
    if (rt.delay > 0) { rt.delay--; continue; }
    rt.rate = (rt.rate + 1) % fr; if (rt.rate !== 0) continue;
    let f = count <= 0 ? rt.frame : rt.frame + 1;
    if (f >= count) { if (loops) f = lf; else { rt.acc = 0; f = Math.max(0, count - 1); } }
    rt.frame = f;
    if (loops) {
      if (f === lf) rt.delay = def.rndDelay > 0 ? Math.floor(Math.random() * dlyTicks(def.rndDelay)) + dlyTicks(def.minDelay) : 0;
      const d = dlyTicks(def.delays[f] || 0); if (d > 0) rt.delay += d;
    }
  }
  rt.T = Math.min(rt.frame + (rt.delay > 0 ? 0 : Math.max(0, rt.acc)), count - 0.001);
}
function simUpdateNode(n, T, dt) {
  if (n.type !== "group" && !(n.type === "flipbook" && !n.simParent)) return;
  const rt = simRt(n), was = rt.latch;
  const drawn = nodeDrawnAt(n, Math.floor(T + 1e-7));
  rt.latch = drawn ? 1 : 0;
  if (!drawn) return;
  const def = simDefOf(n); let cdt = dt;
  if (n.synch && SYNCH_ON) { rt.frame = def.count > 0 ? (((Math.trunc(T) % def.count) + def.count) % def.count) : 0; rt.delay = 0; cdt = T - Math.floor(T); }
  else if (!was) { rt.frame = 0; rt.delay = 0; }
  simStep(def, rt, cdt, true);  
  if (n.type === "group") simUpdateList(n.children, rt.T, cdt);
}
function simUpdateList(list, T, dt) { for (const n of list || []) simUpdateNode(n, T, dt); }
function stepSpritePlayback(sc, dt, loops) {  
  const count = Math.max(1, (sc.maxFrame | 0) + 1);
  const framerate = Math.max(1, sc.framerate | 0);
  const loopTo = Math.max(0, sc.loopFrame | 0);  
  const delays = sc.frameDelays || [];
  state.playbackAccumulator += TICK_HZ * dt;
  let n = Math.floor(state.playbackAccumulator);
  if (n > 0) {
    let mode = "consume";
    for (let guard = 0; guard < 100000; guard++) {
      if (mode === "consume") {
        state.playbackAccumulator -= 1;
        if (state.playbackDelay > 0) { state.playbackDelay--; mode = "dec"; }
        else mode = "head";
      } else if (mode === "head") {
        state.playbackRateCounter = (state.playbackRateCounter + 1) % framerate;
        mode = state.playbackRateCounter === 0 ? "advance" : "dec";
      } else if (mode === "advance") {
        let f = state.playFrame + 1;
        if (f >= count) { if (loops) f = loopTo; else { state.playbackAccumulator = 0; f = count - 1; } }
        state.playFrame = f;
        if (loops) {
          if (f === loopTo) state.playbackDelay = sc.rndDelay > 0 ? Math.floor(Math.random() * dlyTicks(sc.rndDelay)) + dlyTicks(sc.minDelay) : 0;
          const fd = dlyTicks(delays[f] || 0);
          if (fd > 0) state.playbackDelay += fd;
        }
        mode = "dec";
      } else { n--; if (n <= 0) break; mode = "consume"; }
    }
  }
  let frac = state.playbackDelay > 0 ? 0 : Math.max(0, state.playbackAccumulator);
  frac = Math.max(0, Math.min(0.999, frac));
  state.currentFrame = Math.min(state.playFrame + frac, count - 1e-3);
}
let atlas = null, atlasCounter = 0, visCount = 0;
const tintCache = new Map();
function tintedSourceCanvas(srcX, srcY, width, height, rAdd, gAdd, bAdd, rMul, gMul, bMul) { 
  const q = v => Math.max(0, Math.min(255, Math.round((v || 0) * 255)));
  const ra = q(rAdd), ga = q(gAdd), ba = q(bAdd);
  const mr = Math.max(0, Math.round((rMul ?? 1) * 255)), mg = Math.max(0, Math.round((gMul ?? 1) * 255)), mb = Math.max(0, Math.round((bMul ?? 1) * 255));
  if (ra === 0 && ga === 0 && ba === 0 && mr === 255 && mg === 255 && mb === 255) return null;
  const key = [(atlas && atlas._id) || 0, srcX, srcY, width, height, ra, ga, ba, mr, mg, mb].join(":");
  const cached = tintCache.get(key);
  if (cached) return cached;
  if (tintCache.size > 1500) tintCache.clear();
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.drawImage(atlas, srcX, srcY, width, height, 0, 0, width, height);
  const img = cx.getImageData(0, 0, width, height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = Math.min(255, (d[i] * mr) / 255 + ra);
    d[i + 1] = Math.min(255, (d[i + 1] * mg) / 255 + ga);
    d[i + 2] = Math.min(255, (d[i + 2] * mb) / 255 + ba);
  }
  cx.putImageData(img, 0, 0);
  tintCache.set(key, c);
  return c;
}
function drawAtlasImage(ctx, def, key) {
  const tinted = tintedSourceCanvas(def.srcX, def.srcY, def.width, def.height, key.rAdd, key.gAdd, key.bAdd,
    MUL_ON ? key.rMul : 1, MUL_ON ? key.gMul : 1, MUL_ON ? key.bMul : 1);
  if (tinted) ctx.drawImage(tinted, 0, 0, def.width, def.height);
  else ctx.drawImage(atlas, def.srcX, def.srcY, def.width, def.height, 0, 0, def.width, def.height);
}
function effKey(key, inh) {  
  if (!inh) return key;
  return { ...key,
    rAdd: (key.rAdd || 0) + inh.r, gAdd: (key.gAdd || 0) + inh.g, bAdd: (key.bAdd || 0) + inh.b,
    rMul: (key.rMul ?? 1) * (inh.mr ?? 1), gMul: (key.gMul ?? 1) * (inh.mg ?? 1), bMul: (key.bMul ?? 1) * (inh.mb ?? 1) };
}
function flipbookActiveFrame(node, frame) {  
  const imgs = node.sim && node.sim.imgs; if (!imgs || !imgs.length) return null;
  const idx = node.simParent ? Math.floor(frame + 1e-7) : simDraw(node).frame;
  const im = imgs[Math.max(0, Math.min(idx, imgs.length - 1))];
  return (im && im.length) ? { images: im } : null;
}
function walkAndDraw(node, parentMatrix, parentAlpha, frame, ctx, inh, dry) {  
  if (node.type === "unresolved") return;
  const key = interpolateAtFrame(node, frame);
  if (!key || !key.visible) return;
  const alpha = parentAlpha * (key.alpha != null ? key.alpha : 1);
  if (node.type === "group") {
    const worldM = matMul(parentMatrix, keyLocalMatrix(key));
    const childFrame = simDraw(node).T;
    const ni = { r: (inh ? inh.r : 0) + (key.rAdd || 0), g: (inh ? inh.g : 0) + (key.gAdd || 0), b: (inh ? inh.b : 0) + (key.bAdd || 0),
                 mr: (inh ? inh.mr ?? 1 : 1) * (key.rMul ?? 1), mg: (inh ? inh.mg ?? 1 : 1) * (key.gMul ?? 1), mb: (inh ? inh.mb ?? 1 : 1) * (key.bMul ?? 1) };
    for (const child of node.children) walkAndDraw(child, worldM, alpha, childFrame, ctx, ni, dry);
    return;
  }
  const one = (def, M) => {
    if (def.width <= 0 || def.height <= 0) return;
    visCount++;
    if (dry) return;
    try {
      ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      drawAtlasImage(ctx, def, effKey(key, inh));
      ctx.globalAlpha = 1;
    } catch (e) { /* one bad source rect must not abort the frame */ }
  };
  if (node.type === "image") { one(node, matMul(parentMatrix, layerMatrix(node, key))); return; }
  if (node.type === "flipbook") {
    const af = flipbookActiveFrame(node, frame);
    if (!af) return;
    for (const def of af.images) one(def, matMul(parentMatrix, imageDefMatrix(def, key)));
  }
}
function gameFit(W, H) {
  const k = Math.min(H / GAME_PANEL.h, W / GAME_PANEL.w);
  const top = (H - GAME_PANEL.h * k) / 2;
  return { scale: GAME_PANEL.sc * k, offsetX: W / 2, offsetY: top + (GAME_PANEL.h / 2 + GAME_PANEL.oy) * k };
}
async function etcRunStream(bytes, fmt) {
  const ds = new DecompressionStream(fmt);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function etcInflateAny(bytes) {
  const tried = [];
  const looksZlib = (o) => bytes.length > o + 2 && (bytes[o] & 0x0f) === 8 && (((bytes[o] << 8) | bytes[o + 1]) % 31 === 0);
  for (const off of [0, 4, 8]) {
    if (looksZlib(off)) {
      try { const d = await etcRunStream(bytes.subarray(off), "deflate"); if (d.length) return { data: d, how: "zlib @+" + off, tried }; } catch (e) { tried.push("zlib@" + off + ": " + e.message); }
    }
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) { try { const d = await etcRunStream(bytes, "gzip"); if (d.length) return { data: d, how: "gzip", tried }; } catch (e) { tried.push("gzip: " + e.message); } }
  for (const off of [0, 4, 8]) {
    try { const d = await etcRunStream(bytes.subarray(off), "deflate-raw"); if (d.length > 16) return { data: d, how: "raw deflate @+" + off, tried }; } catch (e) { tried.push("raw@" + off + ": " + e.message); }
  }
  return { data: bytes, how: "NOT compressed (or unknown wrapper)", tried };
}
function etcBlocks(w, h) { return Math.ceil(w / 4) * Math.ceil(h / 4); }
function etcParseContainer(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (d.length >= 52 && dv.getUint32(0, true) === 0x03525650) { 
    const pf = dv.getUint32(8, true), pfHi = dv.getUint32(12, true), h = dv.getUint32(24, true), w = dv.getUint32(28, true);
    const mips = dv.getUint32(44, true), meta = dv.getUint32(48, true);
    const names = { 6: "ETC1", 22: "ETC2 RGB", 23: "ETC2 RGBA", 24: "ETC2 RGB A1" };
    return { kind: "PVR3", width: w, height: h, mips, format: pfHi ? -1 : pf, formatName: pfHi ? "non-compressed channel format" : (names[pf] || "pixel format " + pf), dataOffset: 52 + meta, dataLen: d.length - 52 - meta, isEtc1: !pfHi && pf === 6 };
  }
  if (d.length >= 52 && dv.getUint32(44, true) === 0x21525650) {         
    const hs = dv.getUint32(0, true), h = dv.getUint32(4, true), w = dv.getUint32(8, true), mips = dv.getUint32(12, true), fl = dv.getUint32(16, true), ds = dv.getUint32(20, true);
    const type = fl & 0xff;
    return { kind: "PVR2", width: w, height: h, mips: mips + 1, format: type, formatName: type === 0x36 ? "ETC1 (0x36)" : "legacy type 0x" + type.toString(16), dataOffset: hs || 52, dataLen: ds, isEtc1: type === 0x36 };
  }
  const cands = [];
  if (d.length >= 8) {
    const w32 = dv.getUint32(0, true), h32 = dv.getUint32(4, true);
    if (w32 > 0 && h32 > 0 && w32 <= 8192 && h32 <= 8192 && etcBlocks(w32, h32) * 8 <= d.length - 8 && etcBlocks(w32, h32) * 8 >= (d.length - 8) * 0.9) cands.push([w32, h32, 8, "u32 w,h header"]);
    const w16 = dv.getUint16(0, true), h16 = dv.getUint16(2, true);
    if (w16 > 0 && h16 > 0 && etcBlocks(w16, h16) * 8 === d.length - 4) cands.push([w16, h16, 4, "u16 w,h header"]);
  }
  const sq = [];
  for (const w of [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4]) for (const h of [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4]) if (etcBlocks(w, h) * 8 === d.length) sq.push([w, h, 0, "bare ETC1, power of two"]);
  sq.sort((a, b) => Math.abs(Math.log2(a[0] / a[1])) - Math.abs(Math.log2(b[0] / b[1]))); 
  cands.push(...sq);
  return { kind: "raw?", candidates: cands, isEtc1: cands.length > 0 };
}
function etcDecodeEtc1(src, off, w, h) {
  const out = new Uint8Array(w * h * 4), bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const c8 = (v, bits) => bits === 5 ? (v << 3) | (v >> 2) : (v << 4) | v;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  let p = off;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += 8) {
    if (p + 8 > src.length) return out;                                     
    const b0 = src[p], b1 = src[p + 1], b2 = src[p + 2], b3 = src[p + 3];
    const diff = (b3 >> 1) & 1, flip = b3 & 1, cw1 = (b3 >> 5) & 7, cw2 = (b3 >> 2) & 7;
    let r1, g1, b1c, r2, g2, b2c;
    if (diff) {
      const R = b0 >> 3, G = b1 >> 3, B = b2 >> 3;
      const sx = v => (v & 4) ? v - 8 : v;
      const R2 = R + sx(b0 & 7), G2 = G + sx(b1 & 7), B2 = B + sx(b2 & 7);
      r1 = c8(R, 5); g1 = c8(G, 5); b1c = c8(B, 5); r2 = c8(R2 & 31, 5); g2 = c8(G2 & 31, 5); b2c = c8(B2 & 31, 5);
    } else {
      r1 = c8(b0 >> 4, 4); r2 = c8(b0 & 15, 4); g1 = c8(b1 >> 4, 4); g2 = c8(b1 & 15, 4); b1c = c8(b2 >> 4, 4); b2c = c8(b2 & 15, 4);
    }
    const msb = (src[p + 4] << 8) | src[p + 5], lsb = (src[p + 6] << 8) | src[p + 7];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const px = bx * 4 + x, py = by * 4 + y; if (px >= w || py >= h) continue;
      const i = x * 4 + y, idx = (((msb >> i) & 1) << 1) | ((lsb >> i) & 1);
      const second = flip ? (y >= 2) : (x >= 2);
      const mod = ETC_MOD[second ? cw2 : cw1][idx];
      const o = (py * w + px) * 4;
      out[o] = cl((second ? r2 : r1) + mod); out[o + 1] = cl((second ? g2 : g1) + mod); out[o + 2] = cl((second ? b2c : b1c) + mod); out[o + 3] = 255;
    }
  }
  return out;
}
function etcCombine(col, alp, opts) {
  const W = col.width, H = col.height, out = new Uint8ClampedArray(W * H * 4);
  const aw = alp ? alp.width : 0, ah = alp ? alp.height : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    out[o] = col.rgba[o]; out[o + 1] = col.rgba[o + 1]; out[o + 2] = col.rgba[o + 2];
    out[o + 3] = alp ? ((x < aw && y < ah) ? alp.rgba[(y * aw + x) * 4] : 0) : 255;    
  }
  let img = { w: W, h: H, d: out };
  if (opts && opts.flip) {
    const f = new Uint8ClampedArray(out.length), rb = W * 4;
    for (let y = 0; y < H; y++) f.set(out.subarray(y * rb, (y + 1) * rb), (H - 1 - y) * rb);
    img = { w: W, h: H, d: f };
  }
  if (opts && opts.realH && opts.realH > 0 && opts.realH < H) {       
    const cut = H - opts.realH, rb = W * 4;
    img = opts.flip ? { w: W, h: opts.realH, d: img.d.slice(cut * rb) } : { w: W, h: opts.realH, d: img.d.slice(0, opts.realH * rb) };
  }
  return img;
}
const ETC_MOD = [[2, 8, -2, -8], [5, 17, -5, -17], [9, 29, -9, -29], [13, 42, -13, -42], [18, 60, -18, -60], [24, 80, -24, -80], [33, 106, -33, -106], [47, 183, -47, -183]];
async function etcLoadOne(bytes) {
  const inf = await etcInflateAny(bytes);
  const c = etcParseContainer(inf.data);
  let w, h, off;
  if (c.kind === "PVR3" || c.kind === "PVR2") {
    if (!c.isEtc1) throw new Error("texture container is " + c.formatName + ", only ETC1 is supported");
    w = c.width; h = c.height; off = c.dataOffset;
  } else if (c.candidates.length) { [w, h, off] = c.candidates[0]; }
  else throw new Error("unknown texture container (" + inf.data.length + " B)");
  return { rgba: etcDecodeEtc1(inf.data, off, w, h), width: w, height: h };
}
function etcCanvasOf(img) {
  const c = document.createElement("canvas"); c.width = img.w; c.height = img.h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h), 0, 0); return c;
}
const M = { ready: null, byId: new Map(), filesP: null, cache: new Map() };
async function fetchBytes(url) {
  if (M.cache.has(url)) return M.cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (/\.xmz$/i.test(url) && (buf.length < 4 || buf[1] === 0)) throw new Error("bad .xmz (" + buf.length + " B) " + url);  
  M.cache.set(url, buf);
  return buf;
}
function loadManifest() {
  if (M.ready) return M.ready;
  M.ready = (async () => {
    const res = await fetch(CFG.manifest);
    if (!res.ok) throw new Error("manifest HTTP " + res.status + " " + CFG.manifest);
    const doc = new DOMParser().parseFromString(await res.text(), "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("sprites.xml is not valid XML");
    doc.querySelectorAll("PackSummary").forEach(el => {
      const img = el.querySelector(":scope > Img");
      M.byId.set(el.getAttribute("id"), {
        id: el.getAttribute("id"), hash: el.getAttribute("hash"),
        img: img ? { name: img.getAttribute("name"), hash: img.getAttribute("hash"),
          skins: [...img.querySelectorAll(":scope > Skin")].map(s => ({ name: s.getAttribute("name"), hash: s.getAttribute("hash") })) } : null
      });
    });
    M.sprites = new Map();
    doc.querySelectorAll("SpriteSummary").forEach(el => {
      M.sprites.set((el.getAttribute("id") || "").toLowerCase(), el.getAttribute("pack"));
    });
    return M;
  })();
  M.ready.catch(() => { M.ready = null; });
  return M.ready;
}
function loadFileList() {   
  if (!M.filesP) M.filesP = fetch(CFG.files).then(r => r.ok ? r.json() : []).catch(() => []);
  return M.filesP;
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function findFile(stem, kind) {   
  const files = await loadFileList();
  const re = new RegExp("^" + escRe(stem) + "(-[^.]+)?" + escRe(kind) + "$");
  return files.find(f => re.test(f)) || null;
}
function standId(mutantId) { return "specimen_" + String(mutantId || "").trim().toLowerCase() + "_stand"; }
function packIdFor(mutantId) { return (M.sprites && M.sprites.get("specimen_" + String(mutantId || "").trim().toLowerCase() + "_stand")) || null; }
function packIdFor(mutantId) {  
  const m = String(mutantId || "").trim().toLowerCase().match(/^([a-z])([a-z])_(\d+)/);
  return m ? "character_" + m[1] + "_" + m[2] + "_" + m[3] : null;
}
async function loadXmzBytes(pack) {
  const tries = [CFG.spritesDir + "/" + pack.id + "-" + pack.hash + ".xmz", CFG.spritesDir + "/" + pack.id + ".xmz"];
  let err;
  for (const u of tries) { try { return await fetchBytes(u); } catch (e) { err = e; } }
  const f = await findFile(pack.id, ".xmz");
  if (f) return fetchBytes(CFG.spritesDir + "/" + f);
  throw err;
}
function skinInfo(pack, skin) {
  if (!pack.img) return null;
  if (!skin) return { stem: pack.img.name, hash: pack.img.hash };
  const s = pack.img.skins.find(x => (x.name || "").toLowerCase() === skin);
  return s ? { stem: pack.img.name + "_" + s.name, hash: s.hash } : null;
}
async function etcBytes(stem, hash, kind) {
  const ext = kind + CFG.etcExt, tries = [stem + "-" + hash + ext, stem + ext];
  let err;
  for (const t of tries) { try { return await fetchBytes(CFG.etcDir + "/" + t); } catch (e) { err = e; } }
  const f = await findFile(stem, ext);
  if (f) return fetchBytes(CFG.etcDir + "/" + f);
  throw err;
}
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("image failed " + url)); im.src = url; });
}
async function atlasFor(pack, skin) {  
  const si = skinInfo(pack, skin); if (!si) return null;
  const key = "atlas:" + pack.id + ":" + skin;
  if (M.cache.has(key)) return M.cache.get(key);
  let out;
  try {
    const cB = await etcBytes(si.stem, si.hash, ".etc1");
    let aB = null; try { aB = await etcBytes(si.stem, si.hash, ".etca"); } catch (e) { log("no alpha file for " + si.stem + ": " + e.message); }
    const c = await etcLoadOne(cB), a = aB ? await etcLoadOne(aB) : null;
    out = etcCanvasOf(etcCombine(c, a, { flip: CFG.etcFlip, realH: null }));
  } catch (e) {
    log("ETC atlas failed (" + e.message + "), trying the webp");
    out = await loadImage(CFG.spritesDir + "/" + si.stem + "-" + si.hash + ".webp");
  }
  out._id = ++atlasCounter;
  M.cache.set(key, out);
  return out;
}
let inst = null;
async function create(container, mutantId) {
  await loadManifest();
  const spriteKey = "specimen_" + String(mutantId || "").trim().toLowerCase() + "_stand";
  const packId = (spriteKey && M.sprites.get(spriteKey)) || packIdFor(mutantId);
  if (!packId) { log("no sprite entry for " + mutantId); return null; }
  const pack = M.byId.get(packId);
  if (!pack) { log("no pack " + packId + " in the manifest (via " + spriteKey + ")"); return null; }
  const scenes = parseSpriteXml(await decodeXmz(await loadXmzBytes(pack)));
  const scene = scenes.find(s => s.id.toLowerCase() === spriteKey) || scenes.find(s => /_stand$/i.test(s.id));
  if (!scene) { log(packId + ": no _stand clip (" + scenes.map(s => s.id).join(", ") + ")"); return null; }
  const firstAtlas = await atlasFor(pack, "");
  if (!firstAtlas) return null;
  if (inst) inst.destroy();

  atlas = firstAtlas; tintCache.clear(); SIM = { rt: new Map() };
  Object.assign(state, { currentScene: scene, currentFrame: 0, playbackDelay: 0, playbackAccumulator: 0, playbackRateCounter: 0, playFrame: 0,
                         idleActive: false, idlePose: null, idleFrame: -1, lastVis: null });
  simUpdateList(scene.root, 0, 0);

  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const canvas = document.createElement("canvas");
  canvas.className = "mutant-anim-canvas";
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;";
  container.appendChild(canvas);

  let curSkin = "", running = false, inView = true, last = 0, raf = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1, w = Math.round(container.clientWidth * dpr), h = Math.round(container.clientHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    render();
  }
  function poseVisible(frame) {
    const sv = visCount; visCount = 0;
    try { for (const n of scene.root) walkAndDraw(n, matIdentity(), 1, frame, null, null, true); } catch (_) {}
    const v = visCount; visCount = sv; return v > 0;
  }
  function applyIdleFreeze() { 
    if (!(state.playbackDelay > 0)) { state.idleActive = false; state.idlePose = null; return; }
    if (!state.idleActive || !state.idlePose || state.idleFrame !== state.playFrame) {
      state.idleFrame = state.playFrame;
      const cur = { frame: state.currentFrame };
      state.idlePose = (poseVisible(cur.frame) || !state.lastVis) ? cur : state.lastVis;
      state.idleActive = true;
    }
    state.currentFrame = state.idlePose.frame;
  }
  function render() {
    const W = canvas.width, H = canvas.height; if (!W || !H) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const fit = gameFit(W, H);
    const fitM = matMul(matTranslate(fit.offsetX, fit.offsetY), matScale(fit.scale, fit.scale));
    visCount = 0;
    for (const n of scene.root) walkAndDraw(n, fitM, 1, state.currentFrame, ctx, null, false);
    if (visCount > 0 && !state.idleActive) state.lastVis = { frame: state.currentFrame };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function tick(now) {
    raf = 0; if (!running) return;
    const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now;
    stepSpritePlayback(scene, dt, true);
    simUpdateList(scene.root, state.currentFrame, dt);
    applyIdleFreeze();
    render();
    raf = requestAnimationFrame(tick);
  }
  function sync() {
    const want = inView && !document.hidden;
    if (want && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = new IntersectionObserver(es => { inView = es[es.length - 1].isIntersecting; sync(); }); io.observe(container);
  const onVis = () => sync(); document.addEventListener("visibilitychange", onVis);
  resize(); sync();

  const api = {
    canvas, packId, clip: scene.id,
    hasSkin: v => { v = String(v || "").toLowerCase(); return v === "" || !!skinInfo(pack, v); },
    async setSkin(v) {
      v = String(v || "").toLowerCase();
      if (v === curSkin) return true;
      let a = null;
      try { a = await atlasFor(pack, v); } catch (e) { log("skin '" + v + "' failed: " + e.message); }
      if (!a) return false;
      atlas = a; tintCache.clear(); curSkin = v; render(); return true;
    },
    show(on) { canvas.style.display = on ? "block" : "none"; },
    destroy() {
      running = false; if (raf) cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis); canvas.remove(); if (inst === api) inst = null;
    }
  };
  inst = api;
  return api;
}

window.MutantAnim = { create, packIdFor, config: CFG, _test: { parseSpriteXml, stepSpritePlayback, simUpdateList, state, gameFit, decodeXmz } };
})();
