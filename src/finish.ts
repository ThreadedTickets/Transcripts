import fs from "fs";
import path from "path";

export async function finishTranscript(id: string, metadata: any = {}) {
  const inputPath = path.join(
    process.cwd(),
    `/transcripts/active`,
    `${id}.jsonl`
  );
  const outputPath = path.join(
    process.cwd(),
    `/transcripts/complete`,
    `${id}.json`
  );
  const fileStream = fs.createReadStream(inputPath, { encoding: "utf8" });

  let buffer = "";
  const messages: any[] = [];
  let lineIndex = 0;

  for await (const chunk of fileStream) {
    buffer += chunk;
    let lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);

      messages.push(json);
      lineIndex++;
    }
  }

  if (buffer.trim()) {
    const json = JSON.parse(buffer);
    if (lineIndex === 0) metadata = json;
    else messages.push(json);
  }

  // Write output file
  await fs.promises.writeFile(
    outputPath,
    JSON.stringify({ metadata, messages })
  );
  await fs.promises.unlink(inputPath);
}
