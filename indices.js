/**
 * PSYS 指数计算模块 - 行为学口径升级版
 * 实现7个指数:差异指数(DI)、内核稳定指数(KSI)、自我知觉整合指数(SPI)、
 * 圆周指数(CI)、完整指数(PI)、自信指数(CFI)
 * 统一返回格式:{ value, components, type, signals, reliability }
 */

// 工具:安全均值/方差/变异系数/MAD/压缩与回拉
const _mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const _stdev = a => { const m=_mean(a); return Math.sqrt(_mean(a.map(v=>(v-m)**2))); };
const _mad = a => { const m=_mean(a); const d=a.map(v => Math.abs((v??50) - m)).sort((x,y)=>x-y); return d.length? d[Math.floor(d.length*0.5)] : 0; };
const _cv = (a, eps=1e-6) => { const m=_mean(a); return m? _stdev(a)/(Math.abs(m)+eps) : 0; };
const _clip01 = x => Math.max(0, Math.min(1, x));
const _compressTo01 = (x01, k=0.7) => 0.5 + (x01-0.5)*k;      // 中心压缩
const _softClamp01 = (x01, lo=0.05, hi=0.95) => Math.max(lo, Math.min(hi, x01));
const _pct = x01 => Math.round(_clip01(x01)*100);
const _isFallbackVec = v => !Array.isArray(v) || v.every(x=>Math.abs((x??50)-50)<=1.5);
const _topKIdx = (arr, k, asc=false) => {
  const idx = arr.map((v,i)=>[v,i]).sort((a,b)=> asc? a[0]-b[0] : b[0]-a[0]).slice(0,k).map(x=>x[1]);
  return idx;
};

// 默认配置
const DEFAULT_CONFIG = {
  weights: {
    masking_alpha: 0.5,
    spi_beta: 0.7,
    ksi_sigma0: 0.25,
    ci_kappa: 0.3,
    pi_gamma: 0.6
  },
  thresholds: {
    perfection: {
      use: "struct8",
      baseline_dims: ["镜面", "盾牌", "桥梁"],
      T: { "镜面": 0.60, "盾牌": 0.60, "桥梁": 0.60 },
      defaultT: 0.60
    }
  },
  confidence: {
    use_struct_or_pot: "pot8",
    drive_key: "目标推进力",
    influence_key: "影响半径"
  },
  circularity: {
    use_geometry: false,
    target: ["struct8", "pot8"],
    kappa: 0.30
  }
};

// 1. 差异指数 - 保留 MaskCore M 为主, BF 差异作备胎
function calculateDifferenceIndex(payload) {
  const { eco16, struct_env8, struct_self8, entropy_hint } = payload;
  if (window.MaskCore && typeof window.MaskCore.computeMasking === 'function') {
    const res = window.MaskCore.computeMasking({
      eco16,
      structSelf8: struct_self8,
      structEnv8: struct_env8,
      entropy: entropy_hint
    });
    const { M, MA, MI, MC, type, signals } = res || {};
    return {
      value: _pct((M||0)/100), // 保持 0–100
      components: { align_gap: MA, intentionality: MI, cost: MC },
      type: type || '—',
      signals: signals || [],
      reliability: (_isFallbackVec(struct_env8)||_isFallbackVec(struct_self8))? 'low':'high'
    };
  }
  // 备胎:OCEAN 几何差异 - 做压缩与阈值
  const { bf_self=[], bf_env=[] } = payload;
  const l1 = _mean(bf_self.map((s,i)=>Math.abs((s-50)/50 - ((bf_env[i]||50)-50)/50)));
  const dot = _mean(bf_self.map((s,i)=>((s-50)/50)*(((bf_env[i]||50)-50)/50)));
  const cos = _clip01( (dot+1)/2 );
  let raw = 0.5*l1 + 0.5*(1-cos);         // 0–1
  raw = _compressTo01(raw, 0.7);
  raw = _softClamp01(raw, 0.05, 0.95);
  const type = raw<0.25? '轻度差异/正常呈现' : raw<0.55? '中度差异/选择性呈现' : '显著差异/策略性呈现';
  return {
    value: _pct(raw),
    components: { l1: _pct(l1), oneMinusCos: _pct(1-cos) },
    type, signals: [], reliability: (_isFallbackVec(bf_env)||_isFallbackVec(bf_self))? 'low':'mid'
  };
}

