> 📋 **Phase 1 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 1 — Audiveris 코어 래퍼 + 파라미터 튜닝 (백엔드, UI 없음)

이 단계의 목표는 단 하나다. **PDF 한 개를 받아서 `.mxl` 파일 경로 배열을 안정적으로 돌려주는 함수**를 만든다. UI도, 큐도, Claude도 아직 없다. Phase 0에서 만든 도커 컨테이너 안에서 Audiveris CLI를 `child_process.spawn`으로 호출하고, 그 결과를 신뢰할 수 있게 수집하는 얇고 단단한 래퍼다. 여기가 부실하면 위 모든 단계가 흔들린다.

핵심은 "Audiveris는 입력 파일명(radix) 기반으로 **자기 마음대로** 출력 폴더와 파일을 만든다"는 사실을 인정하고, **출력 경로를 추측하지 말고 실제로 스캔해서 찾는다**는 원칙이다. 멀티 movement이면 `.mxl`이 여러 개 나온다(리서치 확인). 이걸 크래시 없이 다루는 게 이 단계의 진짜 함정이다.

```text
[프롬프트 — Phase 1]
역할: 너는 Node.js/TypeScript 백엔드 엔지니어다. UI는 만들지 마라. Audiveris CLI를
child_process로 호출하는 코어 래퍼 모듈 하나만 만든다.

전제(반드시 지켜라):
- Audiveris는 서버 사이드 subprocess로만 실행한다. 브라우저/Edge/서버리스에서 직접 실행 금지.
- 동기 HTTP 핸들러 안에서 호출하지 않는다(이 모듈은 워커에서만 부른다). 이 단계에선 CLI 스크립트로만 검증.
- 출력 경로는 절대 하드코딩하거나 추측하지 마라. Audiveris가 실제로 만든 .mxl 파일을
  출력 디렉터리에서 재귀 스캔해서 찾는다.

만들 파일: /worker/src/audiveris.ts 와 그 단위테스트 /worker/src/audiveris.test.ts.

요구 시그니처(TypeScript, 타입 그대로):

  export interface AudiverisOptions {
    /** 처리할 sheet 선택. 예: "1 4-5". 미지정이면 전체. (-sheets) */
    sheets?: string;
    /** OCR 언어. tesseract 코드 plus-결합. 예: "eng", "kor+eng". 기본 "eng". */
    ocrLang?: string;
    /** -constant KEY=VALUE 쌍들. fully-qualified key. 정확도/출력 튜닝용. */
    constants?: Record<string, string>;
    /** subprocess 타임아웃(ms). 기본 600_000 (10분). */
    timeoutMs?: number;
    /** Audiveris 실행 파일 경로/이름. 기본 process.env.AUDIVERIS_BIN ?? "audiveris". */
    bin?: string;
    /** 추가 raw CLI 인자(escape hatch). */
    extraArgs?: string[];
  }

  export interface AudiverisResult {
    /** Audiveris가 만든 모든 .mxl 절대경로(정렬됨). 0개면 실패로 간주. */
    mxlPaths: string[];
    /** 대표 1개(보통 첫 movement). mxlPaths[0]과 동일하되 명시적. */
    primaryMxl: string;
    /** movement/page 분할로 .mxl이 2개 이상이면 true. UI에서 경고 배지용. */
    multipleOutputs: boolean;
    /** .omr 프로젝트 파일 경로들(있으면). 재export/디버깅용 보관. */
    omrPaths: string[];
    /** subprocess 종료코드. */
    exitCode: number;
    /** 수집한 stdout/stderr 전문(로그 보관). */
    stdout: string;
    stderr: string;
    /** 출력 루트 디렉터리(<jobDir>/audiveris-out). */
    outputDir: string;
  }

  export async function runAudiveris(
    inputPdfPath: string,
    jobDir: string,
    opts?: AudiverisOptions
  ): Promise<AudiverisResult>;

구현 규칙:
1) 출력 디렉터리: outputDir = path.join(jobDir, "audiveris-out"). 없으면 mkdir -p.
2) CLI 인자 조립(검증된 표준 플래그만 사용):
   audiveris -batch -transcribe -export -output <outputDir> [옵션들] -- <inputPdfPath>
   - -batch : GUI 없이 실행
   - -export : MusicXML(.mxl) export (내부적으로 -transcribe 포함하지만 명시적으로 같이 둠)
   - -output <DIR> : 출력 기본 폴더
   - -sheets <range> : opts.sheets 있을 때만 추가
   - OCR 언어: opts.ocrLang(또는 기본 "eng")을 아래 constant로 주입
       -constant org.audiveris.omr.text.Language.defaultSpecification=<lang>
   - opts.constants의 각 항목을 -constant KEY=VALUE 로 추가
   - 입력 경로는 -- 뒤에 둔다(공백/한글 경로 안전).
   ※ 주의: 일부 빌드는 -constant 대신 구명칭 -option 을 쓴다(둘 다 지원). 또
     "-export"가 압축 .mxl을 내는지 비압축을 내는지는 빌드 설정에 따라
     org.audiveris.omr.sheet.BookManager.useCompression 같은 constant로 갈릴 수 있으니,
     실제 산출물 확장자를 스캔으로 확인하라(추측 금지). 정확한 플래그/상수명은
     `audiveris -help` 와 공식 CLI 핸드북에서 재확인하라.
3) child_process.spawn 사용(shell:false). stdout/stderr를 청크로 모아 문자열로 보관하고,
   동시에 console로도 스트리밍(긴 OMR 진행 가시성). exec/execSync 금지(버퍼/escape 위험).
4) 타임아웃: opts.timeoutMs(기본 600_000) 경과 시 child.kill("SIGKILL") 후
   명확한 에러 throw(메시지에 타임아웃 ms, 마지막 stderr 200자 포함).
5) 종료 후 출력 수집:
   - outputDir을 재귀 스캔해 확장자 .mxl 전부 수집 → 정렬 → mxlPaths.
   - .omr 전부 수집 → omrPaths (디버깅/재export 보관, 삭제 금지).
   - mxlPaths.length === 0 이면 exitCode가 0이어도 실패로 간주하고 throw
     (stderr에 "No OCR is available" 류가 있으면 메시지에 그대로 노출 → Phase 0 회귀 신호).
   - multipleOutputs = mxlPaths.length > 1.
   - primaryMxl = mxlPaths[0].
6) 로깅: 실행한 전체 커맨드라인, exitCode, mxl 개수, 소요시간(ms)을 한 줄 요약 로그로 남겨라.

멀티 movement 함정(중요): Audiveris는 book 안에서 발견한 movement마다 .mxl을 1개씩
만든다. 따라서 멀티 movement PDF는 .mxl이 여러 개 나온다. 이때 throw하지 말고
mxlPaths 전부를 반환하고 multipleOutputs=true로 표시하라. 어느 걸 대표로 쓸지(primaryMxl)
와 "전체 N개" 목록은 호출자(Phase 5 파이프라인)가 결정/표시한다.

CLI 진입점도 만들어라: npm run omr 가
  node --import tsx /worker/src/cli-omr.ts <pdfPath>
형태로 동작하게. 인자로 받은 PDF에 대해 runAudiveris를 호출하고 결과(JSON 요약)를 출력.
jobDir은 임시 폴더(os.tmpdir() 하위)로 생성.

단위테스트(audiveris.test.ts) — Audiveris 실행 없이도 도는 테스트 우선:
- (a) 결과 .mxl의 첫 4바이트가 ZIP 시그니처 "PK\x03\x04"인지 검사하는 헬퍼 isZip(buf)을
  만들고 테스트. (.mxl은 zip이다.)
- (b) 가짜 outputDir에 더미 파일(input.mxl, input.omr, movement-2.mxl 등)을 깔고,
  출력 수집 로직이 mxl 2개/omr 1개를 정확히 모으고 multipleOutputs=true가 되는지
  (= 멀티movement no-crash) 검증. 실제 Audiveris 호출은 mock 또는 별도 integration 태그.
- (c) mxl 0개일 때 throw 하는지.
```

