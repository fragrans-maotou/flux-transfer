// 导出核心类型
export * from './core/types';

// 导出核心状态管理
export * from './core/store';
export * from './core/storage-middleware';

// 导出调度引擎
export * from './core/engine';

// 导出内置策略
export * from './core/strategies';

// 导出后台运算工具
export * from './core/worker/hash-calculator';

// 导出网络层
export * from './network/fetch-adapter';

// 不要在这里导出框架适配器，这会导致核心包强依赖 Vue 和 React。
// 适配器应该由用户通过 flux-transfer/vue3 或 flux-transfer/react 独立引入。
