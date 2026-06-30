> 📋 **Phase 7 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 7 — 정확도 · 견고성 · 운영 마감 + 평가(eval) 하니스

v2의 핵심 강화: eval을 정식 Phase로 끌어올린다. "크래시 안 남"을 넘어 **음악적 유사도 지표로 정확도를 수치화**하고 회귀 스냅샷으로 지킨다. 리서치:omr-accuracy에서 실재가 확인된 오픈 구현만 쓴다 — **MV2H**(github.com/apmcleod/MV2H, 다성 전사를 multi-pitch/voice/meter/value/harmony 5축으로 평가, 비정렬 전사를 자동 정렬), **TEDn**(github.com/ufal/olimpic-icdar24의 `app.evaluation.TEDn`, MusicXML 트리 편집거리, 인간 평가 상관 최상으로 보고됨), 그리고 보조로 **MusicDiff**(arxiv 2506.10488 SMB 논문이 개선, 파싱 불가 OMR 출력까지 기호 비교). 회귀 세트는 5종: 벡터1, 깨끗한 스캔2, 가사+코드1, 다성부1. 각각 ground-truth MusicXML을 둔다.

벡터/래스터 판별은 리서치:omr-accuracy 확정 사실로 정교화한다 — **pdfimages -list로 임베드 이미지가 0개면 순수 벡터 확정**, **pdffonts로 임베드 폰트(=벡터 글리프) 식별**, **mutool로 페이지 객체가 XObject 비트맵뿐인지 검사**. 순수 벡터 악보는 OMR을 거치지 말고 **PDFtoMusic Pro류 직접 경로**를 권한다(단 PDFtoMusic Pro는 표보 SW가 만든 "character" 벡터 PDF에서만 동작하고 스캔 PDF엔 작동하지 않으며, MusicXML 내보내기는 Pro만 지원 — 이 제약을 분기와 함께 명시).

