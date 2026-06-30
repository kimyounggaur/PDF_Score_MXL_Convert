import { FileMusic } from "lucide-react";
import { Uploader } from "@/components/Uploader";

export default function HomePage() {
  return (
    <main className="app-shell">
      <div className="workspace">
        <section className="panel tool-panel" aria-labelledby="home-title">
          <p className="eyebrow">
            <FileMusic size={18} aria-hidden />
            PDF Score to MXL
          </p>
          <h1 id="home-title" className="title">
            PDF 악보를 MXL로 변환
          </h1>
          <p className="subtitle">
            Audiveris 기반 OMR에 시스템 단위 대조, 검증, 롤백 흐름을 붙인 변환 파이프라인입니다.
          </p>
          <Uploader />
        </section>
        <section className="panel score-panel" aria-label="샘플 악보">
          <object className="score-object" data="/sample-score.pdf" type="application/pdf">
            <p className="section">샘플 악보 미리보기를 표시할 수 없습니다.</p>
          </object>
        </section>
      </div>
    </main>
  );
}
