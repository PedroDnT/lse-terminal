// src/components/chart/echartsTheme.ts
import * as echarts from 'echarts/core';

export function registerEchartsTheme(mode: 'light' | 'dark') {
  const isLight = mode === 'light';
  
  echarts.registerTheme('tcm', {
    backgroundColor: isLight ? '#ffffff' : '#000000',
    textStyle: {
      color: cssVar('--text-secondary'),
      fontFamily: '-apple-system, SF Pro Display, Inter, system-ui, sans-serif',
    },
    axisPointer: {
      type: 'cross',
      lineStyle: { color: cssVar('--electric-blue'), width: 1, opacity: 0.5 },
      crossStyle: { color: cssVar('--electric-blue'), opacity: 0.5 },
      label: { 
        show: true,
        backgroundColor: cssVar('--electric-blue'),
        color: isLight ? '#ffffff' : '#000000',
      },
      shadowStyle: { color: 'rgba(0,0,0,0)' },
    },
    grid: { left: 60, right: 24, top: 40, bottom: 60 },
    xAxis: {
      axisLine: { lineStyle: { color: cssVar('--border') } },
      axisTick: { show: false },
      axisLabel: { 
        color: cssVar('--text-secondary'),
        fontFamily: 'SF Mono, monospace',
      },
      splitLine: { show: false },
      axisPointer: { type: 'line' },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { 
        color: cssVar('--text-secondary'),
        fontFamily: 'SF Mono, monospace',
      },
      splitLine: { 
        show: true, 
        lineStyle: { 
          color: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)',
          type: 'dashed',
        } 
      },
      axisPointer: { type: 'line' },
    },
    candlestick: {
      itemStyle: {
        color: cssVar('--neon-green'),
        color0: cssVar('--neon-pink'),
        borderColor: cssVar('--neon-green'),
        borderColor0: cssVar('--neon-pink'),
        borderWidth: 1.5,
      },
    },
    tooltip: {
      confine: true,
      borderWidth: 1,
      borderColor: cssVar('--electric-blue'),
      backgroundColor: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(10, 10, 10, 0.95)',
      textStyle: {
        color: isLight ? '#000000' : '#ffffff',
        fontFamily: '-apple-system, SF Pro Display, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 600,
      },
      padding: [10, 14],
      extraCssText: 'backdrop-filter: blur(10px); box-shadow: 0 0 20px rgba(0, 168, 255, 0.3);',
    },
    dataZoom: {
      textStyle: { color: cssVar('--text-secondary') },
      borderColor: cssVar('--border'),
      fillerColor: cssVar('--electric-blue') + '20',
      handleStyle: { 
        color: cssVar('--electric-blue'),
        borderColor: cssVar('--electric-blue'),
      },
      dataBackground: {
        lineStyle: { color: cssVar('--border') },
        areaStyle: { color: cssVar('--border') },
      },
      selectedDataBackground: {
        lineStyle: { color: cssVar('--electric-blue') },
        areaStyle: { color: cssVar('--electric-blue') + '40' },
      },
    },
  });
}

function cssVar(name: string) {
  const el = document.createElement('span');
  el.style.color = `var(${name})`;
  document.body.appendChild(el);
  const color = getComputedStyle(el).color;
  el.remove();
  return color;
}