```text
[프롬프트 — Phase 7]
역할: 너는 변환 품질을 수치로 관리하고 운영 견고성을 마감하는 엔지니어다.
목표: (1) 벡터/래스터 판별을 파이프라인 맨 앞에서 정교화하고 순수 벡터 전용 경로를
분기, (2) 음악적 유사도 지표로 accuracy_score를 산출하는 eval 하니스 구축,
(3) 회귀 5종으로 스냅샷 비교, (4) 신뢰도 시각화·멀티 movement 병합·에러 UX·비용
대시보드 마감.

[검증된 사실 — 단정해도 되는 것]
- pdfimages -list 로 임베드 이미지 0개면 순수 벡터 PDF 확정.
- pdffonts 로 임베드 폰트가 잡히면 텍스트=벡터 글리프 신호. 폰트 없고 큰 이미지만
  있으면 스캔(래스터) 신호.
- mutool show/extract 로 페이지 객체가 XObject 비트맵뿐인지 vs 벡터 경로/텍스트가
  있는지 판별 가능.
- PDFtoMusic Pro는 "표보 소프트웨어가 생성한 character 형식 벡터 PDF"에서만 동작,
  스캔 PDF엔 작동하지 않음. 무료판은 MusicXML 미지원(Pro만).
- 평가 오픈 구현: MV2H(apmcleod/MV2H), TEDn(ufal/olimpic-icdar24의 app.evaluation.TEDn,
  zss+Levenshtein 의존), MusicDiff(SMB 논문이 개선, 파싱 불가 출력 비교 가능).
- "Audiveris/homr/oemer를 SMB로 직접 벤치마크한 결과표"는 SMB 원논문에 없음 →
  수치 인용 금지, 우리 회귀셋으로 자체 측정만.

[산출물]
A) /worker/src/pdfKind.ts
   - detectPdfKind(pdfPath): Promise<{ kind:'vector'|'raster'|'unknown', signals:{...} }>
   - pdfimages -list / pdffonts / mutool 결과를 종합. 이미지 0 & 폰트 있음 → vector.
     큰 단일 이미지 300~600dpi & 폰트 없음 → raster. 애매하면 unknown(→ Audiveris 진행).
   - pipeline.ts 맨 앞에서 호출해 jobs.pdf_kind 채움. vector면 report에
     "PDFtoMusic Pro류 직접 경로 권장(단 스캔 PDF엔 미적용, Pro만 MusicXML)" 안내 플래그.
B) /worker/src/merge.ts
   - mergeMovements(mxlPaths: string[]): Promise<string>
   - Audiveris가 멀티 movement를 .mxl 여러 개로 쪼갠 경우, 사용자가 옵션 선택 시
     하나의 score-partwise로 병합(part/measure 번호 연속성 보존). fast-xml-parser로 raw 조작.
C) /eval/  — 평가 하니스
   - /eval/dataset/  : 회귀 5종. 각 케이스 폴더에 input.pdf + ground_truth.musicxml
       - vector1/  (표보 SW 벡터 PDF)
       - scan_clean1/, scan_clean2/  (깨끗한 스캔)
       - lyrics_chords1/  (가사+코드)
       - polyphony1/  (다성부)
   - /eval/metrics/  : MV2H·TEDn 래퍼(외부 오픈 구현 호출). music-error-rate류는
       MusicDiff/OMR-NED를 보조로.
   - /eval/run.ts  : 각 케이스에 대해 파이프라인 실행 → 산출 .mxl을 MusicXML로 풀어
       ground_truth와 MV2H+TEDn 비교 → accuracy_score(0~1) 계산. jobs.accuracy_score
       및 /eval/baseline.json 갱신. 스냅샷 비교(기준 대비 회귀 시 비교표 출력).
   - /eval/README.md : 외부 도구(MV2H jar, TEDn 파이썬, MusicDiff) 설치/실행법.
D) 신뢰도 시각화: Phase 6 DiffReport에 페이지/시스템별 confidence 히트맵 추가
   (백엔드 report에 perSystemConfidence 배열을 채워 내려보냄).
E) (선택) /app/(admin)/cost/page.tsx — 잡별 cost_usd, 모델 티어 사용량, 레이트리밋
   현황 대시보드. 서버 컴포넌트로 jobs 집계.

요구사항: accuracy_score는 단일 숫자로 강제하되, report에는 MV2H 5축 분해와 TEDn
원점수를 함께 남긴다(나중에 어느 축이 약한지 추적). 회귀 실행은 "크래시 없음"을
하드 게이트로, accuracy_score 하락은 소프트 경고(베이스라인 대비 -ε 초과 시 비교표).
추측 모델명/추측 벤치마크 수치 금지.
```

평가 래퍼 시그니처(타입 포함, 의사코드):

```ts
// /eval/run.ts
interface EvalCaseResult {
  caseId: string;
  crashed: boolean;
  mv2h: { multiPitch: number; voice: number; meter: number; value: number; harmony: number; overall: number };
  tedn: number;            // 정규화 트리 편집거리 점수(0~1, 높을수록 좋음)
  accuracyScore: number;   // mv2h.overall과 tedn의 가중 결합
  pdfKind: 'vector' | 'raster' | 'unknown';
}
async function evalCase(caseDir: string): Promise<EvalCaseResult>;
async function runRegression(): Promise<EvalCaseResult[]>; // 5종 전부 + baseline.json 비교

// /worker/src/pdfKind.ts
interface PdfKindSignals {
  embeddedImageCount: number;   // pdfimages -list 결과 행 수
  hasEmbeddedFonts: boolean;    // pdffonts 결과
  pageObjectsAreBitmapOnly: boolean; // mutool 검사
}
async function detectPdfKind(pdfPath: string): Promise<{ kind: 'vector'|'raster'|'unknown'; signals: PdfKindSignals }>;
```

**산출물**
- `/worker/src/pdfKind.ts` (벡터/래스터 판별 정교화 + 순수 벡터 경로 분기 플래그)
- `/worker/src/merge.ts` (멀티 movement 병합 옵션)
- `/eval/` (데이터셋 5종 + MV2H/TEDn 래퍼 + `run.ts` 비교 스크립트 + `baseline.json` 기준 결과 + README)
- (선택) `/app/(admin)/cost/page.tsx` (비용·레이트리밋 대시보드)
- Phase 6 `DiffReport`에 페이지/시스템별 신뢰도 히트맵 추가

