import { useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {

  X,
  ChevronDown,
  ChevronUp,
  Target,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Gauge,
  Layers,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  calculateTradePnL,
  getContractSpec,
  getDisplayConfig,
  getLotSizeDescription,
  getNotionalValue
} from "@/lib/contractSpecs";

// Price formatting utility. Decimals/pip/step now resolve from the catalog display
// category (passed down from the page) so stocks show 2 dp and every crypto is
// recognised, not just BTC/ETH/XRP. Falls back to symbol-substring guessing when
// the category has not resolved yet. See getDisplayConfig in contractSpecs.ts.
const getInstrumentConfig = (pair: string | null | undefined, category?: string | null) =>
  getDisplayConfig(pair, category);

const formatPrice = (price: number, pair: string, category?: string | null) => {
  const { decimals } = getInstrumentConfig(pair, category);
  return price.toFixed(decimals);
};

const calculatePipsFromDiff = (price1: number, price2: number, pair: string, category?: string | null) => {
  const { pipValue } = getInstrumentConfig(pair, category);
  return Math.round(Math.abs(price1 - price2) / pipValue);
};

// Helper to calculate P&L correctly for different pair types
// Now uses contract specifications for proper lot sizing
export const calculatePnL = (
  type: 'buy' | 'sell',
  entryPrice: number,
  exitPrice: number,
  lotSize: number,
  pair: string
): number => {
  return calculateTradePnL(type, entryPrice, exitPrice, lotSize, pair);
};

export interface Trade {
  id: string;
  type: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop';
  pair: string;
  lotSize: number;
  entryPrice: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
  candleIndex: number;
  exitCandleIndex?: number;
  exitTimestamp?: number;
  status: 'open' | 'closed' | 'pending';
  exitPrice?: number;
  pnl?: number;
  maxFloatingProfit?: number;
  maxFloatingLoss?: number;
}

// Order-entry chrome (no green/red on buy/sell). One
// neutral look for market, limit and stop buttons, the split-button dropdown
// arrow, and the menu items; "active" (a pending limit/stop placement in
// progress) is the shell's active-surface grey, not a coloured fill.
const ORDER_BTN = "h-6 sm:h-7 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors";
const SPLIT_BTN_IDLE = "text-text-secondary hover:text-foreground hover:bg-muted";
const SPLIT_BTN_ACTIVE = "bg-accent text-foreground border border-border";
const MENU_ITEM = "text-xs text-foreground hover:bg-muted cursor-pointer";

interface BacktestTradingPanelProps {
  pair: string;
  currentPrice: number;
  currentIndex: number;
  capital: number;
  trades: Trade[];
  onTrade: (trade: Omit<Trade, 'id' | 'timestamp' | 'status'>) => void;
  onCloseTrade: (tradeId: string, exitPrice: number) => void;
  onCancelOrder: (tradeId: string) => void;
  onStartLimitOrder?: (type: 'buy' | 'sell' | 'buy_stop' | 'sell_stop') => void;
  pendingLimitType?: 'buy' | 'sell' | 'buy_stop' | 'sell_stop' | null;
  lotSize: number;
  onLotSizeChange: (size: number) => void;
  onUpdateTrade?: (tradeId: string, updates: { stopLoss?: number; takeProfit?: number }) => void;
  onStartSlTpPlacement?: (tradeId: string) => void;
  activeSlTpTradeId?: string | null;
  slDragPrice?: number | null;
  tpDragPrice?: number | null;
  onSlPriceChange?: (price: number) => void;
  onTpPriceChange?: (price: number) => void;
  // Playback controls
  isPlaying?: boolean;
  onPlayPauseToggle?: () => void;
  playbackSpeed?: number;
  onPlaybackSpeedChange?: (speed: number) => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  // Timeframe controls
  timeframes?: string[];
  selectedTimeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  // Layout controls
  layoutButton?: React.ReactNode;
  // Indicators button
  indicatorsButton?: React.ReactNode;
  // Date range display
  dateRangeLabel?: string;
  // Catalog display category ('Forex' | 'Crypto' | 'Commodities' | 'Indices' |
  // 'Stock'), resolved by the page from the registry. Drives price decimals and
  // pip size; when absent the helpers fall back to symbol-substring guessing.
  category?: string | null;
}

const LOT_SIZES = [0.01, 0.1, 1, 10];

const BacktestTradingPanel = ({
  pair,
  category,
  currentPrice,
  currentIndex,
  capital,
  trades,
  onTrade,
  onCloseTrade,
  onCancelOrder,
  onStartLimitOrder,
  pendingLimitType,
  lotSize,
  onLotSizeChange,
  onUpdateTrade,
  onStartSlTpPlacement,
  activeSlTpTradeId,
  slDragPrice,
  tpDragPrice,
  onSlPriceChange,
  onTpPriceChange,
  isPlaying = false,
  onPlayPauseToggle,
  playbackSpeed = 1,
  onPlaybackSpeedChange,
  onStepBack,
  onStepForward,
  timeframes = [],
  selectedTimeframe,
  onTimeframeChange,
  layoutButton,
  indicatorsButton,
  dateRangeLabel,
}: BacktestTradingPanelProps) => {
  const [customLotSize, setCustomLotSize] = useState("");
  const [showPositions, setShowPositions] = useState(true);
  const [customSpeed, setCustomSpeed] = useState("");
  const [showCustomSpeed, setShowCustomSpeed] = useState(false);
  const customSpeedInputRef = useRef<HTMLInputElement>(null);

  const openTrades = trades.filter(t => t.status === 'open');
  const pendingOrders = trades.filter(t => t.status === 'pending');
  const closedTrades = trades.filter(t => t.status === 'closed');

  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const unrealizedPnL = openTrades.reduce((sum, t) => {
    const pnl = calculatePnL(t.type, t.entryPrice, currentPrice, t.lotSize, pair);
    return sum + pnl;
  }, 0);

  const handleMarketOrder = (type: 'buy' | 'sell') => {
    onTrade({
      type,
      orderType: 'market',
      pair,
      lotSize,
      entryPrice: currentPrice,
      candleIndex: currentIndex,
    });
  };

  return (
    <div className="flex flex-col gap-1 sm:gap-2">
      {/* Trading Controls - Clean minimal design */}
      <div className="flex flex-wrap items-center gap-1 sm:gap-3 py-0.5 sm:py-2">
        {/* Lot Size Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs font-mono hover:bg-muted/50 transition-colors">
              {lotSize} lots
              <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="glass-strong border-border bg-background min-w-[200px]">
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border mb-1">
              {getLotSizeDescription(pair)}
            </div>
            {LOT_SIZES.map((size) => (
              <DropdownMenuItem
                key={size}
                onClick={() => onLotSizeChange(size)}
                className={cn("text-xs font-mono flex justify-between", lotSize === size && "bg-electric-blue/20")}
              >
                <span>{size} lot{size !== 1 ? 's' : ''}</span>
                <span className="text-muted-foreground ml-3">{getNotionalValue(pair, size, currentPrice)}</span>
              </DropdownMenuItem>
            ))}
            <div className="border-t border-border mt-1 pt-1 px-2 pb-2">
              <div className="text-[10px] text-gray-700 dark:text-gray-200 mb-1">Custom</div>
              <div className="flex gap-1">
                <Input
                  type="number"
                  value={customLotSize}
                  onChange={(e) => setCustomLotSize(e.target.value)}
                  placeholder="0.5"
                  className="h-6 w-16 text-xs font-mono bg-card text-gray-900 dark:text-gray-100 border-border placeholder:text-gray-400"
                  step="0.01"
                  min="0.01"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const val = parseFloat(customLotSize);
                    if (!isNaN(val) && val > 0) {
                      onLotSizeChange(val);
                      setCustomLotSize("");
                    }
                  }}
                  className="h-6 px-2 text-[10px]"
                >
                  Set
                </Button>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Buy/Sell Buttons. Neutral chrome on purpose: the
            green BUY / red SELL read as neon accents, so the order buttons are
            plain bordered text like the rest of the toolbar (no scale, no
            shadow, no glow: the Button default variant carries all three, hence
            variant="ghost" plus an explicit border). Direction is the word. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleMarketOrder('buy')}
          className={ORDER_BTN}
        >
          BUY
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleMarketOrder('sell')}
          className={ORDER_BTN}
        >
          SELL
        </Button>

        {/* Limit & Stop Order Buttons - Hidden on small mobile */}
        <div className="hidden sm:flex items-center gap-1 border-l border-border pl-1.5 sm:pl-2">
          {/* Buy Orders - Split Button */}
          <div className="flex items-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStartLimitOrder?.('buy')}
              className={cn(
                "h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs rounded-r-none",
                (pendingLimitType === 'buy' || pendingLimitType === 'buy_stop')
                  ? SPLIT_BTN_ACTIVE
                  : SPLIT_BTN_IDLE
              )}
            >
              {pendingLimitType === 'buy_stop' ? 'Buy Stop' : 'Buy Limit'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-6 sm:h-7 px-0.5 sm:px-1 text-[10px] sm:text-xs rounded-l-none border-l-0",
                    (pendingLimitType === 'buy' || pendingLimitType === 'buy_stop')
                      ? SPLIT_BTN_ACTIVE
                      : SPLIT_BTN_IDLE
                  )}
                >
                  <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-card min-w-[100px] z-50">
                <DropdownMenuItem
                  onClick={() => onStartLimitOrder?.('buy')}
                  className={MENU_ITEM}
                >
                  Buy Limit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onStartLimitOrder?.('buy_stop')}
                  className={MENU_ITEM}
                >
                  Buy Stop
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Sell Orders - Split Button */}
          <div className="flex items-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStartLimitOrder?.('sell')}
              className={cn(
                "h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs rounded-r-none",
                (pendingLimitType === 'sell' || pendingLimitType === 'sell_stop')
                  ? SPLIT_BTN_ACTIVE
                  : SPLIT_BTN_IDLE
              )}
            >
              {pendingLimitType === 'sell_stop' ? 'Sell Stop' : 'Sell Limit'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-6 sm:h-7 px-0.5 sm:px-1 text-[10px] sm:text-xs rounded-l-none border-l-0",
                    (pendingLimitType === 'sell' || pendingLimitType === 'sell_stop')
                      ? SPLIT_BTN_ACTIVE
                      : SPLIT_BTN_IDLE
                  )}
                >
                  <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-card min-w-[100px] z-50">
                <DropdownMenuItem
                  onClick={() => onStartLimitOrder?.('sell')}
                  className={MENU_ITEM}
                >
                  Sell Limit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onStartLimitOrder?.('sell_stop')}
                  className={MENU_ITEM}
                >
                  Sell Stop
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Playback Controls */}
        {onPlayPauseToggle && (
          <div className="flex items-center gap-0.5 sm:gap-1 pl-1 sm:pl-3">
            <button
              onClick={onStepBack}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-text-secondary hover:text-text-primary transition-colors"
            >
              <SkipBack className="h-3 w-3" />
            </button>

            <button
              onClick={onPlayPauseToggle}
              className="h-6 w-6 sm:h-7 sm:w-7 flex items-center justify-center rounded-full bg-electric-blue/15 border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/25 transition-colors"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={onStepForward}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-text-secondary hover:text-text-primary transition-colors"
            >
              <SkipForward className="h-3 w-3" />
            </button>

            <div className="h-4 w-px bg-border/50 mx-0.5 sm:mx-2" />

            {/* ── Mobile: Speed Dropdown ── */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] font-mono hover:bg-muted/50 transition-colors">
                    {playbackSpeed}x
                    <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-border bg-card min-w-[80px] z-50">
                  {[
                    { label: '1x', value: 1 },
                    { label: '10x', value: 10 },
                    { label: '100x', value: 100 },
                  ].map(({ label, value }) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => onPlaybackSpeedChange?.(value)}
                      className={cn("text-xs font-mono cursor-pointer", playbackSpeed === value && "bg-electric-blue/20 text-electric-blue")}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* ── Desktop: Speed Inline Buttons ── */}
            <div className="hidden sm:flex items-center gap-0.5">
              {[
                { label: '1x', value: 1 },
                { label: '10x', value: 10 },
                { label: '100x', value: 100 },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => {
                    onPlaybackSpeedChange?.(value);
                    setShowCustomSpeed(false);
                  }}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${playbackSpeed === value && !showCustomSpeed
                    ? "text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary"
                    }`}
                >
                  {label}
                </button>
              ))}

              {/* Custom Speed */}
              <Popover open={showCustomSpeed} onOpenChange={setShowCustomSpeed}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 px-2 text-xs rounded-full ${showCustomSpeed || (playbackSpeed !== 1 && playbackSpeed !== 10 && playbackSpeed !== 100)
                      ? "bg-neon-purple/30 text-neon-purple"
                      : "text-text-secondary hover:text-text-primary"
                      }`}
                  >
                    {playbackSpeed !== 1 && playbackSpeed !== 10 && playbackSpeed !== 100
                      ? `${playbackSpeed}x`
                      : <Gauge className="h-3 w-3" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  className="w-32 p-2"
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    customSpeedInputRef.current?.focus();
                  }}
                >
                  <div className="space-y-2">
                    <div className="text-[10px] text-muted-foreground">Custom (0.1-1000)</div>
                    <div className="flex gap-1">
                      <Input
                        ref={customSpeedInputRef}
                        type="number"
                        value={customSpeed}
                        onChange={(e) => setCustomSpeed(e.target.value)}
                        placeholder="50"
                        className="h-6 text-xs font-mono"
                        step="0.1"
                        min="0.1"
                        max="1000"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat(customSpeed);
                            if (!isNaN(val) && val >= 0.1 && val <= 1000) {
                              onPlaybackSpeedChange?.(val);
                              setShowCustomSpeed(false);
                            }
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          const val = parseFloat(customSpeed);
                          if (!isNaN(val) && val >= 0.1 && val <= 1000) {
                            onPlaybackSpeedChange?.(val);
                            setShowCustomSpeed(false);
                          }
                        }}
                        className="h-6 px-2 text-[10px]"
                      >
                        Set
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Timeframe Controls */}
            {timeframes.length > 0 && onTimeframeChange && (
              <>
                <div className="h-4 w-px bg-border/50 mx-0.5 sm:mx-2" />

                {/* ── Mobile: Timeframe Dropdown ── */}
                <div className="sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] font-mono text-electric-blue border border-electric-blue/50 bg-electric-blue/10 hover:bg-electric-blue/20 transition-colors">
                        {selectedTimeframe || timeframes[0]}
                        <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="border-border bg-card min-w-[80px] z-50 max-h-64 overflow-y-auto">
                      {timeframes.map((tf) => (
                        <DropdownMenuItem
                          key={tf}
                          onClick={() => onTimeframeChange(tf)}
                          className={cn("text-xs font-mono cursor-pointer", selectedTimeframe === tf && "bg-electric-blue/20 text-electric-blue")}
                        >
                          {tf}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* ── Desktop: Timeframe Inline Pills ── */}
                <div className="hidden sm:flex items-center gap-1 overflow-x-auto scrollbar-hide">
                  {timeframes.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => onTimeframeChange(tf)}
                      className={`px-2 py-0.5 font-mono text-xs transition-all shrink-0 rounded ${selectedTimeframe === tf
                        ? "text-electric-blue border border-electric-blue/50 bg-electric-blue/10"
                        : "text-text-secondary hover:text-text-primary"
                        }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Date Range Label */}
                {dateRangeLabel && (
                  <div className="hidden lg:flex items-center text-[11px] text-text-secondary shrink-0 ml-1">
                    <span>{dateRangeLabel}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Right side: Indicators, Layout, Capital, P&L */}
        <div className="hidden md:flex items-center gap-2 ml-auto text-xs">
          {/* Indicators Button */}
          {indicatorsButton}
          {/* Layout Button */}
          {layoutButton}

          <div className="flex items-center gap-1.5">
            <span className="text-text-secondary">Capital:</span>
            <span className="font-mono font-medium text-text-primary">${(capital + totalPnL).toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-text-secondary">P&L:</span>
            <span className={cn("font-mono font-medium", totalPnL >= 0 ? "text-up" : "text-down")}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Mobile: Indicators + P&L */}
        <div className="flex md:hidden items-center gap-1.5 ml-auto text-[10px]">
          {indicatorsButton}
          <span className="text-text-secondary">P&L:</span>
          <span className={cn("font-mono", totalPnL >= 0 ? "text-up" : "text-down")}>
            {totalPnL >= 0 ? '+' : ''}${Math.abs(totalPnL).toFixed(2)}
          </span>
        </div>

        {/* Toggle Positions */}
        {(openTrades.length > 0 || pendingOrders.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPositions(!showPositions)}
            className="h-6 w-6 sm:h-7 sm:w-7 p-0 hover:bg-muted/50 transition-colors"
          >
            {showPositions ? <ChevronUp className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> : <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />}
          </Button>
        )}
      </div>

      {/* Open Positions & Pending Orders */}
      {showPositions && (openTrades.length > 0 || pendingOrders.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {/* Pending Orders */}
          {pendingOrders.map((order) => {
            const isActive = activeSlTpTradeId === order.id;
            const { pipValue, decimals, step } = getInstrumentConfig(pair, category);
            const entryPrice = order.limitPrice || currentPrice;

            return (
              <div
                key={order.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 glass rounded border text-xs",
                  isActive ? "border-electric-blue" : "border-border"
                )}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Right-click clears SL/TP
                  if (order.stopLoss || order.takeProfit) {
                    onUpdateTrade?.(order.id, { stopLoss: undefined, takeProfit: undefined });
                  }
                }}
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] py-0",
                    "border-border text-foreground"
                  )}
                >
                  {order.type.toUpperCase()} {order.orderType === 'stop' ? 'STOP' : 'LIMIT'}
                </Badge>
                <span className="font-mono text-text-secondary">@{formatPrice(order.limitPrice || 0, pair, category)}</span>

                {/* Show SL/TP inputs when active */}
                {isActive && slDragPrice != null && tpDragPrice != null ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-red-400 text-[10px]">SL:</span>
                      <input
                        type="number"
                        step={step}
                        defaultValue={slDragPrice.toFixed(decimals)}
                        key={`sl-${order.id}-${isActive}`}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && onSlPriceChange) {
                            if (order.type === 'buy' && val < entryPrice) {
                              onSlPriceChange(val);
                            } else if (order.type === 'sell' && val > entryPrice) {
                              onSlPriceChange(val);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(val) && onSlPriceChange) {
                              if (order.type === 'buy' && val < entryPrice) {
                                onSlPriceChange(val);
                              } else if (order.type === 'sell' && val > entryPrice) {
                                onSlPriceChange(val);
                              }
                            }
                          }
                        }}
                        className="w-24 px-1.5 py-0.5 text-[10px] bg-card border border-red-500/50 rounded text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                      <span className="text-red-400/70 text-[10px]">
                        ({calculatePipsFromDiff(slDragPrice, entryPrice, pair, category)}p)
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-green-500 text-[10px]">TP:</span>
                      <input
                        type="number"
                        step={step}
                        defaultValue={tpDragPrice.toFixed(decimals)}
                        key={`tp-${order.id}-${isActive}`}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && onTpPriceChange) {
                            if (order.type === 'buy' && val > entryPrice) {
                              onTpPriceChange(val);
                            } else if (order.type === 'sell' && val < entryPrice) {
                              onTpPriceChange(val);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(val) && onTpPriceChange) {
                              if (order.type === 'buy' && val > entryPrice) {
                                onTpPriceChange(val);
                              } else if (order.type === 'sell' && val < entryPrice) {
                                onTpPriceChange(val);
                              }
                            }
                          }
                        }}
                        className="w-24 px-1.5 py-0.5 text-[10px] bg-card border border-green-500/50 rounded text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                      <span className="text-green-500/70 text-[10px]">
                        ({calculatePipsFromDiff(tpDragPrice, entryPrice, pair, category)}p)
                      </span>
                    </div>
                  </>
                ) : null}

                <span className="text-text-secondary">{order.lotSize} lot</span>

                {/* SL/TP Placement Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartSlTpPlacement?.(order.id)}
                  className={cn(
                    "h-5 w-5 p-0",
                    isActive
                      ? "bg-electric-blue/30 text-electric-blue"
                      : "hover:bg-electric-blue/20 hover:text-electric-blue"
                  )}
                  title="Set SL/TP - drag lines on chart (right-click to remove)"
                >
                  <Target className="h-3 w-3" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancelOrder(order.id)}
                  className="h-5 w-5 p-0 hover:bg-red-500/20 hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}

          {/* Open Trades */}
          {openTrades.map((trade) => {
            const pnl = calculatePnL(trade.type, trade.entryPrice, currentPrice, trade.lotSize, pair);
            const isActive = activeSlTpTradeId === trade.id;
            const { pipValue, decimals, step } = getInstrumentConfig(pair, category);

            return (
              <div
                key={trade.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 glass rounded border text-xs",
                  isActive ? "border-electric-blue" : "border-border"
                )}
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] py-0",
                    "border-border text-foreground"
                  )}
                >
                  {trade.type.toUpperCase()}
                </Badge>
                <span className="font-mono text-text-secondary">@{formatPrice(trade.entryPrice, pair, category)}</span>

                {/* Show SL/TP inputs when active, otherwise show static values */}
                {isActive && slDragPrice != null && tpDragPrice != null ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-red-400 text-[10px]">SL:</span>
                      <input
                        type="number"
                        step={step}
                        defaultValue={slDragPrice.toFixed(decimals)}
                        key={`sl-${trade.id}-${isActive}`}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && onSlPriceChange) {
                            if (trade.type === 'buy' && val < trade.entryPrice) {
                              onSlPriceChange(val);
                            } else if (trade.type === 'sell' && val > trade.entryPrice) {
                              onSlPriceChange(val);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(val) && onSlPriceChange) {
                              if (trade.type === 'buy' && val < trade.entryPrice) {
                                onSlPriceChange(val);
                              } else if (trade.type === 'sell' && val > trade.entryPrice) {
                                onSlPriceChange(val);
                              }
                            }
                          }
                        }}
                        className="w-24 px-1.5 py-0.5 text-[10px] bg-card border border-red-500/50 rounded text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                      <span className="text-red-400/70 text-[10px]">
                        ({calculatePipsFromDiff(slDragPrice, trade.entryPrice, pair, category)}p)
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-green-500 text-[10px]">TP:</span>
                      <input
                        type="number"
                        step={step}
                        defaultValue={tpDragPrice.toFixed(decimals)}
                        key={`tp-${trade.id}-${isActive}`}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && onTpPriceChange) {
                            if (trade.type === 'buy' && val > trade.entryPrice) {
                              onTpPriceChange(val);
                            } else if (trade.type === 'sell' && val < trade.entryPrice) {
                              onTpPriceChange(val);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(val) && onTpPriceChange) {
                              if (trade.type === 'buy' && val > trade.entryPrice) {
                                onTpPriceChange(val);
                              } else if (trade.type === 'sell' && val < trade.entryPrice) {
                                onTpPriceChange(val);
                              }
                            }
                          }
                        }}
                        className="w-24 px-1.5 py-0.5 text-[10px] bg-card border border-green-500/50 rounded text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                      <span className="text-green-500/70 text-[10px]">
                        ({calculatePipsFromDiff(tpDragPrice, trade.entryPrice, pair, category)}p)
                      </span>
                    </div>
                  </>
                ) : null}

                <span className="text-text-secondary">{trade.lotSize} lot</span>
                <span className={cn("font-mono", pnl >= 0 ? "text-up" : "text-down")}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                </span>

                {/* SL/TP Placement Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartSlTpPlacement?.(trade.id)}
                  className={cn(
                    "h-5 w-5 p-0",
                    isActive
                      ? "bg-electric-blue/30 text-electric-blue"
                      : "hover:bg-electric-blue/20 hover:text-electric-blue"
                  )}
                  title="Set SL/TP - drag lines on chart"
                >
                  <Target className="h-3 w-3" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCloseTrade(trade.id, currentPrice)}
                  className="h-5 px-1 text-[10px] hover:bg-neon-purple/20 hover:text-neon-purple"
                >
                  Close
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BacktestTradingPanel;
