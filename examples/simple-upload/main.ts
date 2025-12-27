import { TransferManager, TaskStatus, FetchAdapter, IndexedDBStorage, type IUploadConfig } from '../../src/index';

// UI Elements
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const folderInput = document.getElementById('folderInput') as HTMLInputElement;
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const tasksContainer = document.getElementById('tasksContainer') as HTMLDivElement;
const taskTemplate = document.getElementById('taskTemplate') as HTMLTemplateElement;
const logOutput = document.getElementById('logOutput') as HTMLPreElement;

const groupStatusCard = document.getElementById('groupStatusCard') as HTMLDivElement;
const groupIdDisplay = document.getElementById('groupIdDisplay') as HTMLSpanElement;
const groupProgressFill = document.getElementById('groupProgressFill') as HTMLDivElement;
const groupStatusText = document.getElementById('groupStatusText') as HTMLDivElement;

const historyCard = document.getElementById('historyCard') as HTMLDivElement;
const historyList = document.getElementById('historyList') as HTMLUListElement;

// Initialize Manager with Persistence
const storage = new IndexedDBStorage();

const manager = new TransferManager({
  maxConcurrent: 3,
  storageAdapter: storage,
  enableCheckpoint: true, // Enable IndexedDB persistence

}); // Allow 3 concurrent tasks
let currentGroupId: string | null = null;

// Logger
function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logOutput.textContent += line;
  logOutput.scrollTop = logOutput.scrollHeight;
  console.log(msg);
}

// Create Task UI
function createProgressBar(uploader: any) {
  const task = uploader.getTask();
  const existingUI = document.getElementById(`ui-${task.id}`);
  if (existingUI) return;

  const clone = taskTemplate.content.cloneNode(true) as DocumentFragment;
  const taskCard = clone.querySelector('.task-card') as HTMLDivElement;
  const nameEl = clone.querySelector('.task-name') as HTMLHeadingElement;
  const fillEl = clone.querySelector('.progress-fill') as HTMLDivElement;
  const statusEl = clone.querySelector('.task-status') as HTMLDivElement;
  const speedEl = clone.querySelector('.task-speed') as HTMLDivElement;
  const pauseBtn = clone.querySelector('.pause-btn') as HTMLButtonElement;
  const resumeBtn = clone.querySelector('.resume-btn') as HTMLButtonElement;
  const cancelBtn = clone.querySelector('.cancel-btn') as HTMLButtonElement;

  nameEl.textContent = task.path || task.fileName;
  taskCard.id = `ui-${task.id}`;

  const updateUI = (status: TaskStatus) => {
    statusEl.textContent = `Status: ${status}`;
    pauseBtn.disabled = status !== TaskStatus.Transferring;
    resumeBtn.disabled = status !== TaskStatus.Paused && status !== TaskStatus.Failed;
    cancelBtn.disabled = status === TaskStatus.Completed || status === TaskStatus.Cancelled;
  };

  updateUI(task.status);
  fillEl.style.width = `${task.progress}%`;

  // uploader events
  uploader.on('statusChange', ({ newStatus }: { newStatus: TaskStatus }) => {
    updateUI(newStatus);
    updateGroupUI();
    if (newStatus === TaskStatus.Completed) log(`Task ${task.fileName} completed.`);
  });

  uploader.on('progress', (data: any) => {
    fillEl.style.width = `${data.progress}%`;
    speedEl.textContent = `Speed: ${(data.speed / 1024).toFixed(2)} KB/s`;
    updateGroupUI();
  });

  uploader.on('error', (error: any) => {
    log(`Task ${task.fileName} error: ${error.message}`);
    updateUI(TaskStatus.Failed);
  });

  // button events
  pauseBtn.onclick = () => uploader.pause();
  resumeBtn.onclick = () => uploader.resume();
  cancelBtn.onclick = () => uploader.cancel();

  tasksContainer.appendChild(clone);
}

function updateGroupUI() {
  if (!currentGroupId) return;
  const status = manager.getGroupStatus(currentGroupId);

  groupStatusCard.style.display = 'block';
  groupIdDisplay.textContent = currentGroupId;
  groupProgressFill.style.width = `${status.progress}%`;
  groupStatusText.textContent = `Status: ${status.status} (${status.completed}/${status.total} files done)`;

  if (status.status === TaskStatus.Completed) {
    log(`[Group] All files in ${currentGroupId} have been uploaded!`);
  }
}

