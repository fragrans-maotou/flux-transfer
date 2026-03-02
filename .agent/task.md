# 超级文件传输 SDK 开发任务

## Phase 0: 工程化准备 (预计 4 小时)
- [x] 初始化 npm 项目，配置 package.json
- [x] 安装并配置 TypeScript (tsconfig.json)
- [x] 配置构建工具 tsup (支持 ESM + CJS 双输出)
- [x] 配置测试框架 Vitest (含覆盖率)
- [x] 创建项目目录结构 (src/core, src/infra, src/adapters, tests)
- [x] 配置 ESLint + Prettier (代码规范)
- [x] 初始化 Git，配置 .gitignore
- [x] 编写第一个测试用例验证环境

## Phase 1: 核心基础设施 (预计 12-15 小时)

### 1.1 类型定义层 (2 小时)
- [x] 定义状态枚举 TaskStatus
- [x] 定义错误码枚举 ErrorCode
- [x] 定义任务接口 ITransferTask
- [x] 定义网络适配器接口 INetworkAdapter
- [x] 定义存储适配器接口 IStorageAdapter
- [x] 定义 SDK 配置接口 ISDKConfig
- [x] 编写配置校验函数 validateConfig

### 1.2 事件系统 (1 小时)
- [x] 实现通用的发布-订阅模式
- [x] 支持事件监听、触发、取消订阅
- [x] 返回取消函数防止内存泄漏
- [x] 错误隔离

### 1.3 传输基类 (3 小时)
- [x] 定义 BaseTransfer 抽象类
- [x] 实现通用状态管理逻辑
- [x] 实现通用错误处理逻辑 (指数退避重试)
- [x] 实现进度计算逻辑 (含速度计算)
- [x] 实现检查点保存和加载
- [x] 继承 EventEmitter，支持事件发射

### 1.4 任务队列 (2 小时)
- [x] 实现任务入队、出队、移除逻辑
- [x] 实现并发控制
- [x] 实现自动调度机制
- [x] 支持优先级排序
- [x] 实现运行中任务计数

### 1.5 持久化层 (2 小时)
- [x] 实现 IStorageAdapter 接口
- [x] 封装 IndexedDB 操作
- [x] 处理数据库版本升级逻辑
- [x] 统一错误处理
- [ ] 支持批量操作 (暂缓)

### 1.6 网络适配器接口 (1 小时)
- [x] 定义统一网络请求接口（已在 types.ts 中完成）
- [x] 设计进度回调机制
- [x] 设计中断控制接口
- [x] 预留 Fetch 和 XHR 扩展点

## Phase 2: 上传功能实现 (预计 15-18 小时)

### 2.1 网络层实现 (4 小时)
- [x] 实现 FetchAdapter
- [x] 实现 XHRAdapter (备用)
- [x] 设计工厂函数自动选择适配器
- [x] 统一错误处理

### 2.2 文件切片逻辑 (2 小时)
- [x] 实现文件切片算法
- [x] 支持自定义分片大小
- [x] 生成分片索引和元数据
- [x] 支持并发上传控制
- [x] 记录已完成分片

### 2.3 Hash 计算 Worker (3 小时)
- [x] 实现增量 Hash 计算（简化版-主线程）
- [x] 支持大文件分块计算
- [x] 支持进度回调
- [x] 批量文件Hash计算
- [ ] Inline Worker（后续优化）

### 2.4 上传器实现 (4 小时)
- [x] 继承 BaseTransfer，实现上传方法
- [x] 实现上传状态机
- [x] 集成 ChunkManager
- [x] 实现断点续传
- [x] 所有分片完成后调用合并接口
- [ ] 集成 Hash Worker（使用简化版）

### 2.5 集成测试 (2 小时)
- [x] 搭建本地 Mock 服务器 (tests/integration/helpers.ts)
- [x] 编写端到端上传测试 (tests/integration/upload.test.ts)
- [x] 测试断点续传场景
- [x] 测试网络错误重试场景
- [x] 测试并发控制

## Phase 3: 下载功能实现 (预计 11-14 小时)

### 3.1 下载策略设计 (2 小时)
- [x] 定义 IDownloadStrategy 接口
- [x] 实现 Service Worker + StreamSaver 策略
- [x] 实现 Fetch + Blob 策略
- [x] 实现 Direct Link 策略
- [x] 实现策略工厂

### 3.2 Service Worker 实现 (4 小时)
- [x] 编写 Service Worker 脚本
- [x] 实现流式响应
- [x] 实现 SW 注册逻辑
- [x] 实现 SW 与主线程通信
- [x] 处理 SW 注册失败的降级

### 3.3 下载器实现 (3 小时)
- [x] 继承 BaseTransfer，实现下载方法
- [x] 实现下载状态机
- [x] 集成 DownloadStrategy
- [x] 实现进度监控
- [x] 实现断点续传
- [x] 触发浏览器下载

### 3.4 集成测试 (2 小时)
- [x] 下载策略单元测试 (20 tests)
- [x] 下载器单元测试 (19 tests)
- [x] 测试断点续传
- [x] 测试策略降级

## Phase 4: 框架适配与打磨 (预计 17 小时)

### 4.1 Vue 2 适配器 (2 小时)
- [x] 实现 useUpload 函数
- [x] 使用 Vue.observable 包装状态
- [x] 提供控制方法
- [x] 自动清理订阅

### 4.2 Vue 3 适配器 (2 小时)
- [ ] 实现 useUpload Composition API
- [ ] 使用 ref/reactive 包装状态
- [ ] 支持 TypeScript 类型提示
- [ ] onUnmounted 自动清理

### 4.3 React 适配器 (2 小时)
- [ ] 实现 useUpload Hook
- [ ] 使用 useState 同步状态
- [ ] useEffect 订阅事件
- [ ] 清理逻辑

### 4.4 示例项目 (4 小时)
- [x] 创建 Vue 2 示例项目
- [ ] 创建 Vue 3 示例项目
- [x] 美化 UI
- [ ] 编写 README

### 4.5 文档编写 (4 小时)
- [ ] 编写 README
- [ ] 编写 API 文档
- [ ] 编写最佳实践文档
- [ ] 编写 FAQ
- [ ] 编写 Changelog

### 4.6 性能优化与错误处理 (3 小时)
- [ ] 优化内存占用
- [ ] 优化事件触发频率
- [ ] 完善错误边界
- [ ] 添加日志系统
- [ ] 检查所有 TODO 和 FIXME

## Phase 5: 发布准备 (预计 5-6 小时)

### 5.1 构建配置优化 (2 小时)
- [ ] 配置 tsup 生成压缩版本
- [ ] 生成 Source Map
- [ ] 配置 package.json exports 字段
- [ ] 检查打包体积
- [ ] 测试 Node.js 环境导入

### 5.2 CI/CD 配置 (2 小时)
- [ ] 配置 GitHub Actions
- [ ] 配置自动发布流程
- [ ] 配置代码覆盖率徽章
- [ ] 配置自动生成 Changelog

### 5.3 npm 发布 (1 小时)
- [ ] 注册 npm 账号
- [ ] 配置 package.json
- [ ] 编写 .npmignore
- [ ] 执行 npm publish
- [ ] 验证安装

### 5.4 社区推广 (可选)
- [ ] 撰写技术博客
- [ ] 发布到 GitHub
- [ ] 在社区分享
- [ ] 收集用户反馈
