> 📋 **Phase 5 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 5 — 비동기 잡 큐 + 파이프라인 오케스트레이션

이 Phase에서 비로소 앞의 모든 조각(전처리·OMR·렌더·Vision·보정·검증)이 하나의 **비동기 잡**으로 묶인다. 핵심 원칙은 절대 규칙 그대로다: **OMR은 HTTP 핸들러 안에서 동기 실행 금지, 무조건 잡 큐로**. 업로드 바이트는 Next 서버를 통과시키지 말고 Supabase 서명 URL로 클라이언트가 직접 PUT 한다(리서치:stack 확정 — App Router Route Handler에는 본문 크기 한도 옵션이 없고, FormData 대용량 업로드 바이너리 드롭 버그가 보고됨). Route Handler에는 메타데이터(파일 경로, jobId)만 오간다.

```text
[프롬프트 — Phase 5]
역할: 너는 PDF→MXL 변환 웹앱의 백엔드 오케스트레이션을 구축하는 시니어 엔지니어다.
목표: Phase 0.5~4.5에서 만든 함수들(preprocess, runAudiveris, renderAndParse,
verifyPage, applyCorrections+validate, repackMxl, refine 루프)을 BullMQ+Redis 잡
큐로 묶어 하나의 비동기 파이프라인으로 실행한다. 절대 규칙을 지켜라.

[절대 규칙]
1. Audiveris/poppler/OMR은 워커 프로세스의 child_process.spawn으로만 실행.
   Next.js Route Handler나 Edge에서 직접 실행 금지.
2. OMR은 HTTP 요청 안에서 동기 실행 금지 → 잡 큐 등록 후 즉시 jobId 반환.
3. ANTHROPIC_API_KEY는 워커 환경변수로만. 프론트 번들/Route Handler 응답에 절대 노출 금지.
4. 업로드 바이트는 Next 서버를 통과시키지 말 것. 클라이언트가 Supabase 서명 업로드
   URL로 직접 PUT. Route Handler는 jobId·source_path 같은 메타데이터만 다룬다.
5. 동시성: OMR은 CPU·JVM 힙 집약. 워커 concurrency는 1~2로 낮게 둔다. 처리량은
   "워커 인스턴스 수 증설"로 확보(같은 큐를 소비하는 worker 컨테이너를 늘림).
6. 잡당 폴더 격리(/work/<jobId>/) + 잡 종료 시 정리(성공/실패 모두).

[구현 산출물]
A) /app/api/jobs/route.ts — POST
   - 입력: { sourcePath: string, fileName: string } (이미 Storage에 업로드된 PDF 경로)
   - Supabase service_role 클라이언트로 jobs 테이블에 레코드 INSERT
       (status:'queued', stage:null, source_path, pdf_kind:'unknown', cost_usd:0)
   - BullMQ 큐 'omr'에 add({ jobId }, { attempts:2, backoff:{type:'exponential', delay:5000} })
   - 응답: { jobId } (201)
   - service_role 키는 서버 전용. 절대 클라이언트에 내려가지 않게 한다.

B) /app/api/jobs/[id]/route.ts — GET
   - jobs 테이블에서 단건 조회 → { id, status, stage, pdf_kind, page_count,
     report, result_mxl_path, error, cost_usd, accuracy_score } 반환
   - result_mxl_path가 있으면 Supabase createSignedUrl(만료 1h)로 다운로드 URL도 함께.
   - 폴링 대상이므로 가볍고 캐시 불가(no-store)하게.

C) /worker/src/queue.ts
   - BullMQ Queue('omr') 정의, Redis 연결(REDIS_URL).
   - export 큐 인스턴스 + 큐명 상수.

D) /worker/src/pipeline.ts — 핵심 오케스트레이터
   - Worker('omr', processor, { concurrency: Number(WORKER_CONCURRENCY ?? 1) })
   - processor(job):
     1) updateJob(jobId, status:'processing', stage:'audiveris') 식으로 단계마다 갱신
     2) Storage에서 input.pdf를 /work/<jobId>/input.pdf로 다운로드
     3) pdfKind = detectPdfKind(pdf)  // Phase 7의 pdfKind.ts, 맨 앞 분기
        - vector면 별도 경로 경고 플래그, 그래도 일단 Audiveris 진행
     4) preprocess(pdf)  // Phase 0.5: deskew/이진화/노이즈제거/DPI정규화
        - 품질 게이트 실패(너무 흐림/저해상)면 report에 경고 추가
     5) audiverisOut = runAudiveris(preprocessedPdf, jobDir)
     6) { pages, parsed } = renderAndParse(...)  // 시스템 단위 크롭 포함
     7) refine 루프 (REFINE_ENABLED 일 때, 아니면 1회):
          for it in 1..MAX_REFINE_ITERATIONS:
            corrections = verifyPage(...) per 대상 페이지/시스템
            { musicxml, validated } = applyCorrections(...)+validate(...)
            검증 실패 → 보정 폐기, 직전 유효본 유지, break
            수렴/진동/단조개선 가드(Phase 4.5)로 종료 판정
     8) mxlPath = repackMxl(finalMusicxml)  // 표준 .mxl zip
     9) Storage 업로드 → result_mxl_path, report(jsonb), cost_usd, 종료사유 기록
    10) updateJob(status:'done')
   - 단계마다 try/catch: 실패 시 status:'failed', error(메시지+스택 요약), 그리고
     "보정 실패면 Audiveris 원본 .mxl + 경고 반환" 규칙 적용(완전 실패와 구분).
   - finally: /work/<jobId>/ 정리(결과 업로드 후).
   - 비용 가드: JOB_COST_LIMIT_USD 초과 시 Vision 단계 중단, 부분 결과+경고.

E) docker-compose.yml — web / worker / redis 3 서비스
   - redis: healthcheck 포함
   - worker: depends_on redis(service_healthy), Dockerfile.audiveris 기반(JDK+
     Audiveris+Tesseract+poppler 포함), 환경변수 주입, deploy.replicas로 수평 확장 가능
   - web: Next standalone 빌드(output:'standalone'), Route Handler만 담당
   - 모든 환경변수는 .env에서 주입(키 하드코딩 금지)

요구사항: pipeline.ts에 각 stage 진입 시 jobs.stage를 갱신하는 헬퍼 setStage()를
두고, 한 곳에서만 DB를 만지게 한다(워커가 status 소유자). 타입은 구체적으로.
완료 시 "어떤 stage에서 어떤 함수를 호출하는지" 한 줄 주석으로 매핑을 남겨라.
```

