> 📋 **Phase 0.5 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 0.5 — PDF 전처리 & 입력 품질 게이트 (v2 신설, 정확도의 출발점)

**왜 필요한가.** OMR 정확도에는 천장이 있고, 그 천장은 **입력 이미지 품질**이 결정한다. Audiveris 공식 스캔 가이드는 "두 보표선 사이 간격(interline)이 약 20px가 되도록" 해상도를 맞추라고 권하며, 통상 **300 DPI(작은 기호는 400 DPI)**, 그리고 스캐너에서 1-bit 흑백으로 굳히지 말고 **grayscale로 넘겨 Audiveris의 적응형 이진화에 맡기라**고 명시한다. 즉 흐릿하거나 기울었거나 저해상도인 PDF를 그대로 OMR에 던지면, 그 뒤에 Claude Vision을 아무리 정교하게 붙여도 "원본에 없는 정보"를 복원할 수는 없다. 보정은 오인식을 고치는 것이지 사라진 픽셀을 만들어내는 게 아니다.

**그래서 파이프라인 맨 앞에 두 가지를 둔다.** ① **벡터/래스터 판별을 가장 먼저** 해서, 표보 소프트웨어가 만든 순수 벡터 PDF는 래스터 OMR로 망치지 말고 고품질 경로(이상적으로는 PDFtoMusic Pro류 — 단 이건 상용·벡터 전용)로 분기하거나 최소한 고해상도 렌더로 우대한다. ② 래스터(스캔/사진)는 **deskew → DPI 정규화 → grayscale → 적응형 이진화 → 노이즈/배경 제거**로 OMR 입력 자체의 품질을 끌어올린다. ③ 그리고 **품질 게이트**: 너무 흐리거나 저해상도면 jobs에 경고 플래그를 달아 사용자에게 "이 결과는 신뢰도가 낮을 수 있다"고 정직하게 알린다. (주의: oemer 개발자도 지적하듯 deskew가 **오히려 해가 될 때**가 있으니, 측정값 기반으로 조건부 적용하고 원본을 항상 보관한다.)