**산출물**
- `/worker/src/audiveris.ts` — `runAudiveris()` 코어 래퍼(위 시그니처).
- `/worker/src/audiveris.test.ts` — zip 시그니처 검사 + 멀티movement 수집 no-crash + 0개 throw.
- `/worker/src/cli-omr.ts` — `npm run omr` 진입점.
- `package.json` 스크립트: `"omr": "tsx worker/src/cli-omr.ts"`.

**완료 판정** (전부 체크 가능해야 통과)
- [ ] `npm run omr -- samples/sample.pdf` 가 0이 아닌 개수의 `.mxl` 절대경로를 출력한다.
- [ ] 반환된 각 `.mxl`의 첫 4바이트가 `PK\x03\x04`(ZIP)이다.
- [ ] `.omr` 파일이 `jobDir` 아래에 보관되어 있다(삭제되지 않음).
- [ ] 멀티 movement 샘플(있으면)에서 `.mxl`이 2개 이상 나와도 throw 없이 `multipleOutputs=true`로 반환된다.
- [ ] 출력이 0개면(또는 stderr에 `No OCR is available`) 명확한 에러로 실패하고, 메시지에 마지막 stderr 일부가 포함된다.
- [ ] `npm test` 가 통과한다(zip 시그니처/멀티movement/0개 케이스).

