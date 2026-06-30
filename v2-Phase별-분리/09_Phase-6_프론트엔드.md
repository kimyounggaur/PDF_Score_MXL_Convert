> 📋 **Phase 6 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 6 — Next.js 프론트엔드 (업로드 · 진행 · 미리보기 · 다운로드)

톤은 깔끔하고 따뜻하게: 부드러운 그라데이션, 둥근 모서리, 넉넉한 여백. 상태는 **폴링 + 로컬 컴포넌트 상태**만 쓴다. 브라우저 스토리지(localStorage/IndexedDB) 금지 — 잡 상태의 단일 출처는 서버다. OSMD는 브라우저 DOM/VexFlow 의존이므로 반드시 `next/dynamic`의 `{ ssr: false }`로 로드한다(리서치:stack 확정). **`.mxl` Blob을 `osmd.load(blob)`에 그대로 넘기면 OSMD가 내부에서 압축 해제하므로 수동 unzip이 불필요**하다.

```text
[프롬프트 — Phase 6]
역할: 너는 따뜻하고 신뢰감 있는 변환 웹앱 UI를 만드는 프론트엔드 엔지니어다.
스택: Next.js 15 App Router + TypeScript. 미리보기는 OpenSheetMusicDisplay(OSMD).
디자인 톤: 부드러운 크림/오프화이트 배경, 둥근 모서리(rounded-2xl), 은은한 그림자,
넉넉한 여백, 한 가지 따뜻한 강조색(앰버/테라코타). 과한 그라데이션·이모지 남발 금지.

[절대 규칙]
- 상태는 폴링 + 로컬 useState/useReducer만. localStorage/sessionStorage/IndexedDB 금지.
- OSMD는 next/dynamic({ ssr:false })로만 import. 서버 렌더 금지.
- .mxl은 서버에서 fetch해 Blob으로 받아 osmd.load(blob)에 직접 넘긴다(수동 unzip 금지).
  서명 URL을 osmd.load(url)에 바로 넘기면 CORS 문제가 생길 수 있으니, 앱이 fetch 후
  Blob 전달.
- ANTHROPIC_API_KEY 등 서버 비밀은 클라이언트에서 절대 참조하지 않는다.

[산출물 — 컴포넌트]
A) /app/page.tsx (업로드 화면)
   - <Uploader/> 배치. 헤드라인 + 한 줄 설명("PDF 악보를 가장 정확한 .mxl로").
B) /components/Uploader.tsx
   - 드래그앤드롭 + 파일 선택. PDF만 허용.
   - 업로드 흐름: (1) 서버에 서명 업로드 URL 요청 → (2) 클라이언트가 그 URL로 PDF를
     직접 PUT(Next 서버 우회) → (3) POST /api/jobs 로 { sourcePath, fileName } 전송 →
     (4) 반환된 jobId로 /jobs/[id]로 라우팅.
   - 업로드 직후 서버가 판별한 pdf_kind가 들어오면 <AccuracyBadge/>로 벡터/래스터 +
     전처리 품질(좋음/주의/경고) 배지 노출.
C) /app/jobs/[id]/page.tsx (진행 + 결과 화면)
   - useJobPolling(id): 2~3초 간격으로 GET /api/jobs/:id 폴링. status가 done/failed면
     폴링 중단. cleanup으로 인터벌 해제. (자체 훅, 외부 저장소 사용 금지)
   - 진행 중: <ProgressSteps/>로 단계 인디케이터 + 페이지수/예상시간/누적비용/needs_human 수.
   - 완료: <ScorePreview/>(OSMD) + <DiffReport/>(접이식) + 다운로드 버튼 + 교정 N회/
     종료사유 배지 + MuseScore 안내.
   - 실패: 친절한 에러 카드 + 재시도 버튼.
D) /components/ProgressSteps.tsx
   - 단계: 판별/전처리 → OMR(Audiveris) → 렌더/슬라이싱 → AI 대조 → 보정 적용 → 검증 → 완료
   - 현재 stage를 강조, 지난 단계는 체크, 남은 단계는 흐리게. 페이지수·예상시간·비용 표시.
E) /components/ScorePreview.tsx
   - 'use client' + OSMD를 동적 import(ssr:false). 마운트 시 컨테이너 div에 렌더.
   - props: { mxlUrl }. 내부에서 fetch(mxlUrl) → blob → osmd.load(blob) → osmd.render().
   - 로딩/에러 상태 처리. 리사이즈 시 re-render.
F) /components/DiffReport.tsx
   - report(jsonb)를 접이식 카드로. missing_chords/missing_lyrics/wrong_notes를 마디별로.
   - needs_human 마디는 눈에 띄게 강조(앰버 배지 + "사람 검수 권장").
   - 채택/거부/경고를 색으로 구분. 페이지/시스템별 신뢰도(high/medium/low) 표시.
G) /components/AccuracyBadge.tsx
   - 입력: { pdfKind, preprocessQuality, accuracyScore? }
   - 벡터/래스터, 전처리 품질, (있으면) accuracy_score를 작은 pill 묶음으로.

요구사항: 모든 fetch는 no-store. 폴링 훅은 status가 종료상태면 즉시 멈추고,
언마운트 시 인터벌을 정리한다. 다운로드는 GET /api/jobs/:id가 준 서명 URL을 a[download]로.
타입(JobResponse, DiffReport 등)은 /worker와 공유하는 types에서 import.
```