```text
[프롬프트 — Phase 0.5] PDF 전처리 & 입력 품질 게이트

# 목표
업로드된 PDF를 OMR에 넣기 전에 (1) 벡터/래스터 판별로 경로를 분기하고,
(2) 래스터는 OMR 친화적으로 전처리하며, (3) 입력 품질을 측정해 경고 플래그를 남긴다.
산출은 preprocessed/page-*.png (또는 정규화된 PDF) + qualityReport(JSON).

# 절대 규칙
- 원본은 절대 덮어쓰지 않는다(원본 PDF/원본 렌더 PNG는 항상 보관).
- 전처리는 "측정 -> 조건부 적용"이다. 무조건 deskew/이진화를 적용하지 말 것
  (deskew가 멀쩡한 페이지를 오히려 망칠 수 있다 — 측정된 skew가 임계 이상일 때만).

# 1) 벡터/래스터 판별 (파이프라인 최선두)
- poppler/mupdf 기반 신호를 조합한다:
  * pdffonts input.pdf    -> 임베드 폰트(=텍스트 글리프) 존재 여부
  * pdfimages -list input.pdf -> 임베드 비트맵 목록/해상도/색공간
  * (가능하면) mutool show / mutool info 로 페이지 객체가 비트맵 XObject뿐인지, 벡터 경로/텍스트가 있는지
- 판정 규칙(휴리스틱):
  * pdfimages 추출 결과 0개 + pdffonts에 실제 폰트 존재 => 'vector' (표보SW 생성 가능성)
  * 페이지마다 큰 비트맵 1장(300~600dpi)뿐 + 텍스트 거의 없음 => 'raster' (스캔/래스터화)
  * 혼재/모호 => 'unknown' (보수적으로 raster 경로 + 경고)
- jobs.pdf_kind 에 vector|raster|unknown 기록.

# 2-A) 벡터 경로
- 벡터로 판정되면:
  * pdftoppm 으로도 처리는 가능하되, 고해상도(예: 400dpi)로 렌더해 OMR 친화 PNG 생성.
  * report에 hint를 남긴다: "순수 벡터 PDF는 PDFtoMusic Pro(상용, 벡터 전용)로
    직접 변환 시 OMR보다 정확할 수 있음" (자동 연동은 하지 않음 — 안내만).
  * 장기 옵션 자리만 마련: detectPdfKind 결과가 vector면 향후 별도 추출 경로로 분기 가능하게 enum 분리.

# 2-B) 래스터 전처리 (OMR 입력 품질 향상)
- 렌더: pdftoppm -r 300 (작은 기호 많으면 -r 400) -png input.pdf preprocessed/page
  * 목표는 interline ~20px. 너무 낮으면 디테일 손실, 500dpi 초과는 낭비.
- 색공간: grayscale 유지(1-bit로 굳히지 말 것 — Audiveris 적응형 이진화에 맡긴다).
  필요 시 ImageMagick: convert in.png -colorspace Gray out.png
- deskew(조건부): skew 각도를 측정(예: ImageMagick -deskew, 또는 OpenCV로 보표선 각도 추정)해
  |angle| 이 임계(예: 0.5도) 이상일 때만 보정. unpaper 로 가장자리 검은 영역/원근/회전 정리 가능.
- 노이즈/배경: unpaper 또는 ImageMagick 형태학 연산으로 점 노이즈/배경 얼룩 제거.
- 이진화는 "전처리 산출물"이 아니라 측정/게이트 용도로만 시험 적용:
  * Otsu(전역, 빠름) vs Sauvola/Wolf(국소 적응, 저대비/불균일 배경에 강함) 비교는 평가용.
  * 실제 OMR 입력으로는 grayscale PNG를 넘기는 것을 기본으로(위 색공간 규칙).
- 도구는 실제 존재하는 것만 사용: poppler-utils(pdftoppm/pdfimages/pdffonts),
  ImageMagick(convert/identify, -deskew), unpaper, (선택) OpenCV(파이썬). ScanTailor류는 GUI라 배치 부적합.

# 3) 품질 게이트(측정 -> 경고)
- 페이지별로 측정:
  * 유효 해상도/픽셀 크기(identify), 추정 interline(보표선 간격, OpenCV 수평 투영 프로파일로 근사)
  * 대비(히스토그램 표준편차/동적범위), skew 각도, blur 지표(라플라시안 분산 등)
- 임계 미달이면 qualityReport.warnings 에 사유 코드 추가:
  * LOW_DPI(추정 interline < ~15px), LOW_CONTRAST, HIGH_SKEW(보정 후에도 큼), BLURRY
- jobs 레코드의 preprocess(jsonb)에 측정값·경고를 기록한다(별도 boolean 컬럼 없이 preprocess.warnings로).
  사용자에게는 "낮은 품질 경고" 배지로 노출(상세는 Phase 6).

# 함수 시그니처
- /worker/src/pdfKind.ts
    export type PdfKind = 'vector' | 'raster' | 'unknown';
    export interface PdfKindResult {
      kind: PdfKind;
      signals: { embeddedFonts: number; embeddedImages: number; hasVectorPaths: boolean };
      hint?: string; // 예: 벡터면 PDFtoMusic 안내
    }
    export async function detectPdfKind(pdfPath: string): Promise<PdfKindResult>;

- /worker/src/preprocess.ts
    export interface PageQuality {
      page: number;
      dpiEstimate: number;
      interlinePx: number | null;
      contrast: number;
      skewDeg: number;
      blurVar: number;
      warnings: Array<'LOW_DPI'|'LOW_CONTRAST'|'HIGH_SKEW'|'BLURRY'>;
    }
    export interface PreprocessResult {
      images: string[];          // preprocessed/page-01.png ...
      originalImages: string[];  // 원본 렌더 보관 경로
      qualityReport: { pages: PageQuality[]; overallWarning: boolean };
    }
    // 벡터면 고해상도 렌더만, 래스터면 전처리까지 수행
    export async function preprocessForOmr(
      input: { pdfPath: string; kind: PdfKind; jobDir: string }
    ): Promise<PreprocessResult>;

# 산출물 파일
- /worker/src/pdfKind.ts
- /worker/src/preprocess.ts
- /worker/src/__tests__/preprocess.test.ts (판별/게이트 단위 테스트)
- 잡 폴더: preprocessed/page-*.png, original/page-*.png, preprocess.json

# 자가 검증
- 벡터 샘플 / 깨끗한 스캔 / 흐린 저해상 스캔 3종으로:
  * detectPdfKind 가 각각 vector/raster/raster 로 분류되는지
  * 흐린 샘플에서 warnings 에 LOW_DPI 또는 BLURRY 가 잡히는지
```