**정확도 영향**
- **OCR 언어 주입**: 가사/텍스트가 한국어 등 비영어면 `ocrLang`을 정확히 지정해야 텍스트 인식이 산다. 기본 constant는 `org.audiveris.omr.text.Language.defaultSpecification`(초기값 `eng`)이며 plus-결합(`kor+eng`)으로 다중 언어 지정. **언어를 너무 많이 넣으면 인식이 느려지니** 실제 필요한 언어만. (리서치 확인)
- **입력 품질이 곧 정확도**: Audiveris는 OMR 정확도가 **입력 해상도/이진화 품질에 직결**된다. 적정 기준은 **두 보표선 간격(interline)이 약 20px**, A4 기준 **300 DPI**(작은 기호는 400 DPI), 200 DPI 미만은 디테일 손실. 또 **흑백 1-bit보다 grayscale 입력을 선호**하라 — Audiveris가 자체 adaptive 이진화를 하므로 미리 1-bit로 굳히면 오히려 손해. 이 입력 품질 끌어올리기는 Phase 0.5(전처리)와 Phase 2(렌더 DPI)에서 보장한다. (리서치 확인)
- **`.omr` 보관**: `.omr`은 Audiveris의 full-fidelity 프로젝트 파일이다. 보관해 두면 파라미터만 바꿔 **재transcribe/재export**가 가능해 디버깅·재현·refine 루프에 유리하다. (리서치 확인)
- **sheets 범위**: 멀티페이지 대용량에서 `-sheets`로 범위를 좁히면 테스트 반복이 빨라진다(정확도 자체보단 반복 속도·비용 영향).

**검증 명령**
```bash
# 1) 변환 실행 + 결과 경로/개수 확인
npm run omr -- samples/sample.pdf

# 2) 산출 .mxl이 진짜 zip인지(첫 4바이트 PK\x03\x04) 확인
#    (npm run omr 출력의 primaryMxl 경로를 넣어라)
head -c 4 <primaryMxl경로> | xxd        # 504b 0304 면 OK

# 3) MuseScore/OSMD로 실제로 열리는지(스모크) — Phase 4에서 자동화하지만 수동 1회 확인 권장
#    .mxl을 MuseScore로 열어 마디가 보이면 통과

# 4) 단위테스트
npm test -- audiveris
```
