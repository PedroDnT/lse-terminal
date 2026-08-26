import React, { memo, useMemo, useRef, useEffect, useState, useId, useReducer } from "react";
import { flushSync } from "react-dom";
import { Trade } from "./BacktestTradingPanel";
import { calculateTradePnL } from "@/lib/contractSpecs";

interface TradeOverlayProps {
  trades: Trade[];
  converter: {
    priceToY: (price: number) => number;
    yToPrice: (y: number) => number;
  } | null;
  pair: string;
  limitLinePrice?: number | null;
  pendingLimitType?: 'buy' | 'sell' | 'buy_stop' | 'sell_stop' | null;
  activeSlTpTradeId?: string | null;
  slDragPrice?: number | null;
  tpDragPrice?: number | null;
  isActivePanel?: boolean;
  onSlDragStart?: () => void;
  onTpDragStart?: () => void;
  scrollSyncRef?: React.MutableRefObject<() => void>;
}

// MT5-style colors
const COLORS = {
  buy: '#2196f3',
  sell: '#ef5350',
  sl: '#ef5350',
  tp: '#26a69a',
  pending: '#2196f3',
};

// MT5-style left label: "TP, +42.72, 576 points" or "SL, -47.91, -645 points"
const MT5Label = ({
  y,
  text,
  color,
}: {
  y: number;
  text: string;
  color: string;
}) => (
  <foreignObject x="4" y={y - 9} width="300" height="18" style={{ pointerEvents: 'none', overflow: 'visible' }}>
    <div
      style={{
        color: color,
        fontSize: '10px',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        height: '18px',
        lineHeight: '18px',
        opacity: 0.9,
      }}
    >
      {text}
    </div>
  </foreignObject>
);

// Right-side Y-axis price badge
const PriceBadge = ({
  y,
  text,
  color,
  interactive = false,
  onMouseDown
}: {
  y: number;
  text: string;
  color: string;
  interactive?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}) => (
  <foreignObject
    x="0"
    y={y - 10}
    width="100%"
    height="20"
    style={{ overflow: 'visible', pointerEvents: interactive ? 'all' : 'none' }}
  >
    <div style={{ display: 'flex', justifyContent: 'flex-end', height: '20px', pointerEvents: interactive ? 'all' : 'none' }}>
      <div
        style={{
          backgroundColor: color,
          color: 'white',
          fontSize: '10px',
          fontFamily: '-apple-system, BlinkMacSystemFont, monospace',
          fontWeight: 600,
          padding: '3px 6px',
          whiteSpace: 'nowrap',
          cursor: interactive ? 'ns-resize' : 'default',
          pointerEvents: interactive ? 'all' : 'none',
        }}
        onMouseDown={onMouseDown}
      >
        {text}
      </div>
    </div>
  </foreignObject>
);