**산출물**
- `/worker/src/pdfKind.ts` — `detectPdfKind(pdfPath): Promise<PdfKindResult>`
- `/worker/src/preprocess.ts` — `preprocessForOmr({pdfPath, kind, jobDir}): Promise<PreprocessResult>`
- `/worker/src/__tests__/preprocess.test.ts`
- 잡 폴더 산출: `preprocessed/page-*.png`, `original/page-*.png`, `preprocess.json`

**완료 판정**
- [ ] 벡터/깨끗한 스캔/흐린 스캔 **3종 샘플**에서 `detectPdfKind` 가 각각 `vector / raster / raster` 로 분류된다.
- [ ] 래스터 샘플이 **grayscale·300(또는 400)DPI PNG**로 렌더되고, **원본 렌더가 `original/` 에 별도 보관**된다.
- [ ] skew가 임계 미만인 깨끗한 페이지에는 deskew가 **적용되지 않는다**(조건부 적용 확인).
- [ ] 흐린 저해상 샘플에서 `qualityReport` 의 `warnings` 에 `LOW_DPI` 또는 `BLURRY` 가 잡히고, `jobs.preprocess.warnings` 에 기록된다.
- [ ] 단위 테스트가 통과한다.

**정확도 영향**(이 Phase가 v2 정확도 강화의 출발점)
- 입력 품질은 OMR 정확도의 **상한**이다. interline ~20px·grayscale·deskew 정규화는 보표/기호 검출 단계의 오류를 근본에서 줄여, 이후 모든 보정 단계의 부담을 낮춘다.
- 벡터 PDF를 래스터 OMR로 망치지 않게 분기하는 것만으로 해당 부류의 정확도가 크게 오른다(벡터는 글리프가 정확하므로).
- 품질 게이트는 **정직성 장치**다. 못 고치는 입력을 "고친 척" 내보내지 않고, 사용자에게 경고로 알려 신뢰를 지킨다.

**검증 명령**(복붙 가능)
```bash
# 벡터/래스터 판별 신호 직접 확인
pdffonts samples/vector.pdf        # 임베드 폰트가 나오면 vector 신호
pdfimages -list samples/vector.pdf # 추출 이미지 0개면 vector 확정 신호
pdfimages -list samples/scan.pdf   # 큰 비트맵이 페이지당 1장이면 raster

# 래스터 전처리 렌더 (grayscale, 300dpi)
pdftoppm -r 300 -gray -png samples/scan.pdf /tmp/pre/page
identify -format "%f %wx%h %[colorspace]\n" /tmp/pre/page*.png

# skew 측정/보정 시험 (ImageMagick) — 적용 전후 비교
convert /tmp/pre/page-1.png -deskew 40% /tmp/pre/page-1.deskew.png
identify -verbose /tmp/pre/page-1.png | grep -i 'standard deviation'  # 대비 근사

# 전처리/판별 단위 테스트
cd worker && npm test -- preprocess
```
