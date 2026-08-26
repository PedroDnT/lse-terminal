// ============================================================================
// renderers/positionRenderer.ts
// Adds isPending + orderType to PositionLine so pending limit/stop orders
// render with "BUY STOP", "SELL LIMIT" etc. labels and lighter styling
// until they fill and become open positions.
// ============================================================================

// ── Position line data passed from the parent component ──
export interface PositionLine {
  id: string;
  price: number;
  side: 'buy' | 'sell';
  quantity: number;
  symbol: string;
  pnl?: number;
  stopLoss?: number;
  takeProfit?: number;
  // Set for pending limit/stop orders; absent for open positions
  isPending?: boolean;
  orderType?: string; // 'market' | 'limit' | 'stop'
}

// ── Context needed by position renderers ──
export interface PositionRenderContext {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;
  mainChartHeight: number;
  mainPriceToY: (price: number) => number;
  formatPrice: (price: number) => string;
  colors: {
    slColor?: string;
    slOpacity?: number;
    tpColor?: string;
    tpOpacity?: number;
  };
  // Current values from interactive refs, read once per frame
  selectedPositionId: string | null;
  slDraft: number | null;
  tpDraft: number | null;
  hoveredSLTP: 'sl' | 'tp' | null;
  // Distance from entry for the SUGGESTED (not yet set) SL/TP lines. The
  // parent derives it from the rendered price range so the suggestions land
  // inside the view; absent, the old flat 0.5%-of-price fallback applies.
  defaultOffset?: number;
  draggingHandle: 'sl' | 'tp' | null;
}