// Draggable circle handle on SL/TP lines (MT5-style)
const DragCircle = ({
  y,
  color,
  onMouseDown,
}: {
  y: number;
  color: string;
  onMouseDown?: (e: React.MouseEvent) => void;
}) => (
  <g style={{ pointerEvents: 'all', cursor: 'ns-resize' }}>
    <circle cx="50%" cy={y} r="14" fill="transparent" style={{ cursor: 'ns-resize' }} onMouseDown={onMouseDown} />
    <circle
      cx="50%"
      cy={y}
      r="5"
      fill={color}
      stroke="white"
      strokeWidth="1.5"
      style={{ cursor: 'ns-resize', pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
    />
  </g>
);

export const TradeOverlay = memo(({
  trades,
  converter,
  pair,
  limitLinePrice,
  pendingLimitType,
  activeSlTpTradeId,
  slDragPrice,
  tpDragPrice,
  isActivePanel = true,
  onSlDragStart,
  onTpDragStart,
  scrollSyncRef,
}: TradeOverlayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const clipId = useId().replace(/:/g, '');
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Register synchronous re-render on every scroll frame, same pattern as ChartDrawingOverlay
  useEffect(() => {
    if (!scrollSyncRef) return;
    scrollSyncRef.current = () => {
      flushSync(() => forceUpdate());
    };
  }, [scrollSyncRef]);

  const priceAxisWidth = typeof window !== 'undefined'
    ? (window.innerWidth >= 1024 ? 110 : (window.innerWidth < 500 ? 72 : 85))
    : 110;
  const chartWidth = containerWidth > 0 ? containerWidth - priceAxisWidth : null;

  const isJpy = pair?.includes('JPY');
  const isCrypto = pair?.includes('BTC') || pair?.includes('ETH') || pair?.includes('XRP');
  const isIndex = pair?.includes('US30') || pair?.includes('DJ30') || pair?.includes('SPX') ||
    pair?.includes('NAS') || pair?.includes('DAX') || pair?.includes('FTSE') ||
    pair?.includes('AU200') || pair?.includes('EU50') || pair?.includes('JP225') ||
    pair?.includes('UK100') || pair?.includes('US500') || pair?.includes('US100');
  const isGold = pair?.includes('XAU');
  const isSilver = pair?.includes('XAG');

  const pipValue = isIndex ? 1 : (isCrypto ? 1 : (isGold ? 0.1 : (isSilver ? 0.01 : (isJpy ? 0.01 : 0.0001))));
  const decimals = isIndex ? 2 : (isCrypto ? 2 : (isGold ? 2 : (isSilver ? 4 : (isJpy ? 3 : 5))));

  const activeTrades = useMemo(() =>
    trades.filter(t => t.status === 'open' || t.status === 'pending'),
    [trades]
  );

  if (!isActivePanel || !converter) return null;

  const formatPrice = (price: number) => price.toFixed(decimals);

  const calculatePips = (price1: number, price2: number) => {
    return Math.round(Math.abs(price1 - price2) / pipValue);
  };

  const getPnL = (trade: Trade, targetPrice: number) => {
    return calculateTradePnL(trade.type, trade.entryPrice, targetPrice, trade.lotSize, pair);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10, overflow: 'hidden', willChange: 'transform', transform: 'translateZ(0)' }}
    >
      <svg width="100%" height="100%" style={{ display: 'block', shapeRendering: 'crispEdges' }} preserveAspectRatio="none">
        <defs>
          {chartWidth !== null && (
            <clipPath id={clipId}>
              <rect x="0" y="0" width={chartWidth} height="9999" />
            </clipPath>
          )}
        </defs>
        {/* Trade entry lines + SL/TP */}
        {(() => {
          const openTrades = activeTrades.filter(t => t.status === 'open');
          const pendingTrades = activeTrades.filter(t => t.status === 'pending');
          const multiOpen = openTrades.length > 1;
          const multiPending = pendingTrades.length > 1;
          return activeTrades.map(trade => {
            const isPending = trade.status === 'pending';
            const tradeIdx = isPending
              ? pendingTrades.indexOf(trade)
              : openTrades.indexOf(trade);
            const suffix = (isPending ? multiPending : multiOpen) ? `${tradeIdx + 1}` : '';

            const price = isPending && trade.limitPrice ? trade.limitPrice : trade.entryPrice;
            const y = Math.round(converter.priceToY(price));
            const isBuy = trade.type === 'buy';
            const entryColor = isBuy ? COLORS.buy : COLORS.sell;
            const isBeingEdited = trade.id === activeSlTpTradeId;

            const slPrice = trade.stopLoss;
            const tpPrice = trade.takeProfit;
            const slY = slPrice ? Math.round(converter.priceToY(slPrice)) : null;
            const tpY = tpPrice ? Math.round(converter.priceToY(tpPrice)) : null;

            const slPnL = slPrice ? getPnL(trade, slPrice) : 0;
            const tpPnL = tpPrice ? getPnL(trade, tpPrice) : 0;
            const slPips = slPrice ? calculatePips(price, slPrice) : 0;
            const tpPips = tpPrice ? calculatePips(price, tpPrice) : 0;

            const entryLabel = isPending
              ? `${isBuy ? 'BUY' : 'SELL'} ${trade.orderType === 'stop' ? 'STOP' : 'LMT'}${suffix}`
              : `${isBuy ? 'BUY' : 'SELL'} ${trade.lotSize}${suffix ? ` #${suffix}` : ''}`;

            return (
              <g key={trade.id}>
                {/* Lines only, clipped to chart canvas (stops before Y-axis) */}
                <g clipPath={chartWidth !== null ? `url(#${clipId})` : undefined}>
                  {!isBeingEdited && tpY !== null && (
                    <line x1="0" y1={tpY} x2="100%" y2={tpY} stroke={COLORS.tp} strokeWidth="1" strokeDasharray="6 4" opacity="0.8" />
                  )}
                  {!isBeingEdited && slY !== null && (
                    <line x1="0" y1={slY} x2="100%" y2={slY} stroke={COLORS.sl} strokeWidth="1" strokeDasharray="6 4" opacity="0.8" />
                  )}
                  <line x1="0" y1={y} x2="100%" y2={y} stroke={entryColor} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
                </g>

                {/* Labels: NOT clipped (live on left side) */}
                {!isBeingEdited && tpY !== null && (
                  <MT5Label y={tpY} text={`TP${suffix} ${tpPnL >= 0 ? '+' : ''}${tpPnL.toFixed(2)}`} color={COLORS.tp} />
                )}
                {!isBeingEdited && slY !== null && (
                  <MT5Label y={slY} text={`SL${suffix} ${slPnL >= 0 ? '+' : ''}${slPnL.toFixed(2)}`} color={COLORS.sl} />
                )}
                <MT5Label y={y} text={entryLabel} color={entryColor} />
              </g>
            );
          });
        })()}

        {/* Limit order placement line */}
        {limitLinePrice != null && pendingLimitType && (() => {
          const isBuyType = pendingLimitType === 'buy' || pendingLimitType === 'buy_stop';
          const y = Math.round(converter.priceToY(limitLinePrice));
          const color = isBuyType ? COLORS.buy : COLORS.sell;
          const isStop = pendingLimitType.includes('stop');
          const label = `${isBuyType ? 'BUY' : 'SELL'} ${isStop ? 'STOP' : 'LMT'}`;
          return (
            <>
              <g clipPath={chartWidth !== null ? `url(#${clipId})` : undefined}>
                <line x1="0" y1={y} x2="100%" y2={y} stroke={color} strokeWidth="1.5" strokeDasharray="6 3" />
              </g>
              <MT5Label y={y} text={label} color={color} />
            </>
          );
        })()}

        {/* SL DRAG LINE with circle */}
        {activeSlTpTradeId && slDragPrice != null && (() => {
          const trade = trades.find(t => t.id === activeSlTpTradeId);
          if (!trade) return null;
          const referencePrice = trade.status === 'pending' ? (trade.limitPrice || trade.entryPrice) : trade.entryPrice;
          const slPips = calculatePips(slDragPrice, referencePrice);
          const slPnL = calculateTradePnL(trade.type, trade.entryPrice, slDragPrice, trade.lotSize, pair);
          const y = Math.round(converter.priceToY(slDragPrice));
          return (
            <g style={{ pointerEvents: 'all' }}>
              <g clipPath={chartWidth !== null ? `url(#${clipId})` : undefined}>
                <line x1="0" y1={y} x2="100%" y2={y} stroke="transparent" strokeWidth="20" className="cursor-ns-resize"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSlDragStart?.(); }} />
                <line x1="0" y1={y} x2="100%" y2={y} stroke={COLORS.sl} strokeWidth="1" strokeDasharray="6 4" opacity="0.9" style={{ pointerEvents: 'none' }} />
                <DragCircle y={y} color={COLORS.sl} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSlDragStart?.(); }} />
              </g>
              <MT5Label y={y} text={`SL ${slPnL >= 0 ? '+' : ''}${slPnL.toFixed(2)}`} color={COLORS.sl} />
            </g>
          );
        })()}

        {/* TP DRAG LINE with circle */}
        {activeSlTpTradeId && tpDragPrice != null && (() => {
          const trade = trades.find(t => t.id === activeSlTpTradeId);
          if (!trade) return null;
          const referencePrice = trade.status === 'pending' ? (trade.limitPrice || trade.entryPrice) : trade.entryPrice;
          const tpPips = calculatePips(tpDragPrice, referencePrice);
          const tpPnL = calculateTradePnL(trade.type, trade.entryPrice, tpDragPrice, trade.lotSize, pair);
          const y = Math.round(converter.priceToY(tpDragPrice));
          return (
            <g style={{ pointerEvents: 'all' }}>
              <g clipPath={chartWidth !== null ? `url(#${clipId})` : undefined}>
                <line x1="0" y1={y} x2="100%" y2={y} stroke="transparent" strokeWidth="20" className="cursor-ns-resize"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onTpDragStart?.(); }} />
                <line x1="0" y1={y} x2="100%" y2={y} stroke={COLORS.tp} strokeWidth="1" strokeDasharray="6 4" opacity="0.9" style={{ pointerEvents: 'none' }} />
                <DragCircle y={y} color={COLORS.tp} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onTpDragStart?.(); }} />
              </g>
              <MT5Label y={y} text={`TP ${tpPnL >= 0 ? '+' : ''}${tpPnL.toFixed(2)}`} color={COLORS.tp} />
            </g>
          );
        })()}
      </svg>
    </div>
  );
});

TradeOverlay.displayName = 'TradeOverlay';

export default TradeOverlay;