const checkInputs = () => {
  const hasFiles = (fileInput.files && fileInput.files.length > 0) || (folderInput.files && folderInput.files.length > 0);
  uploadBtn.disabled = !hasFiles;
};

fileInput.onchange = checkInputs;
folderInput.onchange = checkInputs;

uploadBtn.onclick = async () => {
  const files = Array.from(fileInput.files || []);
  const folderFiles = Array.from(folderInput.files || []);
  const allFiles = [...files, ...folderFiles];

  if (allFiles.length === 0) return;

  currentGroupId = 'group_' + Date.now();
  log(`Starting batch upload [${currentGroupId}] of ${allFiles.length} files...`);

  const config: IUploadConfig = {
    uploadUrl: 'https://httpbin.org/post',
    networkAdapter: new FetchAdapter(),
    chunkSize: 512 * 1024,
    maxConcurrentChunks: 1,
    enableHash: true,
    extraParams: (index, total, taskId) => {
      const u = manager.getUploader(taskId);
      return {
        taskId,
        chunk: index.toString(),
        total: total.toString(),
        path: u?.getTask().path || '',
        groupId: u?.getTask().groupId || ''
      };
    }
  };

  const uploaders = manager.uploadBatch(allFiles, config, currentGroupId);

  // Attempt to restore state first
  for (const uploader of uploaders) {
    createProgressBar(uploader);
    const restored = await uploader.restoreFromStorage();
    if (restored) {
      log(`Restored session for ${uploader.getTask().fileName}`);
      // If restored, it's paused. User must resume manually.
    } else {
      // If new, just ensure it's in the queue (uploadBatch enqueues it)
    }
  }

  // Clear inputs after starting
  fileInput.value = '';
  folderInput.value = '';
  checkInputs();
  updateGroupUI();
};

clearBtn.onclick = () => {
  tasksContainer.innerHTML = '';
  groupStatusCard.style.display = 'none';
  currentGroupId = null;
  log('Cleared task list.');
};

// Check for recoverable sessions
async function scanForRecoverableSessions() {
  const checkpoints = await manager.getRecoverableSessions();
  const historyItems: any[] = [];

  for (const cp of checkpoints) {
    // If checkpoint has a File object, we can auto-restore!
    if (cp.file) {
      log(`Auto-restoring session for ${cp.fileName}...`);

      const config: IUploadConfig = {
        uploadUrl: 'https://httpbin.org/post',
        networkAdapter: new FetchAdapter(),
        storageAdapter: storage,
        chunkSize: 512 * 1024,
        enableCheckpoint: true,
        maxConcurrentChunks: 1,
        enableHash: true,
        extraParams: (index, total, taskId) => {
          const u = manager.getUploader(taskId);
          return {
            taskId,
            chunk: index.toString(),
            total: total.toString(),
            path: u?.getTask().path || '',
            groupId: u?.getTask().groupId || ''
          };
        }
      };

      const uploader = manager.createUploader(cp.file, config, cp.groupId);
      createProgressBar(uploader);
      await uploader.restoreFromStorage();
      // It is now in Paused state, visible in UI.
    } else {
      // Fallback for checkpoints without File objects
      historyItems.push(cp);
    }
  }

  if (historyItems.length > 0) {
    historyCard.style.display = 'block';
    historyList.innerHTML = '';

    historyItems.forEach((cp: any) => {
      const li = document.createElement('li');
      const date = new Date(cp.timestamp).toLocaleString();
      const pct = Math.round((cp.transferredBytes / (cp.fileSize || 1)) * 100);
      li.innerHTML = `
        <strong>${cp.fileName || 'Unknown File'}</strong> 
        <span style="color: #666; font-size: 0.9em;">
          (${pct}% uploaded) - Last active: ${date}
        </span>
        <div style="font-size: 0.8em; color: #999;">Path: ${cp.path || '/'}</div>
      `;
      li.style.marginBottom = '10px';
      li.style.paddingBottom = '10px';
      li.style.borderBottom = '1px solid #eee';
      historyList.appendChild(li);
    });

    log(`Found ${historyItems.length} legacy sessions in IndexedDB.`);
  }
}

scanForRecoverableSessions();

log('TransferManager initialized with IndexedDB storage support.');
