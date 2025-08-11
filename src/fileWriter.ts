import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import readline from "readline";

interface FileState {
  handle: fs.FileHandle;
  timer?: NodeJS.Timeout;
}

export default class FileWriter {
  private baseDir: string;
  private queues = new Map<string, Promise<void>>(); // per-ID promise chain
  private fileStates = new Map<string, FileState>(); // handle + idle timer
  private idleTimeoutMs: number;

  constructor(baseDir: string = "/transcripts/active", idleTimeoutMs = 5000) {
    this.baseDir = path.join(process.cwd(), baseDir);
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /**
   * Ensures the base directory exists
   */
  private async ensureBaseDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Gets or opens a file handle for a specific ID
   */
  private async getFileHandle(id: string) {
    let state = this.fileStates.get(id);
    if (state) {
      // reset idle timer if already open
      this.resetIdleTimer(id, state);
      return state.handle;
    }

    await this.ensureBaseDir();
    const filePath = path.join(this.baseDir, `${id}.jsonl`);

    // "a" mode => append, create if not exists
    const handle = await fs.open(filePath, "a");

    state = { handle };
    this.fileStates.set(id, state);

    // start idle close timer
    this.resetIdleTimer(id, state);

    return handle;
  }

  /**
   * Starts or resets the idle close timer for a file
   */
  private resetIdleTimer(id: string, state: FileState) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      await this.closeFile(id);
    }, this.idleTimeoutMs);
  }

  /**
   * Closes a single file handle
   */
  private async closeFile(id: string) {
    const state = this.fileStates.get(id);
    if (state) {
      await state.handle.close().catch(() => {});
      this.fileStates.delete(id);
    }
  }

  /**
   * Appends a line to the given ID's transcript file.
   * The line is serialized as JSON and followed by a newline.
   * Writes are queued per ID to preserve order.
   */
  append(id: string, obj: string): Promise<void> {
    const serialized = `${obj}\n`;

    const last = this.queues.get(id) || Promise.resolve();

    const next = last
      .catch((e) => {
        console.error(e);
      }) // prevent chain break on error
      .then(async () => {
        const handle = await this.getFileHandle(id);
        await handle.appendFile(serialized, "utf8");
      });

    this.queues.set(id, next);
    return next;
  }

  edit(id: string, obj: any): Promise<void> {
    const last = this.queues.get(id) || Promise.resolve();

    const next = last
      .catch((e) => {
        console.error(e);
      })
      .then(async () => {
        const filePath = path.join(this.baseDir, `${id}.jsonl`);
        const tempPath = filePath + ".tmp";

        try {
          // If file doesn't exist, nothing to edit
          await fs.access(filePath);
        } catch {
          return;
        }

        // Create read and write streams
        const readStream = createReadStream(filePath, { encoding: "utf8" });
        const writeStream = createWriteStream(tempPath, { encoding: "utf8" });

        // Read line-by-line using readline
        const rl = readline.createInterface({
          input: readStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) {
            writeStream.write("\n");
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            if (parsed.id === obj.id) {
              writeStream.write(JSON.stringify(obj) + "\n");
            } else {
              writeStream.write(line + "\n");
            }
          } catch {
            // Preserve invalid lines untouched
            writeStream.write(line + "\n");
          }
        }

        // Close streams
        await new Promise((res) => writeStream.end(res));

        // Replace original file with updated temp file
        await fs.rename(tempPath, filePath);
      });

    this.queues.set(id, next);
    return next;
  }

  delete(id: string, obj: any): Promise<void> {
    const last = this.queues.get(id) || Promise.resolve();

    const next = last
      .catch((e) => {
        console.error(e);
      })
      .then(async () => {
        const filePath = path.join(this.baseDir, `${id}.jsonl`);
        const tempPath = filePath + ".tmp";

        try {
          // If file doesn't exist, nothing to edit
          await fs.access(filePath);
        } catch {
          return;
        }

        // Create read and write streams
        const readStream = createReadStream(filePath, { encoding: "utf8" });
        const writeStream = createWriteStream(tempPath, { encoding: "utf8" });

        // Read line-by-line using readline
        const rl = readline.createInterface({
          input: readStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) {
            writeStream.write("\n");
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            if (parsed.id === obj.id) {
              // Do nothing cause i want to delete the line
            } else {
              writeStream.write(line + "\n");
            }
          } catch {
            // Preserve invalid lines untouched
            writeStream.write(line + "\n");
          }
        }

        // Close streams
        await new Promise((res) => writeStream.end(res));

        // Replace original file with updated temp file
        await fs.rename(tempPath, filePath);
      });

    this.queues.set(id, next);
    return next;
  }

  /**
   * Closes all file handles — should be called on shutdown
   */
  async closeAll() {
    for (const [id] of this.fileStates) {
      await this.closeFile(id);
    }
    console.log("Closed all handles");
  }
}
