'use client';

import React, { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditableBlock {
  slot: number;
  dsp: 1 | 2;
  path: 0 | 1;
  model: string;
  name: string;
  type: string;
  bypassed: boolean;
  fixed?: boolean; // input / output / routing — displayed but not draggable
}

export type EditMap = Map<number, EditableBlock>;

// ── Constants (match page.tsx signal chain viewer) ───────────────────────────

const BLK = 140;
const LINE_W = 32;
const LINE_COLOR = '#1e1e30';
const UNIT = BLK + LINE_W;
const BRIDGE_H = 44;
const MAX_SLOTS = 14;

// ── Category colors ───────────────────────────────────────────────────────────

export function getCat(type: string, name: string): { border: string; abbr: string } {
  switch (type) {
    case 'amp': case 'pre':  return { border: '#e03030', abbr: 'AMP' };
    case 'cab':              return { border: '#b04820', abbr: 'CAB' };
    case 'dist':             return { border: '#c06010', abbr: 'DIST' };
    case 'delay':            return { border: '#20c070', abbr: 'DLY' };
    case 'reverb':           return { border: '#20a0c0', abbr: 'REV' };
    case 'split':            return { border: '#4a4a6a', abbr: 'SPL' };
    case 'join': case 'merge': return { border: '#4a4a6a', abbr: 'MRG' };
    case 'input':            return { border: '#4a4a6a', abbr: 'IN' };
    case 'output':           return { border: '#4a4a6a', abbr: 'OUT' };
  }
  const l = name.toLowerCase();
  if (/\bamp\b|twin|deluxe|princeton|plexi|jcm|mesa|marshall|vox|friedman|dumble|rectif/.test(l)) return { border: '#e03030', abbr: 'AMP' };
  if (/\bcab\b/.test(l))                  return { border: '#b04820', abbr: 'CAB' };
  if (/dist|fuzz|drive|overdrive|boost|screamer|rat\b|klon|muff/.test(l))              return { border: '#c06010', abbr: 'DIST' };
  if (/delay|echo|slapback/.test(l))      return { border: '#20c070', abbr: 'DLY' };
  if (/reverb|plate|hall|spring|room|cathedral/.test(l))                               return { border: '#20a0c0', abbr: 'REV' };
  if (/chorus/.test(l))                   return { border: '#4060e0', abbr: 'CHO' };
  if (/flanger/.test(l))                  return { border: '#6040c0', abbr: 'FLG' };
  if (/phaser/.test(l))                   return { border: '#8030b0', abbr: 'PHS' };
  if (/pitch|octav|whammy|harmony/.test(l)) return { border: '#9030c0', abbr: 'PCH' };
  if (/wah|filter/.test(l))              return { border: '#c0a000', abbr: 'WAH' };
  if (/compressor|comp\b|dynamics/.test(l)) return { border: '#40a040', abbr: 'CMP' };
  if (/\beq\b/.test(l))                  return { border: '#4070c0', abbr: 'EQ'  };
  if (/tremolo|trem\b/.test(l))          return { border: '#c040a0', abbr: 'TRM' };
  if (/volume|vol\b/.test(l))            return { border: '#606090', abbr: 'VOL' };
  return { border: '#3a3a5a', abbr: 'FX' };
}

// ── Drag ghost shown in DragOverlay ───────────────────────────────────────────

function GhostBlock({ block, imgFile }: { block: EditableBlock; imgFile: string | null }) {
  const { border, abbr } = getCat(block.type, block.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
      <div style={{
        width: BLK, height: BLK, borderRadius: 22, background: '#000',
        border: `2px solid ${border}`,
        boxShadow: `0 0 48px ${border}80, 0 12px 40px rgba(0,0,0,0.7)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: 'scale(1.07)', overflow: 'hidden',
      }}>
        {imgFile
          ? <img src={`/helix-icons/${imgFile}`} alt={block.name} style={{ width: 116, height: 116, objectFit: 'contain' }} />
          : <span style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 'bold', color: border, letterSpacing: '0.08em' }}>{abbr}</span>
        }
      </div>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {block.name}
      </span>
    </div>
  );
}

// ── Draggable block ───────────────────────────────────────────────────────────

interface BlockItemProps {
  slotId: string;
  block: EditableBlock;
  isChanged: boolean;
  imgFile: string | null;
  onEdit: () => void;
}

function BlockItem({ slotId, block, isChanged, imgFile, onEdit }: BlockItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: slotId,
    disabled: !!block.fixed,
  });

  const { border, abbr } = getCat(block.type, block.name);

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0,
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        opacity: isDragging ? 0.2 : 1,
        cursor: block.fixed ? 'default' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      {...(block.fixed ? {} : { ...attributes, ...listeners })}
    >
      <div
        style={{
          width: BLK, height: BLK, borderRadius: 22, background: '#000',
          border: `2px solid ${block.bypassed ? '#252535' : border}`,
          boxShadow: block.bypassed ? 'none' : `0 0 28px ${border}40, inset 0 0 36px ${border}0c`,
          opacity: block.bypassed ? 0.35 : 1,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          flexShrink: 0, overflow: 'hidden', position: 'relative',
          cursor: block.fixed ? 'default' : 'pointer',
          transition: 'border-color 0.15s',
        }}
        onClick={e => { if (!block.fixed) { e.stopPropagation(); onEdit(); } }}
      >
        {isChanged && !block.fixed && (
          <div style={{
            position: 'absolute', top: 7, right: 7, width: 9, height: 9,
            borderRadius: '50%', background: '#ffd700', boxShadow: '0 0 8px #ffd700aa', zIndex: 1,
          }} />
        )}
        {imgFile
          ? <img src={`/helix-icons/${imgFile}`} alt={block.name} style={{ width: 116, height: 116, objectFit: 'contain' }} />
          : <span style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 'bold', color: border, letterSpacing: '0.08em' }}>{abbr}</span>
        }
      </div>
      <span style={{
        fontSize: 11, fontFamily: 'monospace',
        color: block.bypassed ? '#2e2e42' : 'rgba(255,255,255,0.85)',
        textAlign: 'center', lineHeight: 1.3, maxWidth: BLK,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600,
      }}>
        {block.name}
      </span>
    </div>
  );
}

// ── Droppable slot wrapper ────────────────────────────────────────────────────

function SlotDrop({ slotId, occupied, anyDragging, children }: {
  slotId: string; occupied: boolean; anyDragging: boolean; children?: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `drop:${slotId}` });
  return (
    <div ref={setNodeRef} style={{ position: 'relative', flexShrink: 0, width: BLK }}>
      {occupied ? children : (
        <div style={{
          width: BLK, height: BLK, borderRadius: 22,
          border: `1px dashed ${isOver ? 'rgba(255,255,255,0.45)' : anyDragging ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)'}`,
          background: isOver ? 'rgba(255,255,255,0.06)' : 'transparent',
          transition: 'all 0.12s',
        }} />
      )}
      {/* drop highlight overlay when dragging over an occupied slot */}
      {isOver && occupied && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: BLK, height: BLK,
          borderRadius: 22, background: 'rgba(255,255,255,0.09)',
          border: '2px solid rgba(255,255,255,0.28)', pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ── Trash zone (fixed, appears during drag) ───────────────────────────────────

function TrashZone({ visible }: { visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'trash' });
  if (!visible) return null;
  return (
    <div ref={setNodeRef} style={{
      position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, width: 210, height: 52, borderRadius: 14,
      background: isOver ? 'rgba(239,68,68,0.22)' : 'rgba(239,68,68,0.07)',
      border: `2px solid ${isOver ? '#ef4444' : 'rgba(239,68,68,0.32)'}`,
      boxShadow: isOver ? '0 0 32px rgba(239,68,68,0.55)' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      transition: 'all 0.12s',
      color: isOver ? '#ef4444' : 'rgba(239,68,68,0.45)',
      fontSize: 13, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.06em',
      pointerEvents: 'all',
    }}>
      ✕ REMOVE BLOCK
    </div>
  );
}

// ── Bridge connector ──────────────────────────────────────────────────────────

function Bridge({ splitSlot, joinSlot }: { splitSlot: number; joinSlot: number }) {
  const splitCX = splitSlot * UNIT + BLK / 2 - 1;
  const joinCX  = joinSlot >= 0 ? joinSlot * UNIT + BLK / 2 - 1 : -1;
  return (
    <div style={{ position: 'relative', height: BRIDGE_H, flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: splitCX, top: 0, width: 2, height: BRIDGE_H, background: LINE_COLOR }} />
      {joinCX >= 0 && (
        <div style={{ position: 'absolute', left: joinCX, top: 0, width: 2, height: BRIDGE_H, background: LINE_COLOR }} />
      )}
    </div>
  );
}

// ── SignalChainEditor ─────────────────────────────────────────────────────────

export interface SignalChainEditorProps {
  dsp1Map: EditMap;
  dsp2Map: EditMap;
  origDsp1Map: EditMap;
  origDsp2Map: EditMap;
  modelDefs: Record<string, { name: string; short: string; cls: string; img: string | null }>;
  onSwap:      (slotIdA: string, slotIdB: string) => void;
  onDelete:    (slotId: string) => void;
  onEditBlock: (slotId: string, block: EditableBlock) => void;
}

export function SignalChainEditor({
  dsp1Map, dsp2Map, origDsp1Map, origDsp2Map,
  modelDefs, onSwap, onDelete, onEditBlock,
}: SignalChainEditorProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Derive layout from map contents
  const dsp1HasBottom = [...dsp1Map.keys()].some(k => k >= 14);
  const dsp1SplitSlot = [...dsp1Map.entries()].find(([, b]) => b.type === 'split'    && b.slot < 14)?.[0] ?? -1;
  const dsp1JoinSlot  = [...dsp1Map.entries()].find(([, b]) => (b.type === 'join' || b.type === 'merge') && b.slot < 14)?.[0] ?? -1;

  const dsp2HasTop    = dsp2Map.size > 0 && [...dsp2Map.keys()].some(k => k < 14);
  const dsp2HasBottom = [...dsp2Map.keys()].some(k => k >= 14);
  const dsp2SplitSlot = [...dsp2Map.entries()].find(([, b]) => b.type === 'split'    && b.slot < 14)?.[0] ?? -1;
  const dsp2JoinSlot  = [...dsp2Map.entries()].find(([, b]) => (b.type === 'join' || b.type === 'merge') && b.slot < 14)?.[0] ?? -1;

  function slotIdToBlock(id: string) {
    const [pfx, s] = id.split(':');
    return pfx === 'd1' ? dsp1Map.get(Number(s)) : dsp2Map.get(Number(s));
  }

  const activeBlock = activeDragId ? slotIdToBlock(activeDragId) : null;
  const getImg = (model: string) =>
    modelDefs[model]?.img ?? modelDefs[model.replace(/Stereo$/, 'Mono')]?.img ?? null;
  const activeImg = activeBlock ? getImg(activeBlock.model) : null;

  function handleDragStart(e: DragStartEvent) { setActiveDragId(String(e.active.id)); }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const activeId = String(active.id);
    if (overId === 'trash') {
      onDelete(activeId);
    } else if (overId.startsWith('drop:')) {
      const targetId = overId.slice(5);
      if (targetId !== activeId) onSwap(activeId, targetId);
    }
  }

  function renderRow(map: EditMap, origMap: EditMap, prefix: 'd1' | 'd2', slotOffset: number) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {Array.from({ length: MAX_SLOTS }, (_, si) => {
          const slot = si + slotOffset;
          const slotId = `${prefix}:${slot}`;
          const block  = map.get(slot);
          const orig   = origMap.get(slot);
          const changed = !!block && !block.fixed && (!orig || orig.model !== block.model);
          return (
            <div key={si} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <SlotDrop slotId={slotId} occupied={!!block} anyDragging={activeDragId !== null}>
                {block && (
                  <BlockItem
                    slotId={slotId}
                    block={block}
                    isChanged={changed}
                    imgFile={getImg(block.model)}
                    onEdit={() => onEditBlock(slotId, block)}
                  />
                )}
              </SlotDrop>
              {si < MAX_SLOTS - 1 && (
                <div style={{ width: LINE_W, height: 2, background: LINE_COLOR, flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* ── DSP 1 ── */}
      <div style={{ position: 'relative' }}>
        {renderRow(dsp1Map, origDsp1Map, 'd1', 0)}
        {dsp1HasBottom && dsp1SplitSlot >= 0 && <Bridge splitSlot={dsp1SplitSlot} joinSlot={dsp1JoinSlot} />}
        {dsp1HasBottom && renderRow(dsp1Map, origDsp1Map, 'd1', 14)}
      </div>

      {/* ── DSP 2 ── */}
      {(dsp2HasTop || dsp2HasBottom) && (
        <div style={{ position: 'relative', marginTop: 48 }}>
          {renderRow(dsp2Map, origDsp2Map, 'd2', 0)}
          {dsp2HasBottom && dsp2SplitSlot >= 0 && <Bridge splitSlot={dsp2SplitSlot} joinSlot={dsp2JoinSlot} />}
          {dsp2HasBottom && renderRow(dsp2Map, origDsp2Map, 'd2', 14)}
        </div>
      )}

      <DragOverlay dropAnimation={null}>
        {activeBlock && <GhostBlock block={activeBlock} imgFile={activeImg} />}
      </DragOverlay>

      <TrashZone visible={activeDragId !== null} />
    </DndContext>
  );
}
