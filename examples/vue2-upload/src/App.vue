<template>
  <div id="app">
    <!-- Header -->
    <header class="header">
      <div class="logo">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="url(#grad)" />
          <path d="M10 20l6-12 6 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="32" y2="32">
              <stop stop-color="#6366f1" />
              <stop offset="1" stop-color="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>
        <h1>Flux Transfer</h1>
      </div>
      <span class="badge">Vue 2 Demo</span>
    </header>

    <!-- Upload Area -->
    <div
      class="upload-area"
      :class="{ dragover: isDragover }"
      @dragover.prevent="isDragover = true"
      @dragleave.prevent="isDragover = false"
      @drop.prevent="handleDrop"
      @click="triggerFileInput"
    >
      <input
        ref="fileInput"
        type="file"
        multiple
        style="display: none"
        @change="handleFileSelect"
      />
      <div class="upload-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M24 32V16m0 0l-8 8m8-8l8 8" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M8 28v8a4 4 0 004 4h24a4 4 0 004-4v-8" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <p class="upload-text">拖拽文件到这里，或 <span class="link">点击选择</span></p>
      <p class="upload-hint">支持任意格式，可多文件上传</p>
    </div>

    <!-- Config Panel -->
    <div class="config-panel">
      <label>
        上传地址
        <input v-model="uploadUrl" type="text" placeholder="https://httpbin.org/post" />
      </label>
      <label>
        分片大小
        <select v-model="chunkSizeLabel">
          <option value="256KB">256 KB</option>
          <option value="512KB">512 KB</option>
          <option value="1MB">1 MB</option>
          <option value="5MB">5 MB</option>
          <option value="0">无限制</option>
        </select>
      </label>
    </div>

    <!-- Task List -->
    <div v-if="uploads.length > 0" class="task-list">
      <h2 class="section-title">
        上传任务
        <span class="task-count">{{ uploads.length }}</span>
      </h2>

      <div v-for="(item, index) in uploads" :key="index" class="task-card">
        <div class="task-header">
          <div class="file-info">
            <span class="file-icon">{{ getFileIcon(item.fileName) }}</span>
            <div>
              <div class="file-name">{{ item.fileName }}</div>
              <div class="file-meta">{{ formatSize(item.fileSize) }}</div>
            </div>
          </div>
          <span class="status-badge" :class="item.ctrl.state.status">
            {{ statusLabel(item.ctrl.state.status) }}
          </span>
        </div>

        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: item.ctrl.state.progress + '%' }"
            :class="{ completed: item.ctrl.state.isCompleted, failed: item.ctrl.state.isFailed }"
          ></div>
        </div>

        <div class="task-footer">
          <span class="progress-text">{{ item.ctrl.state.progress }}%</span>
          <span v-if="item.ctrl.state.isUploading" class="speed">
            {{ formatSpeed(item.ctrl.state.speed) }}
          </span>
          <span v-if="item.ctrl.state.remainingTime > 0" class="eta">
            剩余 {{ formatTime(item.ctrl.state.remainingTime) }}
          </span>

          <div class="actions">
            <button
              v-if="item.ctrl.state.status === 'idle'"
              class="btn btn-primary"
              @click="item.ctrl.start()"
            >开始</button>
            <button
              v-if="item.ctrl.state.isUploading"
              class="btn btn-warn"
              @click="item.ctrl.pause()"
            >暂停</button>
            <button
              v-if="item.ctrl.state.isPaused || item.ctrl.state.isFailed"
              class="btn btn-primary"
              @click="item.ctrl.resume()"
            >恢复</button>
            <button
              v-if="!item.ctrl.state.isCompleted"
              class="btn btn-danger"
              @click="item.ctrl.cancel()"
            >取消</button>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="item.ctrl.state.error" class="error-msg">
          ⚠ {{ item.ctrl.state.error.message }}
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <p>暂无上传任务，选择文件开始上传 🚀</p>
    </div>
  </div>
</template>

<script>
import { FetchAdapter, TransferManager } from 'flux-transfer';
import { useUpload } from 'flux-transfer/vue2';

const CHUNK_SIZE_MAP = {
  '256KB': 256 * 1024,
  '512KB': 512 * 1024,
  '1MB': 1024 * 1024,
  '5MB': 5 * 1024 * 1024,
  '0': 0,
};