// 2. 内核稳定指数 - 来源一致性 + 时间一致性 + 情境负荷
function calculateKernelStabilityIndex(payload) {
  const { bf_self=[], bf_s2=[], bf_s3=[], bf_s4=[], history=[] , entropy_hint=0 } = payload;
  const sources = [bf_self,bf_s2,bf_s3,bf_s4].filter(v=>Array.isArray(v)&&v.length===5);
  // 来源一致性 - 跨源 std 越小越好
  const perDimStd = Array(5).fill(0).map((_,j)=>_stdev(sources.map(v=>(v[j]??50)/100)));
  const srcCons = 1 - Math.max(0, _mean(perDimStd)/0.25); // σ0=0.25
  // 时间一致性 - 历史 bf_env 的 MAD 越小越好
  const hist = Array.isArray(history)? history.slice(-5) : [];
  const timeCons = hist.length>=2 ? 1 - Math.min(1, _mad(hist.map(h=>_mean(h.bf_env||Array(5).fill(50))/100))/0.15) : 0.6;
  // 情境负荷 - 熵高=外部复杂 → 稳定性扣分
  const ctxLoad = 1 - Math.min(1, (entropy_hint||0)/100);
  // 融合 + 压缩
  let x = _clip01( 0.5*srcCons + 0.3*timeCons + 0.2*ctxLoad );
  x = _compressTo01(x, 0.75);
  x = _softClamp01(x, 0.08, 0.98);
  // 类型
  const type = x>=0.75? '高稳定/抗扰动' : x>=0.55? '中稳定/可承压' : '低稳定/敏感';
  // 信号
  const lowestDim = _topKIdx(perDimStd, 1, false)[0]; // 波动最大的维度索引
  const signals = [`跨来源方差最大维度 #${(lowestDim??0)+1}`];
  const reliability = sources.length>=3 ? 'high' : 'mid';
  return { value:_pct(x), components:{ source_consistency:_pct(srcCons), time_consistency:_pct(timeCons), context_load:_pct(ctxLoad) }, type, signals, reliability };
}

// 3. 自我知觉整合 - 方向一致 + 幅度一致 + 结构叙事
function calculateSelfIntegrationIndex(payload) {
  const { bf_self=[], bf_env=[], struct_self8=[], struct_env8=[] } = payload;
  
  // 安全检查:确保数组不为 null 且有足够长度
  const safeBfSelf = Array.isArray(bf_self) && bf_self.length >= 5 ? bf_self : Array(5).fill(50);
  const safeBfEnv = Array.isArray(bf_env) && bf_env.length >= 5 ? bf_env : Array(5).fill(50);
  const safeStructSelf = Array.isArray(struct_self8) && struct_self8.length >= 8 ? struct_self8 : Array(8).fill(50);
  const safeStructEnv = Array.isArray(struct_env8) && struct_env8.length >= 8 ? struct_env8 : Array(8).fill(50);
  
  const s = safeBfSelf.map(v=>(v-50)/50), e = safeBfEnv.map(v=>((v??50)-50)/50);
  const dot = _mean(s.map((v,i)=>v*(e[i]??0)));
  const cos = _clip01((dot+1)/2);
  const rmse = Math.sqrt(_mean(s.map((v,i)=> (v - (e[i]??0))**2 )));
  const magAgree = 1 - Math.min(1, rmse/0.6);
  // 结构叙事一致性 - 8 维角度的一致度
  const ss = safeStructSelf.map(v=>(v-50)/50), se = safeStructEnv.map(v=>((v??50)-50)/50);
  const structCos = _clip01( ( _mean(ss.map((v,i)=>v*(se[i]??0))) + 1 )/2 );
  let x = _clip01( 0.5*cos + 0.3*magAgree + 0.2*structCos );
  x = _compressTo01(x, 0.75);
  x = _softClamp01(x, 0.07, 0.97);
  const type = x>=0.75? '高度自洽/统一呈现' : x>=0.55? '部分自洽/轻度偏差' : '自洽不足/内外割裂';
  const signals = [];
  return { value:_pct(x), components:{ dir_alignment:_pct(cos), mag_alignment:_pct(magAgree), struct_alignment:_pct(structCos) }, type, signals, reliability: (_isFallbackVec(bf_env)||_isFallbackVec(struct_env8))? 'low':'high' };
}

// 4. 圆周指数 - 结构均衡 - 新增到页面显示
function calculateCircularityIndex(vector = [], opts = {}) {
  const v = (Array.isArray(vector) && vector.length) ? vector : [];
  const mean = _mean(v);
  const cv = _cv(v.map(x => x ?? 50));
  let circ = 1 - Math.min(1, cv / (opts.kappa ?? 0.30));
  circ = _compressTo01(circ, 0.8);
  circ = _softClamp01(circ, 0.05, 0.98);

  const mean01 = _clip01((mean ?? 50) / 100);
  let type = '失衡薄弱';
  if (circ >= 0.5 && mean01 >= 0.5) type = '均衡强势';
  else if (circ >= 0.5 && mean01 < 0.5) type = '均衡薄弱';
  else if (circ < 0.5 && mean01 >= 0.5) type = '锋利不均';

  const diffs = v.map(x => (x ?? 50) - mean);
  const spikes = _topKIdx(diffs, 2, false).map(i => `尖峰 #${i + 1}`);
  const dips = _topKIdx(diffs.map(d => -d), 2, false).map(i => `短板 #${i + 1}`);

  return {
    value: _pct(circ),
    components: { mean_value: mean01, cv: _clip01(cv) },
    type,
    signals: [...spikes, ...dips],
    reliability: v.length >= 8 ? 'high' : 'mid'
  };
}

