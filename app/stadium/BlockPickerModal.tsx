'use client';

import React, { useState, useMemo } from 'react';
import type { EditableBlock } from './SignalChainEditor';

interface CatalogEntry {
  id: string;
  name: string;
  cat: string;
  abbr: string;
  border: string;
  bg: string;
  img: string | null;
}

interface BlockPickerModalProps {
  currentBlock: EditableBlock;
  allModels: CatalogEntry[];
  onSelect: (model: string, name: string, type: string) => void;
  onClose: () => void;
}

// Categories to show (no routing/structural blocks)
const SHOW_CATS = [
  'Amp', 'Preamp', 'Cab',
  'Distortion', 'Dynamics', 'EQ', 'Modulation',
  'Delay', 'Reverb', 'Pitch/Synth',
  'Wah/Filter', 'Volume/Pan', 'Looper', 'FX', 'FX Loop',
];

// Map catalog cat → block type string used in EditableBlock
function catToType(cat: string): string {
  switch (cat) {
    case 'Amp': case 'Preamp': return 'amp';
    case 'Cab': return 'cab';
    case 'Distortion': return 'dist';
    case 'Delay': return 'delay';
    case 'Reverb': return 'reverb';
    case 'Modulation': return 'mod';
    case 'Dynamics': return 'dynamics';
    case 'EQ': return 'eq';
    case 'Pitch/Synth': return 'pitch';
    case 'Wah/Filter': return 'wah';
    case 'Volume/Pan': return 'volume';
    case 'Looper': return 'looper';
    default: return 'fx';
  }
}

export function BlockPickerModal({ currentBlock, allModels, onSelect, onClose }: BlockPickerModalProps) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('ALL');

  // Only show user-placeable categories
  const availableCats = useMemo(
    () => SHOW_CATS.filter(c => allModels.some(m => m.cat === c)),
    [allModels],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allModels.filter(m => {
      if (!SHOW_CATS.includes(m.cat)) return false;
      if (cat !== 'ALL' && m.cat !== cat) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allModels, cat, search]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 860, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        background: '#0d0d18', border: '1px solid #2a2a40',
        borderRadius: 18, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px', borderBottom: '1px solid #1a1a2a', flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#5a5a80', letterSpacing: '0.1em' }}>
            SWAP BLOCK
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            {currentBlock.name}  →  select replacement
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', width: 28, height: 28, borderRadius: 8,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Search + category chips */}
        <div style={{ padding: '12px 20px 10px', flexShrink: 0, borderBottom: '1px solid #141420' }}>
          <input
            autoFocus
            type="text"
            placeholder="Search models…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: '#141420', border: '1px solid #2a2a3a', color: '#fff',
              fontFamily: 'monospace', fontSize: 12, outline: 'none',
              marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['ALL', ...availableCats].map(c => (
              <button
                key={c}
                onClick={() => setCat(c)}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 10,
                  fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.06em',
                  cursor: 'pointer', transition: 'all 0.1s',
                  background: cat === c ? '#ff6b1a' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${cat === c ? '#ff6b1a' : 'rgba(255,255,255,0.1)'}`,
                  color: cat === c ? '#fff' : 'rgba(255,255,255,0.5)',
                }}
              >{c}</button>
            ))}
          </div>
        </div>

        {/* Model grid */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10,
          scrollbarWidth: 'thin', scrollbarColor: '#2a2a40 transparent',
        }}>
          {filtered.length === 0 && (
            <div style={{
              gridColumn: '1/-1', textAlign: 'center', padding: '48px 0',
              fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.2)',
            }}>No models match</div>
          )}
          {filtered.map(m => {
            const isCurrent = m.id === currentBlock.model || m.id === currentBlock.model.replace(/Stereo$/, 'Mono');
            return (
              <button
                key={m.id}
                onClick={() => onSelect(m.id, m.name, catToType(m.cat))}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '10px 6px 8px', borderRadius: 12, gap: 6, cursor: 'pointer',
                  background: isCurrent ? `${m.border}18` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isCurrent ? m.border + '88' : 'rgba(255,255,255,0.07)'}`,
                  boxShadow: isCurrent ? `0 0 14px ${m.border}30` : 'none',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = `${m.border}14`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${m.border}66`;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = isCurrent ? `${m.border}18` : 'rgba(255,255,255,0.03)';
                  (e.currentTarget as HTMLElement).style.borderColor = isCurrent ? `${m.border}88` : 'rgba(255,255,255,0.07)';
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 12,
                  background: m.bg || '#111', border: `1.5px solid ${m.border}`,
                  boxShadow: `0 0 10px ${m.border}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', flexShrink: 0,
                }}>
                  {m.img
                    ? <img src={`/helix-icons/${m.img}`} alt={m.name} style={{ width: 48, height: 48, objectFit: 'contain' }} />
                    : <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', color: m.border }}>{m.abbr}</span>
                  }
                </div>
                <span style={{
                  fontSize: 9.5, fontFamily: 'monospace', fontWeight: 600,
                  color: isCurrent ? '#fff' : 'rgba(255,255,255,0.7)',
                  textAlign: 'center', lineHeight: 1.3, wordBreak: 'break-word',
                }}>
                  {m.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px', borderTop: '1px solid #141420', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
            {filtered.length} models  ·  click to swap  ·  gold dot = changed from original
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', padding: '5px 16px', borderRadius: 8,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
            }}
          >CANCEL</button>
        </div>
      </div>
    </div>
  );
}