export default {
  name: 'App',
  data() {
    return {
      manager: null,
      uploads: [],
      isDragover: false,
      uploadUrl: 'https://httpbin.org/post',
      chunkSizeLabel: '512KB',
    };
  },
  created() {
    this.manager = new TransferManager({
      maxConcurrent: 2,
      enableCheckpoint: true,
    });
  },
  beforeDestroy() {
    this.uploads.forEach((item) => item.ctrl.cleanup());
  },
  methods: {
    triggerFileInput() {
      (this.$refs.fileInput).click();
    },
    handleFileSelect(e) {
      const input = e.target;
      const files = Array.from(input.files || []);
      this.addFiles(files);
      input.value = '';
    },
    handleDrop(e) {
      this.isDragover = false;
      const files = Array.from(e.dataTransfer?.files || []);
      this.addFiles(files);
    },
    addFiles(files) {
      if (!this.manager) return;
      // 不限制就不传递
      const chunkSize = CHUNK_SIZE_MAP[this.chunkSizeLabel] || undefined;

      files.forEach((file) => {
        const ctrl = useUpload(this.manager, file, {
          uploadUrl: this.uploadUrl,
          networkAdapter: new FetchAdapter(),
          chunkSize,
          maxConcurrentChunks: 2,
        });

        this.uploads.push({
          fileName: file.name,
          fileSize: file.size,
          ctrl,
        });
      });
    },
    getFileIcon(name) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const map = {
        pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
        ppt: '📽️', pptx: '📽️', zip: '📦', rar: '📦', '7z': '📦',
        mp4: '🎬', avi: '🎬', mkv: '🎬', mp3: '🎵', wav: '🎵',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
        js: '⚙️', ts: '⚙️', vue: '💚', html: '🌐', css: '🎨',
      };
      return map[ext] || '📎';
    },
    statusLabel(status) {
      const labels = {
        idle: '等待中',
        processing: '准备中',
        transferring: '上传中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
      };
      return labels[status] || status;
    },
    formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    },
    formatSpeed(bytesPerSec) {
      if (bytesPerSec <= 0) return '';
      if (bytesPerSec < 1024) return bytesPerSec + ' B/s';
      if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
      return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    },
    formatTime(seconds) {
      if (seconds < 60) return seconds + '秒';
      if (seconds < 3600) return Math.floor(seconds / 60) + '分' + (seconds % 60) + '秒';
      return Math.floor(seconds / 3600) + '时' + Math.floor((seconds % 3600) / 60) + '分';
    },
  },
};
</script>

<style>
/* ========================================
   Design System
   ======================================== */
:root {
  --primary: #6366f1;
  --primary-light: #818cf8;
  --primary-dark: #4f46e5;
  --accent: #8b5cf6;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --bg: #0f0f23;
  --bg-card: #1a1a2e;
  --bg-card-hover: #1e1e35;
  --bg-input: #16162a;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --border: #2d2d52;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

#app {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}

/* ========================================
   Header
   ======================================== */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo h1 {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.15);
  color: var(--primary-light);
  border: 1px solid rgba(99, 102, 241, 0.3);
}

/* ========================================
   Upload Area
   ======================================== */
.upload-area {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: var(--bg-card);
  margin-bottom: 20px;
}

.upload-area:hover,
.upload-area.dragover {
  border-color: var(--primary);
  background: rgba(99, 102, 241, 0.05);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(99, 102, 241, 0.15);
}

.upload-icon {
  margin-bottom: 16px;
  opacity: 0.8;
}

.upload-text {
  font-size: 1rem;
  color: var(--text);
  margin-bottom: 8px;
}

.upload-text .link {
  color: var(--primary-light);
  font-weight: 600;
}

.upload-hint {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* ========================================
   Config Panel
   ======================================== */
.config-panel {
  display: flex;
  gap: 16px;
  margin-bottom: 28px;
}

.config-panel label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-muted);
}

.config-panel input,
.config-panel select {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.config-panel input:focus,
.config-panel select:focus {
  border-color: var(--primary);
}

/* ========================================
   Task List
   ======================================== */
.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-count {
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--primary);
  color: #fff;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.task-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 20px;
  margin-bottom: 12px;
  transition: all 0.2s ease;
}

.task-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-icon {
  font-size: 1.5rem;
}

.file-name {
  font-weight: 600;
  font-size: 0.95rem;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Status Badge */
.status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-badge.idle {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.status-badge.processing {
  background: rgba(99, 102, 241, 0.15);
  color: var(--primary-light);
}

.status-badge.transferring {
  background: rgba(99, 102, 241, 0.2);
  color: var(--primary-light);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-badge.paused {
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning);
}

.status-badge.completed {
  background: rgba(16, 185, 129, 0.15);
  color: var(--success);
}

.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}

.status-badge.cancelled {
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Progress Bar */
.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--accent));
  border-radius: 999px;
  transition: width 0.3s ease;
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  animation: shimmer 2s infinite;
}

.progress-fill.completed {
  background: var(--success);
}

.progress-fill.failed {
  background: var(--danger);
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Task Footer */
.task-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8rem;
}

.progress-text {
  font-weight: 700;
  color: var(--primary-light);
  min-width: 36px;
}

.speed, .eta {
  color: var(--text-muted);
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

/* Buttons */
.btn {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  border: none;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary);
  color: #fff;
}

.btn-primary:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
}

.btn-warn {
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning);
}

.btn-warn:hover {
  background: rgba(245, 158, 11, 0.25);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
}

/* Error Message */
.error-msg {
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--danger);
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.08);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--danger);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 64px 24px;
  color: var(--text-muted);
  font-size: 1rem;
}
</style>