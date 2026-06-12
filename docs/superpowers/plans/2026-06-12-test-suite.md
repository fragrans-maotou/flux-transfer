# 测试套件实现计划 (Test Suite Implementation Plan)

> **致 Agent：** 必须使用的子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 来逐个任务实现此计划。步骤使用复选框 (`- [ ]`) 语法来进行追踪。

**目标：** 为 `flux-transfer` 项目核心存储逻辑补充缺失的单元测试，以达到 `vitest.config.ts` 中定义的 80% 覆盖率阈值。目前项目中完全缺少 `tests/` 目录。

**架构设计：** 使用 Vitest 和 `jsdom`（已在配置中配好）。重点测试 `src/core/store.ts` 和 `src/core/storage-middleware.ts`，以确保断点续传的检查点创建、状态变更以及错误处理足够健壮。

**技术栈：** TypeScript, Vitest, jsdom

## 需要用户审核

> [!IMPORTANT]
> 尽管 `package.json` 已经定义了测试脚本，但目前项目里完全没有 `tests` 目录。这份计划将创建第一批单元测试，主要覆盖核心的传输状态库和存储中间件。你同意先从这些核心文件开始测试吗？还是说我们应该优先测试网络适配器（Network Adapters）或框架适配器（Vue/React）？

---

### 任务 1：基础 Store 状态测试

**涉及文件：**
- 创建：`tests/core/store.test.ts`

- [ ] **步骤 1：编写初始状态的失败测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useTransferStore } from '../../src/core/store'; 

describe('TransferStore', () => {
  beforeEach(() => {
    useTransferStore.setState({ tasks: {}, groups: {} });
  });

  it('应该以空的 tasks 记录作为初始状态', () => {
    const state = useTransferStore.getState();
    expect(state.tasks).toEqual({});
  });
});
```

- [ ] **步骤 2：运行测试以验证执行情况**

运行命令：`npm run test`
预期结果：FAIL（如果 mock 导入和真实实现不一致）或者 PASS。

- [ ] **步骤 3：编写添加任务的测试**

```typescript
  it('应该能够正确添加一个任务', () => {
    const store = useTransferStore.getState();
    const mockTask = {
      id: 'test-id',
      fileName: 'test.zip',
      fileSize: 1000,
      status: 'idle',
      progress: 0,
    } as any; 

    store.addTask(mockTask);
    
    expect(useTransferStore.getState().tasks['test-id']).toBeDefined();
    expect(useTransferStore.getState().tasks['test-id'].fileName).toBe('test.zip');
  });
```

- [ ] **步骤 4：运行测试确保通过**

运行命令：`npm run test`
预期结果：PASS

- [ ] **步骤 5：提交代码**

```bash
git add tests/core/store.test.ts
git commit -m "test: add initial unit tests for TransferStore"
```

### 任务 2：存储中间件测试 (Storage Middleware)

**涉及文件：**
- 创建：`tests/core/storage-middleware.test.ts`

- [ ] **步骤 1：编写保存至存储的测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { StorageMiddleware } from '../../src/core/storage-middleware';

describe('StorageMiddleware', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('当不使用 IndexedDB 时，应该将数据持久化到 localStorage', async () => {
    const middleware = new StorageMiddleware({ enableCheckpoint: true });
    await middleware.saveCheckpoint('test-id', { progress: 50, status: 'paused' } as any);
    
    const stored = localStorage.getItem('flux_checkpoint_test-id');
    expect(stored).toContain('"progress":50');
  });
});
```

- [ ] **步骤 2：运行测试以验证执行情况**

运行命令：`npm run test`
预期结果：FAIL 或 PASS（取决于降级逻辑是否与断言完全匹配）。

- [ ] **步骤 3：如有必要修复实现逻辑，否则验证通过**

运行命令：`npm run test`
预期结果：PASS

- [ ] **步骤 4：提交代码**

```bash
git add tests/core/storage-middleware.test.ts
git commit -m "test: add unit tests for StorageMiddleware fallback"
```
