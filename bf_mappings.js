/**
 * Big Five 映射配置模块
 * 统一管理 Big Five [O,C,E,A,N] 到结构8和潜力8的转换
 */

// Big Five 到结构8的映射矩阵
// 结构8维度：[领导力, 执行力, 创新力, 协作力, 学习力, 抗压力, 沟通力, 决策力]
const BF_TO_STRUCT8_MATRIX = [
  // O(开放性)  C(尽责性)  E(外向性)  A(宜人性)  N(神经质)
  [0.25,      0.15,     0.35,     0.10,     -0.15],  // 领导力
  [0.10,      0.50,     0.20,     0.05,     -0.20],  // 执行力
  [0.45,      0.10,     0.25,     0.05,     -0.10],  // 创新力
  [0.05,      0.15,     0.30,     0.45,     -0.15],  // 协作力
  [0.40,      0.25,     0.15,     0.10,     -0.10],  // 学习力
  [0.15,      0.30,     0.20,     0.10,     -0.40],  // 抗压力
  [0.10,      0.15,     0.45,     0.25,     -0.15],  // 沟通力
  [0.20,      0.35,     0.25,     0.05,     -0.20]   // 决策力
];

// Big Five 到潜力8的映射矩阵
// 潜力8维度：[战略思维, 创新潜力, 领导潜力, 学习潜力, 适应潜力, 协作潜力, 执行潜力, 成长潜力]
const BF_TO_POT8_MATRIX = [
  // O(开放性)  C(尽责性)  E(外向性)  A(宜人性)  N(神经质)
  [0.35,      0.25,     0.20,     0.05,     -0.15],  // 战略思维
  [0.50,      0.10,     0.20,     0.05,     -0.10],  // 创新潜力
  [0.20,      0.20,     0.40,     0.15,     -0.20],  // 领导潜力
  [0.45,      0.20,     0.15,     0.15,     -0.10],  // 学习潜力
  [0.30,      0.15,     0.25,     0.20,     -0.25],  // 适应潜力
  [0.10,      0.15,     0.25,     0.50,     -0.15],  // 协作潜力
  [0.15,      0.45,     0.25,     0.10,     -0.20],  // 执行潜力
  [0.35,      0.25,     0.25,     0.20,     -0.20]   // 成长潜力
];

// 基准值（当所有BF为50时的输出值）
const STRUCT8_BASELINE = [50, 50, 50, 50, 50, 50, 50, 50];
const POT8_BASELINE = [50, 50, 50, 50, 50, 50, 50, 50];

/**
 * 将值限制在指定范围内
 */
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 应用轻微非线性变换（S型曲线）
 */
function applyCurve(x, gamma = 1.1) {
  const normalized = x / 100;
  const curved = Math.pow(normalized, gamma);
  return curved * 100;
}

/**
 * Big Five 到结构8的转换函数
 * @param {Array} bf - Big Five数组 [O, C, E, A, N]
 * @returns {Array} 结构8数组，每个值在0-100范围内
 */
function bf_to_struct8(bf) {
  if (!Array.isArray(bf) || bf.length !== 5) {
    console.warn('Invalid Big Five input:', bf);
    return STRUCT8_BASELINE.slice();
  }

  const result = [];
  
  for (let i = 0; i < 8; i++) {
    let score = STRUCT8_BASELINE[i];
    
    // 计算加权和
    for (let j = 0; j < 5; j++) {
      const bfValue = bf[j] || 50; // 默认值50
      const weight = BF_TO_STRUCT8_MATRIX[i][j];
      score += (bfValue - 50) * weight;
    }
    
    // 应用轻微非线性并限制范围
    score = applyCurve(clamp(score, 0, 100), 1.05);
    result.push(Math.round(score));
  }
  
  return result;
}

/**
 * Big Five 到潜力8的转换函数
 * @param {Array} bf - Big Five数组 [O, C, E, A, N]
 * @returns {Array} 潜力8数组，每个值在0-100范围内
 */
function bf_to_pot8(bf) {
  if (!Array.isArray(bf) || bf.length !== 5) {
    console.warn('Invalid Big Five input:', bf);
    return POT8_BASELINE.slice();
  }

  const result = [];
  
  for (let i = 0; i < 8; i++) {
    let score = POT8_BASELINE[i];
    
    // 计算加权和
    for (let j = 0; j < 5; j++) {
      const bfValue = bf[j] || 50; // 默认值50
      const weight = BF_TO_POT8_MATRIX[i][j];
      score += (bfValue - 50) * weight;
    }
    
    // 应用轻微非线性并限制范围
    score = applyCurve(clamp(score, 0, 100), 1.08);
    result.push(Math.round(score));
  }
  
  return result;
}

/**
 * 结构8转换为16锚点（用于雷达图显示）
 */
function struct8_to_sparse16(struct8) {
  if (!Array.isArray(struct8) || struct8.length !== 8) {
    return new Array(16).fill(0);
  }
  
  const sparse16 = new Array(16).fill(0);
  for (let i = 0; i < 8; i++) {
    sparse16[i * 2] = struct8[i] || 0;
  }
  return sparse16;
}

/**
 * 潜力8转换为16锚点（用于雷达图显示）
 */
function pot8_to_sparse16(pot8) {
  if (!Array.isArray(pot8) || pot8.length !== 8) {
    return new Array(16).fill(0);
  }
  
  const sparse16 = new Array(16).fill(0);
  for (let i = 0; i < 8; i++) {
    sparse16[i * 2] = pot8[i] || 0;
  }
  return sparse16;
}

// 导出函数（兼容不同的模块系统）
if (typeof module !== 'undefined' && module.exports) {
  // Node.js 环境
  module.exports = {
    bf_to_struct8,
    bf_to_pot8,
    struct8_to_sparse16,
    pot8_to_sparse16,
    clamp,
    applyCurve
  };
} else if (typeof window !== 'undefined') {
  // 浏览器环境：挂载到 window.BFMappings
  window.BFMappings = {
    bf_to_struct8,
    bf_to_pot8,
    struct8_to_sparse16,
    pot8_to_sparse16,
    clamp,
    applyCurve
  };
  
  // 添加别名导出以兼容Dashboard的直接调用
  window.bf_to_struct8 = bf_to_struct8;
  window.bf_to_pot8 = bf_to_pot8;
}