// 5. 完整指数 - 底线覆盖 + 最差项 + 离散度惩罚
function calculatePerfectionIndex(vector = [], thresholds = {}) {
  const v01 = (vector || []).map(x => _clip01((x ?? 50) / 100));
  const keys = thresholds.keys || v01.map((_, i) => `维度#${i + 1}`);
  const Tmap = thresholds.T || {};
  const Tarr = keys.map(k => Tmap[k] ?? (thresholds.defaultT ?? 0.6));

  const coverage = v01.map((x, i) => _clip01((x - Tarr[i]) / (1 - Tarr[i] + 1e-6)));
  const covMean = _mean(coverage);
  const worst = Math.min(...coverage);
  const spread = _cv(v01);

  let x = _clip01(0.6 * covMean + 0.3 * worst + 0.1 * (1 - Math.min(1, spread / 0.35)));
  x = _compressTo01(x, 0.75);
  x = _softClamp01(x, 0.05, 0.97);

  const shortfalls = keys.map((k, i) => ({
    dimension: k,
    value: Math.round(v01[i] * 100),
    target: Math.round(Tarr[i] * 100),
    gap: Math.max(0, Math.round((Tarr[i] - v01[i]) * 100))
  })).filter(d => d.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 4);

  const type = x >= 0.75 ? '完整良好/无明显短板' : x >= 0.55 ? '基本完整/个别短板' : '短板显著/优先补齐';

  return {
    value: _pct(x),
    components: { cov_mean: covMean, worst, spread },
    type,
    signals: shortfalls.map(s => `${s.dimension} -${s.gap}`),
    reliability: vector.length >= 8 ? 'high' : 'mid'
  };
}

// 6. 自信指数 - 性格倾向 + 行为证据 + 一致性
function calculateConfidenceIndex(payload, cfg={ drive_key:'目标推进力', influence_key:'影响半径' }) {
  const { bf_self=[], pot8=[], spi_value=0.5, struct8=[] } = payload;
  
  // 安全检查:确保数组不为 null
  const safeBfSelf = Array.isArray(bf_self) && bf_self.length >= 5 ? bf_self : Array(5).fill(50);
  const safePot8 = Array.isArray(pot8) && pot8.length >= 8 ? pot8 : Array(8).fill(50);
  
  const E = _clip01((safeBfSelf[2]??50)/100), N = _clip01((safeBfSelf[4]??50)/100), C = _clip01((safeBfSelf[1]??50)/100);
  const disposition = _clip01( 0.45*E + 0.35*(1-N) + 0.20*C );
  
  // 行为证据 - 从潜力8中找对应索引/名称
  const mapNameToIdx = (names)=> {
    // 安全检查:确保 safePot8 和 struct8 不为 null
    const potNames = (safePot8 && safePot8.__names__) || (struct8 && struct8.__names__) || [];
    if (!Array.isArray(potNames) || potNames.length === 0) {
      return names.map(() => null); // 如果没有名称映射, 返回 null
    }
    const lookup = potNames.reduce((o,n,i)=> (o[n]=i,o),{});
    return names.map(n=> lookup[n] ?? null);
  };
  
  const [dIdx,iIdx] = mapNameToIdx([cfg.drive_key, cfg.influence_key]);
  const drive = _clip01((safePot8[dIdx??0] ?? 50)/100);
  const infl  = _clip01((safePot8[iIdx??1] ?? 50)/100);
  const evidence = _clip01( 0.6*drive + 0.4*infl );
  
  // 确保 spi_value 是有效数值
  const safeSpiValue = (typeof spi_value === 'number' && !isNaN(spi_value)) ? spi_value : 0.5;
  
  let x = _clip01( 0.5*disposition + 0.3*evidence + 0.2*_clip01(safeSpiValue) );
  x = _compressTo01(x, 0.8);
  x = _softClamp01(x, 0.06, 0.97);
  const type = x>=0.75? '高自信/稳态输出' : x>=0.55? '中自信/情境依赖' : '低自信/需结构支持';
  const signals = [];
  // 统一自信指数详情结构, 修复NaN问题 - 使用confidence_details而不是sources
  return { 
    value:_pct(x), 
    components:{ disposition:_pct(disposition), evidence:_pct(evidence), consistency:_pct(safeSpiValue) }, 
    confidence_details:{ personality_ratio:50, evidence_ratio:30, consistency_ratio:20 }, 
    type, 
    signals, 
    reliability:'high' 
  };
}

