"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, UploadCloud } from "lucide-react";

export function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(file: File) {
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    setBusy(true);
    try {
      const uploadRes = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/pdf" })
      });
      const upload = (await uploadRes.json()) as { sourcePath?: string; signedUrl?: string; error?: string };
      if (!uploadRes.ok || !upload.sourcePath || !upload.signedUrl) {
        throw new Error(upload.error ?? "업로드 URL을 만들지 못했습니다.");
      }
      const putRes = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "content-type": "application/pdf" },
        body: file
      });
      if (!putRes.ok) {
        throw new Error("PDF 업로드가 실패했습니다.");
      }
      const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePath: upload.sourcePath, fileName: file.name })
      });
      const job = (await jobRes.json()) as { jobId?: string; error?: string };
      if (!jobRes.ok || !job.jobId) {
        throw new Error(job.error ?? "변환 잡을 만들지 못했습니다.");
      }
      router.push(`/jobs/${job.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void submit(file);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0);
    if (file) void submit(file);
  }

  return (
    <div>
      <div
        className="dropzone"
        data-active={active}
        onDragEnter={() => setActive(true)}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
      >
        <div className="upload-icon">
          <UploadCloud size={28} aria-hidden />
        </div>
        <div>
          <strong>PDF 악보 선택</strong>
          <p className="muted">파일은 Supabase 서명 URL로 직접 전송됩니다.</p>
        </div>
        <div className="button-row">
          <button className="button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={18} aria-hidden /> : <FileUp size={18} aria-hidden />}
            {busy ? "업로드 중" : "파일 선택"}
          </button>
        </div>
        <input ref={inputRef} className="file-input" type="file" accept="application/pdf,.pdf" onChange={onChange} />
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
