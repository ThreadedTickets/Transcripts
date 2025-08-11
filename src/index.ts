import fs from "fs";
import express, { NextFunction, Request, Response } from "express";
import {
  addTag,
  cleanupExpiredTranscripts,
  createTranscriptInDb,
  findTranscripts,
  removeTag,
} from "./database";
import { pipeline } from "stream";
import path from "path";
import FileWriter from "./fileWriter";
import { finishTranscript } from "./finish";

// Check the transcript folders exist
if (!fs.existsSync("./transcripts")) {
  fs.mkdirSync("./transcripts");
  fs.mkdirSync("./transcripts/complete");
  fs.mkdirSync("./transcripts/active");
}

const app = express();
const init = async () => {
  await cleanupExpiredTranscripts();
};
init();
const writer = new FileWriter();

app.get("/", (req: Request, res: Response) => {
  res
    .json({
      name: "Threaded Transcript Server",
    })
    .status(200);
});

// Authorization
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.split(" ")[1];

  if (!token || token !== process.env["ACCESS_TOKEN"])
    return res.status(401).json({ message: "go away" });

  next();
});

app.get("/transcript/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const transcriptFilePath = path.join(`./transcripts/complete`, `${id}.json`);

  try {
    console.log(`Serving transcript ${id}`);
    await fs.promises.access(transcriptFilePath);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${id}.json"`);

    const readStream = fs.createReadStream(transcriptFilePath);
    pipeline(readStream, res, (err) => {
      if (err) {
        console.log(err);
        return res.end("error!!!");
      }
    });
  } catch (err) {
    console.log(err);
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Transcript not found" });
    } else {
      res.status(500).json({ error: "Failed to read transcript" });
    }
  }
});

app.post("/write/:id", async (req: Request, res: Response) => {
  const transcriptId = req.params.id;
  const message = req.body;

  if (!message) return res.status(400).json({ message: "provide a message" });

  writer.append(transcriptId, JSON.stringify(message));

  res.status(200).json({ message: "ok" });
});

app.post("/edit/:id", async (req: Request, res: Response) => {
  const transcriptId = req.params.id;
  const message = req.body;

  if (!message) return res.status(400).json({ message: "provide a message" });

  writer.edit(transcriptId, message);

  res.status(200).json({ message: "ok" });
});

app.post("/delete/:id", async (req: Request, res: Response) => {
  const transcriptId = req.params.id;
  const message = req.body;

  if (!message) return res.status(400).json({ message: "provide a message" });

  writer.delete(transcriptId, message);

  res.status(200).json({ message: "ok" });
});

app.post("/finish/:server/:transcript", async (req: Request, res: Response) => {
  const transcriptId = req.params.transcript;
  const serverId = req.params.server;
  const metadata = req.body ?? {};

  await finishTranscript(transcriptId, metadata);
  createTranscriptInDb(
    transcriptId,
    serverId,
    metadata.permanent ?? false,
    metadata.tags ?? []
  );
  res.status(200).json({ message: "ok" });
});

app.post("/addTag/:id", async (req: Request, res: Response) => {
  const transcriptId = req.params.id;
  const tag = req.body.tag;
  if (!tag || tag.length > 32)
    return res.status(400).json({ message: "tag error" });

  addTag(transcriptId, tag);
  res.status(200).json({ message: "ok" });
});

app.post("/removeTag/:id", async (req: Request, res: Response) => {
  const transcriptId = req.params.id;
  const tag = req.body.tag;
  if (!tag) return res.status(400).json({ message: "tag error" });

  removeTag(transcriptId, tag);
  res.status(200).json({ message: "ok" });
});

app.get("/search/:server", async (req: Request, res: Response) => {
  const server = req.params.server;
  const tags = ((req.query?.t as string) ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const mode: any = req.query?.m ?? "any";
  if (!["any", "all"].includes(mode))
    return res.status(400).json({ message: "no bad mode" });
  if (!server) return res.status(400).json({ message: "no server?????" });

  res.status(200).json({
    transcripts: findTranscripts(server, tags, mode).map((t) => t.id),
  });
});

app.listen(process.env["PORT"], () => {
  console.info(`Listening on ${process.env["PORT"]}`);
});