/**
 * 主计算函数:计算所有指数
 */
function computeAllIndices(payload, config = DEFAULT_CONFIG) {
  const {
    bf_self = [], bf_env = [], eco16 = [], entropy_hint = 0
  } = payload || {};

  // Prefer explicit fields, else alias/fallbacks
  let struct_env8 = payload.struct8 || payload.struct_env8 || [];
  let pot8 = payload.pot8 || payload.pot_env8 || [];

  // Helper: validity check
  const isAllMid = (arr) => Array.isArray(arr) && arr.length && arr.every(x => (x ?? 50) === 50);
  const valid8 = (arr) => Array.isArray(arr) && arr.length === 8 && !isAllMid(arr);

  // If missing, derive from BF - 优先用环境合成 BF, 再退自评
  const bf_for_map = (Array.isArray(bf_env) && bf_env.length ? bf_env :
                     (Array.isArray(bf_self) && bf_self.length ? bf_self : null));
  if (!valid8(struct_env8) && bf_for_map && typeof window.bf_to_struct8 === 'function') {
    struct_env8 = window.bf_to_struct8(bf_for_map);
  }
  if (!valid8(pot8) && bf_for_map && typeof window.bf_to_pot8 === 'function') {
    pot8 = window.bf_to_pot8(bf_for_map);
  }

  const payload2 = { ...payload, struct_env8, pot8 };

  // Calculate
  const difference = calculateDifferenceIndex(payload2);
  const kernel_stability = calculateKernelStabilityIndex(payload2);
  const self_integration = calculateSelfIntegrationIndex(payload2);
  const circularity_struct = valid8(struct_env8)
      ? calculateCircularityIndex(struct_env8, config.circularity || {})
      : { value: 0, reliability: 'low', needed: 'struct8' };
  const circularity_pot = valid8(pot8)
      ? calculateCircularityIndex(pot8, config.circularity || {})
      : { value: 0, reliability: 'low', needed: 'pot8' };
  const perfection = valid8(struct_env8)
      ? calculatePerfectionIndex(struct_env8, (config.thresholds && config.thresholds.perfection) || {})
      : { value: 0, reliability: 'low', needed: 'struct8' };
  const confidence = calculateConfidenceIndex(
      { ...payload2, spi_value: ((self_integration?.value ?? 50) / 100) },
      config.confidence || {}
  );

  // Reliability overrides
  const selfOK = Array.isArray(bf_self) && bf_self.length && !isAllMid(bf_self);
  const envOK = Array.isArray(bf_env) && bf_env.length && !isAllMid(bf_env);
  if (difference) difference.reliability = (selfOK && envOK) ? 'high' : 'low';
  if (self_integration) self_integration.reliability = (selfOK && envOK) ? 'high' : 'low';
  if (kernel_stability) kernel_stability.reliability = (selfOK || envOK) ? 'high' : 'low';
  if (circularity_struct && circularity_struct.needed) circularity_struct.reliability = 'low';
  if (circularity_pot && circularity_pot.needed) circularity_pot.reliability = 'low';
  if (perfection && perfection.needed) perfection.reliability = 'low';

  return {
    difference,
    kernel_stability,
    self_integration,
    circularity_struct,
    circularity_pot,
    completeness: perfection,  // 修复:将 perfection 映射为 completeness
    confidence,
    confidence_details: confidence?.confidence_details || null,
    reliability: {
      difference: difference?.reliability || 'low',
      kernel_stability: kernel_stability?.reliability || 'low',
      self_integration: self_integration?.reliability || 'low',
      circularity_struct: circularity_struct?.reliability || 'low',
      circularity_pot: circularity_pot?.reliability || 'low',
      completeness: perfection?.reliability || 'low',  // 修复:添加 completeness 的可靠性
      confidence: confidence?.reliability || 'low'
    },
    computed_at: new Date().toISOString()
  };
}

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  // Node.js环境
  module.exports = {
    computeAllIndices,
    calculateDifferenceIndex,
    calculateKernelStabilityIndex,
    calculateSelfIntegrationIndex,
    calculateCircularityIndex,
    calculatePerfectionIndex,
    calculateConfidenceIndex,
    DEFAULT_CONFIG
  };
} else {
  // 浏览器环境
  window.IndicesCalculator = {
    computeAllIndices,
    calculateDifferenceIndex,
    calculateKernelStabilityIndex,
    calculateSelfIntegrationIndex,
    calculateCircularityIndex,
    calculatePerfectionIndex,
    calculateConfidenceIndex,
    DEFAULT_CONFIG
  };
}