함수 시그니처(타입 포함, 의사코드):

```ts
// /worker/src/pipeline.ts
// Stage는 §5 jobs.stage enum과 정확히 일치시킨다(단일 출처). 구현이 단순하면 일부 단계는 묶어도 됨.
type Stage =
  | 'detect' | 'preprocess' | 'audiveris' | 'render' | 'crop'
  | 'vision' | 'apply' | 'validate' | 'repack' | 'eval';
type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

interface PipelineResult {
  resultMxlPath: string;
  report: DiffReport;           // jsonb: { pages:[], applied:[], rejected:[], warnings:[], needsHuman:[] }
  costUsd: number;
  pdfKind: 'vector' | 'raster' | 'unknown';
  pageCount: number;
  accuracyScore: number | null; // Phase 7에서 eval 가능할 때만
  terminationReason: 'converged' | 'max_iterations' | 'oscillation' | 'validation_failed' | 'no_improvement' | 'cost_limit';
}

async function runPipeline(jobId: string): Promise<PipelineResult>;
async function setStage(jobId: string, stage: Stage, status?: JobStatus): Promise<void>;
```

**산출물**
- `/app/api/jobs/route.ts` (POST: Storage 경로 받아 jobs 레코드 생성 + 큐 등록 + jobId 반환)
- `/app/api/jobs/[id]/route.ts` (GET: 단건 조회 + 다운로드 서명 URL)
- `/worker/src/queue.ts` (BullMQ Queue + Redis 연결)
- `/worker/src/pipeline.ts` (오케스트레이터 + Worker + setStage 헬퍼)
- `docker-compose.yml` (web / worker / redis, 워커 수평 확장 가능)

**완료 판정** (모두 체크 가능해야 함)
- [ ] `docker compose up` 후 redis healthcheck 통과, worker가 큐 구독 로그 출력.
- [ ] `POST /api/jobs`에 `{ sourcePath, fileName }`을 보내면 **1초 이내** `{ jobId }`가 반환된다(OMR이 동기 실행되지 않는다는 증거).
- [ ] `GET /api/jobs/:id`를 폴링하면 `stage`가 `detect → preprocess → audiveris → render → crop → vision → apply → validate → repack → eval` 순으로 진행되고(구현 단계에 따라 일부 생략 가능), 최종 `status:'done'` + `result_mxl_path` + 다운로드 서명 URL이 채워진다.
- [ ] 일부러 손상된 PDF를 넣으면 `status:'failed'` + `error`가 채워지고 워커가 죽지 않는다(다음 잡 정상 처리).
- [ ] 보정이 검증에서 깨지는 케이스에서 `status:'done'`이되 `report.warnings`에 "보정 폐기, Audiveris 원본 반환"이 남고 `result_mxl_path`는 유효한 .mxl이다(잘못된 보정 > 무보정 규칙).
- [ ] `worker` 서비스 `replicas`를 2로 올리면 두 잡이 병렬 처리된다(동시성은 워커 수로 확보).
- [ ] 응답·번들 어디에도 `ANTHROPIC_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY`가 노출되지 않는다(grep으로 확인).

**정확도 영향**
직접적이진 않지만 **간접적으로 결정적**이다. 잡당 폴더 격리(`/work/<jobId>/`)가 깨지면 멀티 movement·멀티 페이지 산출물이 서로 덮어써 엉뚱한 .mxl이 나간다. 낮은 concurrency는 OMR이 메모리 부족으로 중간 실패(부분 인식)하는 것을 막아 인식 품질을 지킨다. 비용 가드는 "Vision 보정을 끝까지 못 돌린 부분 결과"를 명시적 경고와 함께 반환하게 해, 사용자가 무보정본을 보정본으로 오인하지 않게 한다.

**검증 명령**

```bash
# 1) 잡 생성이 비동기인지(즉시 반환되는지) 확인 — 1초 안에 jobId가 떨어져야 함
time curl -s -X POST http://localhost:3000/api/jobs \
  -H 'content-type: application/json' \
  -d '{"sourcePath":"uploads/sample.pdf","fileName":"sample.pdf"}'

# 2) 상태 폴링으로 stage 전이 관찰
JOB=<위에서 받은 jobId>
for i in $(seq 1 60); do
  curl -s http://localhost:3000/api/jobs/$JOB | jq '{status, stage, cost_usd, error}'
  sleep 3
done

# 3) 키 노출 회귀 점검 (web 번들에 서버 키가 새지 않는지)
docker compose exec web sh -c 'grep -RInE "sk-ant|service_role" .next/ || echo "OK: no server keys in bundle"'

# 4) Redis에 잡이 실제로 쌓이는지
docker compose exec redis redis-cli LLEN bull:omr:wait
```
