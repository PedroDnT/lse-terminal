import React, { memo, useReducer, useEffect } from "react";
import { flushSync } from "react-dom";
import { Trade } from "./BacktestTradingPanel";

interface CoordinateConverter {
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
}

interface PlacedOrderLinesProps {
  converter: CoordinateConverter;
  trades: Trade[];
  activeSlTpTradeId: string | null;
  pair: string | null;
  scrollSyncRef?: React.MutableRefObject<() => void>;
  formatPrice: (price: number, pair: string | null) => string;
}

export const PlacedOrderLines = memo(({
  converter,
  trades,
  activeSlTpTradeId,
  pair,
  scrollSyncRef,
  formatPrice,
}: PlacedOrderLinesProps) => {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Register synchronous re-render on every scroll frame, same pattern as ChartDrawingOverlay
  useEffect(() => {
    if (!scrollSyncRef) return;
    scrollSyncRef.current = () => {
      flushSync(() => forceUpdate());
    };
  }, [scrollSyncRef]);

  const priceAxisW = typeof window !== 'undefined'
    ? (window.innerWidth >= 1024 ? 110 : (window.innerWidth < 500 ? 72 : 85))
    : 110;

  const pendingTrades = trades.filter(t => t.status === 'pending' && t.limitPrice);
  const openTrades = trades.filter(t => t.status === 'open');
  const multipleOpen = openTrades.length > 1;

  const labelStyle = {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 600,
    letterSpacing: '0.02em',
    padding: '1px 4px',
    lineHeight: '14px',
    zIndex: 5,
  } as const;

  return (
    <div className="absolute inset-0 pointer-events-none z-[15]">
      {/* Pending Limit Orders */}
      {pendingTrades.map((trade, i) => {
        const y = converter.priceToY(trade.limitPrice!);
        // Same blue-buy / zinc-sell convention as the canvas positionRenderer:
        // red is SL-only, and no green/red on buy/sell anywhere in the manual
        // backtest.
        const color = trade.type === 'buy' ? '#2563eb' : '#71717a';
        const typeLabel = trade.type === 'buy' ? 'BUY' : 'SELL';
        const kindLabel = trade.orderType === 'stop' ? 'STOP' : 'LMT';
        const suffix = pendingTrades.length > 1 ? `${i + 1}` : '';
        return (
          <div key={trade.id}>
            <div
              className="absolute left-0"
              style={{
                right: priceAxisW,
                top: y,
                height: 1,
                background: `repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 8px)`,
                opacity: 0.5,
              }}
            />
            <div
              className="absolute"
              style={{ left: 8, top: y - 9, background: color, color: 'white', borderRadius: 2, opacity: 0.9, ...labelStyle }}
            >
              {typeLabel} {kindLabel}{suffix}
            </div>
          </div>
        );
      })}

      {/* Open Position Entry Lines + SL/TP Zone Boxes */}
      {openTrades.map((trade, i) => {
        const entryY = converter.priceToY(trade.entryPrice);
        const slY = trade.stopLoss ? converter.priceToY(trade.stopLoss) : null;
        const tpY = trade.takeProfit ? converter.priceToY(trade.takeProfit) : null;
        const isBuy = trade.type === 'buy';
        // Blue-buy / zinc-sell like the pending lines above; TP/SL keep their own colours.
        const entryColor = isBuy ? '#2563eb' : '#71717a';
        const isPlacingSLTP = activeSlTpTradeId === trade.id;
        const suffix = multipleOpen ? `${i + 1}` : '';
        return (
          <div key={trade.id}>
            {/* TP ZONE FILL (only during SL/TP placement) */}
            {isPlacingSLTP && tpY !== null && (
              <div
                className="absolute left-0"
                style={{
                  right: priceAxisW,
                  top: Math.min(entryY, tpY),
                  height: Math.abs(tpY - entryY),
                  background: 'rgba(38, 166, 154, 0.12)',
                }}
              />
            )}

            {/* TP DASHED LINE + LABEL */}
            {tpY !== null && (
              <>
                <div
                  className="absolute left-0"
                  style={{
                    right: priceAxisW,
                    top: tpY,
                    height: 1,
                    background: `repeating-linear-gradient(to right, rgba(38,166,154,0.5) 0, rgba(38,166,154,0.5) 4px, transparent 4px, transparent 7px)`,
                  }}
                />
                <div
                  className="absolute"
                  style={{ left: 8, top: tpY - 9, background: '#26a69a', color: 'white', borderRadius: 2, ...labelStyle }}
                >
                  TP{suffix}
                </div>
              </>
            )}

            {/* SL ZONE FILL (only during SL/TP placement) */}
            {isPlacingSLTP && slY !== null && (
              <div
                className="absolute left-0"
                style={{
                  right: priceAxisW,
                  top: Math.min(entryY, slY),
                  height: Math.abs(slY - entryY),
                  background: 'rgba(239, 83, 80, 0.12)',
                }}
              />
            )}

            {/* SL DASHED LINE + LABEL */}
            {slY !== null && (
              <>
                <div
                  className="absolute left-0"
                  style={{
                    right: priceAxisW,
                    top: slY,
                    height: 1,
                    background: `repeating-linear-gradient(to right, rgba(239,83,80,0.5) 0, rgba(239,83,80,0.5) 4px, transparent 4px, transparent 7px)`,
                  }}
                />
                <div
                  className="absolute"
                  style={{ left: 8, top: slY - 9, background: '#ef5350', color: 'white', borderRadius: 2, ...labelStyle }}
                >
                  SL{suffix}
                </div>
              </>
            )}

            {/* ENTRY LINE */}
            <div
              className="absolute left-0"
              style={{
                right: priceAxisW,
                top: entryY,
                height: 1.5,
                background: `repeating-linear-gradient(to right, ${entryColor} 0, ${entryColor} 8px, transparent 8px, transparent 12px)`,
                opacity: 0.9,
              }}
            />
            {/* Left label */}
            <div
              className="absolute"
              style={{ left: 8, top: entryY - 9, background: entryColor, color: 'white', borderRadius: 2, ...labelStyle }}
            >
              {trade.type === 'buy' ? 'BUY' : 'SELL'} {trade.lotSize?.toFixed(2) || '0.01'}{suffix ? ` #${i + 1}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
});

PlacedOrderLines.displayName = 'PlacedOrderLines';
export default PlacedOrderLines;