// ── Draws a single SL or TP line with its label badge ──
function drawSLTPLine(
  px: PositionRenderContext,
  price: number,
  type: 'sl' | 'tp',
  isDraft: boolean,
  entryPrice: number,
  posSide: 'buy' | 'sell',
  qty: number
): void {
  const { ctx, chartWidth, mainChartHeight, mainPriceToY, formatPrice, colors, hoveredSLTP, draggingHandle } = px;
  const lineY = mainPriceToY(price);
  if (lineY < 0 || lineY > mainChartHeight) return;

  const slOpacityFrac = (colors.slOpacity ?? 70) / 100;
  const tpOpacityFrac = (colors.tpOpacity ?? 70) / 100;
  const opacityFrac = type === 'sl' ? slOpacityFrac : tpOpacityFrac;
  const color = type === 'sl' ? (colors.slColor || '#dc2626') : (colors.tpColor || '#16a34a');
  const label = type === 'sl' ? 'SL' : 'TP';

  ctx.save();

  const isHovered = hoveredSLTP === type;
  const isDragging = draggingHandle === type;

  ctx.strokeStyle = color;
  ctx.lineWidth = (isHovered || isDragging) ? 2.5 : (isDraft ? 1.5 : 1);
  ctx.globalAlpha = (isHovered || isDragging) ? 1 : 0.85;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(chartWidth, lineY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const priceDiff = price - entryPrice;
  const directionMultiplier = posSide === 'buy' ? 1 : -1;
  const pnlUsd = priceDiff * directionMultiplier * qty;
  // Explicit '-' on losses: an unsigned "$0.94" on the SL badge read as a
  // gain next to the TP's "+$0.94".
  const pnlSign = pnlUsd >= 0 ? '+' : '-';
  const pnlText = `${pnlSign}$${Math.abs(pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const priceText = formatPrice(price);
  const fullLabel = `${label}  ${priceText}  ${pnlText}`;

  ctx.font = '10px -apple-system, "Trebuchet MS", sans-serif';
  const tw = ctx.measureText(fullLabel).width;
  const bw = tw + 10;
  const bh = 16;
  const bx = 4;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(bx, lineY - bh / 2, bw, bh, 3);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fullLabel, bx + 5, lineY);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// renderPositionLines: draws MT5-style entry lines for open positions and
// pending limit/stop orders. Pending orders use "BUY STOP" / "SELL LIMIT"
// labels with lighter dash styling until they fill.
// ═══════════════════════════════════════════════════════════════════════════
export function renderPositionLines(
  px: PositionRenderContext,
  positionLines: PositionLine[]
): void {
  const { ctx, chartWidth, mainChartHeight, mainPriceToY, formatPrice, colors, selectedPositionId } = px;

  for (const pos of positionLines) {
    const posY = mainPriceToY(pos.price);
    if (posY < 0 || posY > mainChartHeight) continue;

    const isBuy = pos.side === 'buy';
    // Sell entries are zinc, not red: red is reserved for SL lines, and a red
    // short-entry line was indistinguishable from its own stop.
    const lineColor = isBuy ? '#2563eb' : '#71717a';

    // Pending orders get the order type in the label; open positions get plain BUY/SELL
    let sideLabel: string;
    if (pos.isPending && pos.orderType && pos.orderType !== 'market') {
      const typeLabel = pos.orderType === 'stop' ? 'STOP' : 'LIMIT';
      sideLabel = isBuy ? `BUY ${typeLabel}` : `SELL ${typeLabel}`;
    } else {
      sideLabel = isBuy ? 'BUY' : 'SELL';
    }

    ctx.save();

    // Pending orders: lower opacity + wider dash gap to distinguish from open positions
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    if (pos.isPending) {
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([4, 6]);
    } else {
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([6, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(0, posY);
    ctx.lineTo(chartWidth, posY);
    ctx.stroke();
    ctx.setLineDash([]);

    const priceLabel = formatPrice(pos.price);
    const entryText = `${sideLabel} ${pos.quantity} @ ${priceLabel}`;
    ctx.font = '10px -apple-system, "Trebuchet MS", sans-serif';
    const entryTextW = ctx.measureText(entryText).width;
    const badgeW = entryTextW + 10;
    const badgeH = 16;
    const badgeX = 4;
    const badgeY = posY - badgeH / 2;

    ctx.fillStyle = lineColor;
    ctx.globalAlpha = pos.isPending ? 0.6 : 0.9;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(entryText, badgeX + 5, posY);

    // SL/TP lines only for open positions, not pending orders
    if (!pos.isPending && pos.id !== selectedPositionId) {
      if (pos.stopLoss) {
        const slY = mainPriceToY(pos.stopLoss);
        if (slY >= 0 && slY <= mainChartHeight) {
          ctx.strokeStyle = colors.slColor || '#dc2626';
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, slY);
          ctx.lineTo(chartWidth, slY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '9px -apple-system, sans-serif';
          ctx.fillStyle = colors.slColor || '#dc2626';
          ctx.globalAlpha = 0.9;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`SL ${formatPrice(pos.stopLoss)}`, 4, slY);
          ctx.globalAlpha = 1;
        }
      }
      if (pos.takeProfit) {
        const tpY = mainPriceToY(pos.takeProfit);
        if (tpY >= 0 && tpY <= mainChartHeight) {
          ctx.strokeStyle = colors.tpColor || '#16a34a';
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, tpY);
          ctx.lineTo(chartWidth, tpY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '9px -apple-system, sans-serif';
          ctx.fillStyle = colors.tpColor || '#16a34a';
          ctx.globalAlpha = 0.9;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`TP ${formatPrice(pos.takeProfit)}`, 4, tpY);
          ctx.globalAlpha = 1;
        }
      }
    }

    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// renderSelectedPositionSLTP: draws the interactive SL/TP lines and the
// Place/Cancel/Close buttons for the currently selected position.
// ═══════════════════════════════════════════════════════════════════════════
export function renderSelectedPositionSLTP(
  px: PositionRenderContext,
  positionLines: PositionLine[]
): void {
  const { ctx, chartWidth, mainChartHeight, mainPriceToY, colors, selectedPositionId, slDraft, tpDraft, draggingHandle } = px;
  if (!selectedPositionId) return;

  const selPos = positionLines.find(p => p.id === selectedPositionId);
  if (!selPos) return;

  const isBuy = selPos.side === 'buy';

  const slPrice = slDraft ?? selPos.stopLoss ?? null;
  const tpPrice = tpDraft ?? selPos.takeProfit ?? null;

  const defaultOffset = px.defaultOffset ?? selPos.price * 0.005;
  const suggestedSL = slPrice ?? (isBuy ? selPos.price - defaultOffset : selPos.price + defaultOffset);
  const suggestedTP = tpPrice ?? (isBuy ? selPos.price + defaultOffset : selPos.price - defaultOffset);

  drawSLTPLine(px, suggestedSL, 'sl', slPrice !== null || draggingHandle === 'sl', selPos.price, selPos.side, selPos.quantity);
  drawSLTPLine(px, suggestedTP, 'tp', tpPrice !== null || draggingHandle === 'tp', selPos.price, selPos.side, selPos.quantity);

  const entryY = mainPriceToY(selPos.price);
  if (entryY >= 0 && entryY <= mainChartHeight) {
    ctx.save();
    // Same zinc-for-sell convention as renderPositionLines: red stays SL-only.
    ctx.strokeStyle = isBuy ? '#2563eb' : '#71717a';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, entryY);
    ctx.lineTo(chartWidth, entryY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const btnFont = '11px -apple-system, "Trebuchet MS", sans-serif';
    const btnH = 22;
    const btnY = Math.min(entryY + 10, mainChartHeight - btnH - 4);
    const btnGap = 5;

    ctx.font = `500 ${btnFont}`;
    const placeTw = ctx.measureText('Place').width;
    const placeBw = placeTw + 16;
    const cancelTw = ctx.measureText('Cancel').width;
    const cancelBw = cancelTw + 16;
    const closeTw = ctx.measureText('Close').width;
    const closeBw = closeTw + 16;
    const totalW = placeBw + cancelBw + closeBw + btnGap * 2;
    const startX = (chartWidth - totalW) / 2;
    const placeBx = startX;
    const cancelBx = placeBx + placeBw + btnGap;
    const closeBxVal = cancelBx + cancelBw + btnGap;

    ctx.save();
    ctx.font = `500 ${btnFont}`;
    ctx.fillStyle = 'rgba(22, 163, 74, 0.35)';
    ctx.beginPath(); ctx.roundRect(placeBx, btnY, placeBw, btnH, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(22, 163, 74, 0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Place', placeBx + placeBw / 2, btnY + btnH / 2);
    ctx.restore();

    ctx.save();
    ctx.font = `500 ${btnFont}`;
    ctx.fillStyle = 'rgba(100,116,139, 0.3)';
    ctx.beginPath(); ctx.roundRect(cancelBx, btnY, cancelBw, btnH, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184, 0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Cancel', cancelBx + cancelBw / 2, btnY + btnH / 2);
    ctx.restore();

    ctx.save();
    ctx.font = `500 ${btnFont}`;
    ctx.fillStyle = 'rgba(220, 38, 38, 0.35)';
    ctx.beginPath(); ctx.roundRect(closeBxVal, btnY, closeBw, btnH, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Close', closeBxVal + closeBw / 2, btnY + btnH / 2);
    ctx.restore();
  }
}