핵심 훅·컴포넌트 시그니처(타입 포함):

```ts
// /app/jobs/[id]/useJobPolling.ts
interface JobResponse {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  stage: 'audiveris' | 'render' | 'vision' | 'apply' | 'validate' | null;
  pdfKind: 'vector' | 'raster' | 'unknown';
  pageCount: number | null;
  report: DiffReport | null;
  downloadUrl: string | null;     // server가 createSignedUrl로 생성
  error: string | null;
  costUsd: number;
  accuracyScore: number | null;
  needsHumanCount: number | null;   // jobs.needs_human_count — "사람 검수 N마디" 표시용
  refineIterations: number | null;
  terminationReason: string | null;
}
function useJobPolling(id: string, intervalMs = 2500): JobResponse | null;

// ScorePreview: SSR 비활성 동적 import 패턴
// const OSMDView = dynamic(() => import('./ScorePreviewInner'), { ssr: false });
async function loadMxlIntoOsmd(osmd: OpenSheetMusicDisplay, mxlUrl: string): Promise<void> {
  const blob = await (await fetch(mxlUrl, { cache: 'no-store' })).blob();
  await osmd.load(blob);   // OSMD가 .mxl(zip) 내부 해제 — 수동 unzip 불필요
  osmd.render();
}
```

**산출물**
- `/app/page.tsx`, `/app/jobs/[id]/page.tsx`
- `/components/Uploader.tsx`, `/components/ProgressSteps.tsx`, `/components/ScorePreview.tsx`, `/components/DiffReport.tsx`, `/components/AccuracyBadge.tsx`

**완료 판정**
- [ ] PDF를 드래그앤드롭하면 서명 URL로 직접 업로드되고(네트워크 탭에서 PUT이 Supabase 도메인으로 감), Next 서버로 파일 바이트가 안 간다.
- [ ] 업로드 후 `/jobs/[id]`로 이동, 단계 인디케이터가 `판별/전처리 → OMR → 렌더/슬라이싱 → AI 대조 → 보정 → 검증 → 완료` 순으로 진행된다.
- [ ] 진행 중 페이지수·예상시간·누적 비용·needs_human 수가 표시된다.
- [ ] 완료 시 OSMD 미리보기가 **에러 없이** 렌더되고(`.mxl` Blob 직접 로드), diff 리포트 접이식 카드가 마디별로 보이며, needs_human 마디가 강조된다.
- [ ] 교정 N회·종료사유 배지(수렴/상한/진동/검증실패)와 MuseScore 안내가 보인다.
- [ ] `.mxl` 다운로드 버튼이 서명 URL로 동작한다.
- [ ] 새로고침해도 화면이 서버 상태로 복원된다(브라우저 스토리지 미사용 — DevTools Application 탭에 앱 데이터가 없다).
- [ ] OSMD가 SSR로 끌려와 빌드/하이드레이션 에러를 내지 않는다(`{ ssr:false }` 적용).

**정확도 영향**
UI 자체는 인식 정확도를 바꾸지 않지만 **사용자가 결과를 신뢰할지/검수할지**를 좌우한다. needs_human 마디 강조와 페이지/시스템별 신뢰도 시각화가 없으면, 자동 보정이 손대지 못한 1~5%를 사용자가 그대로 신뢰해 버린다. 종료사유 배지(특히 "검증 실패로 원본 반환")는 무보정본을 보정본으로 오인하는 사고를 막는다.

**검증 명령**

```bash
# 1) SSR 안전성 — 프로덕션 빌드가 OSMD를 서버에서 끌어와 깨지지 않는지
npm run build && npm run start &
sleep 5 && curl -s http://localhost:3000/jobs/test-id -o /dev/null -w "%{http_code}\n"

# 2) 브라우저 스토리지 미사용 회귀 점검 (소스에 금지 API가 없는지)
grep -RInE "localStorage|sessionStorage|indexedDB" app/ components/ \
  && echo "FAIL: 브라우저 스토리지 사용됨" || echo "OK: no browser storage"

# 3) OSMD 동적 import(ssr:false) 적용 확인
grep -RIn "ssr: *false" components/ScorePreview.tsx
```
