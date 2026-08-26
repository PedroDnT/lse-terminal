// Regenerates tests/data/ts_truth.json: the reference chart library's
// output for every indicator on the shared fixture, used by
// test_indicator_parity.py. Run from the repo root:
//   frontend/node_modules/.bin/esbuild frontend/src/lib/indicators.ts \
//     --bundle --format=esm --outfile=/tmp/lse_ts_indicators.mjs
//   node tests/gen_ts_truth.mjs
// The reference chart library is kept only as the historical baseline for this
// parity check; the live library is lse_terminal/indicators (Python).
import { readFileSync, writeFileSync } from 'node:fs';
import * as I from '/tmp/lse_ts_indicators.mjs';

const here = new URL('.', import.meta.url).pathname;
const csv = readFileSync(here + 'data/candles_fixture.csv', 'utf8')
  .trim().split('\n').slice(1).map(l => l.split(',').map(Number));
const ts = csv.map(r => r[0] * 1000);
const o = csv.map(r => r[1]);
const h = csv.map(r => r[2]);
const l = csv.map(r => r[3]);
const c = csv.map(r => r[4]);
const v = csv.map(r => r[5]);
const n = c.length;

const out = {};
const put = (name, res) => {
  if (Array.isArray(res)) { out[name] = { [name]: res }; return; }
  const cols = {};
  for (const [k, arr] of Object.entries(res)) {
    cols[k] = Array.isArray(arr)
      ? arr.map(x => (typeof x === 'boolean' ? (x ? 1 : 0) : x))
      : arr;
  }
  out[name] = cols;
};

