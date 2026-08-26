import { Trade } from "./BacktestTradingPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, TrendingUp, TrendingDown, Clock, ArrowRight, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TradeHistoryDialogProps {
  trades: Trade[];
  startingCapital: number;
}

const TradeHistoryDialog = ({ trades, startingCapital }: TradeHistoryDialogProps) => {
  const closedTrades = trades.filter(t => t.status === 'closed');
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
  const losingTrades = closedTrades.filter(t => (t.pnl || 0) < 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
    : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  const formatDuration = (entryTs: number, exitTs?: number) => {
    if (!exitTs) return '-';
    const durationMs = exitTs - entryTs;
    if (durationMs < 0) return '-';
    
    const minutes = Math.floor(durationMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs glass border border-border hover:border-neon-gold gap-1.5"
        >
          <History className="h-3 w-3" />
          <span className="hidden sm:inline">History</span>
          {closedTrades.length > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] border-neon-gold/50 text-neon-gold">
              {closedTrades.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong border-border max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary">
            <History className="h-5 w-5 text-neon-gold" />
            Trade History
          </DialogTitle>
        </DialogHeader>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="glass rounded-lg p-3 border border-border">
            <div className="text-[10px] text-text-secondary uppercase mb-1">Total P&L</div>
            <div className={cn("text-lg font-bold font-mono", totalPnL >= 0 ? "text-neon-green" : "text-red-400")}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
            </div>
          </div>
          <div className="glass rounded-lg p-3 border border-border">
            <div className="text-[10px] text-text-secondary uppercase mb-1">Win Rate</div>
            <div className={cn("text-lg font-bold font-mono", winRate >= 50 ? "text-neon-green" : "text-red-400")}>
              {winRate.toFixed(1)}%
            </div>
          </div>
          <div className="glass rounded-lg p-3 border border-border">
            <div className="text-[10px] text-text-secondary uppercase mb-1">Trades</div>
            <div className="text-lg font-bold font-mono text-text-primary">
              <span className="text-neon-green">{winningTrades.length}</span>
              <span className="text-text-secondary mx-1">/</span>
              <span className="text-red-400">{losingTrades.length}</span>
            </div>
          </div>
          <div className="glass rounded-lg p-3 border border-border">
            <div className="text-[10px] text-text-secondary uppercase mb-1">Profit Factor</div>
            <div className={cn("text-lg font-bold font-mono", profitFactor >= 1 ? "text-neon-green" : "text-red-400")}>
              {profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Trade List */}
        <ScrollArea className="h-[400px] pr-4">
          {closedTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
              <History className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-sm">No closed trades yet</p>
              <p className="text-xs opacity-70">Complete some trades to see history</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...closedTrades].reverse().map((trade, index) => {
                const pnl = trade.pnl || 0;
                const pnlPercent = ((pnl / (trade.lotSize * 100000)) * 100);
                const isWin = pnl > 0;
                
                return (
                  <div
                    key={trade.id}
                    className={cn(
                      "glass rounded-lg p-3 border transition-colors",
                      isWin ? "border-neon-green/30 hover:border-neon-green/50" : "border-red-500/30 hover:border-red-500/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Trade Info */}
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-full",
                          trade.type === 'buy' ? "bg-neon-green/20" : "bg-red-500/20"
                        )}>
                          {trade.type === 'buy' ? (
                            <TrendingUp className="h-4 w-4 text-neon-green" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-[10px] py-0",
                                trade.type === 'buy' ? "border-neon-green/50 text-neon-green" : "border-red-500/50 text-red-400"
                              )}
                            >
                              {trade.type.toUpperCase()}
                            </Badge>
                            <span className="text-xs text-text-secondary">{trade.pair}</span>
                            <span className="text-xs text-text-secondary">•</span>
                            <span className="text-xs text-text-secondary">{trade.lotSize} lot</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                            <span className="font-mono">{trade.entryPrice.toFixed(5)}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="font-mono">{trade.exitPrice?.toFixed(5) || '-'}</span>
                          </div>
                        </div>
                      </div>

                      {/* P&L */}
                      <div className="text-right">
                        <div className={cn("text-sm font-bold font-mono", isWin ? "text-neon-green" : "text-red-400")}>
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                        <div className={cn("text-[10px] font-mono", isWin ? "text-neon-green/70" : "text-red-400/70")}>
                          {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Additional Details */}
                    <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/50 text-[10px] text-text-secondary">
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        <span>Size: ${(trade.lotSize * 100000).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>Duration: {formatDuration(trade.timestamp, trade.exitTimestamp)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>Order: {trade.orderType}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {closedTrades.length > 0 && (
          <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-text-secondary">
            <span>Starting Capital: ${startingCapital.toLocaleString()}</span>
            <span>Final Balance: ${(startingCapital + totalPnL).toFixed(2)}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TradeHistoryDialog;