**완료 판정**
- [ ] **회귀 5종(벡터1·깨끗한 스캔2·가사+코드1·다성부1)이 전부 크래시 없이 통과**한다(하드 게이트).
- [ ] `/eval/run.ts`가 각 케이스에 대해 **accuracy_score를 출력**하고, MV2H 5축 분해 + TEDn 원점수가 report에 남는다.
- [ ] `baseline.json` 대비 회귀(점수 하락) 시 케이스별 비교표가 출력된다(소프트 경고).
- [ ] `detectPdfKind`가 순수 벡터 PDF에서 `kind:'vector'`(`embeddedImageCount:0` & `hasEmbeddedFonts:true`), 깨끗한 스캔에서 `kind:'raster'`를 정확히 분류한다.
- [ ] 벡터 PDF에 대해 report에 "PDFtoMusic Pro류 직접 경로 권장(스캔 PDF엔 미적용, Pro만 MusicXML)" 안내가 뜬다.
- [ ] 멀티 movement .mxl을 `mergeMovements`로 병합하면 part/measure 번호 연속성이 유지되고 MusicXML 스키마 검증을 통과한다.
- [ ] DiffReport에 **페이지/시스템별 신뢰도 시각화**가 렌더된다.
- [ ] (선택 구현 시) 비용 대시보드가 잡별 `cost_usd`와 모델 티어 사용량을 보여준다.

**정확도 영향**
이 Phase가 "정확도를 측정 가능하게" 만드는 단계다. MV2H/TEDn 수치가 없으면 어떤 변경이 정확도를 올렸는지/내렸는지 알 수 없어 개선이 도박이 된다. 판별 정교화는 순수 벡터를 OMR로 보내 발생하는 불필요한 lossy 변환을 막아 그 클래스의 정확도를 크게 올린다(벡터 직접 경로가 OMR보다 정확). MV2H 5축 분해는 "harmony(코드)만 약함" 같은 약점을 짚어 Phase 3 Vision 보정의 우선순위를 정한다.

**검증 명령**

```bash
# 1) 회귀 5종 실행 — 크래시 없음 + accuracy_score 출력 (하드 게이트)
npx tsx eval/run.ts --all
# 기대 출력 예: 각 caseId별 { crashed:false, mv2h.overall, tedn, accuracyScore } + baseline diff 표

# 2) 벡터/래스터 판별 단위 검증
node -e "require('./worker/dist/pdfKind').detectPdfKind('eval/dataset/vector1/input.pdf').then(r=>console.log(JSON.stringify(r,null,2)))"
# 기대: { kind:'vector', signals:{ embeddedImageCount:0, hasEmbeddedFonts:true } }

# 3) 순수 벡터 판별의 1차 근거(외부 도구 직접 확인)
pdfimages -list eval/dataset/vector1/input.pdf   # 이미지 행 0개여야 vector
pdffonts eval/dataset/vector1/input.pdf          # 임베드 폰트가 잡혀야 vector
pdfimages -list eval/dataset/scan_clean1/input.pdf  # 큰 이미지가 잡혀야 raster

# 4) 멀티 movement 병합 결과의 스키마 검증 (로컬 xml.xsd 패치본 사용 권장)
xmllint --noout --schema /opt/musicxml/musicxml.xsd /work/<jobId>/corrected/merged.musicxml \
  && echo "OK: merged MusicXML valid"
```

> 참고(불확실 표기 — 단정 금지): Audiveris 출력의 MusicXML이 "lossy"라는 **공식 명문은 리서치에서 확인되지 않았다**(README는 오히려 `.omr`이 full-fidelity 표현이고 MusicXML은 export 포맷이라 기술). 따라서 본 문서는 OMR→MusicXML이 표현력 손실을 동반할 수 있다는 일반론까지만 두고, "공식 문서가 손실을 명시한다"는 표현은 쓰지 않는다. `.omr` 원본은 항상 보관해 재처리 여지를 남긴다.