put('sma', I.calculateSMA(c, 20));
put('ema', I.calculateEMA(c, 20));
put('wma', I.calculateWMA(c, 20));
put('rsi', I.calculateRSI(c, 14));
put('macd', I.calculateMACD(c, 12, 26, 9));
put('bollinger', I.calculateBollingerBands(c, 20, 2));
put('atr', I.calculateATR(h, l, c, 14));
put('stochastic', I.calculateStochastic(h, l, c, 14, 3, 3));
put('willr', I.calculateWilliamsR(h, l, c, 14));
put('cci', I.calculateCCI(h, l, c, 20));
put('adx', I.calculateADX(h, l, c, 14));
put('roc', I.calculateROC(c, 12));
put('vwap', I.calculateVWAP(h, l, c, v, ts));
put('supertrend', I.calculateSupertrend(h, l, c, 10, 3));
put('donchian', I.calculateDonchian(h, l, 20));
put('aroon', I.calculateAroon(h, l, 25));
put('dema', I.calculateDEMA(c, 21));
put('tema', I.calculateTEMA(c, 21));
put('hma', I.calculateHMA(c, 9));
put('momentum', I.calculateMomentum(c, 10));
put('ao', I.calculateAwesomeOscillator(h, l));
put('mfi', I.calculateMFI(h, l, c, v, 14));
put('obv', I.calculateOBV(c, v));
put('cmf', I.calculateCMF(h, l, c, v, 20));
put('alma', I.calculateALMA(c, 9, 0.85, 6));
put('kama', I.calculateKAMA(c, 10, 2, 30));
put('keltner', I.calculateKeltnerChannels(h, l, c, 20, 10, 2));
put('smma', I.calculateSMMA(c, 20));
put('ichimoku', I.calculateIchimoku(h, l, c, 9, 26, 52, 26));
put('psar', I.calculateParabolicSAR(h, l, 0.02, 0.02, 0.2));
put('envelopes', I.calculateEnvelopes(c, 20, 2.5));
put('zlema', I.calculateZLEMA(c, 21));
put('t3', I.calculateT3(c, 5, 0.7));
put('lsma', I.calculateLSMA(c, 25));
put('mcginley', I.calculateMcGinley(c, 14));
put('alligator', I.calculateAlligator(c));
put('vortex', I.calculateVortex(h, l, c, 14));
put('choppiness', I.calculateChoppiness(h, l, c, 14));
put('elder_ray', I.calculateElderRay(h, l, c, 13));
put('mass_index', I.calculateMassIndex(h, l, 25));
put('chande_kroll', I.calculateChandeKrollStop(h, l, c, 10, 9, 1));
put('lr_slope', I.calculateLinRegSlope(c, 14));
put('price_channel', I.calculatePriceChannel(h, l, 20));
put('tsi', I.calculateTSI(c, 25, 13, 13));
put('trix', I.calculateTRIX(c, 15, 9));
put('uo', I.calculateUltimateOscillator(h, l, c, 7, 14, 28));
put('dpo', I.calculateDPO(c, 21));
put('kst', I.calculateKST(c, 10, 15, 20, 30, 10, 10, 10, 15, 9));
put('stoch_rsi', I.calculateStochRSI(c, 14, 14, 3));
put('ppo', I.calculatePPO(c, 12, 26, 9));
put('pvo', I.calculatePVO(v, 12, 26, 9));
put('cmo', I.calculateCMO(c, 9));
put('fisher', I.calculateFisher(h, l, 10));
put('stc', I.calculateSTC(c, 23, 50, 10, 3));
put('rvi', I.calculateRVI(o, h, l, c, 10));
put('klinger', I.calculateKlinger(h, l, c, v, 34, 55, 13));
put('connors_rsi', I.calculateConnorsRSI(c, 3, 2, 100));
put('apo', I.calculateAPO(c, 12, 26));
put('qstick', I.calculateQstick(o, c, 8));
put('bop', I.calculateBOP(o, h, l, c, 14));
put('psych_line', I.calculatePsychLine(c, 12));
put('pfe', I.calculatePFE(c, 10, 5));
put('smi', I.calculateSMI(h, l, c, 13, 25, 2));
put('bb_percent', I.calculateBBPercent(c, 20, 2));
put('bb_width', I.calculateBBWidth(c, 20, 2));
put('hist_vol', I.calculateHistoricalVolatility(c, 20));
put('chaikin_vol', I.calculateChaikinVolatility(h, l, 10, 10));
put('stddev', I.calculateStdDev(c, 20));
put('ulcer', I.calculateUlcerIndex(c, 14));
put('natr', I.calculateNATR(h, l, c, 14));
put('true_range', I.calculateTrueRange(h, l, c));
put('squeeze', I.calculateSqueeze(h, l, c, 20, 2, 20, 1.5));
put('chandelier', I.calculateChandelierExit(h, l, c, 22, 3));
put('rvol', I.calculateRelativeVolIndex(c, 10, 14));
put('vhf', I.calculateVHF(c, 28));
put('acc_bands', I.calculateAccBands(h, l, c, 20));
put('volume', v);
put('adl', I.calculateADL(h, l, c, v));
put('force_index', I.calculateForceIndex(c, v, 13));
put('eom', I.calculateEOM(h, l, v, 14));
put('volume_sma', I.calculateVolumeSMA(v, 20));
put('vwma', I.calculateVWMA(c, v, 20));
put('volume_osc', I.calculateVolumeOsc(v, 5, 10));
put('nvi', I.calculateNVI(c, v));
put('pvi', I.calculatePVI(c, v));
put('pvt', I.calculatePVT(c, v));
put('vroc', I.calculateVROC(v, 14));
put('net_volume', I.calculateNetVolume(c, v, 14));
put('twiggs_mf', I.calculateTwiggsMF(h, l, c, v, 21));
put('pivots', I.calculateDailyPivots(ts, h, l, c));
put('camarilla', I.calculateDailyCamarilla(ts, h, l, c));
put('woodie', I.calculateDailyWoodie(ts, h, l, c));
put('demark', I.calculateDeMarkPivots(ts, h, l, o, c));
{
  const lookback = 100;
  const fib = I.calculateFibRetracement(h, l, lookback);
  const names = ['f000', 'f236', 'f382', 'f500', 'f618', 'f786', 'f1000'];
  const cols = {};
  names.forEach((nm, k) => {
    const arr = new Array(n).fill(NaN);
    for (let i = Math.max(0, n - lookback); i < n; i++) arr[i] = fib.levels[k];
    cols[nm] = arr;
  });
  out['fib_retracement'] = cols;
}
put('zigzag', I.calculateZigZag(h, l, c, 5));
put('fractals', I.calculateFractals(h, l, 2));
put('lin_reg', I.calculateLinearRegression(c, 100, 2));
put('coppock', I.calculateCoppock(c, 14, 11, 10));
put('r_squared', I.calculateLinRegRSquared(c, 14));
put('median_price', I.calculateMedianPrice(h, l));
put('typical_price', I.calculateTypicalPrice(h, l, c));
put('weighted_close', I.calculateWeightedClose(h, l, c));
put('gator', I.calculateGator(c));

// Some reference fns return short arrays (built up from index p); left-pad with NaN
// so every column is n-long and index-aligned to the fixture.
for (const cols of Object.values(out)) {
  for (const [k, arr] of Object.entries(cols)) {
    if (arr.length < n) cols[k] = new Array(n - arr.length).fill(NaN).concat(arr);
  }
}

writeFileSync(here + 'data/ts_truth.json',
  JSON.stringify(out, (key, val) => (typeof val === 'number' && !Number.isFinite(val) ? null : val)));
console.log('dumped', Object.keys(out).length, 'indicators');
