import React, { memo, useReducer, useEffect } from "react";
import { flushSync } from "react-dom";
import { Trade } from "./BacktestTradingPanel";

interface CoordinateConverter {
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
}

interface SlTpDragLinesProps {
  converter: CoordinateConverter;
  slDragPrice: number | null;
  tpDragPrice: number | null;
  activeSlTpTradeId: string | null;
  trades: Trade[];
  pair: string | null;
  onSetDraggingLine: (line: 'sl' | 'tp') => void;
  scrollSyncRef?: React.MutableRefObject<() => void>;
}

function getInstrumentInfo(pair: string | null) {
  const isJpy = pair?.includes('JPY') ?? false;
  const isCrypto = !!(pair?.includes('BTC') || pair?.includes('ETH') || pair?.includes('XRP'));
  const isIndex = !!(pair?.includes('US30') || pair?.includes('DJ30') || pair?.includes('SPX') ||
    pair?.includes('NAS') || pair?.includes('DAX') || pair?.includes('FTSE') ||
    pair?.includes('AU200') || pair?.includes('EU50') || pair?.includes('JP225') ||
    pair?.includes('UK100') || pair?.includes('US500') || pair?.includes('US100'));
  const isGold = pair?.includes('XAU') ?? false;
  const isSilver = pair?.includes('XAG') ?? false;
  const pipValue = isIndex ? 1 : (isCrypto ? 1 : (isGold ? 0.1 : (isSilver ? 0.01 : (isJpy ? 0.01 : 0.0001))));
  return { pipValue };
}

export const SlTpDragLines = memo(({
  converter,
  slDragPrice,
  tpDragPrice,
  activeSlTpTradeId,
  trades,
  pair,
  onSetDraggingLine,
  scrollSyncRef,
}: SlTpDragLinesProps) => {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!scrollSyncRef) return;
    scrollSyncRef.current = () => {
      flushSync(() => forceUpdate());
    };
  }, [scrollSyncRef]);

  const trade = trades.find(t => t.id === activeSlTpTradeId);
  if (!trade) return null;

  const referencePrice = trade.status === 'pending' ? (trade.limitPrice || trade.entryPrice) : trade.entryPrice;
  const { pipValue } = getInstrumentInfo(pair);

  const entryY = converter.priceToY(referencePrice);
  const isBuy = trade.type === 'buy';
  const bgColor = isBuy ? '#2196F3' : '#ef5350';

  return (
    <>
      {/* ── SL zone + drag line ── */}
      {slDragPrice !== null && (() => {
        const y = Math.round(converter.priceToY(slDragPrice));
        const eY = Math.round(converter.priceToY(referencePrice));
        const slPips = Math.round(Math.abs(slDragPrice - referencePrice) / pipValue);
        return (
          <>
            {/* SL zone fill: extends full width, bleed hidden by axis cover */}
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: Math.min(y, eY),
                height: Math.abs(y - eY),
                background: 'rgba(239, 83, 80, 0.12)',
              }}
            />
            {/* SL drag handle + dashed line */}
            <div
              className="absolute left-0 right-0 cursor-ns-resize"
              style={{ top: y - 10, height: 20, zIndex: 50, pointerEvents: 'auto' }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSetDraggingLine('sl'); }}
              onTouchStart={(e) => { e.preventDefault(); onSetDraggingLine('sl'); }}
            >
              <div
                className="absolute left-0 right-0"
                style={{
                  top: 10,
                  height: 2,
                  background: `repeating-linear-gradient(to right, #ef5350 0, #ef5350 6px, transparent 6px, transparent 10px)`,
                  pointerEvents: 'none',
                }}
              />
              <div className="absolute left-4 top-0 h-5 flex items-center" style={{ pointerEvents: 'none' }}>
                <div style={{ background: 'rgba(239, 83, 80, 0.9)', color: 'white', padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 500 }}>
                  SL {slPips} pips
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── TP zone + drag line ── */}
      {tpDragPrice !== null && (() => {
        const y = Math.round(converter.priceToY(tpDragPrice));
        const eY = Math.round(converter.priceToY(referencePrice));
        const tpPips = Math.round(Math.abs(tpDragPrice - referencePrice) / pipValue);
        return (
          <>
            {/* TP zone fill: extends full width, bleed hidden by axis cover */}
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: Math.min(y, eY),
                height: Math.abs(y - eY),
                background: 'rgba(38, 166, 154, 0.12)',
              }}
            />
            {/* TP drag handle + dashed line */}
            <div
              className="absolute left-0 right-0 cursor-ns-resize"
              style={{ top: y - 10, height: 20, zIndex: 50, pointerEvents: 'auto' }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSetDraggingLine('tp'); }}
              onTouchStart={(e) => { e.preventDefault(); onSetDraggingLine('tp'); }}
            >
              <div
                className="absolute left-0 right-0"
                style={{
                  top: 10,
                  height: 2,
                  background: `repeating-linear-gradient(to right, #26a69a 0, #26a69a 6px, transparent 6px, transparent 10px)`,
                  pointerEvents: 'none',
                }}
              />
              <div className="absolute left-4 top-0 h-5 flex items-center" style={{ pointerEvents: 'none' }}>
                <div style={{ background: 'rgba(38, 166, 154, 0.9)', color: 'white', padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 500 }}>
                  TP {tpPips} pips
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Entry reference line ── */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{ top: entryY, height: 1, background: bgColor, opacity: 0.7 }}
      />
      <div
        className="absolute flex items-center pointer-events-none"
        style={{ left: 8, top: entryY - 10, zIndex: 51 }}
      >
        <div style={{ background: bgColor, color: 'white', padding: '2px 8px', borderRadius: 2, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {isBuy ? 'BUY' : 'SELL'} {trade.lotSize?.toFixed(2) || '0.01'}
        </div>
      </div>
    </>
  );
});

SlTpDragLines.displayName = 'SlTpDragLines';
export default SlTpDragLines;
